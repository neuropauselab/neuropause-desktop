/**
 * Organizations service — pure domain logic over an `OrgRepository`.
 *
 * Enforces the tenancy rules: an org is created with its creator as `owner`;
 * only owners/admins manage members; the last active owner can't be removed or
 * demoted; invitations are opaque tokens (only a SHA-256 hash is stored) that
 * expire and are bound to the invited email. No HTTP, no database specifics —
 * routes map `OrgError` codes to status codes and inject a concrete repository.
 */
import { createHash, randomBytes } from 'node:crypto';
import type {
  Membership,
  OrgMember,
  Organization,
  OrgRepository,
  OrgRole,
  UserOrganization,
  Workspace,
} from './types';

export type OrgErrorCode = 'conflict' | 'forbidden' | 'not_found' | 'invalid' | 'expired';

export class OrgError extends Error {
  constructor(
    public readonly code: OrgErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrgError';
  }
}

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MANAGE_ROLES: readonly OrgRole[] = ['owner', 'admin'];

const canManage = (role: OrgRole): boolean => MANAGE_ROLES.includes(role);
const eq = (a: string | null, b: string | null): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

function slugify(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'org';
}

function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function requireActiveMember(
  repo: OrgRepository,
  orgId: string,
  userId: string,
): Promise<Membership> {
  const m = await repo.getMembershipByOrgUser(orgId, userId);
  if (!m || m.status !== 'active')
    throw new OrgError('forbidden', 'You are not a member of this organization.');
  return m;
}

/* ── Organizations ─────────────────────────────────────────────────────────── */

export interface CreateOrgInput {
  name: string;
  slug?: string;
  ownerUserId: string;
}
export interface CreateOrgResult {
  organization: Organization;
  membership: Membership;
}

export async function createOrganization(
  repo: OrgRepository,
  input: CreateOrgInput,
): Promise<CreateOrgResult> {
  const name = input.name.trim();
  if (!name) throw new OrgError('invalid', 'Organization name is required.');

  let slug: string;
  if (input.slug) {
    slug = slugify(input.slug);
    if (await repo.slugExists(slug))
      throw new OrgError('conflict', `The slug "${slug}" is already taken.`);
  } else {
    const base = slugify(name);
    let candidate = base;
    for (let i = 0; i < 5 && (await repo.slugExists(candidate)); i++) {
      candidate = `${base}-${randomBytes(2).toString('hex')}`;
    }
    slug = candidate;
  }

  const organization = await repo.createOrganization({ name, slug });
  const membership = await repo.createMembership({
    orgId: organization.id,
    userId: input.ownerUserId,
    role: 'owner',
    status: 'active',
    invitedEmail: null,
    inviteTokenHash: null,
    inviteExpiresAt: null,
    invitedBy: null,
  });
  return { organization, membership };
}

/* ── Invitations ──────────────────────────────────────────────────────────── */

export interface InviteInput {
  orgId: string;
  actorUserId: string;
  email: string;
  role: OrgRole;
}
export interface InviteResult {
  membership: Membership;
  /** The raw token — returned exactly once, to be delivered to the invitee. */
  token: string;
}

export async function inviteMember(repo: OrgRepository, input: InviteInput): Promise<InviteResult> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to invite members.');
  if (input.role === 'owner' && actor.role !== 'owner') {
    throw new OrgError('forbidden', 'Only an owner can invite another owner.');
  }
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new OrgError('invalid', 'A valid email is required.');

  if (await repo.getPendingInvite(input.orgId, email)) {
    throw new OrgError('conflict', 'That email already has a pending invitation.');
  }

  const { token, hash } = newInviteToken();
  const membership = await repo.createMembership({
    orgId: input.orgId,
    userId: null,
    role: input.role,
    status: 'invited',
    invitedEmail: email,
    inviteTokenHash: hash,
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    invitedBy: input.actorUserId,
  });
  return { membership, token };
}

export interface AcceptInviteInput {
  token: string;
  userId: string;
  userEmail: string;
}

export async function acceptInvite(
  repo: OrgRepository,
  input: AcceptInviteInput,
): Promise<Membership> {
  const invite = await repo.getMembershipByInviteTokenHash(hashToken(input.token));
  if (!invite || invite.status !== 'invited')
    throw new OrgError('invalid', 'This invitation is invalid or already used.');
  if (invite.inviteExpiresAt && Date.parse(invite.inviteExpiresAt) < Date.now()) {
    throw new OrgError('expired', 'This invitation has expired.');
  }
  if (!eq(invite.invitedEmail, input.userEmail)) {
    throw new OrgError('forbidden', 'This invitation was issued for a different email address.');
  }

  // If the user is already an active member, consume the invite and keep the seat.
  const existing = await repo.getMembershipByOrgUser(invite.orgId, input.userId);
  if (existing && existing.status === 'active') {
    await repo.deleteMembership(invite.id);
    return existing;
  }

  const updated = await repo.updateMembership(invite.id, {
    userId: input.userId,
    status: 'active',
    invitedEmail: null,
    inviteTokenHash: null,
    inviteExpiresAt: null,
  });
  if (!updated) throw new OrgError('not_found', 'Invitation not found.');
  return updated;
}

/* ── Members ──────────────────────────────────────────────────────────────── */

export async function listMembers(
  repo: OrgRepository,
  orgId: string,
  actorUserId: string,
): Promise<OrgMember[]> {
  await requireActiveMember(repo, orgId, actorUserId);
  return repo.listOrgMembers(orgId);
}

export interface ChangeRoleInput {
  orgId: string;
  actorUserId: string;
  membershipId: string;
  role: OrgRole;
}

export async function changeRole(repo: OrgRepository, input: ChangeRoleInput): Promise<Membership> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to change roles.');

  const target = await repo.getMembershipById(input.membershipId);
  if (!target || target.orgId !== input.orgId) throw new OrgError('not_found', 'Member not found.');

  const grantingOwner = input.role === 'owner';
  const touchingOwner = target.role === 'owner';
  if ((grantingOwner || touchingOwner) && actor.role !== 'owner') {
    throw new OrgError('forbidden', 'Only an owner can change an owner’s role.');
  }
  if (
    touchingOwner &&
    !grantingOwner &&
    target.status === 'active' &&
    (await repo.countActiveOwners(input.orgId)) <= 1
  ) {
    throw new OrgError('conflict', 'You cannot demote the last owner.');
  }

  const updated = await repo.updateMembership(target.id, { role: input.role });
  if (!updated) throw new OrgError('not_found', 'Member not found.');
  return updated;
}

export interface RemoveMemberInput {
  orgId: string;
  actorUserId: string;
  membershipId: string;
}

export async function removeMember(repo: OrgRepository, input: RemoveMemberInput): Promise<void> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to remove members.');

  const target = await repo.getMembershipById(input.membershipId);
  if (!target || target.orgId !== input.orgId) throw new OrgError('not_found', 'Member not found.');

  if (target.role === 'owner') {
    if (actor.role !== 'owner')
      throw new OrgError('forbidden', 'Only an owner can remove an owner.');
    if (target.status === 'active' && (await repo.countActiveOwners(input.orgId)) <= 1) {
      throw new OrgError('conflict', 'You cannot remove the last owner.');
    }
  }
  await repo.deleteMembership(target.id);
}

/* ── Workspaces ───────────────────────────────────────────────────────────── */

export interface CreateWorkspaceInput {
  orgId: string;
  actorUserId: string;
  name: string;
}

export async function createWorkspace(
  repo: OrgRepository,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to create workspaces.');
  const name = input.name.trim();
  if (!name) throw new OrgError('invalid', 'Workspace name is required.');
  return repo.createWorkspace(input.orgId, name);
}

export async function listWorkspaces(
  repo: OrgRepository,
  orgId: string,
  actorUserId: string,
): Promise<Workspace[]> {
  await requireActiveMember(repo, orgId, actorUserId);
  return repo.listWorkspaces(orgId);
}

export interface UpdateWorkspaceInput {
  orgId: string;
  actorUserId: string;
  workspaceId: string;
  name: string;
}

/** Rename a workspace. Owners and admins only. */
export async function updateWorkspace(
  repo: OrgRepository,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to manage workspaces.');
  const name = input.name.trim();
  if (!name) throw new OrgError('invalid', 'Workspace name is required.');
  const updated = await repo.updateWorkspace(input.orgId, input.workspaceId, { name });
  if (!updated) throw new OrgError('not_found', 'Workspace not found.');
  return updated;
}

export interface DeleteWorkspaceInput {
  orgId: string;
  actorUserId: string;
  workspaceId: string;
}

/** Delete a workspace. Owners and admins only. */
export async function deleteWorkspace(
  repo: OrgRepository,
  input: DeleteWorkspaceInput,
): Promise<void> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to manage workspaces.');
  const deleted = await repo.deleteWorkspace(input.orgId, input.workspaceId);
  if (!deleted) throw new OrgError('not_found', 'Workspace not found.');
}

/* ── A user's organizations ───────────────────────────────────────────────── */

/** The active organizations the given user belongs to. */
export async function listUserOrganizations(
  repo: OrgRepository,
  userId: string,
): Promise<UserOrganization[]> {
  return repo.listUserMemberships(userId);
}

/* ── Organization profile ─────────────────────────────────────────────────── */

/** Read an organization's profile. Any active member may view it. */
export async function getOrganization(
  repo: OrgRepository,
  orgId: string,
  actorUserId: string,
): Promise<Organization> {
  await requireActiveMember(repo, orgId, actorUserId);
  const org = await repo.getOrganizationById(orgId);
  if (!org) throw new OrgError('not_found', 'Organization not found.');
  return org;
}

export interface UpdateOrgInput {
  orgId: string;
  actorUserId: string;
  name: string;
}

/** Rename an organization. Owners and admins only. */
export async function updateOrganization(
  repo: OrgRepository,
  input: UpdateOrgInput,
): Promise<Organization> {
  const actor = await requireActiveMember(repo, input.orgId, input.actorUserId);
  if (!canManage(actor.role))
    throw new OrgError('forbidden', 'You do not have permission to update this organization.');
  const name = input.name.trim();
  if (!name) throw new OrgError('invalid', 'Organization name is required.');
  const updated = await repo.updateOrganization(input.orgId, { name });
  if (!updated) throw new OrgError('not_found', 'Organization not found.');
  return updated;
}

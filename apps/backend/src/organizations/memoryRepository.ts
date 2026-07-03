/**
 * In-memory OrgRepository — the reference implementation used by unit tests.
 * Mirrors the semantics the Postgres implementation must uphold (one membership
 * per org/user, one pending invite per org/email), so tests exercise the same
 * rules the database enforces. Each instance is fully isolated.
 */
import { randomUUID } from 'node:crypto';
import type {
  Membership,
  MembershipPatch,
  NewMembership,
  Organization,
  OrgRepository,
  UserOrganization,
  Workspace,
} from './types';

export function createMemoryOrgRepository(
  seed: { users?: { id: string; email: string; displayName?: string | null }[] } = {},
): OrgRepository {
  const orgs = new Map<string, Organization>();
  const members = new Map<string, Membership>();
  const workspaces = new Map<string, Workspace>();
  // Optional user directory so member listings can resolve identities the way
  // the Postgres implementation does via a join on the users table.
  const userDir = new Map<string, { email: string; displayName: string | null }>();
  for (const u of seed.users ?? [])
    userDir.set(u.id, { email: u.email, displayName: u.displayName ?? null });
  // Invite-token hashes are secrets kept out of the Membership view; held in a
  // per-instance side map keyed by membership id.
  const inviteTokenHashes = new Map<string, string | null>();

  const now = (): string => new Date().toISOString();
  const eq = (a: string | null, b: string | null): boolean =>
    (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

  return {
    async createOrganization({ name, slug }) {
      const org: Organization = {
        id: randomUUID(),
        slug,
        name,
        createdAt: now(),
        updatedAt: now(),
      };
      orgs.set(org.id, org);
      return org;
    },
    async getOrganizationById(orgId) {
      return orgs.get(orgId) ?? null;
    },
    async updateOrganization(orgId, patch) {
      const org = orgs.get(orgId);
      if (!org) return null;
      const next: Organization = { ...org, name: patch.name, updatedAt: now() };
      orgs.set(orgId, next);
      return next;
    },
    async slugExists(slug) {
      return [...orgs.values()].some((o) => o.slug.toLowerCase() === slug.toLowerCase());
    },

    async createMembership(input: NewMembership) {
      const m: Membership = {
        id: randomUUID(),
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
        status: input.status,
        invitedEmail: input.invitedEmail,
        inviteExpiresAt: input.inviteExpiresAt,
        invitedBy: input.invitedBy,
        createdAt: now(),
        updatedAt: now(),
      };
      if (
        m.userId &&
        [...members.values()].some((x) => x.orgId === m.orgId && x.userId === m.userId)
      ) {
        throw new Error('duplicate membership for org/user');
      }
      if (
        m.status === 'invited' &&
        m.invitedEmail &&
        [...members.values()].some(
          (x) =>
            x.orgId === m.orgId && x.status === 'invited' && eq(x.invitedEmail, m.invitedEmail),
        )
      ) {
        throw new Error('duplicate pending invite for org/email');
      }
      inviteTokenHashes.set(m.id, input.inviteTokenHash);
      members.set(m.id, m);
      return m;
    },
    async getMembershipById(id) {
      return members.get(id) ?? null;
    },
    async getMembershipByOrgUser(orgId, userId) {
      return [...members.values()].find((m) => m.orgId === orgId && m.userId === userId) ?? null;
    },
    async getMembershipByInviteTokenHash(hash) {
      const id = [...inviteTokenHashes.entries()].find(([, h]) => h === hash)?.[0];
      return id ? (members.get(id) ?? null) : null;
    },
    async getPendingInvite(orgId, email) {
      return (
        [...members.values()].find(
          (m) => m.orgId === orgId && m.status === 'invited' && eq(m.invitedEmail, email),
        ) ?? null
      );
    },
    async listMemberships(orgId) {
      return [...members.values()]
        .filter((m) => m.orgId === orgId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async listOrgMembers(orgId) {
      return [...members.values()]
        .filter((m) => m.orgId === orgId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((m) => {
          const u = m.userId ? userDir.get(m.userId) : undefined;
          return { ...m, userEmail: u?.email ?? null, userDisplayName: u?.displayName ?? null };
        });
    },
    async updateMembership(id, patch: MembershipPatch) {
      const existing = members.get(id);
      if (!existing) return null;
      const next: Membership = {
        ...existing,
        userId: patch.userId !== undefined ? patch.userId : existing.userId,
        role: patch.role ?? existing.role,
        status: patch.status ?? existing.status,
        invitedEmail: patch.invitedEmail !== undefined ? patch.invitedEmail : existing.invitedEmail,
        inviteExpiresAt:
          patch.inviteExpiresAt !== undefined ? patch.inviteExpiresAt : existing.inviteExpiresAt,
        updatedAt: now(),
      };
      if (patch.inviteTokenHash !== undefined) inviteTokenHashes.set(id, patch.inviteTokenHash);
      members.set(id, next);
      return next;
    },
    async deleteMembership(id) {
      inviteTokenHashes.delete(id);
      return members.delete(id);
    },
    async countActiveOwners(orgId) {
      return [...members.values()].filter(
        (m) => m.orgId === orgId && m.role === 'owner' && m.status === 'active',
      ).length;
    },

    async createWorkspace(orgId, name) {
      const w: Workspace = { id: randomUUID(), orgId, name, createdAt: now(), updatedAt: now() };
      workspaces.set(w.id, w);
      return w;
    },
    async updateWorkspace(orgId, workspaceId, patch) {
      const w = workspaces.get(workspaceId);
      if (!w || w.orgId !== orgId) return null;
      const next: Workspace = { ...w, name: patch.name, updatedAt: now() };
      workspaces.set(workspaceId, next);
      return next;
    },
    async deleteWorkspace(orgId, workspaceId) {
      const w = workspaces.get(workspaceId);
      if (!w || w.orgId !== orgId) return false;
      return workspaces.delete(workspaceId);
    },
    async listWorkspaces(orgId) {
      return [...workspaces.values()]
        .filter((w) => w.orgId === orgId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async listUserMemberships(userId) {
      const out: UserOrganization[] = [];
      for (const m of members.values()) {
        if (m.userId !== userId || m.status !== 'active') continue;
        const o = orgs.get(m.orgId);
        if (o)
          out.push({ membershipId: m.id, orgId: o.id, slug: o.slug, name: o.name, role: m.role });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

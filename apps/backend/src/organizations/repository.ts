/**
 * Postgres OrgRepository — the production implementation, using the shared
 * `query` helper (same style as the other repositories). Invite-token hashes are
 * written and matched here but never surfaced on the `Membership` view.
 * Exercised by the integration test suite (requires a real Postgres).
 */
import type {
  Membership,
  MembershipPatch,
  MembershipStatus,
  NewMembership,
  Organization,
  OrgMember,
  OrgRepository,
  OrgRole,
  UserOrganization,
  Workspace,
} from './types';
import { query } from '../db/pool';

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}
const toOrg = (r: OrgRow): Organization => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string | null;
  role: OrgRole;
  status: MembershipStatus;
  invited_email: string | null;
  invite_expires_at: Date | null;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
}
const M_COLS =
  'id, org_id, user_id, role, status, invited_email, invite_expires_at, invited_by, created_at, updated_at';
const toMembership = (r: MembershipRow): Membership => ({
  id: r.id,
  orgId: r.org_id,
  userId: r.user_id,
  role: r.role,
  status: r.status,
  invitedEmail: r.invited_email,
  inviteExpiresAt: r.invite_expires_at ? r.invite_expires_at.toISOString() : null,
  invitedBy: r.invited_by,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

interface MemberRow extends MembershipRow {
  user_email: string | null;
  user_display_name: string | null;
}
const toOrgMember = (r: MemberRow): OrgMember => ({
  ...toMembership(r),
  userEmail: r.user_email,
  userDisplayName: r.user_display_name,
});

interface WorkspaceRow {
  id: string;
  org_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}
const toWorkspace = (r: WorkspaceRow): Workspace => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

async function getMembershipById(id: string): Promise<Membership | null> {
  const { rows } = await query<MembershipRow>(`SELECT ${M_COLS} FROM memberships WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toMembership(rows[0]) : null;
}

export function createPgOrgRepository(): OrgRepository {
  return {
    async createOrganization({ name, slug }) {
      const { rows } = await query<OrgRow>(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, slug, name, created_at, updated_at',
        [name, slug],
      );
      return toOrg(rows[0]!);
    },
    async getOrganizationById(orgId) {
      const { rows } = await query<OrgRow>(
        'SELECT id, slug, name, created_at, updated_at FROM organizations WHERE id = $1',
        [orgId],
      );
      return rows[0] ? toOrg(rows[0]) : null;
    },
    async updateOrganization(orgId, patch) {
      const { rows } = await query<OrgRow>(
        `UPDATE organizations SET name = $2, updated_at = now() WHERE id = $1
         RETURNING id, slug, name, created_at, updated_at`,
        [orgId, patch.name],
      );
      return rows[0] ? toOrg(rows[0]) : null;
    },
    async slugExists(slug) {
      const { rows } = await query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM organizations WHERE lower(slug) = lower($1)) AS exists',
        [slug],
      );
      return rows[0]?.exists ?? false;
    },

    async createMembership(input: NewMembership) {
      const { rows } = await query<MembershipRow>(
        `INSERT INTO memberships
           (org_id, user_id, role, status, invited_email, invite_token_hash, invite_expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${M_COLS}`,
        [
          input.orgId,
          input.userId,
          input.role,
          input.status,
          input.invitedEmail,
          input.inviteTokenHash,
          input.inviteExpiresAt,
          input.invitedBy,
        ],
      );
      return toMembership(rows[0]!);
    },
    getMembershipById,
    async getMembershipByOrgUser(orgId, userId) {
      const { rows } = await query<MembershipRow>(
        `SELECT ${M_COLS} FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      return rows[0] ? toMembership(rows[0]) : null;
    },
    async getMembershipByInviteTokenHash(hash) {
      const { rows } = await query<MembershipRow>(
        `SELECT ${M_COLS} FROM memberships WHERE invite_token_hash = $1`,
        [hash],
      );
      return rows[0] ? toMembership(rows[0]) : null;
    },
    async getPendingInvite(orgId, email) {
      const { rows } = await query<MembershipRow>(
        `SELECT ${M_COLS} FROM memberships
         WHERE org_id = $1 AND status = 'invited' AND lower(invited_email) = lower($2)`,
        [orgId, email],
      );
      return rows[0] ? toMembership(rows[0]) : null;
    },
    async listMemberships(orgId) {
      const { rows } = await query<MembershipRow>(
        `SELECT ${M_COLS} FROM memberships WHERE org_id = $1 ORDER BY created_at ASC`,
        [orgId],
      );
      return rows.map(toMembership);
    },
    async listOrgMembers(orgId) {
      const cols = M_COLS.split(', ')
        .map((c) => `m.${c}`)
        .join(', ');
      const { rows } = await query<MemberRow>(
        `SELECT ${cols}, u.email AS user_email, u.display_name AS user_display_name
         FROM memberships m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1
         ORDER BY m.created_at ASC`,
        [orgId],
      );
      return rows.map(toOrgMember);
    },
    async updateMembership(id, patch: MembershipPatch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const push = (col: string, val: unknown): void => {
        sets.push(`${col} = $${i++}`);
        vals.push(val);
      };
      if (patch.userId !== undefined) push('user_id', patch.userId);
      if (patch.role !== undefined) push('role', patch.role);
      if (patch.status !== undefined) push('status', patch.status);
      if (patch.invitedEmail !== undefined) push('invited_email', patch.invitedEmail);
      if (patch.inviteTokenHash !== undefined) push('invite_token_hash', patch.inviteTokenHash);
      if (patch.inviteExpiresAt !== undefined) push('invite_expires_at', patch.inviteExpiresAt);
      if (sets.length === 0) return getMembershipById(id);
      vals.push(id);
      const { rows } = await query<MembershipRow>(
        `UPDATE memberships SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${M_COLS}`,
        vals,
      );
      return rows[0] ? toMembership(rows[0]) : null;
    },
    async deleteMembership(id) {
      const { rowCount } = await query('DELETE FROM memberships WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
    async countActiveOwners(orgId) {
      const { rows } = await query<{ count: string }>(
        "SELECT count(*)::text AS count FROM memberships WHERE org_id = $1 AND role = 'owner' AND status = 'active'",
        [orgId],
      );
      return Number(rows[0]?.count ?? '0');
    },

    async createWorkspace(orgId, name) {
      const { rows } = await query<WorkspaceRow>(
        'INSERT INTO workspaces (org_id, name) VALUES ($1, $2) RETURNING id, org_id, name, created_at, updated_at',
        [orgId, name],
      );
      return toWorkspace(rows[0]!);
    },
    async updateWorkspace(orgId, workspaceId, patch) {
      const { rows } = await query<WorkspaceRow>(
        `UPDATE workspaces SET name = $3, updated_at = now() WHERE id = $1 AND org_id = $2
         RETURNING id, org_id, name, created_at, updated_at`,
        [workspaceId, orgId, patch.name],
      );
      return rows[0] ? toWorkspace(rows[0]) : null;
    },
    async deleteWorkspace(orgId, workspaceId) {
      const { rowCount } = await query('DELETE FROM workspaces WHERE id = $1 AND org_id = $2', [
        workspaceId,
        orgId,
      ]);
      return (rowCount ?? 0) > 0;
    },
    async listWorkspaces(orgId) {
      const { rows } = await query<WorkspaceRow>(
        'SELECT id, org_id, name, created_at, updated_at FROM workspaces WHERE org_id = $1 ORDER BY created_at ASC',
        [orgId],
      );
      return rows.map(toWorkspace);
    },
    async listUserMemberships(userId) {
      const { rows } = await query<{
        membership_id: string;
        role: OrgRole;
        org_id: string;
        slug: string;
        name: string;
      }>(
        `SELECT m.id AS membership_id, m.role, o.id AS org_id, o.slug, o.name
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND m.status = 'active'
         ORDER BY o.name ASC`,
        [userId],
      );
      return rows.map((r): UserOrganization => ({
        membershipId: r.membership_id,
        orgId: r.org_id,
        slug: r.slug,
        name: r.name,
        role: r.role,
      }));
    },
  };
}

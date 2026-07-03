/**
 * Integration + migration tests against a REAL Postgres. Excluded from the
 * default run; invoked via `npm run test:integration` with TEST_DATABASE_URL.
 *
 * Covers what the in-memory unit tests can't: that the migrations apply (and are
 * idempotent), and that the database itself enforces the tenancy constraints
 * (partial unique indexes and CHECK constraints), exercised through the
 * production `pg` repository.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { createPgOrgRepository } from '../organizations/repository';
import {
  acceptInvite,
  changeRole,
  createOrganization,
  createWorkspace,
  deleteWorkspace,
  getOrganization,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  updateOrganization,
  updateWorkspace,
} from '../organizations/service';

const repo = createPgOrgRepository();

async function makeUser(email: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  // Migration test: applying the full chain must succeed against real Postgres.
  await runMigrations();
});

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await query('TRUNCATE memberships, workspaces, organizations, users RESTART IDENTITY CASCADE');
});

describe('migrations', () => {
  it('created the Sprint 1 tables', async () => {
    const { rows } = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['organizations', 'users', 'memberships', 'workspaces']],
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'memberships',
      'organizations',
      'users',
      'workspaces',
    ]);
  });

  it('is idempotent — re-running applies nothing new', async () => {
    const before = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM schema_migrations',
    );
    await runMigrations();
    const after = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM schema_migrations',
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  });
});

describe('pg repository — full flow against Postgres', () => {
  it('runs create → invite → accept → promote → remove → list', async () => {
    const ownerId = await makeUser('owner@x.com');
    const bobId = await makeUser('bob@x.com');

    const { organization, membership } = await createOrganization(repo, {
      name: 'Acme',
      ownerUserId: ownerId,
    });
    expect(membership.role).toBe('owner');

    const { token } = await inviteMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      email: 'bob@x.com',
      role: 'member',
    });
    const accepted = await acceptInvite(repo, { token, userId: bobId, userEmail: 'bob@x.com' });
    expect(accepted.status).toBe('active');
    expect(accepted.userId).toBe(bobId);

    const promoted = await changeRole(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      membershipId: accepted.id,
      role: 'admin',
    });
    expect(promoted.role).toBe('admin');

    expect(await listMembers(repo, organization.id, ownerId)).toHaveLength(2);

    await removeMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      membershipId: accepted.id,
    });
    expect(await listMembers(repo, organization.id, ownerId)).toHaveLength(1);
  });
});

describe('pg repository — member identity join', () => {
  it('resolves each member’s email and display name from the users table', async () => {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id',
      ['founder@acme.test', 'Founder Person'],
    );
    const ownerId = rows[0]!.id;
    const bobId = await makeUser('bob2@acme.test');

    const { organization } = await createOrganization(repo, {
      name: 'Ident Acme',
      ownerUserId: ownerId,
    });
    const { token } = await inviteMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      email: 'bob2@acme.test',
      role: 'member',
    });
    await acceptInvite(repo, { token, userId: bobId, userEmail: 'bob2@acme.test' });

    const members = await listMembers(repo, organization.id, ownerId);
    const owner = members.find((m) => m.userId === ownerId);
    const bob = members.find((m) => m.userId === bobId);
    expect(owner?.userEmail).toBe('founder@acme.test');
    expect(owner?.userDisplayName).toBe('Founder Person');
    expect(bob?.userEmail).toBe('bob2@acme.test');
    expect(bob?.userDisplayName).toBeNull();
  });

  it('leaves identity null for a pending invitation (no linked user)', async () => {
    const ownerId = await makeUser('owner3@acme.test');
    const { organization } = await createOrganization(repo, {
      name: 'Pending Acme',
      ownerUserId: ownerId,
    });
    await inviteMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      email: 'ghost@acme.test',
      role: 'viewer',
    });
    const members = await listMembers(repo, organization.id, ownerId);
    const pending = members.find((m) => m.status === 'invited');
    expect(pending?.userEmail).toBeNull();
    expect(pending?.invitedEmail).toBe('ghost@acme.test');
  });
});

describe('pg repository — organization profile', () => {
  it('reads and renames an organization, and gates rename on role', async () => {
    const ownerId = await makeUser('prof-owner@acme.test');
    const memberId = await makeUser('prof-member@acme.test');
    const { organization } = await createOrganization(repo, {
      name: 'Profile Acme',
      ownerUserId: ownerId,
    });

    expect((await getOrganization(repo, organization.id, ownerId)).name).toBe('Profile Acme');

    const renamed = await updateOrganization(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      name: 'Renamed Acme',
    });
    expect(renamed.name).toBe('Renamed Acme');
    expect((await getOrganization(repo, organization.id, ownerId)).name).toBe('Renamed Acme');

    const { token } = await inviteMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      email: 'prof-member@acme.test',
      role: 'member',
    });
    await acceptInvite(repo, { token, userId: memberId, userEmail: 'prof-member@acme.test' });
    await expect(
      updateOrganization(repo, { orgId: organization.id, actorUserId: memberId, name: 'Nope' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('pg repository — workspaces', () => {
  it('creates, renames, and deletes a workspace, scoped to its org', async () => {
    const ownerId = await makeUser('ws-owner@acme.test');
    const { organization } = await createOrganization(repo, {
      name: 'WS Acme',
      ownerUserId: ownerId,
    });
    const ws = await createWorkspace(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      name: 'Research',
    });

    const renamed = await updateWorkspace(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      workspaceId: ws.id,
      name: 'R&D',
    });
    expect(renamed.name).toBe('R&D');

    // A different org cannot touch this workspace.
    const other = await createOrganization(repo, { name: 'Other WS', ownerUserId: ownerId });
    await expect(
      updateWorkspace(repo, {
        orgId: other.organization.id,
        actorUserId: ownerId,
        workspaceId: ws.id,
        name: 'hijack',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    await deleteWorkspace(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      workspaceId: ws.id,
    });
    expect(await listWorkspaces(repo, organization.id, ownerId)).toHaveLength(0);
  });
});

describe('database constraints are real', () => {
  it('enforces one membership per (org, user) via the partial unique index', async () => {
    const ownerId = await makeUser('owner@x.com');
    const { organization } = await createOrganization(repo, { name: 'Acme', ownerUserId: ownerId });
    await expect(
      repo.createMembership({
        orgId: organization.id,
        userId: ownerId,
        role: 'member',
        status: 'active',
        invitedEmail: null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        invitedBy: null,
      }),
    ).rejects.toThrow();
  });

  it('enforces one pending invite per (org, email)', async () => {
    const ownerId = await makeUser('owner@x.com');
    const { organization } = await createOrganization(repo, { name: 'Acme', ownerUserId: ownerId });
    await inviteMember(repo, {
      orgId: organization.id,
      actorUserId: ownerId,
      email: 'dup@x.com',
      role: 'member',
    });
    await expect(
      repo.createMembership({
        orgId: organization.id,
        userId: null,
        role: 'member',
        status: 'invited',
        invitedEmail: 'dup@x.com',
        inviteTokenHash: 'a-different-hash',
        inviteExpiresAt: new Date(Date.now() + 1000).toISOString(),
        invitedBy: ownerId,
      }),
    ).rejects.toThrow();
  });

  it('rejects a role outside the CHECK constraint', async () => {
    const ownerId = await makeUser('owner@x.com');
    const { organization } = await createOrganization(repo, { name: 'Acme', ownerUserId: ownerId });
    await expect(
      query('INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)', [
        organization.id,
        ownerId,
        'superadmin',
        'active',
      ]),
    ).rejects.toThrow();
  });

  it('cascades membership deletion when its organization is removed', async () => {
    const ownerId = await makeUser('owner@x.com');
    const { organization } = await createOrganization(repo, { name: 'Acme', ownerUserId: ownerId });
    await query('DELETE FROM organizations WHERE id = $1', [organization.id]);
    const { rows } = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM memberships WHERE org_id = $1',
      [organization.id],
    );
    expect(rows[0]!.count).toBe('0');
  });
});

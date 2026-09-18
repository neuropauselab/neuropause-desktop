/**
 * Account export + deletion integration tests against a REAL Postgres
 * (NP-047 / Computer-B HIGH-1 + HIGH-2 regression).
 *
 * WHY THIS FILE EXISTS: the export path shipped querying `org_members` (a
 * table that does not exist — the relation is `memberships`) and the deletion
 * path filtered `sync_state` on a `user_id` column it does not have, with the
 * error swallowed inside the transaction — so deletion silently rolled back.
 * 10,886 mocked tests were green over both. Only a run against the actual
 * schema can catch that class, which is exactly what this file does: apply
 * the real migrations, call the real functions once each, assert real rows.
 *
 * Excluded from the default run; invoked via `npm run test:integration` with
 * TEST_DATABASE_URL (and a reachable REDIS_URL).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { registerEmailUser } from '../users/service';
import {
  exportUserData,
  requestAccountDeletion,
  confirmAccountDeletion,
} from '../auth/accountManagement';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await Promise.allSettled([closePool(), closeRedis()]);
});

beforeEach(async () => {
  await query(
    'TRUNCATE account_deletion_requests, devices, memberships, organizations, auth_tokens, auth_sessions, auth_identities, audit_log, users RESTART IDENTITY CASCADE',
  );
});

const PW = 'E2e-Test-Pass-9271';

async function seedUserWithOrgAndDevice() {
  const user = await registerEmailUser('acct_e2e@acme.test', PW);
  const org = await query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('E2E Org', 'e2e-org') RETURNING id`,
  );
  const orgId = org.rows[0].id;
  await query(
    `INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [orgId, user.id],
  );
  await query(
    `INSERT INTO devices (org_id, device_id, user_id, name, platform, os, arch, app_version, trust_status, last_seen, registered_at, public_key)
     VALUES ($1, 'dev-e2e-1', $2, 'E2E Box', 'desktop', 'win32', 'x64', '1.0.0', 'trusted', now(), now(), 'dGVzdC1rZXk')`,
    [orgId, user.id],
  );
  return { user, orgId };
}

describe('GET /auth/export data path (real schema)', () => {
  it('exports the user profile, memberships (real `memberships` relation), and devices', async () => {
    const { user, orgId } = await seedUserWithOrgAndDevice();

    const data = await exportUserData(user.id);

    expect(data.user.id).toBe(user.id);
    expect(data.user.email).toBe('acct_e2e@acme.test');
    // HIGH-1 regression: this queried nonexistent `org_members` and threw 42P01.
    expect(data.organizations).toHaveLength(1);
    expect(data.organizations[0]).toMatchObject({ orgId, role: 'owner' });
    expect(data.devices).toHaveLength(1);
    expect(data.devices[0]).toMatchObject({ deviceId: 'dev-e2e-1', orgId });
  });

  it('does not include another user\'s rows', async () => {
    const { user } = await seedUserWithOrgAndDevice();
    const other = await registerEmailUser('acct_other@acme.test', PW);

    const otherExport = await exportUserData(other.id);
    expect(otherExport.organizations).toHaveLength(0);
    expect(otherExport.devices).toHaveLength(0);

    const mine = await exportUserData(user.id);
    expect(mine.organizations).toHaveLength(1);
  });
});

describe('account deletion lifecycle (real schema, real transaction)', () => {
  it('request -> confirm executes: devices/identities gone, user anonymized, request executed', async () => {
    const { user } = await seedUserWithOrgAndDevice();

    const req = await requestAccountDeletion(user.id, 'e2e');
    expect(req.status).toBe('pending');

    const result = await confirmAccountDeletion(user.id, req.requestId);
    // HIGH-2 regression: a 42703 on sync_state poisoned the transaction and
    // rolled everything back while reporting nothing.
    expect(result.executed).toBe(true);

    const devices = await query(`SELECT 1 FROM devices WHERE user_id = $1`, [user.id]);
    expect(devices.rows).toHaveLength(0);
    const identities = await query(`SELECT 1 FROM auth_identities WHERE user_id = $1`, [user.id]);
    expect(identities.rows).toHaveLength(0);
    const u = await query<{ email: string; display_name: string | null }>(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [user.id],
    );
    expect(u.rows[0].email).toContain('@deleted.neuropause.local');
    expect(u.rows[0].display_name).toBeNull();
    const dr = await query<{ status: string }>(
      `SELECT status FROM account_deletion_requests WHERE id = $1`,
      [req.requestId],
    );
    expect(dr.rows[0].status).toBe('executed');
  });

  it('another user cannot confirm my deletion request', async () => {
    const { user } = await seedUserWithOrgAndDevice();
    const attacker = await registerEmailUser('acct_attacker@acme.test', PW);
    const req = await requestAccountDeletion(user.id);

    const result = await confirmAccountDeletion(attacker.id, req.requestId);
    expect(result.executed).toBe(false);

    const u = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [user.id]);
    expect(u.rows[0].email).toBe('acct_e2e@acme.test'); // untouched
  });
});

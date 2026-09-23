/**
 * ENV-03 — the two-sided assertion, run against an ACTUAL established pilot environment.
 *
 * This file is pointed at a dedicated disposable pilot database (`neuropause_pilot`, its own
 * container, its own port, its own credential) whose `pilot_environment_identity` row was
 * declared out-of-band by an operator action, not by application code. It is the smallest
 * thing that can honestly be called a pilot environment.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { resolvePilotEnvironment } from '../pilot/environment';
import { decidePilotMount } from '../pilot/mount';

const ENV_ID = process.env.NP009_PILOT_ENV_ID ?? 'NP009-FIRST-PILOT-ENV-001';
const TARGET_ID = process.env.NP009_PILOT_TARGET_ID ?? 'NP009-PILOT-DB-001';
const cfg = (over: Record<string, string> = {}) => ({
  PILOT_MODULE_ENABLED: 'true', PILOT_ENVIRONMENT_CLASS: 'PILOT',
  PILOT_ENVIRONMENT_ID: ENV_ID, PILOT_TARGET_ID: TARGET_ID, ...over,
} as NodeJS.ProcessEnv);

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

describe.runIf(process.env.NP009_PILOT_ENV === '1')('ENV-03 — an established pilot environment', () => {
  it('the database asserts its own PILOT identity', async () => {
    const { rows } = await query('SELECT * FROM pilot_environment_identity WHERE id = true');
    expect(rows).toHaveLength(1);
    expect(rows[0].environment_class).toBe('PILOT');
    expect(rows[0].environment_id).toBe(ENV_ID);
    expect(rows[0].target_id).toBe(TARGET_ID);
  });

  it('the two-sided assertion RESOLVES, and the record carries no secret', async () => {
    const r = await resolvePilotEnvironment(cfg());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toMatchObject({ environmentClass: 'PILOT', environmentId: ENV_ID, targetId: TARGET_ID });
    const text = JSON.stringify(r.record).toLowerCase();
    for (const f of ['postgres://', 'throwaway', 'password', 'secret', 'token']) expect(text).not.toContain(f);
  });

  it('the pilot surface MOUNTS here — and this authorizes no execution', async () => {
    expect((await decidePilotMount(cfg())).mounted).toBe(true);
  });

  it('the same database refuses a PRODUCTION-classed configuration', async () => {
    expect(await decidePilotMount(cfg({ PILOT_ENVIRONMENT_CLASS: 'PRODUCTION' })))
      .toEqual({ mounted: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' });
  });

  it('the same database refuses a mismatched target id', async () => {
    expect(await decidePilotMount(cfg({ PILOT_TARGET_ID: 'SOME-OTHER-DB' })))
      .toEqual({ mounted: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });

  it('and refuses without the explicit module opt-in, however correct the identity', async () => {
    expect(await decidePilotMount(cfg({ PILOT_MODULE_ENABLED: 'false' })))
      .toEqual({ mounted: false, reason: 'PILOT_MODULE_NOT_ENABLED' });
  });

  it('the cap is NOT_SET in this environment — engineering did not choose one', async () => {
    const { rows } = await query('SELECT max_participants FROM pilot_control WHERE id = true');
    expect(rows[0]?.max_participants ?? null).toBeNull();
  });

  it('no role binding and no authenticated decision exists here', async () => {
    expect((await query('SELECT count(*)::int AS n FROM pilot_role_bindings')).rows[0].n).toBe(0);
    expect((await query("SELECT count(*)::int AS n FROM pilot_authority_decisions WHERE authenticated")).rows[0].n).toBe(0);
  });

  it('no participant exists in this environment', async () => {
    expect((await query('SELECT count(*)::int AS n FROM pilot_enrollments')).rows[0].n).toBe(0);
    expect((await query('SELECT count(*)::int AS n FROM consents')).rows[0].n).toBe(0);
  });
});

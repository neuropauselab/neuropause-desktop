/**
 * NP-PILOT-FIRST-008 — ENV-01, ENV-02, ENG-05 and ENG-06 against REAL Postgres.
 *
 * These are here rather than in the default suite because every one of them asserts something
 * about DATABASE STATE: the environment identity the database asserts about itself, the
 * retention clock, holds, idempotence, and the monitor ledger. NP-007 established that the
 * in-memory repository aliases its rows and so cannot model independent snapshots, and §8
 * makes real Postgres mandatory for anything of this shape.
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { resolvePilotEnvironment, assertPilotEnvironment, PilotEnvironmentError, configurationDigest } from '../pilot/environment';
import { sqlPilotMonitor, ALERT_SEVERITY, resetMonitorWriteFailureCount, monitorWriteFailureCount } from '../pilot/monitor';
import { planRetention, executeRetention, RETENTION_CLASSES, RETENTION_DAYS_AFTER_CLOSURE } from '../pilot/retention';
import { loadRoleBindings, loadAuthorityDecisions } from '../pilot/authorityStore';

const U1 = '55555555-5555-4555-8555-000000000001';
const OP = '55555555-5555-4555-8555-000000000002';
const ENV_ID = 'NP008-TEST-PILOT-ENV';
const TARGET_ID = 'NP008-TEST-PILOT-TARGET';

const ENV_OK = {
  PILOT_ENVIRONMENT_CLASS: 'PILOT',
  PILOT_ENVIRONMENT_ID: ENV_ID,
  PILOT_TARGET_ID: TARGET_ID,
} as NodeJS.ProcessEnv;

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

async function reset({ declareEnv = true } = {}) {
  await query(`TRUNCATE pilot_monitor_events, pilot_retention_log, pilot_retention_holds,
               pilot_closure, pilot_authority_decisions, pilot_role_bindings,
               pilot_environment_identity, pilot_lifecycle_events, pilot_events,
               human_decisions, pilot_enrollments, consents, pilot_terms RESTART IDENTITY CASCADE`);
  for (const id of [U1, OP])
    await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING",
      [id, `${id}@np008.invalid`]);
  if (declareEnv)
    await query(
      `INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
       VALUES ('PILOT', $1, $2, 'NP-008 test harness')`, [ENV_ID, TARGET_ID]);
  resetMonitorWriteFailureCount();
}

/* ======================================================================================
 * ENV-01 / ENV-02
 * ==================================================================================== */
describe('ENV-01 — the pilot environment must be DECLARED, never inferred', () => {
  beforeEach(() => reset());

  it('§38 a missing class refuses — there is no default=pilot', async () => {
    const r = await resolvePilotEnvironment({} as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_DECLARED' });
  });
  it('§39 class=PRODUCTION refuses', async () => {
    const r = await resolvePilotEnvironment({ ...ENV_OK, PILOT_ENVIRONMENT_CLASS: 'PRODUCTION' });
    expect(r).toEqual({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_PILOT' });
  });
  it('a declared class with no environment id refuses', async () => {
    const r = await resolvePilotEnvironment({ PILOT_ENVIRONMENT_CLASS: 'PILOT' } as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, reason: 'ENVIRONMENT_ID_NOT_DECLARED' });
  });
  it('a declared environment with no target id refuses', async () => {
    const r = await resolvePilotEnvironment({ PILOT_ENVIRONMENT_CLASS: 'PILOT', PILOT_ENVIRONMENT_ID: ENV_ID } as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, reason: 'TARGET_ID_NOT_DECLARED' });
  });
  it('whitespace is not a declaration', async () => {
    const r = await resolvePilotEnvironment({ ...ENV_OK, PILOT_ENVIRONMENT_CLASS: '   ' });
    expect(r).toEqual({ ok: false, reason: 'ENVIRONMENT_CLASS_NOT_DECLARED' });
  });
  it('a fully declared environment matching the database RESOLVES', async () => {
    const r = await resolvePilotEnvironment(ENV_OK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.environmentClass).toBe('PILOT');
      expect(r.record.environmentId).toBe(ENV_ID);
      expect(r.record.targetId).toBe(TARGET_ID);
    }
  });
});

describe('ENV-02 — the DATABASE must assert its own identity', () => {
  it('§39 a database carrying NO identity row refuses (this is the production case)', async () => {
    await reset({ declareEnv: false });
    const r = await resolvePilotEnvironment(ENV_OK);
    expect(r).toEqual({ ok: false, reason: 'TARGET_IDENTITY_ABSENT' });
  });
  it('a database asserting a DIFFERENT target refuses', async () => {
    await reset();
    const r = await resolvePilotEnvironment({ ...ENV_OK, PILOT_TARGET_ID: 'SOME-OTHER-DATABASE' });
    expect(r).toEqual({ ok: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });
  it('a database asserting a different ENVIRONMENT refuses', async () => {
    await reset();
    const r = await resolvePilotEnvironment({ ...ENV_OK, PILOT_ENVIRONMENT_ID: 'SOME-OTHER-ENV' });
    expect(r).toEqual({ ok: false, reason: 'TARGET_IDENTITY_MISMATCH' });
  });
  it('§37 the boot assertion throws the reason CODE and nothing else', async () => {
    await reset({ declareEnv: false });
    await expect(assertPilotEnvironment(ENV_OK)).rejects.toBeInstanceOf(PilotEnvironmentError);
    await expect(assertPilotEnvironment(ENV_OK)).rejects.toMatchObject({ reason: 'TARGET_IDENTITY_ABSENT' });
  });
  it('the schema makes a PRODUCTION identity row impossible to write', async () => {
    await reset({ declareEnv: false });
    await expect(query(
      `INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
       VALUES ('PRODUCTION', $1, $2, 'hostile')`, [ENV_ID, TARGET_ID])).rejects.toThrow();
  });
});

describe('§40 — the environment evidence record carries no secret', () => {
  it('no connection string, password, token or key appears anywhere in it', async () => {
    await reset();
    const r = await resolvePilotEnvironment({ ...ENV_OK, DATABASE_URL: 'postgres://u:SUPERSECRET@h/db' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.record);
    for (const forbidden of ['SUPERSECRET', 'postgres://', 'password', 'token', 'secret'])
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
  it('the configuration digest reflects presence, never the value of DATABASE_URL', () => {
    const a = configurationDigest({ ...ENV_OK, DATABASE_URL: 'postgres://a:1@h/db' });
    const b = configurationDigest({ ...ENV_OK, DATABASE_URL: 'postgres://b:2@other/db' });
    expect(a).toBe(b);                                   // the VALUE does not leak into the digest
    expect(configurationDigest(ENV_OK)).not.toBe(a);     // but PRESENCE does change it
  });
});

/* ======================================================================================
 * ENG-04 — the production posture, measured
 * ==================================================================================== */
describe('ENG-04 — production ships bound to nobody', () => {
  it('both authority tables are EMPTY, so every gate denies', async () => {
    await reset();
    expect(await loadRoleBindings()).toEqual([]);
    expect(await loadAuthorityDecisions()).toEqual([]);
  });
  it('a decision artifact defaults to authenticated=false', async () => {
    await reset();
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, actions, environment_class, effective_from)
       VALUES ('NP-PILOT-FIRST-HUMAN-001', ARRAY['pilot.stop'], 'PILOT', now())`);
    const [d] = await loadAuthorityDecisions();
    expect(d.authenticated).toBe(false);
  });
});

/* ======================================================================================
 * ENG-06 — monitoring
 * ==================================================================================== */
describe('ENG-06 — the monitor ledger', () => {
  beforeEach(() => reset());

  it('§30 every mandatory-stop class is CRITICAL and escalates', async () => {
    for (const cls of Object.keys(ALERT_SEVERITY) as (keyof typeof ALERT_SEVERITY)[]) {
      const rec = await sqlPilotMonitor.record({ alertClass: cls, outcome: 'DENIED', reasonCode: 'TEST' });
      expect(rec?.severity).toBe('CRITICAL');
      expect(rec?.escalated).toBe(true);
    }
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_monitor_events WHERE escalated');
    expect(rows[0].n).toBe(Object.keys(ALERT_SEVERITY).length);
  });

  it('§29 the event is DURABLE — read back from the ledger, not from the return value', async () => {
    await sqlPilotMonitor.record({
      alertClass: 'PRODUCTION_PATH_ATTEMPT', outcome: 'BLOCKED', reasonCode: 'PRODUCTION_TARGET_DENIED',
      actorId: U1, action: 'pilot.stop',
    });
    const { rows } = await query(
      `SELECT alert_class, severity, outcome, reason_code, escalated FROM pilot_monitor_events`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      alert_class: 'PRODUCTION_PATH_ATTEMPT', severity: 'CRITICAL',
      outcome: 'BLOCKED', reason_code: 'PRODUCTION_TARGET_DENIED', escalated: true,
    });
  });

  it('detail is filtered to scalars — an unbounded shape cannot reach durable storage', async () => {
    await sqlPilotMonitor.record({
      alertClass: 'SECURITY_INCIDENT', outcome: 'DENIED', reasonCode: 'TEST',
      detail: { ok: true, n: 1, s: 'short', nested: { secret: 'leaked' }, arr: ['a'], fn: () => 1 } as never,
    });
    const { rows } = await query('SELECT detail FROM pilot_monitor_events');
    expect(rows[0].detail).toEqual({ ok: true, n: 1, s: 'short' });
    expect(JSON.stringify(rows[0].detail)).not.toContain('leaked');
  });

  it('a long string is truncated rather than stored whole', async () => {
    await sqlPilotMonitor.record({
      alertClass: 'SECURITY_INCIDENT', outcome: 'DENIED', reasonCode: 'TEST',
      detail: { s: 'x'.repeat(5000) },
    });
    const { rows } = await query('SELECT detail FROM pilot_monitor_events');
    expect((rows[0].detail.s as string).length).toBeLessThan(250);
  });

  it('§32 the monitor has no way to allow, resume or authorize', () => {
    const surface = Object.keys(sqlPilotMonitor);
    expect(surface).toEqual(['record']);
    for (const forbidden of ['allow', 'resume', 'authorize', 'override'])
      expect(surface.join(',').toLowerCase()).not.toContain(forbidden);
  });

  it('a failed write is COUNTED, not swallowed silently and not thrown', async () => {
    // RENAMED, not dropped. `runMigrations` is idempotent by ledger, so it would not recreate
    // a dropped table and every later test in this file would fail against a missing relation
    // - which is exactly what happened the first time this was written.
    await query('ALTER TABLE pilot_monitor_events RENAME TO pilot_monitor_events__hidden');
    try {
      const rec = await sqlPilotMonitor.record({ alertClass: 'SECURITY_INCIDENT', outcome: 'DENIED', reasonCode: 'TEST' });
      expect(rec).toBeNull();                       // the caller is told nothing was written
      expect(monitorWriteFailureCount()).toBe(1);   // and the failure is visible, not silent
    } finally {
      await query('ALTER TABLE pilot_monitor_events__hidden RENAME TO pilot_monitor_events');
    }
  });
});

/* ======================================================================================
 * ENG-05 — retention
 * ==================================================================================== */
describe('ENG-05 — retention is PREPARED, and refuses to run', () => {
  beforeEach(() => reset());

  it('§21 with no closure row NOTHING is eligible — the clock has not started', async () => {
    const plan = await planRetention();
    expect(plan.closedAt).toBeNull();
    expect(plan.items.every((i) => !i.eligible)).toBe(true);
    expect(plan.items.every((i) => i.reason === 'PILOT_NOT_CLOSED')).toBe(true);
    expect(await executeRetention()).toEqual([]);
  });

  it('§23 the clock runs from CLOSURE, not creation', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '10 days', $1, 'test')`, [OP]);
    const plan = await planRetention();
    const expected = new Date(Date.parse(plan.closedAt!) + RETENTION_DAYS_AFTER_CLOSURE * 86400_000);
    expect(Date.parse(plan.eligibleFrom!)).toBe(expected.getTime());
    expect(plan.items.every((i) => i.reason === 'WITHIN_RETENTION')).toBe(true);
  });

  it('closed 89 days ago -> PRESERVE; 91 days ago -> ELIGIBLE', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '89 days', $1, 'test')`, [OP]);
    expect((await planRetention()).items.every((i) => i.reason === 'WITHIN_RETENTION')).toBe(true);
    await query(`UPDATE pilot_closure SET closed_at = now() - interval '91 days'`);
    expect((await planRetention()).items.every((i) => i.eligible)).toBe(true);
  });

  it('§24 a LEGAL hold outranks the clock', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                 VALUES ('LEGAL', 'investigation', $1)`, [OP]);
    const plan = await planRetention();
    expect(plan.items.every((i) => i.reason === 'ON_HOLD')).toBe(true);
    expect(await executeRetention()).toEqual([]);
  });

  it('a released hold stops outranking it', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by, released_at)
                 VALUES ('INCIDENT', 'resolved', $1, now())`, [OP]);
    expect((await planRetention()).items.every((i) => i.eligible)).toBe(true);
  });

  it('§26 execution is IDEMPOTENT — a second run is a no-op', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    const first = await executeRetention();
    expect(first.length).toBe(RETENTION_CLASSES.length);
    const second = await executeRetention();
    expect(second).toEqual([]);
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(rows[0].n).toBe(RETENTION_CLASSES.length);
  });

  it('§24 it touches NO table outside the pilot', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    const before = (await query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    await executeRetention();
    expect((await query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(before);
  });

  it('§25 every class is named PSEUDONYMIZED or DELETED — never ANONYMIZED', () => {
    for (const c of RETENTION_CLASSES)
      expect(['PSEUDONYMIZED', 'DELETED', 'PRESERVED_UNDER_HOLD']).toContain(c.method);
    const text = JSON.stringify(RETENTION_CLASSES).toLowerCase();
    expect(text).not.toContain('anonymi');
  });

  it('§27 a hold placed AFTER planning is still honoured (transaction-level guard)', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    // The plan says ELIGIBLE. The hold lands between planning and the write - precisely the
    // window a read-then-write guard cannot see.
    let placed = false;
    const applied = await executeRetention(new Date(), {
      beforeItem: async () => {
        if (placed) return;
        placed = true;
        await query(`INSERT INTO pilot_retention_holds (hold_class, reason, placed_by)
                     VALUES ('LEGAL', 'placed mid-run', $1)`, [OP]);
      },
    });
    expect(applied).toEqual([]);
    expect((await query('SELECT count(*)::int AS n FROM pilot_retention_log')).rows[0].n).toBe(0);
  });

  it('§27 two concurrent runs process each item EXACTLY once', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    const [a, b] = await Promise.all([executeRetention(), executeRetention()]);
    // The claim row is what serialises them; without it both runs would process every item.
    expect(a.length + b.length).toBe(RETENTION_CLASSES.length);
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(rows[0].n).toBe(RETENTION_CLASSES.length);
  });

  it('the evidence classes are preserved, not deleted', () => {
    const evidence = ['pilot_lifecycle_events', 'human_decisions', 'pilot_monitor_events'];
    for (const name of evidence)
      expect(RETENTION_CLASSES.find((c) => c.name === name)?.method).toBe('PSEUDONYMIZED');
  });
});

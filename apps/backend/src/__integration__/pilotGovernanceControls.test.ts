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
import { planRetention, executeRetention, RETENTION_CLASSES, RETENTION_DAYS_AFTER_CLOSURE, EXECUTABLE_CLASSES } from '../pilot/retention';
import { loadRoleBindings, loadAuthorityDecisions } from '../pilot/authorityStore';

const U1 = '55555555-5555-4555-8555-000000000001';
const OP = '55555555-5555-4555-8555-000000000002';
const ENV_ID = 'NP008-TEST-PILOT-ENV';
const TARGET_ID = 'NP008-TEST-PILOT-TARGET';

const ENV_OK = {
  PILOT_ENVIRONMENT_CLASS: 'PILOT',
  PILOT_ENVIRONMENT_ID: ENV_ID,
  PILOT_TARGET_ID: TARGET_ID,
  // ENV-04 (NP-014): a pilot environment now requires a DECLARED, DISTINCT pilot store.
  // Without it resolution refuses PILOT_STORE_NOT_DECLARED, which is the point of the control.
  PILOT_DATABASE_URL: 'postgres://pilot@pilot-host:5432/neuropause_pilot',
  DATABASE_URL: 'postgres://prod@prod-host:5432/neuropause',
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
    const r = await resolvePilotEnvironment({
      ...ENV_OK,
      DATABASE_URL: 'postgres://u:SUPERSECRET@h/db',
      PILOT_DATABASE_URL: 'postgres://u:PILOTSECRET@ph/pdb',   // ENV-04: the new string must not leak either
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.record);
    for (const forbidden of ['SUPERSECRET', 'PILOTSECRET', 'postgres://', 'password', 'token', 'secret'])
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
  it('the configuration digest reflects presence, never the value of DATABASE_URL', () => {
    const a = configurationDigest({ ...ENV_OK, DATABASE_URL: 'postgres://a:1@h/db' });
    const b = configurationDigest({ ...ENV_OK, DATABASE_URL: 'postgres://b:2@other/db' });
    expect(a).toBe(b);                                   // the VALUE does not leak into the digest
    // ENV_OK now DECLARES DATABASE_URL, because ENV-04 needs it present to test separation.
    // The absent case must therefore be built EXPLICITLY. Leaving this as
    // `configurationDigest(ENV_OK)` compared a digest to itself and passed for no reason.
    const absent: NodeJS.ProcessEnv = { ...ENV_OK };
    delete absent.DATABASE_URL;
    expect(configurationDigest(absent)).not.toBe(a);     // but PRESENCE does change it
  });

  it('the digest reflects PILOT store presence and SEPARATION, never the value', () => {
    const shared = 'postgres://prod@prod-host:5432/neuropause';
    const p1 = configurationDigest({ ...ENV_OK, DATABASE_URL: shared, PILOT_DATABASE_URL: 'postgres://x:1@ph/p' });
    const p2 = configurationDigest({ ...ENV_OK, DATABASE_URL: shared, PILOT_DATABASE_URL: 'postgres://y:2@qh/q' });
    expect(p1).toBe(p2);                                 // two different pilot stores, same digest

    const absent: NodeJS.ProcessEnv = { ...ENV_OK, DATABASE_URL: shared };
    delete absent.PILOT_DATABASE_URL;
    expect(configurationDigest(absent)).not.toBe(p1);    // declaring a pilot store changes it

    // The separation bit must move on its own: same presence, same two keys, but pointed at
    // the product store. If this digest equalled p1 the evidence record could not distinguish
    // a separated pilot from one running inside production.
    const notSeparated = configurationDigest({ ...ENV_OK, DATABASE_URL: shared, PILOT_DATABASE_URL: shared });
    expect(notSeparated).not.toBe(p1);

    // ...and the PRESENCE bit must carry its own weight. Both of the states below yield
    // PILOT_STORE_SEPARATED=false, so separation alone cannot tell them apart:
    //   (a) no pilot store was declared at all        - an OMISSION
    //   (b) a pilot store was declared as the product store - a CONTAMINATION
    // Those are different governance facts and the evidence record must distinguish them.
    // Found by mutation M4: deleting PILOT_DATABASE_URL_PRESENT from the digest survived the
    // whole suite until this assertion existed.
    expect(configurationDigest(absent)).not.toBe(notSeparated);
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
/**
 * NP-017: seed a REAL enrolled subject before a retention run.
 *
 * §26 and §27 previously ran with pilot_enrollments EMPTY. planRetention falls back to
 * `subjectIds = [null]` in that case, so both tests exercised the NULL-SUBJECT path - where the
 * mutation predicates (`user_id = $1`) match nothing and the verification counts nothing. They
 * passed because the old implementation wrote the claim regardless of effect, so a path on which
 * no work was even possible looked identical to a successful one.
 *
 * With a real subject they test what their names say.
 */
async function seedRetentionSubject(): Promise<void> {
  const { rows: [t] } = await query(
    `INSERT INTO pilot_terms (version,status,digest,content_reference,published_at)
     VALUES ('NP017-GOV','PUBLISHED','D','np017',now()) RETURNING *`);
  const { rows: [c] } = await query(
    `INSERT INTO consents (user_id, version, terms_id, terms_digest)
     VALUES ($1,'NP017-GOV',$2,'D') RETURNING *`, [U1, t.id]);
  const { rows: [e] } = await query(
    `INSERT INTO pilot_enrollments (user_id, consent_id, state)
     VALUES ($1,$2,'PILOT_ACTIVE') RETURNING *`, [U1, c.id]);
  await query(`INSERT INTO pilot_events (user_id, enrollment_id, event_type, metadata)
               VALUES ($1,$2,'session_started','{}'::jsonb)`, [U1, e.id]);
  await query(`INSERT INTO pilot_monitor_events
               (alert_class,severity,outcome,reason_code,actor_id,subject_user_id)
               VALUES ('UNAUTHORIZED_AUTHORITY','INFO','DENIED','NP017',$1,$1)`, [U1]);
}

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
    await seedRetentionSubject();
    // NP-017 CORRECTION. This asserted first.length === RETENTION_CLASSES.length - that ALL SIX
    // classes were claimed on the first run. THAT EXPECTATION ENCODED THE DEFECT: five of the
    // six were claimed with zero rows modified, and this test passed BECAUSE the implementation
    // falsely claimed them. A suite that asserts the bug cannot catch the bug.
    //
    // Corrected invariant: only classes whose declared method the schema actually permits are
    // executed, verified and claimed. The rest stay unclaimed pending a human decision (§23).
    const first = await executeRetention();
    expect(first.map((i) => i.dataClass).sort()).toEqual([...EXECUTABLE_CLASSES].sort());
    const second = await executeRetention();
    expect(second).toEqual([]);
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(rows[0].n).toBe(EXECUTABLE_CLASSES.length);
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
    // NP-019 R1. This test did NOT seed a subject, so pilot_enrollments was empty and
    // planRetention fell back to subjectIds = [null]. The in-transaction hold re-check RAN and
    // FIRED even so: it is the first statement in the transaction, upstream of applyAndVerify,
    // and a pilot-wide hold matches via `subject_user_id IS NULL` whatever $1 holds. What was
    // missing was OBSERVABILITY, not reachability — with the check deleted, NP-017's DOWNSTREAM
    // null-subject guard refused the same item and produced an identical observable, so the
    // suite stayed 33/33 GREEN. Outcome-masking, not short-circuiting. Seeding a real subject
    // removes the masking refusal, so the two routes diverge and M14 now fails 3 tests.
    await seedRetentionSubject();
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

  it('§9 NEGATIVE CONTROL: with NO hold, the same fixture DOES proceed', async () => {
    // Without this, the test above is equally consistent with "retention always refuses".
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    await seedRetentionSubject();
    const applied = await executeRetention(new Date());
    expect(applied.map((i) => i.dataClass).sort()).toEqual([...EXECUTABLE_CLASSES].sort());
  });

  it('§27 two concurrent runs process each item EXACTLY once', async () => {
    await query(`INSERT INTO pilot_closure (closed_at, closed_by, closure_reason)
                 VALUES (now() - interval '200 days', $1, 'test')`, [OP]);
    await seedRetentionSubject();
    const [a, b] = await Promise.all([executeRetention(), executeRetention()]);
    // NP-017: the claim row still serialises them - it moved AFTER the verified mutation, so
    // the UNIQUE constraint now guarantees exactly one AUTHOR per item rather than exactly one
    // attempt. Both mutations are idempotent (a DELETE of nothing; an UPDATE to NULL of columns
    // already NULL), so a concurrent double-apply is harmless. What must not happen is two
    // completion records, or a completion record without a verified mutation.
    expect(a.length + b.length).toBe(EXECUTABLE_CLASSES.length);
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_retention_log');
    expect(rows[0].n).toBe(EXECUTABLE_CLASSES.length);
  });

  it('the evidence classes are preserved, not deleted', () => {
    const evidence = ['pilot_lifecycle_events', 'human_decisions', 'pilot_monitor_events'];
    for (const name of evidence)
      expect(RETENTION_CLASSES.find((c) => c.name === name)?.method).toBe('PSEUDONYMIZED');
  });
});

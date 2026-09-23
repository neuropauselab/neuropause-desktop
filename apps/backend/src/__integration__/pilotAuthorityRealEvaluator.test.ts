/**
 * NP-PILOT-FIRST-013 §11 §19 §26 §27 §28 — the REAL evaluator, end to end, against real Postgres.
 *
 * §26: NOT ONE ASSERTION HERE USES `{ evaluate: () => 'ALLOW' }`. Every case builds an
 * `AuthoritySnapshot` from rows and runs `explainAuthority`, which is the predicate production
 * runs. That is the whole point: NP-009's cap gap survived forty tests and four mutants
 * precisely because every one of them stubbed this function out.
 *
 * §19: the self-authorization sequence starts from EMPTY authority tables and walks forward one
 * governance layer at a time, asserting DENY until the layer that legitimately permits.
 *
 * THE SUBJECTS BELOW ARE SYNTHETIC AND BIND NOBODY. They are fixed uuid literals that map to no
 * real account. A green run proves the MECHANISM; it proves nothing about any person's identity.
 */
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import {
  explainAuthority, createSnapshotEvaluator, PILOT_ACTIONS,
  type AuthoritySnapshot, type RoleBinding, type AuthorityDecisionArtifact,
} from '../pilot/authorityEvaluator';
import { loadRoleBindings, loadAuthorityDecisions } from '../pilot/authorityStore';
import { setPilotCap } from '../pilot/capGovernance';
import { sqlPilotRepository } from '../pilot/repository';

const TEST_SAURABH  = 'cccccccc-0000-4000-8000-000000000001';
const TEST_DISHANT  = 'cccccccc-0000-4000-8000-000000000002';
const TEST_KINJAL   = 'cccccccc-0000-4000-8000-000000000003';
const TEST_UNBOUND  = 'cccccccc-0000-4000-8000-000000000009';
const ENV_ID = 'NP013-PILOT-ENV';
const INSTRUMENT = 'TEST_ONLY-NP-PILOT-FIRST-APPOINTMENT-001';
const NOW = new Date('2026-09-23T12:00:00.000Z');
const PAST = '2026-01-01T00:00:00.000Z';

const PILOT_ENV = async () => ({ environmentClass: 'PILOT', environmentId: ENV_ID });

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

async function reset() {
  await query(`TRUNCATE pilot_cap_decisions, pilot_alert_deliveries, pilot_monitor_events,
               pilot_retention_log, pilot_retention_holds, pilot_closure,
               pilot_authority_decisions, pilot_role_bindings, pilot_environment_identity,
               pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments,
               consents, pilot_terms RESTART IDENTITY CASCADE`);
  await query('DELETE FROM pilot_control');
  await query('INSERT INTO pilot_control (id, stopped) VALUES (true, false)');
  for (const id of [TEST_SAURABH, TEST_DISHANT, TEST_KINJAL, TEST_UNBOUND])
    await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING",
      [id, `${id}@np013.invalid`]);
}

const binding = (subjectId: string, role: RoleBinding['role'], over: Partial<RoleBinding> = {}): RoleBinding =>
  ({ subjectId, role, decisionRef: INSTRUMENT, boundAt: PAST, expiresAt: null, revokedAt: null, ...over });

const artifact = (over: Partial<AuthorityDecisionArtifact> = {}): AuthorityDecisionArtifact => ({
  instrument: INSTRUMENT, authenticated: true, actions: [...PILOT_ACTIONS],
  environmentClass: 'PILOT', effectiveFrom: PAST, expiresAt: null, revokedAt: null, ...over,
});

const snap = (over: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  bindings: [
    binding(TEST_SAURABH, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY'),
    binding(TEST_DISHANT, 'PILOT_OPERATOR_TECHNICAL_OPERATIONS'),
    binding(TEST_KINJAL,  'INDEPENDENT_PILOT_VERIFIER'),
  ],
  decisions: [artifact()],
  environment: { environmentClass: 'PILOT', environmentId: ENV_ID },
  now: NOW,
  ...over,
});

const ctx = (actorId: string, action: string) => ({ actorId, subjectId: actorId, action });

/* ===================================================================================
 * §11 — the cap-authority matrix, against the REAL evaluator
 * =================================================================================== */
describe('§11 ENG-12 — pilot.cap.set through the real evaluator', () => {
  it('bound decision authority -> ALLOW', () => {
    const out = explainAuthority(snap(), ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.decision).toBe('ALLOW');
    expect(out.role).toBe('FIRST_PILOT_HUMAN_DECISION_AUTHORITY');
  });

  it.each([
    ['operator (Dishant)', TEST_DISHANT, 'ACTION_NOT_AUTHORIZED'],
    ['independent verifier (Kinjal)', TEST_KINJAL, 'ACTION_NOT_AUTHORIZED'],
    ['unbound identity', TEST_UNBOUND, 'ROLE_NOT_BOUND'],
  ])('%s -> DENY %s', (_label, subject, reason) => {
    const out = explainAuthority(snap(), ctx(subject, 'pilot.cap.set'));
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe(reason);
  });

  it('UNAUTHENTICATED decision artifact -> DENY DECISION_INVALID', () => {
    const out = explainAuthority(
      snap({ decisions: [artifact({ authenticated: false })] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe('DECISION_INVALID');
  });

  it('MISSING authority root (no bindings, no decisions) -> DENY ROLE_NOT_BOUND', () => {
    const out = explainAuthority(
      snap({ bindings: [], decisions: [] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('decision artifact that does not cover the action -> DENY DECISION_OUT_OF_SCOPE', () => {
    const out = explainAuthority(
      snap({ decisions: [artifact({ actions: ['pilot.control.read'] })] }),
      ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.reason).toBe('DECISION_OUT_OF_SCOPE');
  });
});

/* ===================================================================================
 * §19 — the self-authorization sequence, from EMPTY tables, layer by layer
 * =================================================================================== */
describe('§19 — the machine cannot bootstrap its own authority', () => {
  beforeEach(() => reset());

  it('S0: with EMPTY authority tables the runtime denies every action for every subject', async () => {
    expect(await loadRoleBindings()).toEqual([]);
    expect(await loadAuthorityDecisions()).toEqual([]);
    const empty = snap({ bindings: [], decisions: [] });
    for (const subject of [TEST_SAURABH, TEST_DISHANT, TEST_KINJAL, TEST_UNBOUND])
      for (const action of PILOT_ACTIONS)
        expect(explainAuthority(empty, ctx(subject, action)).reason).toBe('ROLE_NOT_BOUND');
  });

  it('S0: setPilotCap refuses, and writes NOTHING — the propagation cannot be forced', async () => {
    const evaluator = createSnapshotEvaluator(snap({ bindings: [], decisions: [] }));
    await expect(setPilotCap(
      { repo: sqlPilotRepository, authority: evaluator, environment: PILOT_ENV }, TEST_SAURABH, 1, 'r'),
    ).rejects.toMatchObject({ code: 'not_authorized' });
    expect((await query('SELECT count(*)::int AS n FROM pilot_cap_decisions')).rows[0].n).toBe(0);
    expect((await query('SELECT max_participants FROM pilot_control WHERE id=true')).rows[0].max_participants)
      .toBeNull();
  });

  it('S1/S2: an APPOINTMENT alone (decision recorded, UNAUTHENTICATED) still denies', async () => {
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, actions, environment_class, effective_from)
       VALUES ($1, $2, 'PILOT', now())`, [INSTRUMENT, [...PILOT_ACTIONS]]);
    const [d] = await loadAuthorityDecisions();
    expect(d.authenticated).toBe(false);          // the column defaults false; nothing set it true
    // even with a binding, an unauthenticated instrument authorizes nothing
    const out = explainAuthority(
      snap({ decisions: [artifact({ authenticated: false })] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.reason).toBe('DECISION_INVALID');
  });

  it('S3/S4: a role binding WITHOUT an authenticated decision still denies', () => {
    const out = explainAuthority(
      snap({ decisions: [] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.reason).toBe('DECISION_MISSING');
  });

  it('S5/S6: binding + AUTHENTICATED decision + PILOT environment -> the action becomes representable', () => {
    expect(explainAuthority(snap(), ctx(TEST_SAURABH, 'pilot.cap.set')).decision).toBe('ALLOW');
  });

  it('S6 is NOT S7: authority to set a cap is not authority to execute the pilot', async () => {
    // The evaluator permitting pilot.cap.set says nothing about execution. There is no
    // execution-authorization action in the vocabulary at all, and no code path grants one.
    expect([...PILOT_ACTIONS]).not.toContain('pilot.execute');
    expect([...PILOT_ACTIONS]).not.toContain('pilot.start');
    expect((await query('SELECT count(*)::int AS n FROM pilot_enrollments')).rows[0].n).toBe(0);
  });
});

/* ===================================================================================
 * §28 — technical privilege is not pilot authority
 * =================================================================================== */
describe('§28 — privilege does not confer pilot authority', () => {
  beforeEach(() => reset());

  it('a context carrying admin/owner/release-manager claims is still DENIED', () => {
    const hostile = {
      ...ctx(TEST_UNBOUND, 'pilot.cap.set'),
      admin: true, isOwner: true, role: 'Release Manager', releaseAuthority: true,
      name: 'Saurabh Patel', email: 'anything@example.invalid', githubLogin: 'anything',
    };
    expect(explainAuthority(snap(), hostile).decision).toBe('DENY');
    expect(explainAuthority(snap(), hostile).reason).toBe('ROLE_NOT_BOUND');
  });

  it('the evaluator reads NO privilege field — only actorId and the bindings table', () => {
    // A binding for a DIFFERENT subject cannot be borrowed by a privileged caller.
    const out = explainAuthority(
      snap({ bindings: [binding(TEST_SAURABH, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY')] }),
      ctx(TEST_DISHANT, 'pilot.cap.set'));
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('a production-class environment denies before any binding is consulted', () => {
    const out = explainAuthority(
      snap({ environment: { environmentClass: 'PRODUCTION', environmentId: 'prod' } }),
      ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.reason).toBe('PRODUCTION_TARGET_DENIED');
  });
});

/* ===================================================================================
 * ENG-13 — the environment guard must actually discriminate
 * =================================================================================== */
describe('ENG-13 — environment_class is read from the row, not assumed', () => {
  beforeEach(() => reset());

  it('the loader returns the COLUMN value, not a hard-coded constant', async () => {
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, authenticated, actions, environment_class, effective_from)
       VALUES ($1, true, $2, 'PILOT', now())`, [INSTRUMENT, [...PILOT_ACTIONS]]);
    const [d] = await loadAuthorityDecisions();
    expect(d.environmentClass).toBe('PILOT');
  });

  it('WITH THE CHECK DROPPED, a non-PILOT artifact is refused DECISION_OUT_OF_SCOPE', async () => {
    // The schema CHECK is what makes the bad row impossible today. Dropping it here models the
    // one realistic way the mask comes off: the runtime credential also holds DDL rights.
    // The code-level guard must stand on its own once the constraint is gone.
    // Positive control: the mask must be ON before we take it off. Without this the test
    // reports an obscure 42704 instead of "this database is already unconstrained".
    const { rows: [{ present }] } = await query<{ present: boolean }>(
      `SELECT count(*)::int > 0 AS present FROM pg_constraint WHERE conname = $1`,
      ['pilot_authority_decisions_environment_class_check']);
    expect(present).toBe(true);
    await query('ALTER TABLE pilot_authority_decisions DROP CONSTRAINT pilot_authority_decisions_environment_class_check');
    try {
      await query(
        `INSERT INTO pilot_authority_decisions (instrument, authenticated, actions, environment_class, effective_from)
         VALUES ($1, true, $2, 'PRODUCTION', now())`, [INSTRUMENT, [...PILOT_ACTIONS]]);
      const decisions = await loadAuthorityDecisions();
      expect(decisions[0].environmentClass).toBe('PRODUCTION');   // the row, not a constant

      const out = explainAuthority(
        snap({ decisions: [...decisions] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
      expect(out.decision).toBe('DENY');
      expect(out.reason).toBe('DECISION_OUT_OF_SCOPE');
    } finally {
      // The PRODUCTION row inserted above would itself violate the CHECK, so it has to go
      // before the constraint can come back. The previous `.catch(() => {})` swallowed exactly
      // that failure, leaving the database PERMANENTLY unconstrained: the test passed once per
      // container and errored on every later run. A repair step that can fail silently is not
      // a repair step.
      await query(`DELETE FROM pilot_authority_decisions WHERE environment_class <> 'PILOT'`);
      await query(
        `ALTER TABLE pilot_authority_decisions ADD CONSTRAINT pilot_authority_decisions_environment_class_check
         CHECK (environment_class = 'PILOT')`);
    }
  });
});

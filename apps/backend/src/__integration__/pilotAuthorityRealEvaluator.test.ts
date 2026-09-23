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
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import {
  explainAuthority, createSnapshotEvaluator, recordAuthorityRefusals, PILOT_ACTIONS,
  type AuthoritySnapshot, type RoleBinding, type AuthorityDecisionArtifact,
} from '../pilot/authorityEvaluator';
import { loadRoleBindings, loadAuthorityDecisions, loadProductionAuthoritySnapshot } from '../pilot/authorityStore';
import { setPilotCap } from '../pilot/capGovernance';
import { sqlPilotMonitor } from '../pilot/monitor';
import { sqlPilotRepository } from '../pilot/repository';

const TEST_SAURABH  = 'cccccccc-0000-4000-8000-000000000001';
const TEST_DISHANT  = 'cccccccc-0000-4000-8000-000000000002';
const TEST_KINJAL   = 'cccccccc-0000-4000-8000-000000000003';
const TEST_UNBOUND  = 'cccccccc-0000-4000-8000-000000000009';
const ENV_ID = 'NP013-PILOT-ENV';
const INSTRUMENT = 'TEST_ONLY-NP-PILOT-FIRST-APPOINTMENT-001';
const NOW = new Date('2026-09-23T12:00:00.000Z');
const PAST = '2026-01-01T00:00:00.000Z';

/**
 * NP-020 — every temporal fixture is expressed RELATIVE TO `NOW`, the one instant this suite
 * evaluates at. No fixture may read a clock the assertion does not control.
 *
 * The defect this replaces: ENG-13 inserted `effective_from = now()` — the DATABASE wall clock —
 * and then evaluated the loaded row against the hard-coded `NOW` above. Before 12:00:00Z on
 * 2026-09-23 the row was already in force and the test passed; after it, `effectiveFrom > now`
 * fired at authorityEvaluator.ts:241 and DECISION_INVALID preempted the DECISION_OUT_OF_SCOPE
 * the test exists to prove. Measured at reproduction: effective_from landed 6,142 s after the
 * evaluation instant. The test was a wall-clock time bomb, not a broken guard.
 *
 * The evaluator was never the problem — it has always taken its instant by injection
 * (`snapshot.now`) and reads no clock itself. The §29 block below already binds `effective_from`
 * as a parameter. This is that same convention, applied where it was missing.
 */
const at = (msFromNow: number): string => new Date(NOW.getTime() + msFromNow).toISOString();
const HOUR_MS = 3_600_000;
const BEFORE_NOW = at(-HOUR_MS);   // in force at NOW
const AFTER_NOW  = at(+HOUR_MS);   // not yet effective at NOW
const AT_NOW     = at(0);          // the exact boundary

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
       VALUES ($1, true, $2, 'PILOT', $3)`, [INSTRUMENT, [...PILOT_ACTIONS], BEFORE_NOW]);
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
         VALUES ($1, true, $2, 'PRODUCTION', $3)`, [INSTRUMENT, [...PILOT_ACTIONS], BEFORE_NOW]);
      const decisions = await loadAuthorityDecisions();
      expect(decisions[0].environmentClass).toBe('PRODUCTION');   // the row, not a constant

      // NP-020 CASE D. This assertion is the whole point of ENG-13, and for the ninety minutes
      // after 12:00:00Z it was unreachable: the artifact was not yet effective, so :241 refused
      // it as DECISION_INVALID before :245 could refuse it for being PRODUCTION. `BEFORE_NOW`
      // puts the artifact in force so the environment branch is the one under test.
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

/* ===================================================================================
 * NP-020 — the LOWER bound of the temporal contract. The upper bound is NOT pinned here.
 *
 * ENG-13 failed for ninety minutes a day, every day, from 2026-09-23T12:00:00Z onward, and
 * nothing in the suite expressed the rule it tripped over. Repairing the fixture without
 * pinning the rule would leave the next wall-clock assumption free to reintroduce it.
 *
 * The rule is READ FROM THE SOURCE, not chosen here:
 *     authorityEvaluator.ts:241   refuse when  effectiveFrom >  now    (strict)
 *     authorityEvaluator.ts:243   refuse when  expiresAt     <= now    (inclusive)
 * so the window THIS EVALUATOR implements is [effectiveFrom, expiresAt). CASE C asserts the
 * INCLUSIVE lower bound as written; it does not decide it.
 *
 * BE PRECISE ABOUT WHAT IS AND IS NOT PINNED. An earlier draft of this header claimed the
 * contract was pinned "on BOTH sides". It is not, and the gap was measured across the whole
 * corpus (798 unit + 29 integration tests):
 *
 *     :241  effectiveFrom >  now   (artifact)   CASE C is the ONLY assertion pinning it.
 *                                               Delete CASE C and `>` -> `>=` survives.
 *     :243  expiresAt     <= now   (artifact)   `<=` -> `<` SURVIVES the entire corpus
 *     :239  revokedAt     <= now   (artifact)   `<=` -> `<` SURVIVES the entire corpus
 *     :224  expiresAt     >  now   (binding)    `>`  -> `>=` SURVIVES the entire corpus
 *     :220  revokedAt     <= now   (binding)    `<=` -> `<` SURVIVES the entire corpus
 *
 * Four of the five temporal guards have UNPINNED boundary semantics. They are reachable and
 * production-mapped (authorityStore.ts:22-23, :56-57), but every fixture leaves expiresAt and
 * revokedAt null, so `x !== null` short-circuits and the comparison is never evaluated. The
 * sibling unit tests do exercise revoked/expired — only with `past` values, where `<=` and `<`
 * are indistinguishable. This is a real coverage gap, recorded rather than quietly widened:
 * closing it is a separate seam's work, not this one's (NP-020 §1, §5).
 *
 * What IS pinned, and measured: the INJECTION contract. Replace `const now = snapshot.now` in
 * explainAuthority with `new Date()` and CASE B plus the instant-control both fail.
 * =================================================================================== */
describe('NP-020 — effective_from is evaluated against the snapshot instant, not the wall clock', () => {
  beforeEach(() => reset());

  /** Drives the REAL loader and the REAL evaluator - no stub, per §26. */
  const evaluateWithEffectiveFrom = async (effectiveFrom: string) => {
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, authenticated, actions, environment_class, effective_from)
       VALUES ($1, true, $2, 'PILOT', $3)`, [INSTRUMENT, [...PILOT_ACTIONS], effectiveFrom]);
    const decisions = await loadAuthorityDecisions();
    expect(decisions).toHaveLength(1);            // vacuity guard: there IS a row to evaluate
    return explainAuthority(snap({ decisions: [...decisions] }), ctx(TEST_SAURABH, 'pilot.cap.set'));
  };

  it('CASE A — effective_from BEFORE the reference instant is IN FORCE', async () => {
    const out = await evaluateWithEffectiveFrom(BEFORE_NOW);
    expect(out.decision).toBe('ALLOW');
    expect(out.reason).toBe('ALLOWED');
  });

  it('CASE B — effective_from AFTER the reference instant is NOT YET EFFECTIVE', async () => {
    const out = await evaluateWithEffectiveFrom(AFTER_NOW);
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe('DECISION_INVALID');
  });

  it('CASE C — effective_from EXACTLY AT the reference instant is IN FORCE (lower bound INCLUSIVE)', async () => {
    // authorityEvaluator.ts:241 refuses on `>`, strictly, so equality is not refused. If that
    // line is ever changed to `>=` this test fails - which is the point of asserting the
    // boundary explicitly rather than testing a millisecond either side of it.
    expect(new Date(AT_NOW).getTime()).toBe(NOW.getTime());     // the case really is the boundary
    const out = await evaluateWithEffectiveFrom(AT_NOW);
    expect(out.decision).toBe('ALLOW');
    expect(out.reason).toBe('ALLOWED');
  });

  it('NEGATIVE CONTROL — the outcome tracks the INSTANT and nothing else', async () => {
    // Without this pair, CASE A and CASE B could both pass against a fixture that is always in
    // force (or always refused) for some reason having nothing to do with time. The two rows
    // below are byte-identical but for effective_from, and they must disagree.
    expect(new Date(BEFORE_NOW).getTime()).toBeLessThan(NOW.getTime());
    expect(new Date(AFTER_NOW).getTime()).toBeGreaterThan(NOW.getTime());

    const effective = await evaluateWithEffectiveFrom(BEFORE_NOW);
    await query('TRUNCATE pilot_authority_decisions RESTART IDENTITY CASCADE');
    const notYet = await evaluateWithEffectiveFrom(AFTER_NOW);

    expect(effective.reason).not.toBe(notYet.reason);
    expect([effective.reason, notYet.reason]).toEqual(['ALLOWED', 'DECISION_INVALID']);
  });

  it('NEGATIVE CONTROL — the fixtures do not depend on when this suite runs', async () => {
    // The defect was that a fixture read a clock. Asserting the fixtures are pure constants is
    // what stops it coming back: these three values are identical on every run, forever.
    expect(BEFORE_NOW).toBe('2026-09-23T11:00:00.000Z');
    expect(AT_NOW).toBe('2026-09-23T12:00:00.000Z');
    expect(AFTER_NOW).toBe('2026-09-23T13:00:00.000Z');
  });
});

/* ===================================================================================
 * §29 — KNOWN-GAP PIN: the database credential is the authority boundary
 *
 * NP-013 recorded, in prose, that seven application-layer privileges cannot produce an ALLOW
 * but that an ordinary INSERT can. Prose is not a control. This block executes that path
 * against the REAL loaders and the REAL predicate so the finding is a fact the suite asserts
 * rather than a claim a report makes.
 *
 * THESE TESTS ASSERT THAT A HOLE IS OPEN. They are expected to FAIL - loudly, and by design -
 * on the day a trigger, RLS policy, GRANT/REVOKE split or signature check closes it. That
 * failure is the signal to update this block, and it is the only thing standing between a
 * future session and a second "authority model verified" report written over an open door.
 *
 * Nothing here authorizes anything. The subjects are the synthetic uuids declared above, the
 * instrument is TEST_ONLY-prefixed, and the database is a disposable container.
 * =================================================================================== */
describe('§29 — a plain INSERT manufactures authority the application layer cannot', () => {
  // NP-014 NARROWS NP-013's CLAIM. A forged row alone is NOT sufficient: `loadAuthorityEnvironment`
  // resolves from process configuration as well as from the database, so in a process with no
  // PILOT_* configuration the snapshot denies on the ENVIRONMENT leg before any binding is read.
  // The gap is therefore conditional, and the condition is the pilot's own normal operating state:
  // a process configured as the pilot, which the pilot process is by definition. That is what is
  // reproduced here - not "any database write from anywhere".
  const PILOT_PROCESS_ENV = {
    PILOT_ENVIRONMENT_CLASS: 'PILOT',
    PILOT_ENVIRONMENT_ID: ENV_ID,
    PILOT_TARGET_ID: ENV_ID,
    PILOT_DATABASE_URL: 'postgres://pilot@pilot-host:5432/neuropause_pilot',
    DATABASE_URL: 'postgres://prod@prod-host:5432/neuropause',
  } as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    await reset();
    for (const [k, v] of Object.entries(PILOT_PROCESS_ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    await query(
      `INSERT INTO pilot_environment_identity (environment_class, environment_id, target_id, declared_by)
       VALUES ('PILOT', $1, $1, 'np014-gap-pin')`, [ENV_ID]);
  });
  afterEach(() => {
    for (const k of Object.keys(PILOT_PROCESS_ENV)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  it('POSITIVE CONTROL: configured as the pilot but with EMPTY authority tables, it still denies', async () => {
    const before = await loadProductionAuthoritySnapshot(NOW);
    expect(before.environment).not.toBeNull();     // the environment leg is satisfied...
    const out = explainAuthority(before, ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.decision).toBe('DENY');             // ...so this DENY is about AUTHORITY, not config
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('an ordinary INSERT through the app pool turns that DENY into ALLOW', async () => {
    await query(
      `INSERT INTO pilot_role_bindings (subject_id, role, decision_ref)
       VALUES ($1, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', $2)`, [TEST_SAURABH, INSTRUMENT]);
    // `authenticated` is the field that is supposed to mean "a human signature was verified".
    // No code path sets it true. SQL sets it true.
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, authenticated, actions, environment_class, effective_from)
       VALUES ($1, true, $2, 'PILOT', $3)`, [INSTRUMENT, [...PILOT_ACTIONS], PAST]);

    const after = await loadProductionAuthoritySnapshot(NOW);
    const out = explainAuthority(after, ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(out.decision).toBe('ALLOW');          // <-- the gap, executed
  });

  it('and the forged ALLOW leaves NO trace, because the ledger records only refusals', async () => {
    // NP-015 CORRECTION - THIS TEST COULD NOT FAIL. As NP-014 shipped it, it inserted the two
    // rows and then asserted `pilot_monitor_events = 0` WITHOUT EVER CALLING THE EVALUATOR. No
    // ALLOW was produced, so the count was zero because nothing had run - and the test would
    // have passed unchanged even if the system emitted a monitor event on every single ALLOW.
    // It was the programme's FOURTH guard-that-cannot-fail, and it sat inside the block NP-014
    // presented as its key executable control. Found by the NP-015 fan-out re-measuring it.
    await query(
      `INSERT INTO pilot_role_bindings (subject_id, role, decision_ref)
       VALUES ($1, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', $2)`, [TEST_SAURABH, INSTRUMENT]);
    await query(
      `INSERT INTO pilot_authority_decisions (instrument, authenticated, actions, environment_class, effective_from)
       VALUES ($1, true, $2, 'PILOT', $3)`, [INSTRUMENT, [...PILOT_ACTIONS], PAST]);

    // POSITIVE CONTROL: the ledger CAN be written in this context. Without this, "0 events"
    // would again be consistent with a broken monitor rather than with a silent ALLOW.
    await sqlPilotMonitor.record({
      alertClass: 'UNAUTHORIZED_AUTHORITY', outcome: 'DENIED',
      actorId: TEST_SAURABH, action: 'pilot.cap.set', reasonCode: 'NP015_POSITIVE_CONTROL',
    });
    const { rows: ctrl } = await query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pilot_monitor_events');
    expect(ctrl[0].n).toBe(1);
    await query('DELETE FROM pilot_monitor_events');

    // NP-016 SECOND CORRECTION. NP-015's repair was ALSO unfalsifiable, and for a subtler
    // reason than the original. It produced the ALLOW by calling `explainAuthority` directly -
    // but `explainAuthority` is a PURE function (its body contains no await, no async, no
    // query(), no monitor reference), so it structurally cannot write a ledger row. The zero
    // therefore moved from "guaranteed because nothing ran" to "guaranteed because a pure
    // predicate ran". Deleting the filter at authorityEvaluator.ts
    //     if (outcome.decision !== 'DENY') continue;
    // is EXACTLY the mutation the previous commit message named - "emit a monitor event on every
    // ALLOW" - and the repaired test would have stayed green, because it never invoked the
    // recording layer at all.
    //
    // The recording layer is `recordAuthorityRefusals`, and it is what production calls
    // (router.ts:159 and :163). The test now drives THAT, through the real evaluator, so the
    // assertion is sensitive to the code that actually decides what gets written.
    const after = await loadProductionAuthoritySnapshot(NOW);
    const evaluator = createSnapshotEvaluator(after);
    const decision = evaluator.evaluate(ctx(TEST_SAURABH, 'pilot.cap.set'));
    expect(decision).toBe('ALLOW');
    expect(evaluator.outcomes).toHaveLength(1);       // vacuity guard: the outcome was captured

    await recordAuthorityRefusals(sqlPilotMonitor, evaluator);

    // ...and only NOW is a zero meaningful: an ALLOW was evaluated, handed to the recorder, and
    // the recorder wrote nothing. Remove the DENY filter and this fails.
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_monitor_events');
    expect(rows[0].n).toBe(0);
  });

  it('CONTROL for the above: the SAME recorder DOES write when the outcome is a DENY', async () => {
    // Without this, "the recorder wrote nothing" is equally consistent with a recorder that
    // never writes anything at all - which is how the previous two versions of this test passed.
    const empty = await loadProductionAuthoritySnapshot(NOW);   // no bindings -> DENY
    const evaluator = createSnapshotEvaluator(empty);
    expect(evaluator.evaluate(ctx(TEST_SAURABH, 'pilot.cap.set'))).toBe('DENY');
    await recordAuthorityRefusals(sqlPilotMonitor, evaluator);
    const { rows } = await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_monitor_events');
    expect(rows[0].n).toBe(1);
  });

  it('no trigger, no RLS and no signature column defends either authority table', async () => {
    const tables = ['pilot_role_bindings', 'pilot_authority_decisions'];
    const { rows: trig } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname = ANY($1)`, [tables]);
    expect(trig[0].n).toBe(0);

    const { rows: rls } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class WHERE relname = ANY($1) AND relrowsecurity`, [tables]);
    expect(rls[0].n).toBe(0);

    // Nothing in either table stores a verifiable signature over its own contents.
    const { rows: sig } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema='public' AND table_name = ANY($1)
         AND column_name ~* '(signature|signed_by|pubkey|public_key|digest|checksum)'`, [tables]);
    expect(sig[0].n).toBe(0);
  });

  it('forging ability is EXACTLY the granted privilege - a deployment choice, not a law of the system',
    async () => {
      // NP-015 CORRECTION. This test previously asserted
      //     expect(owner[0].isowner).toBe(true)
      // i.e. "the writing credential owns the table it writes to". That was true of NP-014's
      // disposable instance, which had ONE role owning everything - so it was a property of that
      // SETUP, asserted as though it were a property of the system. NP-015 built an instance with
      // three distinct SQL identities (migrate / app / dba) and the assertion went red, correctly:
      // the tables were owned by the migration role while the connection was a different role.
      //
      // The invariant that actually holds, and that is worth pinning, is narrower and stronger:
      // WHETHER THIS CONNECTION CAN MANUFACTURE A BINDING IS DECIDED SOLELY BY ITS GRANTED
      // PRIVILEGE. Nothing else - no trigger, no RLS policy, no signature check, no provenance
      // test - stands between privilege and a forged row.
      //
      // So this test fails the day any such control is added, which is the signal to update it.
      const { rows: priv } = await query<{ can: boolean }>(
        `SELECT has_table_privilege(current_user, 'pilot_role_bindings', 'INSERT') AS can`);
      const canInsert = priv[0].can;

      let inserted = false;
      try {
        await query(
          `INSERT INTO pilot_role_bindings (subject_id, role, decision_ref)
           VALUES ($1, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', $2)`,
          [TEST_SAURABH, 'TEST_ONLY-NP015-PRIVILEGE-PROBE']);
        inserted = true;
      } catch { inserted = false; }
      await query(`DELETE FROM pilot_role_bindings WHERE decision_ref = $1`,
        ['TEST_ONLY-NP015-PRIVILEGE-PROBE']).catch(() => undefined);

      expect(inserted).toBe(canInsert);

      // Recorded, not asserted: HOW this connection came to hold that privilege. Both routes
      // appear in real deployments, and tools/np015-db-trust-boundary.sh measures all three
      // identities. Superusers bypass RLS entirely; owners can ALTER ... NO FORCE ROW LEVEL
      // SECURITY, so a control either of them "gains" is a control they can also drop.
      const { rows: who } = await query<{ su: boolean; isowner: boolean }>(
        `SELECT r.rolsuper AS su,
                pg_get_userbyid(c.relowner) = current_user AS isowner
         FROM pg_class c, pg_roles r
         WHERE c.relname = 'pilot_role_bindings' AND r.rolname = current_user`);
      expect(who).toHaveLength(1);
      if (canInsert) expect(who[0].su || who[0].isowner).toBe(true);
    });
});

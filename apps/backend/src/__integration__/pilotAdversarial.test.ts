/**
 * NP-PILOT-FIRST-006 — ADVERSARIAL RE-VERIFICATION OF THE NP-005 REMEDIATIONS.
 *
 * NP-005 fixed five load-bearing defects and proved each with a single-trial test. §9 and §16
 * of NP-006 are explicit that a single trial is not evidence for a CONCURRENCY invariant: a
 * race that fires one time in twenty passes a one-shot test every time it is run by the person
 * who wrote it. So the concurrency claims here are asserted over HUNDREDS of trials against a
 * REAL Postgres with independent connections, and the exact cardinality is recorded.
 *
 * "Do NOT accept source inspection." Every assertion below is on rows that exist afterwards.
 *
 * SYNTHETIC PARTICIPANTS ONLY. Disposable database, truncated between tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { sqlPilotRepository } from '../pilot/repository';
import {
  advanceMachineStates, applyHumanDecision, enroll, recordConsent, recordEvent,
  resumePilot, stopPilot, terminateParticipation, withdraw,
} from '../pilot/service';
import { readBackParticipation, readBackPilotControl } from '../pilot/readBack';

const deps = { repo: sqlPilotRepository };
const ALLOW = { repo: sqlPilotRepository, authority: { evaluate: () => 'ALLOW' as const } };

const TERMS_VERSION = 'TEST-FIXTURE-adversarial-terms-v1';
const TERMS_DIGEST = 'TEST-FIXTURE-DIGEST-NOT-A-REAL-HASH';

/** §9 / §16 require >= 100 trials. Recorded so the cardinality is never in doubt. */
const TRIALS = 100;

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await Promise.allSettled([closePool(), closeRedis()]); });

beforeEach(async () => {
  await query(
    `TRUNCATE pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments,
     consents, pilot_terms, users RESTART IDENTITY CASCADE`,
  );
  // TRUNCATE users CASCADE also truncates pilot_control (it references users), so re-seed.
  await query(
    `INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, false, NULL)
     ON CONFLICT (id) DO UPDATE SET stopped=false, stop_actor_id=NULL, stop_reason=NULL,
     stop_at=NULL, max_participants=NULL`,
  );
  await query(
    `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
     VALUES ($1,'PUBLISHED',$2,'ADVERSARIAL TEST FIXTURE - NOT PUBLISHED TERMS', now())`,
    [TERMS_VERSION, TERMS_DIGEST],
  );
});

const setCap = (n: number | null) => query('UPDATE pilot_control SET max_participants=$1', [n]);
const nEnrollments = async () =>
  Number((await query<{ n: number }>('SELECT count(*)::int AS n FROM pilot_enrollments')).rows[0].n);

let seq = 0;
async function newUser(tag: string): Promise<string> {
  seq += 1;
  const { rows } = await query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`synthetic-${tag}-${seq}-${Date.now()}@test.invalid`],
  );
  return rows[0].id;
}

async function enrolledUser(tag: string): Promise<string> {
  const id = await newUser(tag);
  await recordConsent(deps, id, TERMS_VERSION);
  await enroll(deps, id);
  return id;
}

/* ============================================================================================
 * §9 — WITHDRAWAL CONCURRENCY, AT SCALE
 * ========================================================================================== */

describe(`§9 withdrawal concurrency over ${TRIALS} trials`, () => {
  it(`${TRIALS} participants x 2 concurrent withdrawals: AT MOST ONE terminal transition each`, async () => {
    await setCap(TRIALS + 10);
    const users: string[] = [];
    for (let i = 0; i < TRIALS; i += 1) users.push(await enrolledUser('wd'));

    // Each pair races. All pairs run together, so the pool is genuinely contended.
    const outcomes = await Promise.all(
      users.map(async (u) => {
        const r = await Promise.allSettled([withdraw(deps, u, 'A'), withdraw(deps, u, 'B')]);
        return r.filter((x) => x.status === 'fulfilled').length;
      }),
    );

    const doubleWins = outcomes.filter((n) => n !== 1);
    expect(doubleWins).toEqual([]); // every trial admitted exactly one

    // The invariant on the durable rows, which is what actually matters.
    const ledger = await query<{ user_id: string; n: number }>(
      `SELECT subject_user_id AS user_id, count(*)::int AS n FROM pilot_lifecycle_events
       WHERE kind='WITHDRAWAL' GROUP BY subject_user_id HAVING count(*) > 1`,
    );
    expect(ledger.rows).toEqual([]); // no participant has two withdrawal rows

    const total = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pilot_lifecycle_events WHERE kind='WITHDRAWAL'",
    );
    expect(Number(total.rows[0].n)).toBe(TRIALS);
  }, 180_000);

  it(`${TRIALS} participants x (withdraw RACING terminate): exactly one exit, and the ledger agrees with the state`, async () => {
    await setCap(TRIALS + 10);
    const operator = await newUser('op');
    const users: string[] = [];
    for (let i = 0; i < TRIALS; i += 1) users.push(await enrolledUser('wt'));

    const outcomes = await Promise.all(
      users.map(async (u) => {
        const r = await Promise.allSettled([
          withdraw(deps, u, 'participant left'),
          terminateParticipation(ALLOW, operator, u, 'operator ended it'),
        ]);
        return r.filter((x) => x.status === 'fulfilled').length;
      }),
    );
    expect(outcomes.filter((n) => n !== 1)).toEqual([]);

    // AUDIT ORDER = ACTUAL COMMIT ORDER: for every participant the single ledger row's
    // new_state must equal the enrollment's final state. A "last writer wins" ambiguity would
    // show up here as a mismatch.
    const mismatched = await query<{ user_id: string }>(
      `SELECT e.user_id FROM pilot_enrollments e
       JOIN pilot_lifecycle_events l ON l.enrollment_id = e.id
       WHERE l.new_state <> e.state`,
    );
    expect(mismatched.rows).toEqual([]);

    const perUser = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT subject_user_id FROM pilot_lifecycle_events
         WHERE kind IN ('WITHDRAWAL','TERMINATION')
         GROUP BY subject_user_id HAVING count(*) > 1) x`,
    );
    expect(Number(perUser.rows[0].n)).toBe(0);
  }, 180_000);
});

/* ============================================================================================
 * §16 — THE CAP INVARIANT: SUCCESS_COUNT <= CAP, EVERY TRIAL
 * ========================================================================================== */

describe('§16 cap invariant, repeated trials', () => {
  it.each([
    [1, 2, 25],
    [1, 5, 25],
    [1, 10, 20],
    [2, 10, 20],
    [3, 10, 20],
  ])('cap %i vs %i concurrent, %i trials: SUCCESS never exceeds the cap', async (cap, concurrent, trials) => {
    let totalSuccess = 0;
    let totalReject = 0;
    let breaches = 0;

    for (let t = 0; t < trials; t += 1) {
      await query('TRUNCATE pilot_lifecycle_events, pilot_events, pilot_enrollments, consents RESTART IDENTITY CASCADE');
      await setCap(cap);
      const users: string[] = [];
      for (let i = 0; i < concurrent; i += 1) {
        const u = await newUser(`cap${cap}-${t}-${i}`);
        await recordConsent(deps, u, TERMS_VERSION);
        users.push(u);
      }

      const r = await Promise.allSettled(users.map((u) => enroll(deps, u)));
      const success = r.filter((x) => x.status === 'fulfilled').length;
      totalSuccess += success;
      totalReject += r.length - success;
      if (success > cap) breaches += 1;

      // The externally observable invariant, per trial.
      expect(await nEnrollments()).toBeLessThanOrEqual(cap);
    }

    expect(breaches).toBe(0);
    expect(totalSuccess).toBe(cap * trials);
    expect(totalReject).toBe((concurrent - cap) * trials);
  }, 300_000);
});

/* ============================================================================================
 * §8 — TERMINAL EXIT ENFORCEMENT, EVERY CONSEQUENTIAL OPERATION
 * ========================================================================================== */

describe('§8 no terminal participant may return to an active state', () => {
  it.each(['WITHDRAWN', 'TERMINATED', 'COMPLETED'] as const)(
    'a %s participation refuses every consequential operation',
    async (terminal) => {
      await setCap(10);
      const operator = await newUser('op8');
      const u = await enrolledUser('t8');
      await query('UPDATE pilot_enrollments SET state=$1 WHERE user_id=$2', [terminal, u]);

      const err = (p: Promise<unknown>) => p.then(() => null).catch((e: { code?: string }) => e);

      // decision
      expect((await err(applyHumanDecision(ALLOW, operator, u, 'CONTINUE', 'd', 'r')))?.code).toBe('already_exited');
      // withdraw
      expect((await err(withdraw(deps, u, 'again')))?.code).toBe('already_exited');
      // terminate
      expect((await err(terminateParticipation(ALLOW, operator, u, 'again')))?.code).toBe('already_exited');
      // activity
      expect((await err(recordEvent(deps, u, 'session_started', {})))?.code).toBe('already_exited');

      // the clock, even far past day 30
      await query(
        "UPDATE pilot_enrollments SET started_at = now() - interval '400 days' WHERE user_id=$1",
        [u],
      );
      expect((await advanceMachineStates(deps, u))?.state).toBe(terminal);

      // and nothing was written by any of it
      const rows = await query<{ n: number }>(
        'SELECT count(*)::int AS n FROM pilot_lifecycle_events WHERE subject_user_id=$1',
        [u],
      );
      expect(Number(rows.rows[0].n)).toBe(0);
      const state = await query<{ state: string }>('SELECT state FROM pilot_enrollments WHERE user_id=$1', [u]);
      expect(state.rows[0].state).toBe(terminal);
    },
  );
});

/* ============================================================================================
 * §10 — A STOPPED PILOT MUST NOT ADVANCE
 * ========================================================================================== */

describe('§10 a stopped pilot does not advance its participants', () => {
  it('STOP -> time passes -> no advancement; RESUME -> advancement resumes', async () => {
    await setCap(10);
    const operator = await newUser('op10');
    const u = await enrolledUser('s10');
    await stopPilot(ALLOW, operator, 'safety signal');

    await query("UPDATE pilot_enrollments SET started_at = now() - interval '40 days' WHERE user_id=$1", [u]);

    expect((await advanceMachineStates(deps, u))?.state).toBe('PILOT_ACTIVE');
    expect((await advanceMachineStates(deps, u))?.state).toBe('PILOT_ACTIVE'); // repeated evaluation

    await resumePilot(ALLOW, operator, 'cleared');

    // THE CLOCK WAS NOT FROZEN, ONLY THE WRITES. Whether stopped time should count toward the
    // 30 days is a HUMAN DECISION (D6); subtracting it here would invent the answer.
    expect((await advanceMachineStates(deps, u))?.state).toBe('DAY30_READY');
  });
});

/* ============================================================================================
 * §18 — STOP STOP RESUME RESUME STOP, RECONSTRUCTED FROM THE LEDGER ALONE
 * ========================================================================================== */

describe('§18 stop/resume evidence reconstruction', () => {
  it('no consequential event is silently overwritten across STOP STOP RESUME RESUME STOP', async () => {
    const a = await newUser('stopA');
    const b = await newUser('stopB');

    await stopPilot(ALLOW, a, 'first stop reason');
    await stopPilot(ALLOW, b, 'second stop attempt');   // repeated stop
    await resumePilot(ALLOW, b, 'first resume reason');
    await resumePilot(ALLOW, a, 'second resume attempt'); // repeated resume
    await stopPilot(ALLOW, a, 'third stop reason');

    const history = await readBackPilotControl(sqlPilotRepository);

    // The ORIGINAL stop is preserved: the repeated stop is a no-op that does not overwrite it,
    // and the repeated resume writes nothing because the pilot was not stopped.
    expect(history.episodes.map((e) => `${e.kind}:${e.reason}`)).toEqual([
      'STOP:first stop reason',
      'RESUME:first resume reason',
      'STOP:third stop reason',
    ]);
    expect(history.stopped).toBe(true);
    expect(history.standingStop).toMatchObject({ actorId: a, reason: 'third stop reason' });
    expect(history.deviations).toEqual([]);

    // Every retained episode carries actor, reason and time - nothing is a bare marker.
    for (const e of history.episodes) {
      expect(e.actorUserId).toBeTruthy();
      expect(e.reason).toBeTruthy();
      expect(e.at).toBeTruthy();
    }
  });
});

/* ============================================================================================
 * §7 — TERMS BINDING, ADVERSARIALLY
 * ========================================================================================== */

describe('§7 terms binding survives four kinds of registry change', () => {
  it.each([
    ['TERMS_DIGEST_CHANGED', async () => { await query('UPDATE pilot_terms SET digest=$1', ['MUTATED']); }, 'terms_digest_mismatch'],
    ['TERMS_STATUS_CHANGED', async () => { await query("UPDATE pilot_terms SET status='RETIRED'"); }, 'terms_no_longer_published'],
  ])('%s after consent: enrollment refused, zero mutation, no clean read-back', async (_label, mutate, code) => {
    await setCap(10);
    const u = await newUser('terms');
    await recordConsent(deps, u, TERMS_VERSION);

    await mutate();

    await expect(enroll(deps, u)).rejects.toMatchObject({ code });
    expect(await nEnrollments()).toBe(0);

    // And the reconstruction does not report a clean participation.
    const rb = await readBackParticipation(sqlPilotRepository, u);
    expect(rb.enrollment.recorded).toBe(false);
  });

  it('TERMS_ID_DELETED IS NOT REACHABLE: a consented terms row CANNOT be deleted', async () => {
    await setCap(10);
    const u = await newUser('termsdel');
    await recordConsent(deps, u, TERMS_VERSION);

    // Measured, not assumed: consents_terms_id_fkey is
    //   FOREIGN KEY (terms_id) REFERENCES pilot_terms(id)
    // with NO ON DELETE clause, so NO ACTION applies. The database refuses to let a document
    // that somebody has consented to disappear.
    //
    // THIS IS A PROTECTION THIS PROGRAMME HAD NOT RECORDED. It is stronger than the
    // application-level check: the enrollment gate would have refused a vanished terms row,
    // but the row cannot vanish in the first place while a consent points at it.
    await expect(query('DELETE FROM pilot_terms')).rejects.toMatchObject({ code: '23503' });

    // The consent and its binding are intact, and enrollment still works.
    await enroll(deps, u);
    const rb = await readBackParticipation(sqlPilotRepository, u);
    expect(rb.consent.digest).toBe(TERMS_DIGEST);
    expect(rb.deviations).toEqual([]);
  });

  it('an UNCONSENTED terms row CAN be removed, so the protection is about consent, not about the table', async () => {
    await query(
      `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
       VALUES ('TEST-FIXTURE-orphan','DRAFT','d','ref', NULL)`,
    );
    // No consent references it, so it deletes cleanly. Without this control the assertion
    // above could hold for a reason unrelated to consent.
    await query("DELETE FROM pilot_terms WHERE version='TEST-FIXTURE-orphan'");
    const left = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pilot_terms WHERE version='TEST-FIXTURE-orphan'",
    );
    expect(Number(left.rows[0].n)).toBe(0);
  });

  it('TERMS_VERSION_REPUBLISHED: the participant keeps the document they actually accepted', async () => {
    await setCap(10);
    const u = await newUser('republish');
    await recordConsent(deps, u, TERMS_VERSION);

    // A DIFFERENT document is published under the same version string.
    await query('UPDATE pilot_terms SET version=$1', [`${TERMS_VERSION}-superseded`]);
    await query(
      `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
       VALUES ($1,'PUBLISHED','A-DIFFERENT-DIGEST','IMPOSTOR', now())`,
      [TERMS_VERSION],
    );

    await enroll(deps, u); // correctly admitted - nothing changed for THEM

    const rb = await readBackParticipation(sqlPilotRepository, u);
    expect(rb.consent.digest).toBe(TERMS_DIGEST);        // the content they accepted
    expect(rb.consent.termsVersion).toBe(`${TERMS_VERSION}-superseded`);
    expect(rb.deviations).toEqual([]);
  });
});

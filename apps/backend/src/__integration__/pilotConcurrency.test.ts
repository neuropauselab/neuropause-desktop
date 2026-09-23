/**
 * THE ENROLLMENT AND EXIT INVARIANTS, PROVEN AGAINST A REAL POSTGRES.
 *
 * Every other pilot test in this repository runs against the in-memory repository. That is
 * fast and it cannot settle the question this file exists for: the enrollment cap and the exit
 * compare-and-set are enforced by SQL semantics — `SELECT ... FOR UPDATE` inside a transaction,
 * and a state precondition inside an UPDATE — and **an in-memory analogue cannot prove either.**
 *
 * NP-PILOT-FIRST-005 recorded exactly this as a known limitation: "the SQL repository is
 * exercised by no automated test" and "the concurrency claim is reasoned, not executed". This
 * closes both. The invariant asserted here is EXTERNALLY OBSERVABLE — how many rows exist
 * afterwards — not an inspection of the statement text.
 *
 * The defect being guarded against was real and was measured: before the atomic write, a cap of
 * 1 admitted 2 participants, because counting and inserting were separate statements.
 *
 * SYNTHETIC PARTICIPANTS ONLY. Every account here is created by this file, in a disposable
 * database, and truncated between tests.
 *
 * Excluded from the default run; invoked via `npm run test:integration` with TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { sqlPilotRepository } from '../pilot/repository';
import { enroll, recordConsent, terminateParticipation, withdraw } from '../pilot/service';
import { readBackParticipation } from '../pilot/readBack';

const deps = { repo: sqlPilotRepository };
const ALLOW = { repo: sqlPilotRepository, authority: { evaluate: () => 'ALLOW' as const } };

/** A clearly-labelled test terms row. NEVER production terms. */
const TERMS_VERSION = 'TEST-FIXTURE-integration-terms-v1';
const TERMS_DIGEST = 'TEST-FIXTURE-DIGEST-NOT-A-REAL-HASH';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await Promise.allSettled([closePool(), closeRedis()]);
});

beforeEach(async () => {
  await query(
    `TRUNCATE pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments,
     consents, pilot_terms, users RESTART IDENTITY CASCADE`,
  );
  /*
   * RE-SEED the control singleton rather than UPDATE it.
   *
   * The TRUNCATE above names `users` with CASCADE, and `pilot_control.stop_actor_id`
   * REFERENCES users(id) - so Postgres truncates pilot_control too. An UPDATE then matches
   * zero rows, the singleton is gone, and `getControl` FAILS CLOSED with
   * `stopped: true, stopReason: 'pilot_control row missing'`.
   *
   * That is the design working correctly, and it cost 13 red tests to notice: every enrollment
   * was refused `pilot_stopped`, which looked like 13 defects and was one harness bug. The
   * fail-closed behaviour it exposed is pinned as its own test below.
   */
  await query(
    `INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, false, NULL)
     ON CONFLICT (id) DO UPDATE SET stopped=false, stop_actor_id=NULL, stop_reason=NULL,
     stop_at=NULL, max_participants=NULL`,
  );
  await query(
    `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
     VALUES ($1,'PUBLISHED',$2,'INTEGRATION TEST FIXTURE - NOT PUBLISHED TERMS', now())`,
    [TERMS_VERSION, TERMS_DIGEST],
  );
});

/** Create N synthetic accounts, each with a bound consent, ready to enroll. */
async function seedConsentedUsers(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`synthetic-conc-${i}-${Date.now()}@test.invalid`],
    );
    const id = rows[0].id;
    await recordConsent(deps, id, TERMS_VERSION);
    ids.push(id);
  }
  return ids;
}

const setCap = (n: number | null) => query('UPDATE pilot_control SET max_participants=$1', [n]);
const countEnrollments = async () =>
  Number((await query<{ n: string }>('SELECT count(*)::int AS n FROM pilot_enrollments')).rows[0].n);

describe('THE ENROLLMENT CAP IS AN EXTERNALLY OBSERVABLE INVARIANT', () => {
  it.each([
    [1, 2],
    [1, 5],
    [1, 10],
    [2, 5],
    [2, 10],
    [3, 10],
  ])('cap %i against %i truly concurrent enrollments admits EXACTLY the cap', async (cap, concurrent) => {
    await setCap(cap);
    const users = await seedConsentedUsers(concurrent);

    // All started before any finishes. Each call takes its own pool connection, so these are
    // genuinely separate database sessions contending for the same control row.
    const results = await Promise.allSettled(users.map((u) => enroll(deps, u)));

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(cap);
    expect(rejected).toHaveLength(concurrent - cap);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.code).toBe('enrollment_full');
    }
    // The assertion that matters: what is actually in the table.
    expect(await countEnrollments()).toBe(cap);
  });

  it('A CAP OF ZERO IS NOT EXPRESSIBLE - the schema refuses it, and that has a consequence', async () => {
    // Measured, not assumed: pilot_control_max_participants_check is
    //   (max_participants IS NULL OR max_participants > 0)
    // so 0 cannot be stored at all. The intent is sound - it stops 0 from being read as either
    // "unlimited" or "undecided", leaving NULL as the single UNDECIDED value.
    await expect(setCap(0)).rejects.toMatchObject({ code: '23514' });

    // THE CONSEQUENCE, recorded rather than worked around: there is NO WAY TO CLOSE ENROLLMENT
    // WHILE THE PILOT KEEPS RUNNING. Stopping the pilot also halts participant activity, and
    // setting the cap to the current count does not hold - a withdrawal frees a slot and
    // enrollment silently reopens. Demonstrated here.
    const users = await seedConsentedUsers(2);
    await setCap(1);
    await enroll(deps, users[0]);
    await expect(enroll(deps, users[1])).rejects.toMatchObject({ code: 'enrollment_full' });

    await withdraw(deps, users[0], 'leaving');

    await enroll(deps, users[1]); // the "closed" pilot admitted someone new
    expect(await countEnrollments()).toBe(2);
  });

  it('cap NULL means UNDECIDED and admits nobody - it is NOT unlimited', async () => {
    await setCap(null);
    const users = await seedConsentedUsers(3);

    const results = await Promise.allSettled(users.map((u) => enroll(deps, u)));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason.code).toBe('enrollment_boundary_undecided');
    }
    expect(await countEnrollments()).toBe(0);
  });

  it('a duplicate enrollment by the SAME account is refused, concurrently as well as serially', async () => {
    await setCap(10);
    const [u] = await seedConsentedUsers(1);

    const results = await Promise.allSettled([enroll(deps, u), enroll(deps, u), enroll(deps, u)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await countEnrollments()).toBe(1);
  });

  it('a retry after a full-cap refusal still refuses, and a freed slot is then admitted', async () => {
    await setCap(1);
    const [a, b] = await seedConsentedUsers(2);
    await enroll(deps, a);

    await expect(enroll(deps, b)).rejects.toMatchObject({ code: 'enrollment_full' });
    await expect(enroll(deps, b)).rejects.toMatchObject({ code: 'enrollment_full' }); // retry

    await withdraw(deps, a, 'freeing the slot');

    await enroll(deps, b);
    expect(await countEnrollments()).toBe(2); // one WITHDRAWN, one active
  });
});

describe('THE EXIT IS A COMPARE-AND-SET, AGAINST A REAL DATABASE', () => {
  it('two truly concurrent withdrawals produce ONE exit and ONE ledger row', async () => {
    await setCap(5);
    const [u] = await seedConsentedUsers(1);
    await enroll(deps, u);

    const results = await Promise.allSettled([withdraw(deps, u, 'first'), withdraw(deps, u, 'second')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ledger = await query<{ n: string }>(
      "SELECT count(*)::int AS n FROM pilot_lifecycle_events WHERE kind='WITHDRAWAL'",
    );
    expect(Number(ledger.rows[0].n)).toBe(1);
  });

  it('a withdrawal racing a TERMINATION yields exactly one exit, preserving the distinction', async () => {
    await setCap(5);
    const [u] = await seedConsentedUsers(1);
    await enroll(deps, u);
    const { rows } = await query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      [`synthetic-operator-${Date.now()}@test.invalid`],
    );
    const operator = rows[0].id;

    const results = await Promise.allSettled([
      withdraw(deps, u, 'the participant left'),
      terminateParticipation(ALLOW, operator, u, 'the operator ended it'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const ledger = await query<{ kind: string; new_state: string }>(
      'SELECT kind, new_state FROM pilot_lifecycle_events',
    );
    expect(ledger.rows).toHaveLength(1);

    // The ledger and the enrollment must agree about which exit happened.
    const enrollment = await query<{ state: string }>(
      'SELECT state FROM pilot_enrollments WHERE user_id=$1',
      [u],
    );
    expect(ledger.rows[0].new_state).toBe(enrollment.rows[0].state);

    // And the reconstruction agrees too, with no deviation.
    const rb = await readBackParticipation(sqlPilotRepository, u);
    expect(rb.status).toBe('EXITED');
    expect(rb.deviations).toEqual([]);
  });
});

describe('WRITE -> READ -> RECONSTRUCT, against real rows', () => {
  it('a full participation reconstructs from the database alone', async () => {
    await setCap(5);
    const [u] = await seedConsentedUsers(1);
    await enroll(deps, u);
    await withdraw(deps, u, 'reconstruct me');

    const rb = await readBackParticipation(sqlPilotRepository, u);

    expect(rb.status).toBe('EXITED');
    expect(rb.consent).toMatchObject({ recorded: true, version: TERMS_VERSION, boundToTerms: true });
    expect(rb.consent.termsVersion).toBe(TERMS_VERSION);
    expect(rb.consent.termsStatus).toBe('PUBLISHED');
    expect(rb.consent.digest).toBe(TERMS_DIGEST);
    expect(rb.enrollment.state).toBe('WITHDRAWN');
    expect(rb.transitions).toHaveLength(1);
    expect(rb.transitions[0]).toMatchObject({ kind: 'WITHDRAWAL', reason: 'reconstruct me' });
    expect(rb.deviations).toEqual([]);
  });

  it('a stale terms digest refuses enrollment against the real registry', async () => {
    await setCap(5);
    const [u] = await seedConsentedUsers(1);
    await query('UPDATE pilot_terms SET digest=$1 WHERE version=$2', ['CHANGED-DIGEST', TERMS_VERSION]);

    await expect(enroll(deps, u)).rejects.toMatchObject({ code: 'terms_digest_mismatch' });
    expect(await countEnrollments()).toBe(0);
  });
});

describe('THE CONTROL SINGLETON FAILS CLOSED WHEN IT IS MISSING', () => {
  /**
   * Not hypothetical - reached by accident while building this file. `TRUNCATE users CASCADE`
   * removes pilot_control, because that table references users. A pilot whose control row has
   * vanished must not become an OPEN pilot.
   */
  it('a missing control row reports STOPPED with an UNDECIDED boundary, and refuses enrollment', async () => {
    await setCap(10);
    const [u] = await seedConsentedUsers(1);
    await query('DELETE FROM pilot_control');

    const control = await sqlPilotRepository.getControl();
    expect(control.stopped).toBe(true);
    expect(control.maxParticipants).toBeNull();
    expect(control.stopReason).toBe('pilot_control row missing');

    await expect(enroll(deps, u)).rejects.toMatchObject({ code: 'pilot_stopped' });
    expect(await countEnrollments()).toBe(0);
  });
});

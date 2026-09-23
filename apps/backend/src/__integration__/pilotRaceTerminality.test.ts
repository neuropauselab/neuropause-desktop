/**
 * NP-PILOT-FIRST-007 REGRESSION PINS — against REAL Postgres, which is the only place this
 * defect class exists.
 *
 * NP-007 reproduced these over real HTTP at 36-39% of 100 trials. A pin that fails 37% of the
 * time is not a regression pin. These force the interleaving instead: the commit that used to
 * be invisible happens EXACTLY inside the window the old code read across, so they fail 100%
 * of the time against the old code and pass 100% against the fix.
 *
 * WHY THESE CANNOT LIVE IN THE DEFAULT SUITE: the in-memory repository hands out live
 * references, so the "stale" read is never stale there and the old code passes. See
 * `src/pilot/memoryRepository.limits.test.ts`.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { sqlPilotRepository } from '../pilot/repository';
import { advanceMachineStates, applyHumanDecision, enroll, recordEvent, withdraw } from '../pilot/service';
import type { PilotRepository } from '../pilot/repository';

const P = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const TERMS = { version: 'NP008-RACE-TERMS-v1', digest: 'NP008-RACE-DIGEST' };

beforeAll(async () => { await runMigrations(); });
afterAll(async () => { await closePool(); await closeRedis(); });

/** Run `hook` exactly once, at the moment `on` is called — the interleaving, forced. */
function interleave(repo: PilotRepository, on: keyof PilotRepository, hook: () => Promise<void>): PilotRepository {
  let fired = false;
  return new Proxy(repo, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (k !== on || typeof v !== 'function') return v;
      return async (...args: unknown[]) => {
        if (!fired) { fired = true; await hook(); }
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  }) as PilotRepository;
}

async function reset(stopped = false) {
  await query('TRUNCATE pilot_lifecycle_events, pilot_events, human_decisions, pilot_enrollments, consents, pilot_terms RESTART IDENTITY CASCADE');
  await query('DELETE FROM pilot_control');
  await query('INSERT INTO pilot_control (id, stopped, max_participants) VALUES (true, $1, 10)', [stopped]);
  for (const id of [P, OP])
    await query("INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING", [id, `${id}@np008.invalid`]);
  const { rows } = await query(
    `INSERT INTO pilot_terms (version, status, digest, content_reference, published_at)
     VALUES ($1,'PUBLISHED',$2,'NP-008 race fixture', now()) RETURNING *`, [TERMS.version, TERMS.digest]);
  return rows[0];
}

async function seedActive(daysAgo: number) {
  const terms = await reset();
  await sqlPilotRepository.recordConsent(P, TERMS.version, {
    id: terms.id, version: terms.version, status: 'PUBLISHED', digest: terms.digest,
    contentReference: terms.content_reference, publishedAt: terms.published_at,
  });
  const e = await enroll({ repo: sqlPilotRepository }, P);
  await query('UPDATE pilot_enrollments SET started_at = now() - ($2 || \' days\')::interval WHERE id=$1', [e.id, String(daysAgo)]);
  return e;
}

describe('NP-007 DEFECT-1 — a status poll must not revive a withdrawn participation', () => {
  for (const day of [8, 31]) {
    it(`day ${day}: a withdrawal committing mid-advance leaves the participation EXITED`, async () => {
      await seedActive(day);
      const raced = interleave(sqlPilotRepository, 'getControl', async () => {
        await withdraw({ repo: sqlPilotRepository }, P, 'participant withdrew mid-poll');
      });
      // Exactly what GET /pilot/status runs (router.ts:135).
      await advanceMachineStates({ repo: raced }, P);

      const after = await sqlPilotRepository.getEnrollment(P);
      expect(after?.state).toBe('WITHDRAWN');

      // The consequence that made this a pilot blocker, not a cosmetic one.
      await expect(recordEvent({ repo: sqlPilotRepository }, P, 'session_started', {}))
        .rejects.toMatchObject({ code: 'already_exited' });
    });
  }
});

describe('NP-007 DEFECT-2 — a committed STOP binds writes already in flight', () => {
  it('an advancement racing a STOP does not write', async () => {
    await seedActive(8);
    const raced = interleave(sqlPilotRepository, 'getEnrollment', async () => {
      await sqlPilotRepository.setStopped(true, OP, 'NP-008 regression');
    });
    await advanceMachineStates({ repo: raced }, P);
    expect((await sqlPilotRepository.getEnrollment(P))?.state).toBe('PILOT_ACTIVE');
  });

  it('an event insert racing a STOP does not write', async () => {
    await seedActive(2);
    const raced = interleave(sqlPilotRepository, 'getControl', async () => {
      await sqlPilotRepository.setStopped(true, OP, 'NP-008 regression');
    });
    await expect(recordEvent({ repo: raced }, P, 'session_started', {})).rejects.toThrow();
    const { rows } = await query('SELECT count(*)::int AS n FROM pilot_events');
    expect(rows[0].n).toBe(0);
  });
});

describe('NP-007 DEFECT-2b — a stop racing an enrollment is refused AS STOPPED', () => {
  it('names the real cause, not enrollment_full', async () => {
    const terms = await reset();
    await sqlPilotRepository.recordConsent(P, TERMS.version, {
      id: terms.id, version: terms.version, status: 'PUBLISHED', digest: terms.digest,
      contentReference: terms.content_reference, publishedAt: terms.published_at,
    });
    const raced = interleave(sqlPilotRepository, 'latestConsent', async () => {
      await sqlPilotRepository.setStopped(true, OP, 'NP-008 regression');
    });
    // Reporting a stop as `enrollment_full` sends an operator to look at the cap.
    await expect(enroll({ repo: raced }, P)).rejects.toMatchObject({ code: 'pilot_stopped' });
    expect(await sqlPilotRepository.getEnrollment(P)).toBeNull();
  });
});

describe('fail-closed: a missing pilot_control singleton refuses advancement', () => {
  it('does not wave the write through', async () => {
    await seedActive(31);
    await query('DELETE FROM pilot_control');
    const ok = await sqlPilotRepository.advanceMachineStateIfRunning(
      (await sqlPilotRepository.getEnrollment(P))!.id, ['PILOT_ACTIVE'], 'DAY30_READY');
    expect(ok).toBe(false);
    expect((await sqlPilotRepository.getEnrollment(P))?.state).toBe('PILOT_ACTIVE');
  });
});

describe('NP-007 DEFECT-3 — a human decision must not overwrite an exit', () => {
  /*
   * NOT REACHABLE IN PRODUCTION TODAY, AND PINNED ANYWAY.
   *
   * Production supplies no authority evaluator, so every decision route refuses before
   * reaching this code. The `evaluate: () => 'ALLOW'` below is a TEST DESIGNATION used to
   * exercise the mechanics; it grants nothing and exists in no production path.
   *
   * It is pinned because the defect becomes reachable the DAY an evaluator is written — which
   * is now permitted, D05 having designated authority. A defect that is only unreachable
   * because a feature is missing is a defect scheduled to arrive with the feature.
   */
  const testDesignation = { evaluate: () => 'ALLOW' as const };

  it('a decision racing a withdrawal loses, and the exit stands', async () => {
    await seedActive(31);
    const raced = interleave(sqlPilotRepository, 'insertDecision', async () => {
      await withdraw({ repo: sqlPilotRepository }, P, 'participant withdrew mid-decision');
    });
    await expect(
      applyHumanDecision({ repo: raced, authority: testDesignation }, OP, P, 'CONTINUE', 'continue', 'NP-008 race pin'),
    ).rejects.toMatchObject({ code: 'already_exited' });

    const after = await sqlPilotRepository.getEnrollment(P);
    expect(after?.state).toBe('WITHDRAWN');
  });
});

/**
 * G1 — the 30-day lifecycle, boundary by boundary.
 *
 * NP-PILOT-FIRST-003 recorded C-01: both machine transitions required
 * `state === 'PILOT_ACTIVE'`, so DAY7_READY was a machine DEAD END. Since
 * `/pilot/status` advances state on every request and the web page polls it on load,
 * a single check-in between day 7 and day 29 permanently foreclosed DAY30_READY.
 * The 30-day lifecycle was reachable only by a participant who never looked at it.
 *
 * The load-bearing case in this file is `participation must not suppress completion`.
 * Run it against the pre-fix service and it fails; that is the regression it pins.
 *
 * Convention follows service.test.ts: the clock is moved by back-dating `startedAt`
 * on the in-memory enrollment, so no timer or fake-clock is needed.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import { seedPilotFixtures, TEST_TERMS_VERSION } from './testFixtures';
import { advanceMachineStates, enroll, pilotDay, recordConsent, status } from './service';
import type { PilotState } from './types';

const U = 'user-g1';
const DAY = 86_400_000;

async function enrolled() {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  const deps = { repo };
  await recordConsent(deps, U, TEST_TERMS_VERSION);
  await enroll(deps, U);
  return { deps, repo };
}

/** Move the enrollment's start back so that `pilotDay` reads `day`. */
function atDay(repo: ReturnType<typeof createMemoryPilotRepository>, day: number) {
  repo.enrollments.get(U)!.startedAt = new Date(Date.now() - (day - 1) * DAY).toISOString();
}

function setState(repo: ReturnType<typeof createMemoryPilotRepository>, state: PilotState) {
  repo.enrollments.get(U)!.state = state;
}

describe('G1 — enrollment and the day counter', () => {
  it('enrollment starts PILOT_ACTIVE on day 1', async () => {
    const { deps, repo } = await enrolled();
    expect(repo.enrollments.get(U)!.state).toBe('PILOT_ACTIVE');
    expect((await status(deps, U)).day).toBe(1);
  });

  it('pilotDay is 1-based and advances with the clock', async () => {
    const { repo } = await enrolled();
    for (const d of [1, 2, 7, 29, 30, 31]) {
      atDay(repo, d);
      expect(pilotDay(repo.enrollments.get(U)!)).toBe(d);
    }
  });
});

describe('G1 — the day-7 boundary', () => {
  it('day 6 does not advance', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 6);
    expect((await advanceMachineStates(deps, U))?.state).toBe('PILOT_ACTIVE');
  });

  it('day 7 advances PILOT_ACTIVE to DAY7_READY', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 7);
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY7_READY');
  });

  it('repeated checks between day 7 and day 29 are idempotent', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 7);
    await advanceMachineStates(deps, U);
    for (const d of [8, 12, 20, 29]) {
      atDay(repo, d);
      expect((await advanceMachineStates(deps, U))?.state).toBe('DAY7_READY');
    }
  });
});

describe('G1 — the day-30 boundary', () => {
  it('day 29 does not reach DAY30_READY', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 29);
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY7_READY');
  });

  it('REGRESSION (C-01): participation must not suppress completion — DAY7_READY reaches DAY30_READY', async () => {
    const { deps, repo } = await enrolled();

    // The participant checks in once during the pilot, exactly as the web page does.
    atDay(repo, 10);
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY7_READY');

    // Day 30 arrives.
    atDay(repo, 30);
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY30_READY');
  });

  it('a participant who never checks in still reaches DAY30_READY from PILOT_ACTIVE', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 30);
    expect(repo.enrollments.get(U)!.state).toBe('PILOT_ACTIVE'); // never advanced
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY30_READY');
  });

  it('a lapsed enrollment lands directly on DAY30_READY, not via DAY7_READY', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 45);
    expect((await advanceMachineStates(deps, U))?.state).toBe('DAY30_READY');
  });

  it('DAY30_READY is terminal for the machine and repeated calls are idempotent', async () => {
    const { deps, repo } = await enrolled();
    atDay(repo, 30);
    await advanceMachineStates(deps, U);
    for (const d of [31, 60, 365]) {
      atDay(repo, d);
      expect((await advanceMachineStates(deps, U))?.state).toBe('DAY30_READY');
    }
  });
});

describe('G1 — the machine never touches an outcome state', () => {
  it.each(['CONTINUE', 'PAID_PENDING_HUMAN_DECISION', 'INSTITUTIONAL_PENDING', 'EXTENDED', 'STOPPED', 'COMPLETED'] as const)(
    'leaves %s untouched even past day 30',
    async (outcome) => {
      const { deps, repo } = await enrolled();
      setState(repo, outcome);
      atDay(repo, 400);
      expect((await advanceMachineStates(deps, U))?.state).toBe(outcome);
    },
  );

  it('a COMPLETED pilot cannot regress to a clock state', async () => {
    const { deps, repo } = await enrolled();
    setState(repo, 'COMPLETED');
    atDay(repo, 8);
    expect((await advanceMachineStates(deps, U))?.state).toBe('COMPLETED');
    atDay(repo, 30);
    expect((await advanceMachineStates(deps, U))?.state).toBe('COMPLETED');
  });
});

describe('G1 — states with no writer (recorded, not invented)', () => {
  /**
   * DAY7_REVIEWED and OUTCOME_PENDING are declared in PilotState and in the SQL CHECK,
   * but they are in neither HUMAN_DECISION_STATES nor any machine transition, so no code
   * path can set them. This test PINS that fact rather than asserting a behaviour: giving
   * them a writer would require deciding what they MEAN, which is a human governance
   * question (recorded as HUMAN_DECISION_REQUIRED in NP-PILOT-FIRST-004). If a writer is
   * added later, this test fails and forces that decision to be recorded.
   */
  it('DAY7_REVIEWED and OUTCOME_PENDING remain unreachable by the machine', async () => {
    const { deps, repo } = await enrolled();
    for (const d of [1, 7, 8, 29, 30, 60]) {
      atDay(repo, d);
      const after = await advanceMachineStates(deps, U);
      expect(after?.state).not.toBe('DAY7_REVIEWED');
      expect(after?.state).not.toBe('OUTCOME_PENDING');
    }
  });
});

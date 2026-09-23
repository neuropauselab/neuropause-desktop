/**
 * WHAT THE IN-MEMORY REPOSITORY CANNOT TEST — pinned, so nobody claims it did.
 *
 * NP-PILOT-FIRST-007 found three read-then-write defects that NP-006's 200 in-memory race
 * trials had declared safe. This file records WHY those trials could not have found them,
 * rather than leaving it as folklore.
 *
 * `createMemoryPilotRepository` stores rows in a Map and hands out THE STORED OBJECT. A caller
 * that reads an enrollment and then awaits is holding a LIVE REFERENCE: when someone else
 * withdraws, the caller's own variable changes underneath it. So `e.state` is never stale, and
 * a guard that reads `e.state` before a write LOOKS CORRECT HERE AND IS NOT CORRECT IN SQL,
 * where the caller holds a snapshot.
 *
 * A test double that is more COHERENT than the real thing produces false greens exactly as
 * surely as one that is more generous. The concurrency pins that matter live in
 * `src/__integration__/pilotRaceTerminality.test.ts`, against real Postgres.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import type { PilotControl, PilotTerms } from './types';
import { enroll, withdraw } from './service';
import { seedPilotFixtures, TEST_TERMS } from './testFixtures';

const P = '11111111-1111-4111-8111-111111111111';

describe('in-memory repository: documented limitation', () => {
  it('ALIASES its rows, so a stale read cannot be reproduced here', async () => {
    const repo = createMemoryPilotRepository() as ReturnType<typeof createMemoryPilotRepository> &
      { terms: PilotTerms[]; control: PilotControl };
    seedPilotFixtures(repo, { cap: 10 });
    await repo.recordConsent(P, TEST_TERMS.version, TEST_TERMS);
    await enroll({ repo }, P);

    const handleTakenBefore = (await repo.getEnrollment(P))!;
    expect(handleTakenBefore.state).toBe('PILOT_ACTIVE');

    await withdraw({ repo }, P, 'documented-limitation probe');

    // If this ever becomes 'PILOT_ACTIVE', the repository has started returning copies —
    // which would be an IMPROVEMENT, and would mean the in-memory suite can finally see this
    // defect class. Until then, treat every in-memory concurrency result as inconclusive.
    expect(handleTakenBefore.state).toBe('WITHDRAWN');
  });
});

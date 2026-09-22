/**
 * C-03 / C-04 / C-05 / G6 — the four Register-C items that were MECHANISMS MISSING, not
 * merely operations unauthorized.
 *
 * NP-PILOT-FIRST-003 recorded them as:
 *   C-03  no exit existed — a participant could not withdraw, and no operator could end a
 *         participation. The only ways out were a database edit or nothing.
 *   C-04  no pilot-scoped stop existed. Stopping the pilot meant stopping the service.
 *   C-05  consent bound to no document. The server stored whatever 1..64-character string
 *         the browser sent as the record of what a participant agreed to.
 *   G6    enrollment had no boundary. Nothing anywhere named how many participants the
 *         pilot admits.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It proves the MECHANISMS now exist and are exercised, and — for the two that are
 * authority-gated (terminate, stop/resume) — that building them created NO authority:
 * with no designated evaluator every caller is refused with ZERO writes. It does NOT prove
 * that anyone may terminate a participation or stop the pilot. That needs a human
 * designation (MR-04), and no evaluator returning ALLOW ships in this repository.
 *
 * It also does NOT prove that enrollment may open. Two production defaults hold it shut and
 * are asserted here as the PRODUCTION SHAPE: the terms registry ships EMPTY (migration 0016
 * inserts no row), and `max_participants` ships NULL, which means UNDECIDED — never
 * unlimited. Both refusals are the intended state until a human supplies the missing piece.
 *
 * Fixtures: `seedPilotFixtures` / `TEST_TERMS*` are TEST FIXTURES, labelled as such in
 * testFixtures.ts. Every test that needs enrollment to be possible seeds them explicitly,
 * so no test silently inherits an open boundary.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import {
  TEST_TERMS, TEST_TERMS_DRAFT, TEST_TERMS_RETIRED, TEST_TERMS_VERSION, seedPilotFixtures,
} from './testFixtures';
import {
  advanceMachineStates, enroll, pilotControl, recordConsent, recordEvent,
  resumePilot, status, stopPilot, terminateParticipation, withdraw,
} from './service';
import type { AuthorityEvaluator, DecisionContext } from './authority';
import { readBackPilotControl } from './readBack';
import { PILOT_RE_ENROLLMENT_POLICY } from './types';

const P = 'participant-1';
const Q = 'participant-2';
const OPERATOR = 'operator-1';

type Repo = ReturnType<typeof createMemoryPilotRepository>;

/** A fixture evaluator. Shipping one of these would be a DESIGNATION, which this repo has not made. */
const allowing = (predicate: (c: DecisionContext) => boolean): AuthorityEvaluator => ({
  evaluate: (c) => (predicate(c) ? 'ALLOW' : 'DENY'),
});

/** A repository with published terms and an approved boundary, ready for enrollment. */
function seeded(cap = 100): { repo: Repo; deps: { repo: Repo } } {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo, { cap });
  return { repo, deps: { repo } };
}

async function enrolled(userId = P, cap = 100) {
  const { repo, deps } = seeded(cap);
  await recordConsent(deps, userId, TEST_TERMS_VERSION);
  await enroll(deps, userId);
  return { repo, deps };
}

const err = (p: Promise<unknown>) => p.then(() => null).catch((e: { code?: string }) => e);

/* ============================================================================================
 * C-05 — CONSENT BINDS TO A DOCUMENT
 * ========================================================================================== */

describe('C-05 — consent binds to an authoritative terms object', () => {
  it('PRODUCTION SHAPE: the registry ships EMPTY, so every version is refused with zero consents', async () => {
    const repo = createMemoryPilotRepository(); // NOT seeded — exactly what migration 0016 leaves
    const deps = { repo };

    expect(repo.terms).toHaveLength(0);
    for (const version of ['v1', 'pilot-terms-v1', 'pilot-terms-draft-v1', TEST_TERMS_VERSION]) {
      expect((await err(recordConsent(deps, P, version)))!.code).toBe('terms_unknown');
    }
    expect(await repo.latestConsent(P)).toBeNull();
  });

  it('a published version records consent bound to the terms id AND its digest', async () => {
    const { repo, deps } = seeded();
    const consent = await recordConsent(deps, P, TEST_TERMS_VERSION);

    expect(consent.version).toBe(TEST_TERMS_VERSION);
    expect(consent.termsId).toBe(TEST_TERMS.id);
    expect(consent.termsDigest).toBe(TEST_TERMS.digest);
    expect(await repo.latestConsent(P)).toMatchObject({ termsId: TEST_TERMS.id });
  });

  it.each([
    ['DRAFT', TEST_TERMS_DRAFT],
    ['RETIRED', TEST_TERMS_RETIRED],
  ])('a %s terms version is refused — existence is not publication', async (_label, terms) => {
    const { repo, deps } = seeded();

    const e = await err(recordConsent(deps, P, terms.version));

    expect(e!.code).toBe('terms_not_published');
    expect(await repo.findTerms(terms.version)).not.toBeNull(); // it EXISTS
    expect(await repo.latestConsent(P)).toBeNull();             // and still binds nothing
  });

  it('enrollment refuses a legacy consent that is bound to no terms (consent_not_bound)', async () => {
    const { repo, deps } = seeded();
    // The pre-registry shape: a consent row written with no terms object behind it.
    await repo.recordConsent(P, 'pilot-terms-draft-v1', undefined);

    const e = await err(enroll(deps, P));

    expect(e!.code).toBe('consent_not_bound');
    expect(repo.enrollments.size).toBe(0);
  });
});

/* ============================================================================================
 * G6 — THE ENROLLMENT BOUNDARY
 * ========================================================================================== */

describe('G6 — enrollment has a boundary, and an undecided boundary refuses', () => {
  it('PRODUCTION SHAPE: maxParticipants NULL is UNDECIDED, not unlimited — enrollment is withheld', async () => {
    const repo = createMemoryPilotRepository();
    repo.terms.push(TEST_TERMS); // terms published, boundary still undecided
    const deps = { repo };
    expect((await repo.getControl()).maxParticipants).toBeNull();
    await recordConsent(deps, P, TEST_TERMS_VERSION);

    const e = await err(enroll(deps, P));

    expect(e!.code).toBe('enrollment_boundary_undecided');
    expect(repo.enrollments.size).toBe(0);
  });

  it('an approved boundary admits exactly that many participants and refuses the next', async () => {
    const { repo, deps } = seeded(2);
    for (const u of [P, Q]) {
      await recordConsent(deps, u, TEST_TERMS_VERSION);
      await enroll(deps, u);
    }
    await recordConsent(deps, 'participant-3', TEST_TERMS_VERSION);

    const e = await err(enroll(deps, 'participant-3'));

    expect(e!.code).toBe('enrollment_full');
    expect(repo.enrollments.size).toBe(2);
  });

  it('an exited participation frees its place — the cap counts ACTIVE participation', async () => {
    const { repo, deps } = seeded(1);
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await recordConsent(deps, Q, TEST_TERMS_VERSION);
    expect((await err(enroll(deps, Q)))!.code).toBe('enrollment_full');

    await withdraw(deps, P, 'leaving');

    await enroll(deps, Q); // now admitted
    expect(repo.enrollments.get(Q)!.state).toBe('PILOT_ACTIVE');
    expect(await repo.countActiveEnrollments()).toBe(1);
  });

  it('the pilot-wide gates are asked FIRST, so a refusal cannot be used to probe consent', async () => {
    // No consent recorded for P at all. If the consent gate ran first the code would be
    // consent_required, which would disclose that this account has not consented.
    const repo = createMemoryPilotRepository();
    repo.terms.push(TEST_TERMS);
    const deps = { repo };

    expect((await err(enroll(deps, P)))!.code).toBe('enrollment_boundary_undecided');

    repo.control.maxParticipants = 10;
    repo.control.stopped = true;
    expect((await err(enroll(deps, P)))!.code).toBe('pilot_stopped');
  });

  it('re-enrollment stays refused — the one-shot policy is unchanged by this seam', async () => {
    const { deps } = await enrolled();
    expect((await err(enroll(deps, P)))!.code).toBe('already_enrolled');
  });
});

/* ============================================================================================
 * C-03 — EXIT: WITHDRAWAL AND TERMINATION
 * ========================================================================================== */

describe('C-03 — a participant can leave their own participation', () => {
  it('withdrawal sets WITHDRAWN and records actor, subject and reason durably', async () => {
    const { repo, deps } = await enrolled();

    const { enrollment, event } = await withdraw(deps, P, 'no longer available for the study');

    expect(enrollment.state).toBe('WITHDRAWN');
    expect(repo.enrollments.get(P)!.state).toBe('WITHDRAWN');
    expect(repo.lifecycle).toHaveLength(1);
    expect(event).toMatchObject({
      kind: 'WITHDRAWAL', actorUserId: P, subjectUserId: P,
      previousState: 'PILOT_ACTIVE', newState: 'WITHDRAWN',
      reason: 'no longer available for the study',
    });
    expect(event.createdAt).toBeTruthy();
    expect(await repo.listLifecycleEvents(enrollment.id)).toHaveLength(1);
  });

  it('withdrawal is NOT authority-gated — it works with no evaluator designated', async () => {
    const { deps } = await enrolled();
    expect(deps).not.toHaveProperty('authority');
    await expect(withdraw(deps, P, 'r')).resolves.toMatchObject({
      enrollment: { state: 'WITHDRAWN' },
    });
  });

  it('exit is TERMINAL: a second withdrawal, new events, and the clock are all refused', async () => {
    const { repo, deps } = await enrolled();
    await withdraw(deps, P, 'r');

    expect((await err(withdraw(deps, P, 'again')))!.code).toBe('already_exited');
    expect((await err(recordEvent(deps, P, 'session_started', {})))!.code).toBe('already_exited');
    expect(repo.lifecycle).toHaveLength(1);
    expect(repo.events).toHaveLength(0);

    // The day-30 machine must not reanimate an exited participation.
    repo.enrollments.get(P)!.startedAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect((await advanceMachineStates(deps, P))?.state).toBe('WITHDRAWN');
  });

  it('withdrawal preserves the evidence already recorded — nothing is deleted', async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'session_started', { n: 1 });
    await recordEvent(deps, P, 'measurement_recorded', { n: 2 });

    await withdraw(deps, P, 'r');

    expect(repo.events).toHaveLength(2);
    const s = await status(deps, P);
    expect(s.eventCount).toBe(2);
    expect(s.consentVersion).toBe(TEST_TERMS_VERSION);
  });

  it('a non-enrolled account cannot withdraw', async () => {
    const { deps } = seeded();
    expect((await err(withdraw(deps, P, 'r')))!.code).toBe('not_enrolled');
  });
});

describe('C-03 — termination exists, and building it created no authority', () => {
  it('PRODUCTION SHAPE: with no evaluator, termination is refused with ZERO writes', async () => {
    const { repo, deps } = await enrolled();

    const e = await err(terminateParticipation(deps, OPERATOR, P, 'protocol violation'));

    expect(e!.code).toBe('human_decision_required');
    expect(repo.enrollments.get(P)!.state).toBe('PILOT_ACTIVE');
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('an evaluator that DENIES refuses with zero writes', async () => {
    const { repo, deps } = await enrolled();
    const d = { ...deps, authority: { evaluate: () => 'DENY' as const } };

    expect((await err(terminateParticipation(d, OPERATOR, P, 'r')))!.code).toBe('human_decision_required');
    expect(repo.enrollments.get(P)!.state).toBe('PILOT_ACTIVE');
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('a designated operator ends ANOTHER participation, with actor and subject recorded SEPARATELY', async () => {
    const { repo, deps } = await enrolled();
    const seen: DecisionContext[] = [];
    const d = {
      ...deps,
      authority: { evaluate: (c: DecisionContext) => { seen.push(c); return 'ALLOW' as const; } },
    };

    const { enrollment, event } = await terminateParticipation(d, OPERATOR, P, 'protocol violation');

    expect(enrollment.state).toBe('TERMINATED');
    expect(event).toMatchObject({ kind: 'TERMINATION', actorUserId: OPERATOR, subjectUserId: P, reason: 'protocol violation' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ actorId: OPERATOR, subjectId: P, action: 'pilot.participation.terminate' });
    expect(seen[0].actorId).not.toBe(seen[0].subjectId);
    expect(repo.lifecycle).toHaveLength(1);
  });

  it('a participant cannot terminate someone else by naming themselves the actor', async () => {
    const { repo, deps } = await enrolled();
    await recordConsent(deps, Q, TEST_TERMS_VERSION);
    await enroll(deps, Q);
    const d = { ...deps, authority: allowing((c) => c.actorId === OPERATOR) };

    expect((await err(terminateParticipation(d, P, Q, 'r')))!.code).toBe('human_decision_required');
    expect(repo.enrollments.get(Q)!.state).toBe('PILOT_ACTIVE');
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('an already-exited participation cannot be terminated, even by a designated operator', async () => {
    const { repo, deps } = await enrolled();
    const d = { ...deps, authority: allowing(() => true) };
    await withdraw(deps, P, 'r');

    expect((await err(terminateParticipation(d, OPERATOR, P, 'r')))!.code).toBe('already_exited');
    expect(repo.enrollments.get(P)!.state).toBe('WITHDRAWN');
    expect(repo.lifecycle).toHaveLength(1); // the withdrawal only
  });
});

/* ============================================================================================
 * C-04 — THE PILOT-SCOPED STOP
 * ========================================================================================== */

describe('C-04 — a pilot-scoped stop exists, and building it created no authority', () => {
  it('PRODUCTION SHAPE: with no evaluator, stop and resume are both refused with ZERO writes', async () => {
    const { repo, deps } = seeded();

    expect((await err(stopPilot(deps, OPERATOR, 'safety signal')))!.code).toBe('human_decision_required');
    expect((await err(resumePilot(deps, OPERATOR, 'cleared')))!.code).toBe('human_decision_required');
    expect((await pilotControl(deps, OPERATOR)).stopped).toBe(false);
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('a designated authority stops the pilot, and actor, reason and time are all durable', async () => {
    const { repo, deps } = seeded();
    const d = { ...deps, authority: allowing(() => true) };

    const control = await stopPilot(d, OPERATOR, 'adverse safety signal');

    expect(control).toMatchObject({ stopped: true, stopActorId: OPERATOR, stopReason: 'adverse safety signal' });
    expect(control.stopAt).toBeTruthy();
    expect(repo.lifecycle).toHaveLength(1);
    expect(repo.lifecycle[0]).toMatchObject({
      kind: 'STOP', actorUserId: OPERATOR, reason: 'adverse safety signal',
      enrollmentId: null, subjectUserId: null, // pilot-wide: it belongs to no participation
    });
  });

  it('a stopped pilot refuses new enrollment and new participant activity', async () => {
    const { repo, deps } = await enrolled();
    await recordConsent(deps, Q, TEST_TERMS_VERSION);
    const d = { ...deps, authority: allowing(() => true) };
    await stopPilot(d, OPERATOR, 'stop');

    expect((await err(enroll(deps, Q)))!.code).toBe('pilot_stopped');
    expect((await err(recordEvent(deps, P, 'session_started', {})))!.code).toBe('pilot_stopped');
    expect(repo.enrollments.size).toBe(1);
    expect(repo.events).toHaveLength(0);
  });

  it('a stop preserves every existing record — it withholds activity, it does not erase', async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'session_started', {});
    const d = { ...deps, authority: allowing(() => true) };

    await stopPilot(d, OPERATOR, 'stop');

    expect(repo.enrollments.get(P)!.state).toBe('PILOT_ACTIVE');
    expect(repo.events).toHaveLength(1);
    expect((await status(deps, P)).eventCount).toBe(1);
  });

  it('RESUME IS A SEPARATE AUTHORITY QUESTION — stopping never carries the right to restart', async () => {
    const { repo, deps } = seeded();
    const seen: string[] = [];
    const d = {
      ...deps,
      authority: {
        evaluate: (c: DecisionContext) => {
          seen.push(c.action);
          return c.action === 'pilot.stop' ? ('ALLOW' as const) : ('DENY' as const);
        },
      },
    };

    await stopPilot(d, OPERATOR, 'stop');
    expect((await err(resumePilot(d, OPERATOR, 'restart')))!.code).toBe('human_decision_required');

    expect(seen).toEqual(['pilot.stop', 'pilot.resume']);
    expect((await pilotControl(deps, OPERATOR)).stopped).toBe(true); // still stopped
    expect(repo.lifecycle).toHaveLength(1);                // no RESUME event was written
  });

  it('a designated resume clears the stop fields and records the resume', async () => {
    const { repo, deps } = await enrolled();
    const d = { ...deps, authority: allowing(() => true) };
    await stopPilot(d, OPERATOR, 'stop');

    const control = await resumePilot(d, OPERATOR, 'safety review cleared');

    expect(control).toMatchObject({ stopped: false, stopActorId: null, stopReason: null, stopAt: null });
    expect(repo.lifecycle.map((e) => e.kind)).toEqual(['STOP', 'RESUME']);
    expect(repo.lifecycle[1]!.reason).toBe('safety review cleared');
    await expect(recordEvent(deps, P, 'session_started', {})).resolves.toMatchObject({ userId: P });
  });
});

/* ============================================================================================
 * The remaining §10 / §11 / §13 cases named by the directive.
 * ========================================================================================== */

describe('§11 — a repeated stop is deterministic and does not overwrite the first one', () => {
  it('THE SECOND STOP PRESERVES THE FIRST STOP\'S ACTOR, REASON AND TIME', async () => {
    const { repo, deps } = seeded();
    const d = { ...deps, authority: allowing(() => true) };
    const first = await stopPilot(d, OPERATOR, 'adverse safety signal');

    const second = await stopPilot(d, 'operator-2', 'unrelated later reason');

    // The authority record for WHY AND BY WHOM the pilot was stopped is the one fact a stop
    // exists to preserve, so the later caller must not replace it.
    expect(second).toEqual(first);
    expect(second.stopActorId).toBe(OPERATOR);
    expect(second.stopReason).toBe('adverse safety signal');
    expect(repo.lifecycle).toHaveLength(1); // no second STOP row either
  });

  it('an UNAUTHORIZED repeat is still refused — authority is asked before the no-op', async () => {
    const { repo, deps } = seeded();
    await stopPilot({ ...deps, authority: allowing(() => true) }, OPERATOR, 'stop');

    expect((await err(stopPilot(deps, 'stranger', 'me too')))!.code).toBe('human_decision_required');
    expect(repo.lifecycle).toHaveLength(1);
  });

  it('resuming a pilot that is not stopped records nothing — no RESUME that resumed nothing', async () => {
    const { repo, deps } = seeded();
    const d = { ...deps, authority: allowing(() => true) };

    const control = await resumePilot(d, OPERATOR, 'nothing to resume');

    expect(control.stopped).toBe(false);
    expect(repo.lifecycle).toHaveLength(0);
  });

  it('AUDIT RECONSTRUCTION: the stop history is recoverable from the pilot-wide ledger', async () => {
    const { repo, deps } = seeded();
    const d = { ...deps, authority: allowing(() => true) };
    await stopPilot(d, OPERATOR, 'first stop');
    await resumePilot(d, 'operator-2', 'cleared');
    await stopPilot(d, OPERATOR, 'second stop');

    const history = await readBackPilotControl(repo);

    expect(history.stopped).toBe(true);
    expect(history.episodes.map((e) => `${e.kind}:${e.actorUserId}:${e.reason}`)).toEqual([
      'STOP:operator-1:first stop',
      'RESUME:operator-2:cleared',
      'STOP:operator-1:second stop',
    ]);
    expect(history.standingStop).toMatchObject({ actorId: OPERATOR, reason: 'second stop' });
    expect(history.deviations).toEqual([]);
  });

  it('a control row that disagrees with its own ledger is a DEVIATION, not a silent answer', async () => {
    const { repo, deps } = seeded();
    await stopPilot({ ...deps, authority: allowing(() => true) }, OPERATOR, 'stop');
    repo.control.stopActorId = 'somebody-else'; // the control row rewritten out of band

    const history = await readBackPilotControl(repo);

    expect(history.deviations.join('\n')).toContain("ledger's last STOP was by operator-1");
  });
});

describe('§13 — the remaining enrollment-boundary cases', () => {
  it('CONCURRENT ENROLLMENT against a cap of one admits exactly one participant', async () => {
    const { repo, deps } = seeded(1);
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await recordConsent(deps, Q, TEST_TERMS_VERSION);

    // Both started before either finished — the shape a real race has.
    const results = await Promise.allSettled([enroll(deps, P), enroll(deps, Q)]);

    const admitted = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(admitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason.code).toBe('enrollment_full');
    expect(repo.enrollments.size).toBe(1);
    expect(await repo.countActiveEnrollments()).toBe(1);
  });

  it('ENROLLMENT AFTER COMPLETION is refused — a finished participation is not a free place', async () => {
    const { repo, deps } = seeded(1);
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    repo.enrollments.get(P)!.state = 'COMPLETED';

    // The same account cannot re-enroll...
    expect((await err(enroll(deps, P)))!.code).toBe('already_enrolled');
    // ...and the cap's accounting is a separate question, answered explicitly:
    // a COMPLETED participation is EXITED, so it does not occupy the boundary.
    expect(await repo.countActiveEnrollments()).toBe(0);
  });

  it('re-enrollment policy is ENCODED, not inferred from a database constraint', async () => {
    expect(PILOT_RE_ENROLLMENT_POLICY).toBe('NOT_ALLOWED_PENDING_HUMAN_DECISION');
  });
});

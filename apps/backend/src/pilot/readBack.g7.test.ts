/**
 * G7 — can one participation be reconstructed from evidence alone?
 *
 * NP-PILOT-FIRST-004 §11. Each test drives a SYNTHETIC participant through the REAL service,
 * then throws away everything the service returned and answers the question using nothing but
 * the persisted rows.
 *
 * INDEPENDENCE IS ENFORCED, NOT PROMISED. `detached()` copies the stored rows into a fresh
 * object whose WRITE methods all throw, and the reconstruction is run against that. So:
 *   - a reconstruction cannot be corroborated by the call that produced it (different objects);
 *   - a reconstruction that tried to repair what it reads would fail loudly (writes throw);
 *   - anything the reconstruction gets right, it got from a row.
 *
 * SYNTHETIC PARTICIPANTS ONLY (§20). Every id below is a fixture. No real participant exists,
 * no invitation is sent, and no 30-day clock starts for anyone.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import { TEST_TERMS, TEST_TERMS_VERSION, seedPilotFixtures } from './testFixtures';
import { applyHumanDecision, enroll, recordConsent, recordEvent, terminateParticipation, withdraw } from './service';
import { readBackParticipation } from './readBack';
import type { PilotRepository } from './repository';

const P = 'synthetic-participant-1';
const OPERATOR = 'synthetic-operator-1';
const ALLOW = { authority: { evaluate: () => 'ALLOW' as const } };

type Repo = ReturnType<typeof createMemoryPilotRepository>;

/**
 * A READ-ONLY, detached view of what was persisted. Every write throws, and every row is a
 * structural copy — so the reconstruction cannot reach the objects the service handed back.
 */
function detached(repo: Repo): PilotRepository {
  const snapshot = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const enrollments = snapshot([...repo.enrollments.values()]);
  const events = snapshot(repo.events);
  const decisions = snapshot(repo.decisions);
  const lifecycle = snapshot(repo.lifecycle);
  const terms = snapshot(repo.terms);
  const refuse = (name: string) => () => {
    throw new Error(`read-back attempted a write: ${name}`);
  };
  return {
    // The consent rows are private to the memory repository, so they are read through its
    // own reader — the one read this view cannot copy. Everything else is detached.
    latestConsent: (userId) => repo.latestConsent(userId),
    findConsentById: (id) => repo.findConsentById(id),
    getEnrollment: async (userId) => enrollments.find((e) => e.userId === userId) ?? null,
    listEvents: async (enrollmentId) => events.filter((e) => e.enrollmentId === enrollmentId),
    listLifecycleEvents: async (enrollmentId) => lifecycle.filter((e) => e.enrollmentId === enrollmentId),
    listPilotWideLifecycleEvents: async () => lifecycle.filter((e) => e.enrollmentId === null),
    findDecision: async (id) => decisions.find((d) => d.id === id) ?? null,
    findTerms: async (version) => terms.find((t) => t.version === version) ?? null,
    findTermsById: async (id) => terms.find((t) => t.id === id) ?? null,
    listPublishedTerms: async () => terms.filter((t) => t.status === 'PUBLISHED'),
    getControl: async () => ({ ...repo.control }),
    countActiveEnrollments: async () => enrollments.length,
    recordConsent: refuse('recordConsent') as PilotRepository['recordConsent'],
    createEnrollment: refuse('createEnrollment') as PilotRepository['createEnrollment'],
    createEnrollmentWithinBoundary: refuse('createEnrollmentWithinBoundary') as PilotRepository['createEnrollmentWithinBoundary'],
    setEnrollmentState: refuse('setEnrollmentState') as PilotRepository['setEnrollmentState'],
    exitEnrollmentIfActive: refuse('exitEnrollmentIfActive') as PilotRepository['exitEnrollmentIfActive'],
    insertEvent: refuse('insertEvent') as PilotRepository['insertEvent'],
    insertDecision: refuse('insertDecision') as PilotRepository['insertDecision'],
    setStopped: refuse('setStopped') as PilotRepository['setStopped'],
    insertLifecycleEvent: refuse('insertLifecycleEvent') as PilotRepository['insertLifecycleEvent'],
  };
}

function seeded() {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  return { repo, deps: { repo } };
}

/** The reconstruction, always run against the detached read-only view. */
const readBack = (repo: Repo, userId = P) => readBackParticipation(detached(repo), userId);

describe('G7 — a complete participation reconstructs from evidence alone', () => {
  it('consent -> enrollment -> activity -> withdrawal, all of it recovered from rows', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await recordEvent(deps, P, 'session_started', { n: 1 });
    await recordEvent(deps, P, 'measurement_recorded', { n: 2 });
    await recordEvent(deps, P, 'session_ended', { n: 3 });
    await withdraw(deps, P, 'no longer available for the study');

    const rb = await readBack(repo);

    expect(rb.status).toBe('EXITED');
    expect(rb.consent).toMatchObject({
      recorded: true, version: TEST_TERMS_VERSION, boundToTerms: true,
      termsStatus: 'PUBLISHED', digest: TEST_TERMS.digest,
    });
    expect(rb.enrollment.state).toBe('WITHDRAWN');
    expect(rb.enrollment.startedAt).toBeTruthy();
    expect(rb.activity.count).toBe(3);
    expect(rb.activity.types).toEqual(['session_started', 'measurement_recorded', 'session_ended']);
    expect(rb.transitions).toHaveLength(1);
    expect(rb.transitions[0]).toMatchObject({
      kind: 'WITHDRAWAL', previousState: 'PILOT_ACTIVE', newState: 'WITHDRAWN',
      actorUserId: P, reason: 'no longer available for the study',
    });
    expect(rb.deviations).toEqual([]);
  });

  it('the reconstruction NEVER WRITES — every write on the detached view throws', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    const view = detached(repo);

    await readBackParticipation(view, P); // must not touch a single writer

    for (const name of ['createEnrollment', 'createEnrollmentWithinBoundary', 'setEnrollmentState', 'insertEvent', 'insertDecision', 'setStopped', 'insertLifecycleEvent'] as const) {
      expect(() => (view[name] as (...a: never[]) => unknown)()).toThrow(/read-back attempted a write/);
    }
  });

  it('an outcome state recovers the HUMAN DECISION behind it — actor, decision and reason', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    const d = { ...deps, ...ALLOW };
    await applyHumanDecision(d, OPERATOR, P, 'COMPLETED', 'pilot completed', 'day-30 evidence reviewed');

    const rb = await readBack(repo);

    expect(rb.status).toBe('EXITED'); // COMPLETED is an exited state
    expect(rb.decision).toMatchObject({
      recorded: true, actorId: OPERATOR, reason: 'day-30 evidence reviewed',
      // The service stamps the target state into the decision text, so the state that was
      // decided is recoverable from the decision row itself, not only from the enrollment.
      decision: 'COMPLETED: pilot completed',
    });
    expect(rb.decision.id).toBe(repo.enrollments.get(P)!.decisionId);
    expect(rb.deviations).toEqual([]);
  });

  it('a termination recovers ACTOR and SUBJECT separately — who ended whose participation', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await terminateParticipation({ ...deps, ...ALLOW }, OPERATOR, P, 'protocol violation');

    const rb = await readBack(repo);

    expect(rb.status).toBe('EXITED');
    expect(rb.enrollment.state).toBe('TERMINATED');
    expect(rb.transitions[0]).toMatchObject({ kind: 'TERMINATION', actorUserId: OPERATOR, reason: 'protocol violation' });
    expect(rb.transitions[0]!.actorUserId).not.toBe(P);
  });

  it.each([
    ['a running participation', async (deps: { repo: Repo }) => { await recordEvent(deps, P, 'session_started', {}); }, 'IN_PILOT'],
    ['an untouched enrollment', async () => {}, 'IN_PILOT'],
  ])('%s reconstructs as %s', async (_label, act, expected) => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await act(deps);

    expect((await readBack(repo)).status).toBe(expected);
  });

  it('consent without enrollment, and no consent at all, are DIFFERENT reconstructions', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);

    expect((await readBack(repo)).status).toBe('CONSENT_ONLY');
    expect((await readBack(repo, 'nobody')).status).toBe('NOT_ENROLLED');
    expect((await readBack(repo, 'nobody')).consent.recorded).toBe(false);
  });
});

describe('G7 — the reconstruction states what it cannot know', () => {
  it('names the facts this pilot does not record, instead of leaving them blank', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);

    const { notRecorded } = await readBack(repo);

    // These are the §16 data-lifecycle facts. Each is structurally absent today, and the
    // reconstruction says so by name rather than implying the answer is "no".
    for (const fact of ['consent_withdrawal', 'data_export_request', 'data_erasure_request', 'retention_expiry', 'participant_notification'])
      expect(notRecorded.join('\n')).toContain(fact);
  });

  it('A LEGACY CONSENT BOUND TO NOTHING IS REPORTED AS UNRECONSTRUCTIBLE, never as agreed', async () => {
    const repo = createMemoryPilotRepository();
    // The pre-registry shape: a consent row with no terms object behind it.
    await repo.recordConsent(P, 'pilot-terms-draft-v1', undefined);

    const rb = await readBack(repo);

    expect(rb.consent.recorded).toBe(true);
    expect(rb.consent.version).toBe('pilot-terms-draft-v1');
    expect(rb.consent.boundToTerms).toBe(false);
    expect(rb.consent.termsStatus).toBeNull();
    expect(rb.notRecorded.join('\n')).toContain('terms_accepted');
  });
});

describe('G7 — disagreement is reported, never resolved by preference', () => {
  it('an outcome state with no recorded decision is a DEVIATION', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    // Simulate a write that reached an outcome state by some path other than the decision
    // endpoint — exactly what the read-back exists to catch.
    repo.enrollments.get(P)!.state = 'PAID_PENDING_HUMAN_DECISION';

    const rb = await readBack(repo);

    expect(rb.status).toBe('DEVIATION');
    expect(rb.deviations.join('\n')).toContain('no human decision is recorded');
    expect(rb.enrollment.state).toBe('PAID_PENDING_HUMAN_DECISION'); // reported, not corrected
  });

  it('an exited state with no transition explaining it is a DEVIATION', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    repo.enrollments.get(P)!.state = 'WITHDRAWN'; // no lifecycle row written

    const rb = await readBack(repo);

    expect(rb.status).toBe('DEVIATION');
    expect(rb.deviations.join('\n')).toContain('no lifecycle transition records reaching it');
  });

  it('a decision id pointing at no decision row is a DEVIATION, not a silent null', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    repo.enrollments.get(P)!.decisionId = 'decision-that-does-not-exist';

    const rb = await readBack(repo);

    expect(rb.status).toBe('DEVIATION');
    expect(rb.deviations.join('\n')).toContain('decision-that-does-not-exist');
    expect(rb.decision.recorded).toBe(false);
  });
});

describe('G13 - a COMPLETION is an exit, and appears in the ledger of exits', () => {
  /**
   * Migration 0016 called pilot_lifecycle_events "an append-only record of every lifecycle
   * exit" while its kind vocabulary admitted only WITHDRAWAL / TERMINATION / STOP / RESUME.
   * COMPLETED is in EXITED_STATES and is the one exit a 30-day pilot exists to produce, so
   * the ledger's own claim was false by one value. 0017 widened it; this pins the row.
   */
  it('a completed participation carries a COMPLETION transition, not just a state literal', async () => {
    const { repo, deps } = seeded();
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await applyHumanDecision({ ...deps, ...ALLOW }, OPERATOR, P, 'COMPLETED', 'pilot completed', 'day-30 evidence reviewed');

    const rb = await readBack(repo);

    expect(rb.status).toBe('EXITED');
    expect(rb.transitions).toHaveLength(1);
    expect(rb.transitions[0]).toMatchObject({
      kind: 'COMPLETION', previousState: 'PILOT_ACTIVE', newState: 'COMPLETED',
      actorUserId: OPERATOR, reason: 'day-30 evidence reviewed',
    });
    expect(rb.deviations).toEqual([]);
  });

  it.each(['CONTINUE', 'EXTENDED', 'PAID_PENDING_HUMAN_DECISION', 'INSTITUTIONAL_PENDING'])(
    'a %s decision writes NO exit row - it is an outcome, not an exit',
    async (state) => {
      const { repo, deps } = seeded();
      await recordConsent(deps, P, TEST_TERMS_VERSION);
      await enroll(deps, P);
      await applyHumanDecision({ ...deps, ...ALLOW }, OPERATOR, P, state, 'd', 'r');

      const rb = await readBack(repo);

      expect(rb.transitions).toEqual([]);   // inventing an exit here would overstate it
      expect(rb.status).toBe('DECIDED');
      expect(rb.decision.recorded).toBe(true);
    },
  );
});

describe('W2 - the reconstruction reports the BOUND consent, not the latest one', () => {
  /**
   * `pilot_enrollments.consent_id` was written and never read - the THIRD column in this
   * module persisted with no reader, after `insertDecision` and `terms_id`. Every
   * reconstruction used `latestConsent(userId)` instead.
   *
   * MEASURED BEFORE THE FIX: a participant bound to terms v1 who later consented to v2 had
   * their whole participation reported as resting on v2, with v2's DIGEST, in both the
   * evidence read-back and their own data export. The participation had not changed; the
   * reader had answered a different question.
   */
  const V2 = { ...TEST_TERMS, id: '00000000-0000-4000-8000-0000000000v2'.replace('v2', '0092'), version: 'TEST-FIXTURE-terms-v2', digest: 'DIGEST-V2' };

  async function boundToV1ThenConsentedToV2() {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo, { terms: [TEST_TERMS, V2] });
    const deps = { repo };
    const bound = await recordConsent(deps, P, TEST_TERMS_VERSION);
    await enroll(deps, P);
    await recordConsent(deps, P, V2.version); // a later, DIFFERENT agreement
    return { repo, bound };
  }

  it('REGRESSION: a later consent does not retroactively rewrite the participation', async () => {
    const { repo, bound } = await boundToV1ThenConsentedToV2();

    const rb = await readBack(repo);

    expect(rb.consent.version).toBe(TEST_TERMS_VERSION);
    expect(rb.consent.digest).toBe(TEST_TERMS.digest);
    expect(rb.consent.at).toBe(bound.createdAt);
    expect(rb.consent.version).not.toBe(V2.version);
    expect(rb.deviations).toEqual([]);
  });

  it('CONSENT_ONLY still resolves the latest, because nothing is bound yet', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo, { terms: [TEST_TERMS, V2] });
    const deps = { repo };
    await recordConsent(deps, P, TEST_TERMS_VERSION);
    await recordConsent(deps, P, V2.version);

    const rb = await readBack(repo);

    expect(rb.status).toBe('CONSENT_ONLY');
    expect(rb.consent.version).toBe(V2.version); // the account's current agreement
  });
});

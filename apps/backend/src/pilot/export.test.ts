/**
 * §16 - PARTICIPANT DATA EXPORT.
 *
 * NP-PILOT-FIRST-005 measured the existing `GET /auth/export` and found it reads six tables and
 * NONE of the seven pilot tables: a participant asking for their data received nothing about
 * their consent, participation, activity, own feedback or own withdrawal.
 *
 * What these tests pin is not only that the data now appears, but the rule governing what does
 * NOT: an operator-authored field is present, null, and NAMED in `withheld` alongside the
 * decision that governs it. An export that silently dropped those fields would tell the reader
 * nothing existed, which is a different and worse statement than "this exists and is not being
 * shown".
 *
 * SYNTHETIC PARTICIPANTS ONLY (§33).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryPilotRepository } from './memoryRepository';
import { TEST_TERMS, TEST_TERMS_VERSION, seedPilotFixtures } from './testFixtures';
import { applyHumanDecision, enroll, recordConsent, recordEvent, terminateParticipation, withdraw } from './service';
import { exportParticipantPilotData } from './export';

const P = 'synthetic-participant-1';
const Q = 'synthetic-participant-2';
const OPERATOR = 'synthetic-operator-1';
const ALLOW = { authority: { evaluate: () => 'ALLOW' as const } };
const FEEDBACK = 'SYNTHETIC-feedback-their-own-words';

async function enrolled(userId = P) {
  const repo = createMemoryPilotRepository();
  seedPilotFixtures(repo);
  const deps = { repo };
  await recordConsent(deps, userId, TEST_TERMS_VERSION);
  await enroll(deps, userId);
  return { repo, deps };
}

describe('§16 - an ACTIVE participant receives their own record', () => {
  it('consent, the terms document behind it, enrollment and every event', async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'session_started', {});
    await recordEvent(deps, P, 'feedback_submitted', { text: FEEDBACK });

    const out = await exportParticipantPilotData(repo, P);

    expect(out.consent).toMatchObject({
      recorded: true, version: TEST_TERMS_VERSION, termsId: TEST_TERMS.id, termsDigest: TEST_TERMS.digest,
    });
    // The document identity, not just a version string - a consent naming a version with no
    // document behind it is not a reconstructable consent record.
    expect(out.consent.terms).toMatchObject({
      version: TEST_TERMS_VERSION, status: 'PUBLISHED', digest: TEST_TERMS.digest,
      contentReference: TEST_TERMS.contentReference,
    });
    expect(out.enrollment).toMatchObject({ recorded: true, state: 'PILOT_ACTIVE' });
    expect(out.enrollment.startedAt).toBeTruthy();
    expect(out.events).toHaveLength(2);
    expect(JSON.stringify(out.events)).toContain(FEEDBACK); // their own words come back
    expect(out.withheld).toEqual([]);                        // nothing operator-authored yet
  });

  it('an account that never entered the pilot gets an empty but HONEST record', async () => {
    const repo = createMemoryPilotRepository();
    seedPilotFixtures(repo);

    const out = await exportParticipantPilotData(repo, 'nobody');

    expect(out.consent.recorded).toBe(false);
    expect(out.enrollment.recorded).toBe(false);
    expect(out.events).toEqual([]);
    expect(out.lifecycle).toEqual([]);
    expect(out.decision.recorded).toBe(false);
    // `recorded: false` is distinguishable from "enrolled but empty" - which a bare empty
    // object would not have been.
  });
});

describe('§16 - a WITHDRAWN participant receives their own withdrawal IN FULL', () => {
  it('their own reason is theirs, because they wrote it', async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'feedback_submitted', { text: FEEDBACK });
    await withdraw(deps, P, 'no longer available for the study');

    const out = await exportParticipantPilotData(repo, P);

    expect(out.enrollment.state).toBe('WITHDRAWN');
    expect(out.lifecycle).toHaveLength(1);
    expect(out.lifecycle[0]).toMatchObject({
      kind: 'WITHDRAWAL', previousState: 'PILOT_ACTIVE', newState: 'WITHDRAWN',
      reason: 'no longer available for the study', actorUserId: P, selfInitiated: true,
    });
    expect(out.withheld).toEqual([]);
    // Withdrawal deletes nothing, so the activity is still there.
    expect(out.events).toHaveLength(1);
  });
});

describe('§16 - a TERMINATED participant: the fact is disclosed, the operator content is not', () => {
  it("the transition appears, and the operator's reason and identity are WITHHELD BY NAME", async () => {
    const { repo, deps } = await enrolled();
    await terminateParticipation({ ...deps, ...ALLOW }, OPERATOR, P, 'a reason written by someone else');

    const out = await exportParticipantPilotData(repo, P);
    const raw = JSON.stringify(out);

    expect(out.enrollment.state).toBe('TERMINATED');
    expect(out.lifecycle[0]).toMatchObject({
      kind: 'TERMINATION', previousState: 'PILOT_ACTIVE', newState: 'TERMINATED',
      reason: null, actorUserId: null, selfInitiated: false,
    });
    expect(out.lifecycle[0]!.at).toBeTruthy(); // WHEN it happened is a fact about them

    // The two things a participant must not silently receive.
    expect(raw).not.toContain('a reason written by someone else');
    expect(raw).not.toContain(OPERATOR);

    // AND THE EXPORT SAYS SO, rather than looking like nothing existed.
    expect(out.withheld).toHaveLength(1);
    expect(out.withheld[0]).toContain('TERMINATION');
    expect(out.withheld[0]).toContain('HUMAN-DECISION-G5-TERMINATION-POLICY.md');
  });
});

describe('§16 - a COMPLETED participant: the decision exists, its content is withheld', () => {
  it('records that a decision was made and when, without disclosing what an operator wrote', async () => {
    const { repo, deps } = await enrolled();
    await applyHumanDecision({ ...deps, ...ALLOW }, OPERATOR, P, 'COMPLETED', 'pilot completed', 'day-30 evidence reviewed');

    const out = await exportParticipantPilotData(repo, P);
    const raw = JSON.stringify(out);

    expect(out.enrollment.state).toBe('COMPLETED');
    expect(out.decision.recorded).toBe(true);
    expect(out.decision.at).toBeTruthy();
    expect(out.decision).toMatchObject({ decision: null, reason: null, actorId: null });
    expect(raw).not.toContain('day-30 evidence reviewed');
    expect(raw).not.toContain(OPERATOR);
    expect(out.withheld.join('\n')).toContain('human_decisions');
    // The free-text `subject` column can name a third party, so it is exported in no form.
    expect(raw).not.toContain('pilot_enrollment:');
  });
});

describe('§16 - the export is scoped to ONE participant', () => {
  it("contains nothing of another participant's, in any field", async () => {
    const { repo, deps } = await enrolled();
    await recordEvent(deps, P, 'feedback_submitted', { text: FEEDBACK });
    await recordConsent(deps, Q, TEST_TERMS_VERSION);
    await enroll(deps, Q);
    await recordEvent(deps, Q, 'feedback_submitted', { text: 'SYNTHETIC-someone-elses-words' });
    await withdraw(deps, Q, 'a reason belonging to Q');

    const out = await exportParticipantPilotData(repo, P);
    const raw = JSON.stringify(out);

    expect(raw).not.toContain('SYNTHETIC-someone-elses-words');
    expect(raw).not.toContain('a reason belonging to Q');
    expect(raw).not.toContain(Q);
    expect(out.events).toHaveLength(1);
    expect(out.lifecycle).toEqual([]);
  });

  it('carries no pilot-wide programme state - the cap and the stop are not personal data', async () => {
    const { repo, deps } = await enrolled();
    // Activity first: a stopped pilot correctly refuses new events, so stopping before
    // recording would have been testing the stop, not the export.
    await recordEvent(deps, P, 'session_started', {});
    repo.control.maxParticipants = 137;
    repo.control.stopped = true;
    repo.control.stopActorId = OPERATOR;
    repo.control.stopReason = 'a programme-level reason';

    const raw = JSON.stringify(await exportParticipantPilotData(repo, P));

    expect(raw).not.toContain('137');
    expect(raw).not.toContain('a programme-level reason');
    expect(raw).not.toContain(OPERATOR);
  });
});

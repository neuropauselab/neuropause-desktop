/**
 * NP-PILOT-FIRST-015 §13 §40 — the trust-boundary state matrix S0-S9.
 *
 * TEST CLASS (§38):  REAL_EVALUATOR · IN_MEMORY snapshot · no stub, no database.
 * Not one case uses `{ evaluate: () => 'ALLOW' }`.
 *
 * WHAT THIS FILE IS FOR. §13 defines eight trust-chain invariants T1-T8 and says: "Do not claim
 * they are implemented until tests prove them." This file is that proof attempt, and it returns a
 * NEGATIVE for four of them. The evaluator's entire input vocabulary is:
 *
 *     AuthoritySnapshot { bindings, decisions, environment, now }
 *     DecisionContext   { actorId, subjectId, action, targetId? }
 *
 * There is NO input representing an appointment, identity evidence, or an independent
 * verification. So a forged binding row and a binding row that faithfully projects a validly
 * appointed, identity-verified human are, to this predicate, THE SAME OBJECT. The matrix below
 * records which states the model discriminates and which it cannot see at all.
 *
 * THE SUBJECTS ARE SYNTHETIC UUIDs THAT MAP TO NO ACCOUNT AND BIND NOBODY.
 */
import { describe, it, expect } from 'vitest';
import {
  explainAuthority, PILOT_ACTIONS,
  type AuthoritySnapshot, type RoleBinding, type AuthorityDecisionArtifact,
} from './authorityEvaluator';

const SUBJECT   = 'ffff0000-0000-4000-8000-000000000001';
const UNBOUND   = 'ffff0000-0000-4000-8000-000000000009';
const INSTRUMENT = 'TEST_ONLY-NP-PILOT-FIRST-APPOINTMENT-001';
const NOW  = new Date('2026-09-23T12:00:00.000Z');
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2027-01-01T00:00:00.000Z';

const binding = (over: Partial<RoleBinding> = {}): RoleBinding => ({
  subjectId: SUBJECT, role: 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY',
  decisionRef: INSTRUMENT, boundAt: PAST, expiresAt: null, revokedAt: null, ...over,
});
const artifact = (over: Partial<AuthorityDecisionArtifact> = {}): AuthorityDecisionArtifact => ({
  instrument: INSTRUMENT, authenticated: true, actions: [...PILOT_ACTIONS],
  environmentClass: 'PILOT', effectiveFrom: PAST, expiresAt: null, revokedAt: null, ...over,
});
const snap = (over: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  bindings: [binding()], decisions: [artifact()],
  environment: { environmentClass: 'PILOT', environmentId: 'TEST_ONLY-np015-env' },
  now: NOW, ...over,
});
const ctx = (actorId: string, action: string) => ({ actorId, subjectId: actorId, action });

describe('§40 S0-S9 — what the current trust model CAN discriminate', () => {
  it('S0: nothing at all -> DENY ROLE_NOT_BOUND', () => {
    const out = explainAuthority(snap({ bindings: [], decisions: [] }), ctx(SUBJECT, 'pilot.cap.set'));
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('S3: no projected row -> DENY ROLE_NOT_BOUND (correct outcome)', () => {
    // Appointment + identity + verification may all have happened in the world; with no row the
    // evaluator still denies. It denies because the ROW is absent, not because it checked them.
    const out = explainAuthority(snap({ bindings: [] }), ctx(SUBJECT, 'pilot.cap.set'));
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('S4: a valid projection -> ALLOW', () => {
    expect(explainAuthority(snap(), ctx(SUBJECT, 'pilot.cap.set')).decision).toBe('ALLOW');
  });

  it('S5: forged SCOPE -> DENY DECISION_OUT_OF_SCOPE', () => {
    const out = explainAuthority(
      snap({ decisions: [artifact({ actions: ['pilot.control.read'] })] }), ctx(SUBJECT, 'pilot.cap.set'));
    expect(out.reason).toBe('DECISION_OUT_OF_SCOPE');
  });

  it('S6: REVOKED appointment, stale projection -> DENY', () => {
    expect(explainAuthority(snap({ decisions: [artifact({ revokedAt: PAST })] }),
      ctx(SUBJECT, 'pilot.cap.set')).reason).toBe('DECISION_INVALID');
    expect(explainAuthority(snap({ bindings: [binding({ revokedAt: PAST })] }),
      ctx(SUBJECT, 'pilot.cap.set')).decision).toBe('DENY');
  });

  it('S7: EXPIRED appointment, stale projection -> DENY', () => {
    expect(explainAuthority(snap({ decisions: [artifact({ expiresAt: PAST })] }),
      ctx(SUBJECT, 'pilot.cap.set')).reason).toBe('DECISION_INVALID');
    expect(explainAuthority(snap({ decisions: [artifact({ effectiveFrom: FUTURE })] }),
      ctx(SUBJECT, 'pilot.cap.set')).reason).toBe('DECISION_INVALID');
  });

  it('S8: a valid role is still bounded by its ACTION scope', () => {
    const operator = snap({ bindings: [binding({ role: 'PILOT_OPERATOR_TECHNICAL_OPERATIONS' })] });
    expect(explainAuthority(operator, ctx(SUBJECT, 'pilot.stop')).decision).toBe('ALLOW');
    expect(explainAuthority(operator, ctx(SUBJECT, 'pilot.cap.set')).reason).toBe('ACTION_NOT_AUTHORIZED');
    expect(explainAuthority(snap(), ctx(UNBOUND, 'pilot.cap.set')).reason).toBe('ROLE_NOT_BOUND');
  });

  it('S9: authority over an action is NOT execution authorization (D23)', () => {
    expect(explainAuthority(snap(), ctx(SUBJECT, 'pilot.cap.set')).decision).toBe('ALLOW');
    // There is no execution action in the vocabulary at all, so no binding can imply execution.
    expect([...PILOT_ACTIONS]).not.toContain('pilot.execute');
    expect([...PILOT_ACTIONS]).not.toContain('pilot.start');
    expect([...PILOT_ACTIONS]).not.toContain('pilot.authorize.execution');
  });
});

describe('§13 T1-T4 — the invariants the current model CANNOT enforce', () => {
  /**
   * These tests assert a NEGATIVE CAPABILITY. They pass today by showing the model is blind, and
   * they are written to FAIL the day appointment / identity / verification become inputs to the
   * predicate - at which point S1 and S2 must start denying and these expectations must be
   * rewritten. That failure is the intended signal, not a regression.
   */
  it('S1/S2: a FORGED row is indistinguishable from a valid projection -> ALLOW', () => {
    // Identical object. Nothing in the snapshot says where either row came from.
    const forged = snap();
    expect(explainAuthority(forged, ctx(SUBJECT, 'pilot.cap.set')).decision).toBe('ALLOW');
  });

  it('T1 no appointment -> no binding: NOT ENFORCEABLE (no appointment input exists)', () => {
    const keys = Object.keys(snap());
    expect(keys.sort()).toEqual(['bindings', 'decisions', 'environment', 'now']);
    expect(keys).not.toContain('appointment');
  });

  it('T2 no identity evidence -> no binding: NOT ENFORCEABLE (no identity-evidence input)', () => {
    expect(Object.keys(binding()).sort())
      .toEqual(['boundAt', 'decisionRef', 'expiresAt', 'revokedAt', 'role', 'subjectId']);
    // decisionRef is a free-text string. It references an instrument by NAME, and nothing
    // verifies that the named instrument exists, is signed, or covers this subject.
    expect(typeof binding().decisionRef).toBe('string');
  });

  it('T3 no independent verification -> no binding: NOT ENFORCEABLE (no verifier input)', () => {
    const keys = Object.keys(artifact());
    expect(keys).not.toContain('verifiedBy');
    expect(keys).not.toContain('signature');
    // `authenticated` is the only field that gestures at verification, and it is a BOOLEAN with
    // no provenance: it records that someone asserted a verification, never that one occurred.
    expect(typeof artifact().authenticated).toBe('boolean');
  });

  it('T8 database mutation alone cannot manufacture a trust chain: FALSE TODAY', () => {
    // The honest statement of the gap: supply the two rows and the chain is complete, because
    // the rows ARE the chain. See tools/np015-db-trust-boundary.sh for which SQL identities can
    // write them, and 09-DATABASE-FORGE-TESTS.md for the measured matrix.
    expect(explainAuthority(snap(), ctx(SUBJECT, 'pilot.cap.set')).decision).toBe('ALLOW');
  });
});

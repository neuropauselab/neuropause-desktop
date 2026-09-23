/**
 * NP-PILOT-FIRST-016 section 15 — the self-authorization matrix S0-S5.
 *
 * TEST CLASS: REAL_EVALUATOR, IN_MEMORY snapshot, no stub, no database.
 *
 * S0-S2 were measured by NP-015. S3 (appointment claimed by a JWT subject) and S4 (appointment
 * claimed by an acceptance statement) are NEW, and they are the two that matter most, because
 * they are the two claims that actually exist in this programme today: three people have sent
 * acceptance statements, and every authenticated request carries a subject claim.
 *
 * The result to read carefully is that S1, S2 and S3 are THE SAME ALLOW. The evaluator cannot
 * see who wrote a row or how a subject came to be authenticated, so "the application wrote it",
 * "a database administrator wrote it" and "whoever holds the signing secret chose this subject"
 * are indistinguishable at the point of decision. That is the trust-boundary defect stated as a
 * test rather than as prose.
 *
 * SUBJECTS ARE SYNTHETIC UUIDs. They map to no account and bind nobody.
 */
import { describe, it, expect } from 'vitest';
import {
  explainAuthority, PILOT_ACTIONS,
  type AuthoritySnapshot, type RoleBinding, type AuthorityDecisionArtifact,
} from './authorityEvaluator';

const SUBJECT = 'aaaa0000-0000-4000-8000-00000000f001';
const NOW = new Date('2026-09-23T12:00:00.000Z');
const PAST = '2026-01-01T00:00:00.000Z';
const INSTRUMENT = 'TEST_ONLY-NP-PILOT-FIRST-APPOINTMENT-001';

const binding = (o: Partial<RoleBinding> = {}): RoleBinding => ({
  subjectId: SUBJECT, role: 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', decisionRef: INSTRUMENT,
  boundAt: PAST, expiresAt: null, revokedAt: null, ...o,
});
const artifact = (o: Partial<AuthorityDecisionArtifact> = {}): AuthorityDecisionArtifact => ({
  instrument: INSTRUMENT, authenticated: true, actions: [...PILOT_ACTIONS],
  environmentClass: 'PILOT', effectiveFrom: PAST, expiresAt: null, revokedAt: null, ...o,
});
const snap = (o: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  bindings: [binding()], decisions: [artifact()],
  environment: { environmentClass: 'PILOT', environmentId: 'TEST_ONLY-np016' }, now: NOW, ...o,
});
const ctx = (actorId: string) => ({ actorId, subjectId: actorId, action: 'pilot.cap.set' });
const decide = (s: AuthoritySnapshot) => explainAuthority(s, ctx(SUBJECT));

describe('section 15 — S0-S5 self-authorization', () => {
  it('S0 no appointment at all -> DENY ROLE_NOT_BOUND', () => {
    const out = decide(snap({ bindings: [], decisions: [] }));
    expect(out.decision).toBe('DENY');
    expect(out.reason).toBe('ROLE_NOT_BOUND');
  });

  it('S1 appointment claimed ONLY by an application row -> ALLOW (trust-boundary defect)', () => {
    expect(decide(snap()).decision).toBe('ALLOW');
  });

  it('S2 appointment claimed by a DATABASE ADMINISTRATOR -> the SAME ALLOW', () => {
    // Byte-identical snapshot. The writer is not an input to the predicate, so S2 cannot be
    // distinguished from S1 no matter who actually executed the INSERT.
    expect(JSON.stringify(snap())).toBe(JSON.stringify(snap()));
    expect(decide(snap()).decision).toBe('ALLOW');
  });

  it('S3 appointment claimed by a JWT SUBJECT -> ALLOW, and nothing marks it as asserted', () => {
    // A subject claim is just a string that became actorId. If a binding names that subject,
    // whoever could mint the token holds the authority. The evaluator sees no difference
    // between a subject that authenticated honestly and one that was chosen.
    expect(decide(snap()).decision).toBe('ALLOW');
    // ...and with no binding for that subject, the subject claim alone confers nothing:
    expect(decide(snap({ bindings: [] })).reason).toBe('ROLE_NOT_BOUND');
  });

  it('S4 appointment claimed by an ACCEPTANCE STATEMENT -> NOT_MEASURABLE, and that is the point',
    () => {
      // Three acceptance statements exist in the programme. NONE of them is representable here:
      // there is no field in a snapshot, a binding, or a decision artifact in which "this person
      // accepted the role" could be recorded, so the evaluator cannot be shown one.
      const keys = [...Object.keys(snap()), ...Object.keys(binding()), ...Object.keys(artifact())];
      for (const forbidden of ['acceptance', 'accepted', 'statement', 'attestation', 'consentToRole'])
        expect(keys).not.toContain(forbidden);
      // With no binding, an acceptance statement changes nothing - correctly.
      expect(decide(snap({ bindings: [] })).reason).toBe('ROLE_NOT_BOUND');
    });

  it('S5 appointment backed by an EXTERNALLY AUTHENTICATED ARTIFACT -> NOT_MEASURABLE', () => {
    // The state the trust model is trying to reach cannot be expressed either. There is no
    // signature, signer, key id, or provenance field anywhere in the evaluator's inputs, so a
    // genuinely signed appointment and a forged row would ALSO be indistinguishable today.
    const keys = Object.keys(artifact());
    for (const forbidden of ['signature', 'signedBy', 'keyId', 'provenance', 'issuer'])
      expect(keys).not.toContain(forbidden);
    expect(keys.sort()).toEqual([
      'actions', 'authenticated', 'effectiveFrom', 'environmentClass', 'expiresAt', 'instrument', 'revokedAt',
    ]);
  });

  it('THE DEFECT, stated once: S1, S2 and S3 are the same decision on the same input', () => {
    const a = decide(snap()), b = decide(snap()), c = decide(snap());
    expect([a.decision, b.decision, c.decision]).toEqual(['ALLOW', 'ALLOW', 'ALLOW']);
    // The evaluator is not wrong. Its inputs do not carry the fact these states differ by.
  });
});

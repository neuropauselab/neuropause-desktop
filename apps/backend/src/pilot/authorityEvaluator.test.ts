/**
 * ENG-04 §17 — the authority test matrix.
 *
 * THE SYNTHETIC SUBJECTS BELOW ARE NOT PEOPLE. §53/§54: real role identities are
 * NOT_ESTABLISHED and must not be inferred, so these ids are fixed literals prefixed
 * TEST_ONLY in their decision refs and map to no account anywhere. A green run here proves
 * AUTHORITY_MECHANISM_CORRECT. It does NOT prove that any real person's identity is bound -
 * that is a human-governance artifact and remains pending.
 */
import { describe, it, expect } from 'vitest';
import { explainAuthority, createSnapshotEvaluator, recordAuthorityRefusals, ROLE_ACTIONS, PILOT_ACTIONS,
  type AuthoritySnapshot, type RoleBinding, type AuthorityDecisionArtifact } from './authorityEvaluator';
import { resolveAuthority, ownAuthority } from './authority';
import { createMemoryPilotMonitor } from './monitor';

const TEST_SAURABH = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEST_DISHANT = 'aaaaaaaa-0000-4000-8000-000000000002';
const TEST_KINJAL = 'aaaaaaaa-0000-4000-8000-000000000003';
const TEST_UNAUTHORIZED = 'aaaaaaaa-0000-4000-8000-000000000009';
const TARGET = 'bbbbbbbb-0000-4000-8000-000000000001';
const INSTRUMENT = 'TEST_ONLY-NP-PILOT-FIRST-HUMAN-001';

const NOW = new Date('2026-09-23T00:00:00.000Z');
const past = new Date('2026-01-01T00:00:00.000Z').toISOString();
const future = new Date('2027-01-01T00:00:00.000Z').toISOString();

const binding = (subjectId: string, role: RoleBinding['role'], over: Partial<RoleBinding> = {}): RoleBinding => ({
  subjectId, role, decisionRef: INSTRUMENT, boundAt: past, expiresAt: null, revokedAt: null, ...over,
});

const artifact = (over: Partial<AuthorityDecisionArtifact> = {}): AuthorityDecisionArtifact => ({
  instrument: INSTRUMENT,
  authenticated: true,
  // Tied to the declared vocabulary, not a hand-copied list: when an action is added to
  // PILOT_ACTIONS this fixture follows it, instead of silently covering one action less
  // than the role matrix grants (which is how the ENG-12 gap stayed invisible here).
  actions: [...PILOT_ACTIONS],
  environmentClass: 'PILOT',
  effectiveFrom: past, expiresAt: null, revokedAt: null, ...over,
});

const snap = (over: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  bindings: [
    binding(TEST_SAURABH, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY'),
    binding(TEST_DISHANT, 'PILOT_OPERATOR_TECHNICAL_OPERATIONS'),
    binding(TEST_KINJAL, 'INDEPENDENT_PILOT_VERIFIER'),
  ],
  decisions: [artifact()],
  environment: { environmentClass: 'PILOT', environmentId: 'TEST_ONLY-pilot-env' },
  now: NOW,
  ...over,
});

const ctx = (actorId: string, action: string, over = {}) =>
  ({ actorId, subjectId: TARGET, action, targetId: TARGET, ...over });

describe('§17 — every invalid case DENIES, with a stable reason', () => {
  const cases: Array<[string, AuthoritySnapshot, ReturnType<typeof ctx>, string]> = [
    ['missing subject', snap(), ctx('', 'pilot.stop'), 'NO_AUTHENTICATED_SUBJECT'],
    ['malformed subject', snap(), ctx('not-a-uuid', 'pilot.stop'), 'NO_AUTHENTICATED_SUBJECT'],
    ['unknown subject', snap(), ctx(TEST_UNAUTHORIZED, 'pilot.stop'), 'ROLE_NOT_BOUND'],
    ['unbound subject (empty registry)', snap({ bindings: [] }), ctx(TEST_SAURABH, 'pilot.stop'), 'ROLE_NOT_BOUND'],
    ['revoked role', snap({ bindings: [binding(TEST_SAURABH, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', { revokedAt: past })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'ROLE_REVOKED'],
    ['expired role', snap({ bindings: [binding(TEST_SAURABH, 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY', { expiresAt: past })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'ROLE_EXPIRED'],
    ['wrong role for the action', snap(), ctx(TEST_KINJAL, 'pilot.stop'), 'ACTION_NOT_AUTHORIZED'],
    ['operator may not resume', snap(), ctx(TEST_DISHANT, 'pilot.resume'), 'ACTION_NOT_AUTHORIZED'],
    ['operator may not record a decision', snap(), ctx(TEST_DISHANT, 'pilot.decision.record'), 'ACTION_NOT_AUTHORIZED'],
    ['unknown action', snap(), ctx(TEST_SAURABH, 'pilot.delete.everything'), 'ACTION_NOT_AUTHORIZED'],
    ['missing decision', snap({ decisions: [] }), ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_MISSING'],
    ['UNSIGNED decision', snap({ decisions: [artifact({ authenticated: false })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_INVALID'],
    ['revoked decision', snap({ decisions: [artifact({ revokedAt: past })] }), ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_INVALID'],
    ['not yet effective', snap({ decisions: [artifact({ effectiveFrom: future })] }), ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_INVALID'],
    ['expired decision', snap({ decisions: [artifact({ expiresAt: past })] }), ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_INVALID'],
    ['action outside decision scope', snap({ decisions: [artifact({ actions: ['pilot.control.read'] })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_OUT_OF_SCOPE'],
    ['malformed target', snap(), ctx(TEST_SAURABH, 'pilot.stop', { targetId: 'not-a-uuid' }), 'TARGET_NOT_AUTHORIZED'],
    ['environment not established', snap({ environment: null }), ctx(TEST_SAURABH, 'pilot.stop'), 'ENVIRONMENT_NOT_AUTHORIZED'],
    ['PRODUCTION environment', snap({ environment: { environmentClass: 'PRODUCTION', environmentId: 'prod' } }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'PRODUCTION_TARGET_DENIED'],
    // NP-014. THIS CASE COULD NOT BE WRITTEN BEFORE. `AuthorityDecisionArtifact.environmentClass`
    // was declared as the literal type 'PILOT', so an artifact carrying any other class was not
    // expressible and the guard `artifact.environmentClass !== 'PILOT'` was, statically, a
    // comparison of a constant to itself with an unreachable deny branch - the ENG-13 defect
    // surviving at the type level after its runtime form was fixed. Widening the field to
    // `string` (which the sibling AuthorityEnvironment always used) is what makes this
    // assertion compile, and the guard falsifiable by a test that needs no database.
    ['PRODUCTION decision artifact', snap({ decisions: [artifact({ environmentClass: 'PRODUCTION' })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_OUT_OF_SCOPE'],
    ['empty-string decision class', snap({ decisions: [artifact({ environmentClass: '' })] }),
      ctx(TEST_SAURABH, 'pilot.stop'), 'DECISION_OUT_OF_SCOPE'],
  ];

  for (const [name, s, c, reason] of cases) {
    it(`${name} -> DENY ${reason}`, () => {
      const out = explainAuthority(s, c);
      expect(out.decision).toBe('DENY');
      expect(out.reason).toBe(reason);
    });
  }
});

describe('§54 — the synthetic roles get exactly their own actions', () => {
  it('TEST_SAURABH may perform every decision-authority action', () => {
    for (const action of ROLE_ACTIONS.FIRST_PILOT_HUMAN_DECISION_AUTHORITY)
      expect(explainAuthority(snap(), ctx(TEST_SAURABH, action)).decision).toBe('ALLOW');
  });
  it('TEST_DISHANT may stop, read and terminate — and nothing else', () => {
    for (const action of ROLE_ACTIONS.PILOT_OPERATOR_TECHNICAL_OPERATIONS)
      expect(explainAuthority(snap(), ctx(TEST_DISHANT, action)).decision).toBe('ALLOW');
    expect(explainAuthority(snap(), ctx(TEST_DISHANT, 'pilot.resume')).decision).toBe('DENY');
  });
  it('TEST_KINJAL may read — and nothing else', () => {
    expect(explainAuthority(snap(), ctx(TEST_KINJAL, 'pilot.control.read')).decision).toBe('ALLOW');
    for (const action of ['pilot.stop', 'pilot.resume', 'pilot.participation.terminate', 'pilot.decision.record'])
      expect(explainAuthority(snap(), ctx(TEST_KINJAL, action)).decision).toBe('DENY');
  });
  it('TEST_UNAUTHORIZED may do nothing at all', () => {
    for (const action of ['pilot.control.read', 'pilot.stop', 'pilot.resume', 'pilot.participation.terminate', 'pilot.decision.record'])
      expect(explainAuthority(snap(), ctx(TEST_UNAUTHORIZED, action)).decision).toBe('DENY');
  });
});

describe('§12/§13 — what is never sufficient, and no ALLOW_ALL', () => {
  it('no role carries a wildcard', () => {
    for (const actions of Object.values(ROLE_ACTIONS)) {
      expect(actions).not.toContain('*');
      expect(actions.length).toBeGreaterThan(0);
      // Bound to the declared vocabulary rather than a magic number. The point of this
      // assertion is 'no role has everything plus more', not 'no role has six things'.
      expect(actions.length).toBeLessThanOrEqual(PILOT_ACTIONS.length);
    }
  });
  it('a name, an email or a title in the context grants nothing', () => {
    // These fields do not exist on DecisionContext; passing them proves the evaluator reads
    // only `actorId` and cannot be steered by anything that looks like an identity.
    const hostile = { ...ctx(TEST_UNAUTHORIZED, 'pilot.stop'),
      name: 'Saurabh Patel', email: 'neuropause033@gmail.com', role: 'Founder', isOwner: true, admin: true };
    expect(explainAuthority(snap(), hostile).decision).toBe('DENY');
  });
  it('the empty PRODUCTION posture denies every action for every synthetic subject', () => {
    const production = snap({ bindings: [], decisions: [] });
    for (const subject of [TEST_SAURABH, TEST_DISHANT, TEST_KINJAL, TEST_UNAUTHORIZED])
      for (const action of ['pilot.control.read', 'pilot.stop', 'pilot.resume', 'pilot.participation.terminate', 'pilot.decision.record'])
        expect(explainAuthority(production, ctx(subject, action)).reason).toBe('ROLE_NOT_BOUND');
  });
});

describe('the evaluator satisfies the existing fail-closed resolver', () => {
  it('resolveAuthority accepts it and honours ALLOW/DENY', () => {
    const ev = createSnapshotEvaluator(snap());
    expect(resolveAuthority(ownAuthority({ authority: ev }), ctx(TEST_SAURABH, 'pilot.stop'))).toBe('ALLOW');
    expect(resolveAuthority(ownAuthority({ authority: ev }), ctx(TEST_UNAUTHORIZED, 'pilot.stop'))).toBe('DENY');
  });
  it('a refused evaluation is recorded to the monitor with a CRITICAL class', async () => {
    const monitor = createMemoryPilotMonitor();
    const ev = createSnapshotEvaluator(snap({ bindings: [] }));
    ev.evaluate(ctx(TEST_SAURABH, 'pilot.stop'));
    await recordAuthorityRefusals(monitor, ev);
    expect(monitor.events).toHaveLength(1);
    expect(monitor.events[0].alertClass).toBe('UNAUTHORIZED_AUTHORITY');
    expect(monitor.events[0].severity).toBe('CRITICAL');
    expect(monitor.events[0].escalated).toBe(true);
    expect(monitor.events[0].outcome).toBe('DENIED');
  });
  /*
   * SUPERSEDED BY WORK ITEM 3, AND THE OLD ASSERTION IS RECORDED RATHER THAN DELETED QUIETLY.
   *
   * This test used to read "an ALLOW records nothing — the ledger is a refusal ledger, not a
   * trace" and asserted `toHaveLength(0)`. It was a faithful description of the contract at
   * the time and it encoded the defect NP-015 measured: with no ALLOW in the Outcome union an
   * authorized action was structurally unrepresentable, so "records nothing" was the only
   * behaviour available. A suite that asserts the defect cannot catch the defect — NP-017
   * recorded that lesson about §26/§27 of the governance-controls suite.
   *
   * The contract is now: a refusal is recorded AND a permission is recorded, distinctly.
   */
  it('an ALLOW is recorded as ALLOW, distinctly from a refusal', async () => {
    const monitor = createMemoryPilotMonitor();
    const ev = createSnapshotEvaluator(snap());
    ev.evaluate(ctx(TEST_SAURABH, 'pilot.stop'));
    await recordAuthorityRefusals(monitor, ev);
    expect(monitor.events).toHaveLength(1);
    expect(monitor.events[0].outcome).toBe('ALLOW');
    expect(monitor.events[0].alertClass).toBe('AUTHORIZED_ACTION');
    // An authorized action is not an alert: it must NOT escalate like a refusal does.
    expect(monitor.events[0].severity).toBe('INFO');
    expect(monitor.events[0].escalated).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createMemoryPilotMonitor, ALERT_SEVERITY, escalates, type Outcome } from './monitor';
import {
  explainAuthority, recordAuthorityRefusals, createSnapshotEvaluator,
  type AuthoritySnapshot,
} from './authorityEvaluator';

/* DecisionContext is not exported by the evaluator; the shape is declared locally rather than
 * widening the module's public surface for a test. */
type DecisionContext = { actorId: string; subjectId: string; action: string };

/* ==========================================================================================
 * WORK ITEM 3 — an AUTHORIZED action must be representable.
 *
 * NP-015 measured the defect: the outcome type had no ALLOW, so an authorized action was
 * "structurally unrepresentable in the ledger, not merely unlogged by habit". Every test here
 * proves TARGET_PATH_REACHED before interpreting its outcome, because this programme has
 * repeatedly had a test pass on an upstream denial it never noticed.
 * ========================================================================================== */

const NOW = new Date('2026-09-24T00:00:00.000Z');
const ACTOR = '22222222-2222-4222-8222-222222222222';
const INSTR = 'NP-PILOT-BIND:x:FIRST_PILOT_HUMAN_DECISION_AUTHORITY';

const snapshot = (over: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot => ({
  now: NOW,
  environment: { environmentClass: 'PILOT', environmentId: 'e1' },
  bindings: [{
    subjectId: ACTOR, role: 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY',
    decisionRef: INSTR, boundAt: '2026-09-01T00:00:00.000Z', expiresAt: null, revokedAt: null,
  }],
  decisions: [{
    instrument: INSTR, authenticated: true, actions: ['pilot.stop'],
    environmentClass: 'PILOT', effectiveFrom: '2026-09-01T00:00:00.000Z',
    expiresAt: null, revokedAt: null,
  }],
  ...over,
} as AuthoritySnapshot);

const ctx = (over: Partial<DecisionContext> = {}): DecisionContext =>
  ({ actorId: ACTOR, subjectId: ACTOR, action: 'pilot.stop', ...over } as DecisionContext);

const runAndRecord = async (snap: AuthoritySnapshot, c: DecisionContext) => {
  const monitor = createMemoryPilotMonitor();
  const ev = createSnapshotEvaluator(snap);
  const decision = ev.evaluate(c);
  await recordAuthorityRefusals(monitor, ev);
  return { decision, outcome: explainAuthority(snap, c), events: monitor.events };
};

describe('the outcome vocabulary can express permission', () => {
  it('ALLOW is in the type union', () => {
    const o: Outcome[] = ['BLOCKED', 'DENIED', 'RECORDED', 'ALLOW'];
    expect(o).toHaveLength(4);
  });
  it('AUTHORIZED_ACTION is INFO — escalates() can now return false', () => {
    // NP-015: all 13 classes mapped to CRITICAL, so escalates() could not return false.
    expect(ALERT_SEVERITY.AUTHORIZED_ACTION).toBe('INFO');
    expect(escalates(ALERT_SEVERITY.AUTHORIZED_ACTION)).toBe(false);
    expect(escalates(ALERT_SEVERITY.UNAUTHORIZED_ACCESS)).toBe(true);
  });
});

describe('M3 — valid authority + valid environment → ALLOW, and it is recorded', () => {
  it('records an ALLOW event', async () => {
    const r = await runAndRecord(snapshot(), ctx());
    // TARGET_PATH_REACHED: the evaluator genuinely produced ALLOW, not an upstream denial.
    expect(r.outcome.decision).toBe('ALLOW');
    expect(r.outcome.reason).toBe('ALLOWED');

    expect(r.events).toHaveLength(1);
    expect(r.events[0].outcome).toBe('ALLOW');
    expect(r.events[0].alertClass).toBe('AUTHORIZED_ACTION');
    expect(r.events[0].severity).toBe('INFO');
    expect(r.events[0].escalated).toBe(false);
  });
  it('the ALLOW record carries the context needed to reconstruct the event', async () => {
    const [e] = (await runAndRecord(snapshot(), ctx())).events;
    expect(e.actorId).toBe(ACTOR);
    expect(e.action).toBe('pilot.stop');
    expect(e.reasonCode).toBe('ALLOWED');
    expect(e.detail).toMatchObject({ role: 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY' });
  });
  it('carries no secret material', async () => {
    const [e] = (await runAndRecord(snapshot(), ctx())).events;
    const blob = JSON.stringify(e);
    for (const s of ['PRIVATE KEY', 'password', 'JWT_ACCESS_SECRET', 'postgresql://'])
      expect(blob).not.toContain(s);
  });
});

describe('M1 — invalid authority → DENIED, and ALLOW is NOT produced', () => {
  it('an unbound actor is DENIED', async () => {
    const r = await runAndRecord(snapshot({ bindings: [] }), ctx());
    expect(r.outcome.decision).toBe('DENY');
    expect(r.outcome.reason).toBe('ROLE_NOT_BOUND');
    expect(r.events.every((e) => e.outcome !== 'ALLOW')).toBe(true);
  });
  it('M6 — a malformed actor is DENIED', async () => {
    const r = await runAndRecord(snapshot(), ctx({ actorId: 'not-a-uuid' }));
    expect(r.outcome.reason).toBe('NO_AUTHENTICATED_SUBJECT');
    expect(r.events.every((e) => e.outcome !== 'ALLOW')).toBe(true);
  });
  it('M5 — an unknown action is DENIED', async () => {
    const r = await runAndRecord(snapshot(), ctx({ action: 'pilot.not.a.real.action' }));
    expect(r.outcome.decision).toBe('DENY');
    expect(r.events.every((e) => e.outcome !== 'ALLOW')).toBe(true);
  });
  it('M4 — a non-PILOT environment is DENIED before authority is consulted', async () => {
    const r = await runAndRecord(
      snapshot({ environment: { environmentClass: 'PRODUCTION', environmentId: 'p' } }), ctx());
    expect(r.outcome.reason).toBe('PRODUCTION_TARGET_DENIED');
    expect(r.events.every((e) => e.outcome !== 'ALLOW')).toBe(true);
  });
});

describe('outcome masking controls', () => {
  it('the ALLOW fixture is not passing because of some OTHER denial', async () => {
    // Positive control on the fixture itself: remove only the binding and the SAME fixture
    // must flip to DENY. If it denied for an unrelated reason, this would not change.
    const allow = await runAndRecord(snapshot(), ctx());
    const denied = await runAndRecord(snapshot({ bindings: [] }), ctx());
    expect(allow.outcome.decision).toBe('ALLOW');
    expect(denied.outcome.decision).toBe('DENY');
    expect(denied.outcome.reason).toBe('ROLE_NOT_BOUND');
  });
  it('DENIED and ALLOW are distinct records, not the same row with a different label', async () => {
    const a = (await runAndRecord(snapshot(), ctx())).events[0];
    const d = (await runAndRecord(snapshot({ bindings: [] }), ctx())).events[0];
    expect(a.outcome).toBe('ALLOW');
    expect(d?.outcome).toBe('DENIED');
    expect(a.alertClass).not.toBe(d?.alertClass);
  });
});

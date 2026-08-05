/**
 * Phase 6 Stage 10 — business value: decision → outcome joined ONLY from
 * recorded evidence (the Stage 6 outcome loop + measured health-history
 * deltas). Verdicts are computed, never estimated; no currency exists and the
 * disclosure says so; an unreadable decision store is declared.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBusinessValue,
  VALUE_DISCLOSURE,
  verdictFor,
  windowDeltas,
  type OutcomeDecision,
} from './businessOutcome';

const NOW = '2026-07-31T12:00:00.000Z';

function mkDecision(over: Partial<OutcomeDecision> = {}): OutcomeDecision {
  return {
    id: 'dec-1',
    title: 'Adopt incident first-response playbook',
    category: 'operations',
    status: 'completed',
    expectedOutcome: 'Failed executions recover within a day.',
    businessImpact: 'Reliability of the governed execution spine.',
    fromRecommendationId: 'rec-1',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...over,
  };
}

const HISTORY = [
  { day: '2026-07-01', overall: 70, engineering: 65 },
  { day: '2026-07-20', overall: 80, engineering: 71 },
];

describe('windowDeltas — measured from the EXISTING history, or honestly absent', () => {
  it('empty history → a single honest no-points delta, nulls preserved', () => {
    const d = windowDeltas(mkDecision(), []);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ before: null, after: null });
    expect(d[0].detail).toContain('no recorded history points');
  });

  it('window edges: before = closest point at/preceding creation, after = latest point', () => {
    const d = windowDeltas(mkDecision(), HISTORY);
    expect(d.find((x) => x.label === 'org health')).toMatchObject({ before: 70, after: 80 });
    expect(d.find((x) => x.label === 'engineering health')).toMatchObject({ before: 65, after: 71 });
    expect(d[0].detail).toContain('70 → 80 (+10)');
  });

  it('decision created before any point → the missing window edge is declared', () => {
    const d = windowDeltas(mkDecision({ createdAt: '2026-06-01T00:00:00.000Z' }), HISTORY);
    expect(d[0].before).toBeNull();
    expect(d[0].detail).toContain('window edge missing');
  });
});

describe('verdictFor — computed, never estimated', () => {
  const improving = windowDeltas(mkDecision(), HISTORY);

  it("verified outcome + measurable improvement → 'delivered'", () => {
    expect(verdictFor(mkDecision(), 'verified', improving).verdict).toBe('delivered');
  });

  it("verified but flat/mixed measures → 'partial' (verification alone does not inflate value)", () => {
    const mixed = windowDeltas(
      mkDecision(),
      [
        { day: '2026-07-01', overall: 70, engineering: 65 },
        { day: '2026-07-20', overall: 80, engineering: 60 },
      ],
    );
    expect(verdictFor(mkDecision(), 'verified', mixed).verdict).toBe('partial');
  });

  it("completed WITHOUT verification → at most 'partial'; with no measurable window → 'unmeasurable'", () => {
    expect(verdictFor(mkDecision({ fromRecommendationId: null }), null, improving).verdict).toBe('partial');
    const none = windowDeltas(mkDecision(), []);
    expect(verdictFor(mkDecision({ fromRecommendationId: null }), null, none).verdict).toBe('unmeasurable');
  });

  it("rejected/archived → 'unmeasurable'; in-flight → 'not-yet-observed'", () => {
    expect(verdictFor(mkDecision({ status: 'rejected' }), null, improving).verdict).toBe('unmeasurable');
    expect(verdictFor(mkDecision({ status: 'in_progress' }), 'approved', improving).verdict).toBe('not-yet-observed');
    expect(verdictFor(mkDecision({ status: 'accepted' }), null, improving).verdict).toBe('not-yet-observed');
  });
});

describe('buildBusinessValue — the report', () => {
  it('joins decision × outcome stage × deltas; capability keys ride the category map; totals add up', () => {
    const r = buildBusinessValue({
      nowIso: NOW,
      decisions: [
        mkDecision(),
        mkDecision({ id: 'dec-2', category: 'growth', status: 'in_progress', fromRecommendationId: 'rec-2' }),
      ],
      outcomes: [
        { id: 'rec-1', stage: 'verified' },
        { id: 'rec-2', stage: 'executed' },
      ],
      history: HISTORY,
      failures: {},
    });
    expect(r.decisions).toHaveLength(2);
    const first = r.decisions.find((d) => d.decisionId === 'dec-1')!;
    expect(first.verdict).toBe('delivered');
    expect(first.outcomeStage).toBe('verified');
    expect(first.capabilityKeys).toEqual(['operations']);
    expect(first.evidence).toEqual(['dec-1', 'rec-1']);
    const second = r.decisions.find((d) => d.decisionId === 'dec-2')!;
    expect(second.verdict).toBe('not-yet-observed');
    expect(second.capabilityKeys.sort()).toEqual(['marketing', 'sales']);
    expect(r.totals).toEqual({ delivered: 1, partial: 0, notYetObserved: 1, unmeasurable: 0 });
  });

  it('carries the no-currency disclosure verbatim', () => {
    const r = buildBusinessValue({ nowIso: NOW, decisions: [], outcomes: [], history: [], failures: {} });
    expect(r.disclosure).toBe(VALUE_DISCLOSURE);
    expect(r.disclosure).toContain('no revenue, cost, or margin figures');
  });

  it('an unreadable decision store is DECLARED unavailable — never an empty-but-confident report', () => {
    const r = buildBusinessValue({ nowIso: NOW, decisions: null, outcomes: null, history: null, failures: {} });
    expect(r.decisions).toEqual([]);
    expect(r.unavailable.some((u) => u.system === 'decisions')).toBe(true);
  });
});

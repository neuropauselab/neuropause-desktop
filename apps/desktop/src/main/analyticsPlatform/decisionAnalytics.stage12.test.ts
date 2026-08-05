/**
 * Phase 6 Stage 12 — decision intelligence: the funnel from the decision
 * store, the Stage 6 outcome loop joined by fromRecommendationId, Stage 10's
 * value verdicts composed VERBATIM (null = declared unreadable, never
 * defaulted), the sync S10/S11 recommendation inventory, and the stated
 * scope (S8 findings + async S9 registered, not counted live).
 */
import { describe, expect, it } from 'vitest';
import { buildDecisionReport, DECISION_DISCLOSURE } from './decisionAnalytics';

const NOW = '2026-08-01T09:00:00.000Z';

describe('buildDecisionReport — composed, never re-modeled', () => {
  it('builds the funnel by status and joins the outcome loop through fromRecommendationId', () => {
    const r = buildDecisionReport({
      nowIso: NOW,
      decisions: [
        { id: 'd1', status: 'approved', fromRecommendationId: 'rec-1' },
        { id: 'd2', status: 'approved', fromRecommendationId: 'rec-2' },
        { id: 'd3', status: 'proposed', fromRecommendationId: null },
        { id: 'd4', status: 'executed', fromRecommendationId: 'rec-3' },
        { id: 'd5', status: 'executed', fromRecommendationId: 'rec-missing' },
      ],
      outcomes: [
        { id: 'rec-1', stage: 'verified' },
        { id: 'rec-2', stage: 'approved' },
        { id: 'rec-3', stage: 'executed' },
      ],
      valueTotals: { delivered: 2, partial: 1, notYetObserved: 1, unmeasurable: 1 },
      strategyRecs: { count: 3, criticalOrHigh: 1 },
      federationRecs: { count: 2, criticalOrHigh: 2 },
      failures: {},
    });
    expect(r.funnel.total).toBe(5);
    expect(r.funnel.byStatus[0]).toEqual({ status: 'approved', count: 2 }); // sorted by count desc
    expect(r.funnel.outcomeLoop).toEqual({ recommended: 0, approved: 1, executed: 1, verified: 1 });
    expect(r.value).toEqual({ delivered: 2, partial: 1, notYetObserved: 1, unmeasurable: 1 });
    expect(r.recommendations).toEqual([
      { source: 's10-strategy-recommendations', count: 3, criticalOrHigh: 1 },
      { source: 's11-federation-recommendations', count: 2, criticalOrHigh: 2 },
    ]);
  });

  it('a decision whose recommendation has no recorded outcome stage counts in NO loop bucket — nothing assumed', () => {
    const r = buildDecisionReport({
      nowIso: NOW,
      decisions: [{ id: 'd1', status: 'approved', fromRecommendationId: 'rec-unknown' }],
      outcomes: [],
      valueTotals: null,
      strategyRecs: null,
      federationRecs: null,
      failures: {},
    });
    expect(r.funnel.outcomeLoop).toEqual({ recommended: 0, approved: 0, executed: 0, verified: 0 });
  });

  it('an unreadable Stage 10 value report stays null — declared, never defaulted to zeros', () => {
    const r = buildDecisionReport({
      nowIso: NOW,
      decisions: [],
      outcomes: [],
      valueTotals: null,
      strategyRecs: null,
      federationRecs: null,
      failures: { 's10-value-totals': 'strategy value read threw' },
    });
    expect(r.value).toBeNull();
    expect(r.recommendations).toEqual([]); // unreadable inventories are absent, not zeroed
    expect(r.unavailable).toContainEqual({ system: 's10-value-totals', reason: 'strategy value read threw' });
  });

  it('unreadable stores are declared and the funnel is honestly empty', () => {
    const r = buildDecisionReport({
      nowIso: NOW,
      decisions: null,
      outcomes: null,
      valueTotals: null,
      strategyRecs: null,
      federationRecs: null,
      failures: { decisions: 'store threw', 'insight-outcomes': 'insight threw' },
    });
    expect(r.funnel.total).toBe(0);
    expect(r.funnel.byStatus).toEqual([]);
    expect(r.unavailable).toHaveLength(2);
  });

  it('the disclosure states the composition scope: no new model, S8/S9 registered not counted live', () => {
    const r = buildDecisionReport({ nowIso: NOW, decisions: [], outcomes: [], valueTotals: null, strategyRecs: null, federationRecs: null, failures: {} });
    expect(r.disclosure).toBe(DECISION_DISCLOSURE);
    expect(r.disclosure).toContain('no new decision model');
    expect(r.disclosure).toContain('registered, not counted live');
  });
});

/**
 * Phase 6 Stage 12 — decision intelligence, COMPOSED: the decision store's
 * funnel, the Stage 6 outcome loop, Stage 10's computed value verdicts
 * (verbatim — never restated), and the Principle-C recommendation inventory
 * from the SYNC stage dashboards (S10 strategy + S11 federation). No new
 * decision model, no scoring, no second confidence system. Scope is stated:
 * the S8 dashboard surfaces findings (not Principle-C recommendations) and the
 * S9 recommendations are async-composed — both registered, neither counted
 * live here. Pure; reads injected.
 */
import type { EanaDecisionReport, EanaUnavailable } from '@neuropause/shared';

export const DECISION_DISCLOSURE =
  'Decision intelligence composes the decision store, the Stage 6 outcome loop, and Stage 10’s computed value verdicts verbatim — no new decision model, scoring, or confidence system. Recommendation counts cover the sync Stage 10/11 dashboards; the Stage 8 monitor surfaces findings and the Stage 9 recommendations are async-composed (registered, not counted live).';

export interface DecisionAnalyticsInput {
  nowIso: string;
  decisions: { id: string; status: string; fromRecommendationId: string | null }[] | null;
  outcomes: { id: string; stage: string }[] | null;
  /** Stage 10's value totals, composed verbatim; null = unreadable. */
  valueTotals: { delivered: number; partial: number; notYetObserved: number; unmeasurable: number } | null;
  strategyRecs: { count: number; criticalOrHigh: number } | null;
  federationRecs: { count: number; criticalOrHigh: number } | null;
  failures: Record<string, string>;
}

export function buildDecisionReport(input: DecisionAnalyticsInput): EanaDecisionReport {
  const unavailable: EanaUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));

  const byStatus = new Map<string, number>();
  for (const d of input.decisions ?? []) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);

  const linked = (input.decisions ?? []).filter((d) => d.fromRecommendationId !== null);
  const stageOf = new Map((input.outcomes ?? []).map((o) => [o.id, o.stage]));
  const loop = { recommended: 0, approved: 0, executed: 0, verified: 0 };
  for (const d of linked) {
    const stage = stageOf.get(d.fromRecommendationId as string);
    if (stage === 'recommended') loop.recommended += 1;
    else if (stage === 'approved') loop.approved += 1;
    else if (stage === 'executed') loop.executed += 1;
    else if (stage === 'verified') loop.verified += 1;
  }

  const recommendations = [
    ...(input.strategyRecs ? [{ source: 's10-strategy-recommendations', count: input.strategyRecs.count, criticalOrHigh: input.strategyRecs.criticalOrHigh }] : []),
    ...(input.federationRecs ? [{ source: 's11-federation-recommendations', count: input.federationRecs.count, criticalOrHigh: input.federationRecs.criticalOrHigh }] : []),
  ];

  return {
    generatedAt: input.nowIso,
    funnel: {
      total: input.decisions?.length ?? 0,
      byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      outcomeLoop: loop,
    },
    value: input.valueTotals,
    recommendations,
    disclosure: DECISION_DISCLOSURE,
    unavailable,
  };
}

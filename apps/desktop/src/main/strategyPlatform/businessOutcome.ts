/**
 * Phase 6 Stage 10 — business value (D-3/D-7): decision → outcome, COMPUTED.
 *
 * The join uses only what the platform records: the decision's own declared
 * `expectedOutcome`/`businessImpact`, the Stage 6 outcome-loop stage of its
 * linked recommendation (`fromRecommendationId` → recommended/approved/
 * executed/verified), and measure DELTAS over the decision's window from the
 * EXISTING 90-day health history. Verdicts: `delivered` (verified + measurable
 * improvement), `partial` (verified but flat/mixed measures, or completed
 * without verification), `not-yet-observed` (in flight), `unmeasurable`
 * (no linked recommendation and no measurable window). NO currency exists in
 * the platform and none is invented — the disclosure states it. Pure.
 */
import type {
  BusinessValueReport,
  DecisionValueView,
  InsightOutcomeStage,
  MeasureDelta,
  OutcomeVerdict,
  StrategyUnavailable,
} from '@neuropause/shared';
import { DECISION_CATEGORY_CAPABILITIES } from './strategyRegistry';

export interface OutcomeDecision {
  id: string;
  title: string;
  category: string;
  status: string;
  expectedOutcome: string;
  businessImpact: string;
  fromRecommendationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutcomeInput {
  nowIso: string;
  decisions: OutcomeDecision[] | null;
  /** Stage 6 recommendation outcome stages, keyed by recommendation id. */
  outcomes: { id: string; stage: InsightOutcomeStage }[] | null;
  /** The EXISTING 90-day history (day 'YYYY-MM-DD', overall, engineering). */
  history: { day: string; overall: number; engineering: number }[] | null;
  failures: Record<string, string>;
}

export const VALUE_DISCLOSURE =
  'Business value is computed from recorded evidence only: declared expected outcomes, the Stage 6 outcome-verification loop, and measured health deltas over the decision window. The platform records no revenue, cost, or margin figures — none are shown and none are estimated.';

/** Window deltas from the recorded daily history — null when the window has no points. */
export function windowDeltas(decision: OutcomeDecision, history: OutcomeInput['history']): MeasureDelta[] {
  if (!history || history.length === 0) {
    return [{ label: 'org health', before: null, after: null, detail: 'no recorded history points in the window' }];
  }
  const from = decision.createdAt.slice(0, 10);
  const sorted = [...history].sort((a, b) => (a.day < b.day ? -1 : 1));
  const before = sorted.filter((h) => h.day <= from).at(-1) ?? null;
  const after = sorted.at(-1) ?? null;
  const mk = (label: string, b: number | null, a: number | null): MeasureDelta => ({
    label,
    before: b,
    after: a,
    detail:
      b === null || a === null
        ? 'window edge missing from the recorded history'
        : `${b} → ${a} (${a - b >= 0 ? '+' : ''}${a - b}) over the decision window`,
  });
  return [
    mk('org health', before?.overall ?? null, after?.overall ?? null),
    mk('engineering health', before?.engineering ?? null, after?.engineering ?? null),
  ];
}

export function verdictFor(
  decision: OutcomeDecision,
  stage: InsightOutcomeStage | null,
  deltas: MeasureDelta[],
): { verdict: OutcomeVerdict; detail: string } {
  const measurable = deltas.filter((d) => d.before !== null && d.after !== null);
  const improved = measurable.filter((d) => (d.after as number) > (d.before as number));
  const regressed = measurable.filter((d) => (d.after as number) < (d.before as number));

  if (stage === 'verified') {
    if (measurable.length === 0) return { verdict: 'partial', detail: 'outcome verified by the Stage 6 loop, but no measurable window deltas exist' };
    if (improved.length > 0 && regressed.length === 0)
      return { verdict: 'delivered', detail: `outcome verified AND ${improved.length} measure(s) improved over the window` };
    return { verdict: 'partial', detail: 'outcome verified; window measures flat or mixed' };
  }
  if (decision.status === 'completed') {
    if (measurable.length === 0) return { verdict: 'unmeasurable', detail: 'decision completed, but no verification link and no measurable window' };
    if (improved.length > 0 && regressed.length === 0)
      return { verdict: 'partial', detail: 'decision completed with improving measures, but the outcome loop has not verified it' };
    return { verdict: 'partial', detail: 'decision completed; measures flat/mixed and unverified' };
  }
  if (decision.status === 'rejected' || decision.status === 'archived') {
    return { verdict: 'unmeasurable', detail: `decision ${decision.status} — no outcome to observe` };
  }
  if (stage === 'executed' || stage === 'approved' || decision.status === 'in_progress' || decision.status === 'accepted') {
    return { verdict: 'not-yet-observed', detail: `in flight (decision ${decision.status}${stage ? `, outcome loop at '${stage}'` : ''}) — value not yet observable` };
  }
  if (decision.fromRecommendationId === null && measurable.length === 0) {
    return { verdict: 'unmeasurable', detail: 'no linked recommendation (no verification path) and no measurable window' };
  }
  return { verdict: 'not-yet-observed', detail: `decision ${decision.status} — awaiting execution/verification` };
}

export function buildBusinessValue(input: OutcomeInput): BusinessValueReport {
  const unavailable: StrategyUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({ system, reason }));
  const stageById = new Map((input.outcomes ?? []).map((o) => [o.id, o.stage]));
  const capsByCategory = new Map(DECISION_CATEGORY_CAPABILITIES.map((d) => [d.category, d.capabilityKeys]));

  const decisions: DecisionValueView[] = (input.decisions ?? []).map((d) => {
    const stage = d.fromRecommendationId ? (stageById.get(d.fromRecommendationId) ?? null) : null;
    const deltas = windowDeltas(d, input.history);
    const v = verdictFor(d, stage, deltas);
    return {
      decisionId: d.id,
      title: d.title,
      category: d.category,
      capabilityKeys: [...(capsByCategory.get(d.category) ?? [])],
      status: d.status,
      expectedOutcome: d.expectedOutcome,
      businessImpact: d.businessImpact,
      outcomeStage: stage,
      deltas,
      verdict: v.verdict,
      verdictDetail: v.detail,
      evidence: [d.id, ...(d.fromRecommendationId ? [d.fromRecommendationId] : [])],
    };
  });

  if (input.decisions === null && !unavailable.some((u) => u.system === 'decisions')) {
    unavailable.push({ system: 'decisions', reason: 'decision store unreadable this pass' });
  }

  return {
    generatedAt: input.nowIso,
    decisions,
    totals: {
      delivered: decisions.filter((x) => x.verdict === 'delivered').length,
      partial: decisions.filter((x) => x.verdict === 'partial').length,
      notYetObserved: decisions.filter((x) => x.verdict === 'not-yet-observed').length,
      unmeasurable: decisions.filter((x) => x.verdict === 'unmeasurable').length,
    },
    disclosure: VALUE_DISCLOSURE,
    unavailable,
  };
}

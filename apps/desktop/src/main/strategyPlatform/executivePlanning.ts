/**
 * Phase 6 Stage 10 — executive planning (D-4/D-6): relative horizons computed
 * from the clock (never stored dates) composing objectives at risk, blocked/
 * stalled initiatives, capacity pressure, and readiness misses into horizon
 * FOCUS lists. Every focus item is a Stage 9 Principle-C recommendation —
 * the SAME type, built through the SAME throwing guard (`mkRecommendation`),
 * pointing ONLY at existing governed surfaces. Planning recommends; it never
 * executes. Pure.
 */
import type {
  HorizonPlan,
  ObjectivesReport,
  OperationsRecommendation,
  PlanningReport,
  PortfolioReport,
  StrategyHorizonKey,
  StrategyUnavailable,
} from '@neuropause/shared';
import { mkRecommendation } from '../operationsPlatform/operationsModel';
import { COMPANY_OBJECTIVE_REGISTRY, INITIATIVE_REGISTRY } from './strategyRegistry';

export interface PlanningInputSignals {
  capacityPressure: 'low' | 'elevated' | 'high' | 'unknown' | null;
  readinessMisses: { key: string; state: string; missing: string[] }[] | null;
}

export interface PlanningInputs {
  nowMs: number;
  nowIso: string;
  objectives: ObjectivesReport;
  portfolio: PortfolioReport;
  signals: PlanningInputSignals;
  failures: Record<string, string>;
}

/** Relative windows computed from the clock at read time — no stored dates. */
export function horizonWindow(horizon: StrategyHorizonKey, nowMs: number): { fromIso: string; toIso: string; label: string } {
  const d = new Date(nowMs);
  const q = Math.floor(d.getMonth() / 3);
  const qStart = new Date(d.getFullYear(), q * 3, 1);
  const qEnd = new Date(d.getFullYear(), q * 3 + 3, 1);
  if (horizon === 'current-quarter') {
    return { fromIso: qStart.toISOString(), toIso: qEnd.toISOString(), label: `Q${q + 1} ${d.getFullYear()}` };
  }
  if (horizon === 'next-quarter') {
    const nStart = qEnd;
    const nEnd = new Date(qEnd.getFullYear(), qEnd.getMonth() + 3, 1);
    const nq = (q + 1) % 4;
    return { fromIso: nStart.toISOString(), toIso: nEnd.toISOString(), label: `Q${nq + 1} ${nStart.getFullYear()}` };
  }
  const yStart = new Date(d.getFullYear(), 0, 1);
  const yEnd = new Date(d.getFullYear() + 1, 0, 1);
  return { fromIso: yStart.toISOString(), toIso: yEnd.toISOString(), label: `${d.getFullYear()} (annual)` };
}

export function buildPlanningReport(inp: PlanningInputs): PlanningReport {
  const unavailable: StrategyUnavailable[] = Object.entries(inp.failures).map(([system, reason]) => ({ system, reason }));
  const allObjectives = [...inp.objectives.company, ...inp.objectives.departments];

  const horizons: HorizonPlan[] = (['current-quarter', 'next-quarter', 'annual'] as const).map((horizon) => {
    const w = horizonWindow(horizon, inp.nowMs);
    const objectiveIds = COMPANY_OBJECTIVE_REGISTRY.filter((o) => o.horizon === horizon).map((o) => o.id);
    const horizonObjectives = allObjectives.filter(
      (o) => objectiveIds.includes(o.id) || (o.companyObjectiveId !== null && objectiveIds.includes(o.companyObjectiveId)),
    );
    const initiativeIds = INITIATIVE_REGISTRY.filter((i) => objectiveIds.includes(i.companyObjectiveId)).map((i) => i.id);
    const horizonInitiatives = inp.portfolio.initiatives.filter((i) => initiativeIds.includes(i.id));

    const focus: OperationsRecommendation[] = [];
    for (const o of horizonObjectives.filter((x) => x.health === 'at-risk' || x.health === 'off-track')) {
      focus.push(
        mkRecommendation({
          id: `stratrec:objective:${o.id}:${horizon}`,
          title: `Objective ${o.health}: ${o.label}`,
          detail: o.healthDetail,
          priority: o.health === 'off-track' ? 'critical' : 'high',
          suggestedAction: `Review the failing measures on the Strategy tab; corrective actions run only through the existing governed surfaces.`,
          evidence: o.measures.filter((m) => m.state === 'bad').map((m) => m.ref).concat(o.id),
          reasoning: 'The objective’s own live measures (existing aggregates only) place it below its bar.',
          confidence: 0.85,
          affectedSystems: [...o.capabilityKeys],
          operationalImpact: `The ${o.unitName} objective is not meeting its declared measures this ${w.label} window.`,
          expectedBusinessOutcome: 'Restoring the measures returns the objective to on-track for its horizon.',
          rollbackImplications: 'The plan itself changes nothing; each measure names its own existing, governed surface.',
        }),
      );
    }
    for (const i of horizonInitiatives.filter((x) => x.state === 'blocked' || x.state === 'stalled')) {
      focus.push(
        mkRecommendation({
          id: `stratrec:initiative:${i.id}:${horizon}`,
          title: `Initiative ${i.state}: ${i.label}`,
          detail: i.stateDetail,
          priority: i.state === 'blocked' ? 'high' : 'medium',
          suggestedAction:
            i.blockers.length > 0
              ? `Clear the blockers (${i.blockers.map((b) => b.reason).join('; ')}) via the existing surfaces they name.`
              : 'Advance the unmet milestone conditions via their existing surfaces.',
          evidence: [i.id, ...i.blockers.flatMap((b) => b.evidence).slice(0, 4)],
          reasoning: 'The initiative’s composed sources and milestone conditions (live signals) show no forward motion.',
          confidence: 0.8,
          affectedSystems: [...i.capabilityKeys],
          operationalImpact: `The ${i.label} initiative is not advancing its company objective.`,
          expectedBusinessOutcome: 'Unblocking restores portfolio progress toward the objective it serves.',
          rollbackImplications: 'Recommendation only; any corrective execution parks for approval on the existing spine.',
        }),
      );
    }
    if (horizon === 'current-quarter' && inp.signals.capacityPressure === 'high') {
      focus.push(
        mkRecommendation({
          id: `stratrec:capacity:${horizon}`,
          title: 'Capacity pressure is high this quarter',
          detail: 'The Stage 9 capacity composition reports high pressure — strategic work will queue behind operational load.',
          priority: 'high',
          suggestedAction: 'Drain queues and decide parked approvals before committing new initiative work.',
          evidence: ['capacity-composition'],
          reasoning: 'Composed queue depth, execution backlog, and bottlenecks exceed the elevated thresholds (Stage 9 composition).',
          confidence: 0.8,
          affectedSystems: ['operations'],
          operationalImpact: 'Initiative milestones that depend on execution throughput will slip while pressure stays high.',
          expectedBusinessOutcome: 'Restored throughput lets the quarter’s objectives advance.',
          rollbackImplications: 'Queue and approval decisions reverse through the same existing surfaces that made them.',
        }),
      );
    }
    const summary =
      focus.length === 0
        ? `${w.label}: ${objectiveIds.length} objective(s), ${initiativeIds.length} initiative(s) — nothing requires executive focus by the composed signals.`
        : `${w.label}: ${focus.length} focus item(s) across ${objectiveIds.length} objective(s) and ${initiativeIds.length} initiative(s).`;
    return { horizon, label: w.label, window: { fromIso: w.fromIso, toIso: w.toIso }, objectiveIds, initiativeIds, focus, summary };
  });

  return { generatedAt: inp.nowIso, horizons, unavailable };
}

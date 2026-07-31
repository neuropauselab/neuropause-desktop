/**
 * Phase 6 Stage 9 — capacity composition (D-5 of the approved gap list).
 *
 * Composes the EXISTING measurements — execution stats, workforce queue depth,
 * the automation monitor, and `detectBottlenecks` over the real job page — into
 * one capacity view. The ONLY forecast is the Stage 6 prediction list, reused
 * verbatim (no new model, no invented trend). Pressure is a deterministic
 * composition of the available inputs; with nothing readable it is `unknown`,
 * never a guess. Pure.
 */
import type { CapacityBottleneck, CapacityView, InsightPrediction, OperationsUnavailable } from '@neuropause/shared';

export interface CapacityInput {
  nowIso: string;
  executions: { active: number; queued: number; successRate: number | null } | null;
  workforce: { queueDepth: number; awaitingApproval: number } | null;
  automation: { running: number; failed: number; paused: number } | null;
  bottlenecks: CapacityBottleneck[] | null;
  /** Stage 6 predictions REUSED as the only forecast. */
  predictions: InsightPrediction[] | null;
  failures: Record<string, string>;
}

export function composePressure(input: CapacityInput): { pressure: CapacityView['pressure']; detail: string } {
  if (!input.executions && !input.workforce && !input.automation) {
    return { pressure: 'unknown', detail: 'no capacity inputs were readable — pressure is unknown, not assumed low' };
  }
  const signals: string[] = [];
  let score = 0;
  if (input.workforce) {
    if (input.workforce.queueDepth > 50) {
      score += 2;
      signals.push(`queue depth ${input.workforce.queueDepth} (>50)`);
    } else if (input.workforce.queueDepth > 25) {
      score += 1;
      signals.push(`queue depth ${input.workforce.queueDepth} (>25)`);
    }
    if (input.workforce.awaitingApproval > 25) {
      score += 1;
      signals.push(`${input.workforce.awaitingApproval} approvals parked`);
    }
  }
  if (input.executions) {
    if (input.executions.queued > 20) {
      score += 1;
      signals.push(`${input.executions.queued} executions queued`);
    }
    if (input.executions.successRate !== null && input.executions.successRate < 0.7) {
      score += 1;
      signals.push(`execution success ${(input.executions.successRate * 100).toFixed(0)}% (<70%)`);
    }
  }
  const bottleneckCount = input.bottlenecks?.length ?? 0;
  if (bottleneckCount > 0) {
    score += bottleneckCount >= 3 ? 2 : 1;
    signals.push(`${bottleneckCount} workforce bottleneck(s)`);
  }
  const pressure: CapacityView['pressure'] = score >= 4 ? 'high' : score >= 2 ? 'elevated' : 'low';
  return {
    pressure,
    detail: signals.length > 0 ? signals.join(' · ') : 'all composed capacity signals inside normal ranges',
  };
}

export function buildCapacityView(input: CapacityInput): CapacityView {
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  const p = composePressure(input);
  return {
    generatedAt: input.nowIso,
    executions: input.executions,
    workforce: input.workforce,
    automation: input.automation,
    bottlenecks: input.bottlenecks ?? [],
    pressure: p.pressure,
    pressureDetail: p.detail,
    // Only capacity-relevant prediction kinds; the list itself is Stage 6's.
    forecast: (input.predictions ?? []).filter(
      (pr) => pr.kind === 'approval-backlog' || pr.kind === 'project-delay' || pr.kind === 'connector-instability',
    ),
    unavailable,
  };
}

/**
 * Phase 6 Stage 9 — the SLA framework (D-3): registry targets measured ONLY by
 * aggregates the platform ALREADY records. A target whose registry row carries
 * `measuredBy: null` is `unmeasurable` — with the reason stated — and is never
 * estimated. Breaches cite the measuring aggregate as evidence. Pure.
 */
import type { OperationsUnavailable, SlaReport, SlaStatus, SlaTargetDef } from '@neuropause/shared';
import { SLA_REGISTRY } from './operationsRegistry';

export interface SlaMeasurements {
  /** executeEngine.stats() — null when the read failed. */
  executions: { successRate: number | null; averageRuntimeMs: number | null } | null;
  workforce: { queueDepth: number; oldestApprovalHours: number | null } | null;
  automation: { completed: number; failed: number } | null;
  connectors: { configured: number; healthy: number } | null;
  aiState: string | null;
}

export interface SlaInput {
  nowIso: string;
  measurements: SlaMeasurements;
  failures: Record<string, string>;
}

/** Measure ONE target from the existing aggregates. null = source unavailable. */
export function measureTarget(t: SlaTargetDef, m: SlaMeasurements): { value: number | null; source: string } | null {
  if (t.measuredBy === null) return null; // declared unmeasurable — no source exists
  switch (t.metric) {
    case 'success-rate':
      return m.executions ? { value: m.executions.successRate, source: 'execution-stats' } : { value: null, source: 'execution-stats' };
    case 'avg-runtime-ms':
      return m.executions ? { value: m.executions.averageRuntimeMs, source: 'execution-stats' } : { value: null, source: 'execution-stats' };
    case 'queue-depth':
      return m.workforce ? { value: m.workforce.queueDepth, source: 'job-store' } : { value: null, source: 'job-store' };
    case 'approval-age-hours':
      return m.workforce ? { value: m.workforce.oldestApprovalHours, source: 'job-store' } : { value: null, source: 'job-store' };
    case 'failure-ratio': {
      if (!m.automation) return { value: null, source: 'automation-monitor' };
      const finished = m.automation.completed + m.automation.failed;
      return { value: finished > 0 ? m.automation.failed / finished : null, source: 'automation-monitor' };
    }
    case 'healthy-ratio': {
      if (!m.connectors) return { value: null, source: 'connector-service' };
      return { value: m.connectors.configured > 0 ? m.connectors.healthy / m.connectors.configured : null, source: 'connector-service' };
    }
    case 'engine-ready':
      return m.aiState === null ? { value: null, source: 'engine-manager' } : { value: m.aiState === 'ready' ? 1 : 0, source: 'engine-manager' };
    case 'response-latency-ms':
      // Reaching here would mean a latency target claims a measuring aggregate;
      // the registry integrity check forbids it — treat as unmeasurable.
      return null;
    default:
      return null;
  }
}

export function buildSlaReport(input: SlaInput): SlaReport {
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const statuses: SlaStatus[] = SLA_REGISTRY.map((t) => {
    const measured = measureTarget(t, input.measurements);
    if (measured === null) {
      return {
        targetId: t.id,
        serviceId: t.serviceId,
        label: t.label,
        metric: t.metric,
        comparator: t.comparator,
        target: t.target,
        unit: t.unit,
        measured: null,
        status: 'unmeasurable' as const,
        detail:
          'DECLARED unmeasurable: the platform records no aggregate for this target (no per-request tracing exists) — not estimated.',
        evidence: [],
        windowLabel: t.windowLabel,
      };
    }
    if (measured.value === null) {
      return {
        targetId: t.id,
        serviceId: t.serviceId,
        label: t.label,
        metric: t.metric,
        comparator: t.comparator,
        target: t.target,
        unit: t.unit,
        measured: null,
        status: 'unmeasurable' as const,
        detail: `The measuring aggregate (${measured.source}) has no value yet (nothing finished / nothing configured / read failed) — status is honestly unmeasurable, not assumed met.`,
        evidence: [measured.source],
        windowLabel: t.windowLabel,
      };
    }
    const met = t.comparator === 'gte' ? measured.value >= t.target : measured.value <= t.target;
    return {
      targetId: t.id,
      serviceId: t.serviceId,
      label: t.label,
      metric: t.metric,
      comparator: t.comparator,
      target: t.target,
      unit: t.unit,
      measured: measured.value,
      status: met ? ('met' as const) : ('breached' as const),
      detail: `measured ${formatValue(measured.value, t.unit)} ${t.comparator === 'gte' ? '≥' : '≤'} target ${formatValue(t.target, t.unit)} → ${met ? 'met' : 'BREACHED'} (${measured.source}, ${t.windowLabel})`,
      evidence: [measured.source, t.id],
      windowLabel: t.windowLabel,
    };
  });

  return {
    generatedAt: input.nowIso,
    statuses,
    totals: {
      targets: statuses.length,
      met: statuses.filter((s) => s.status === 'met').length,
      breached: statuses.filter((s) => s.status === 'breached').length,
      unmeasurable: statuses.filter((s) => s.status === 'unmeasurable').length,
    },
    unavailable,
  };
}

function formatValue(v: number, unit: string): string {
  if (unit === 'ratio') return `${(v * 100).toFixed(0)}%`;
  if (unit === 'ms') return `${Math.round(v)} ms`;
  if (unit === 'hours') return `${v.toFixed(1)} h`;
  if (unit === 'boolean') return v >= 1 ? 'yes' : 'no';
  return `${v} ${unit}`;
}

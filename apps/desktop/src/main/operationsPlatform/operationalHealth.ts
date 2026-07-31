/**
 * Phase 6 Stage 9 — operational health (compose, never recompute).
 *
 * The Stage 6 eight-domain framework is carried VERBATIM — same domains, same
 * scores, same confidence, same explanations. Stage 9 adds only adjacent
 * composition: the NeuroCore system snapshot, the workforce health summary,
 * connector counts, and the 90-day trend from the EXISTING history store.
 * A failed read isolates into `unavailable`; nothing is re-derived. Pure.
 */
import type { InsightHealthFramework, OperationalHealthView, OperationsUnavailable } from '@neuropause/shared';

export interface HealthInput {
  nowIso: string;
  /** The Stage 6 framework, read from the EXISTING insight subsystem. */
  framework: InsightHealthFramework | null;
  system: { score: number; level: string } | null;
  workforce: { healthy: number; degraded: number; unhealthy: number; unknown: number } | null;
  connectors: { total: number; configured: number; healthy: number } | null;
  history: { day: string; overall: number }[] | null;
  failures: Record<string, string>;
}

const EMPTY_FRAMEWORK: InsightHealthFramework = {
  domains: [],
  overall: null,
  band: 'unknown',
  // Honest zero-confidence breakdown: nothing was available to compose.
  confidence: { dataAvailability: 0, signalQuality: 0, historicalCoverage: 0, correlationStrength: 0, overall: 0 },
  generatedAt: '',
};

export function buildOperationalHealth(input: HealthInput): OperationalHealthView {
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  if (input.framework === null && !unavailable.some((u) => u.system === 'insight')) {
    unavailable.push({ system: 'insight', reason: 'the Stage 6 intelligence layer returned no framework' });
  }
  return {
    generatedAt: input.nowIso,
    framework: input.framework ?? { ...EMPTY_FRAMEWORK, generatedAt: input.nowIso },
    system: input.system,
    workforce: input.workforce,
    connectors: input.connectors,
    trend: (input.history ?? []).map((h) => ({ day: h.day, overall: h.overall })),
    unavailable,
  };
}

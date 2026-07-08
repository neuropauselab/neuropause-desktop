/**
 * Enterprise insights (V8.5 inc1) — the enterprise decision layer's first deriver.
 *
 * It does NOT compute new metrics. It folds signals that already exist elsewhere —
 * knowledge health (knowledge/knowledgeHealth), memory counts (memoryStore.counts),
 * and the workforce intelligence summary (workforce/intelligence) — into one
 * enterprise-level snapshot with a small set of derived, explainable indicators
 * (coverage %, workforce success %, an overall enterprise band). Every input value
 * comes from an existing aggregation; nothing here is fabricated or re-measured.
 *
 * Pure and I/O-free: the caller passes the already-produced signals (from the
 * Executive Center's existing `sources` seam) and this returns the snapshot. Unit-
 * tests from synthetic inputs; touches no runtime state.
 */

/** Minimal shapes of the existing signals this deriver reads (structurally matched). */
export interface KnowledgeHealthLike {
  totalMemories: number;
  topicCount: number;
  memoriesInTopics: number;
  orphanCount: number;
  coveragePercent: number;
}
export interface MemoryCountsLike {
  total: number;
  byKind: Record<string, number>;
  lastBuiltAt: string | null;
}
export interface WorkforceIntelLike {
  totalJobs: number;
  activeWorkers: number;
  overallSuccessRate: number;
  bottlenecks: unknown[];
}

export type EnterpriseBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

export interface EnterpriseInsights {
  /** Memory footprint (from memoryStore.counts). */
  memoryTotal: number;
  memoryKinds: number;
  memoryLastBuiltAt: string | null;
  /** Knowledge structure (from knowledgeHealth). */
  knowledgeTopics: number;
  knowledgeCoveragePercent: number;
  knowledgeOrphans: number;
  /** Workforce (from workforceIntelligence). */
  workforceJobs: number;
  workforceActiveWorkers: number;
  workforceSuccessPercent: number;
  workforceBottlenecks: number;
  /** Derived, explainable overall band across the signals present. */
  band: EnterpriseBand;
  /** One-line human summary of the enterprise state. */
  headline: string;
}

export interface EnterpriseInsightsInput {
  knowledge?: KnowledgeHealthLike;
  memory?: MemoryCountsLike;
  workforce?: WorkforceIntelLike;
}

function worstBand(a: EnterpriseBand, b: EnterpriseBand): EnterpriseBand {
  const order: EnterpriseBand[] = ['healthy', 'watch', 'at-risk', 'critical'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export function enterpriseInsights(input: EnterpriseInsightsInput): EnterpriseInsights {
  const k = input.knowledge;
  const m = input.memory;
  const w = input.workforce;

  const workforceSuccessPercent = w ? Math.round(w.overallSuccessRate * 100) : 0;
  const knowledgeCoveragePercent = k ? k.coveragePercent : 0;

  // Overall band folds the present signals; absent signals don't drag it down.
  let band: EnterpriseBand = 'healthy';
  if (w && w.totalJobs > 0) {
    const wfBand: EnterpriseBand =
      w.bottlenecks.length > 0 ? 'at-risk' : workforceSuccessPercent >= 80 ? 'healthy' : workforceSuccessPercent >= 50 ? 'watch' : 'critical';
    band = worstBand(band, wfBand);
  }
  if (k && k.totalMemories > 0) {
    const kBand: EnterpriseBand =
      knowledgeCoveragePercent >= 60 ? 'healthy' : knowledgeCoveragePercent >= 30 ? 'watch' : 'at-risk';
    band = worstBand(band, kBand);
  }

  const parts: string[] = [];
  if (m) parts.push(`${m.total} memories`);
  if (k) parts.push(`${k.topicCount} topics · ${knowledgeCoveragePercent}% connected`);
  if (w) parts.push(`${w.activeWorkers} workers · ${workforceSuccessPercent}% success`);
  const headline = parts.length > 0 ? parts.join(' · ') : 'No enterprise signals yet';

  return {
    memoryTotal: m?.total ?? 0,
    memoryKinds: m ? Object.keys(m.byKind).length : 0,
    memoryLastBuiltAt: m?.lastBuiltAt ?? null,
    knowledgeTopics: k?.topicCount ?? 0,
    knowledgeCoveragePercent,
    knowledgeOrphans: k?.orphanCount ?? 0,
    workforceJobs: w?.totalJobs ?? 0,
    workforceActiveWorkers: w?.activeWorkers ?? 0,
    workforceSuccessPercent,
    workforceBottlenecks: w ? w.bottlenecks.length : 0,
    band,
    headline,
  };
}

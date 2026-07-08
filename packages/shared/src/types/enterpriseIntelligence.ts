/**
 * Enterprise intelligence types (V8.5). Canonical home for the enterprise insights
 * snapshot so both the deriver (main) and the Executive Center snapshot (shared)
 * reference one definition. Declaration only.
 */
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

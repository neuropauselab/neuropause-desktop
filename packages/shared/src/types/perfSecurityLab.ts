/**
 * AI Sandbox — Performance & Security Lab (S5): the lab contract.
 *
 * The Sandbox validates performance, scalability, reliability, resilience, and security of
 * the REAL platform by ORCHESTRATING the existing executors (S1 engine → S2 desktop / S3
 * enterprise / S4 AI QA) and reading the existing diagnostics / executive / observability
 * surfaces. These types + the pure helpers are the shared, validated shape the lab and the
 * SDK/portal author against. All latency math REUSES the existing perfMetrics helpers — no
 * duplicate metric code. No runtime here (the S5 analog of S3's scenario contract).
 */
import { percentile, summarizeDurations, type DurationSummary } from './perfMetrics';

/* ─────────────────────────────── targets + profiles (Step 2) ─────────────────────────────── */

export type LabTargetKind =
  | 'startup'
  | 'shutdown'
  | 'desktop'
  | 'rest'
  | 'sdk'
  | 'cli'
  | 'automation'
  | 'connectors'
  | 'plugins'
  | 'graph'
  | 'timeline'
  | 'memory'
  | 'executive'
  | 'scenario-runner'
  | 'ai-qa';

export const LAB_TARGET_KINDS: readonly LabTargetKind[] = [
  'startup', 'shutdown', 'desktop', 'rest', 'sdk', 'cli', 'automation', 'connectors',
  'plugins', 'graph', 'timeline', 'memory', 'executive', 'scenario-runner', 'ai-qa',
];

export interface PerfProfileResult {
  id: string;
  target: LabTargetKind;
  runs: number;
  passed: number;
  latency: DurationSummary;
  p99Ms: number;
  throughputPerSec: number;
}

/* ─────────────────────────────── load (Step 3) ─────────────────────────────── */

export type LoadDimension =
  | 'users'
  | 'desktop'
  | 'rest'
  | 'sdk'
  | 'cli'
  | 'automation'
  | 'plugins'
  | 'connectors'
  | 'ai-sessions';

export interface LoadPlan {
  id: string;
  dimension: LoadDimension;
  /** Concurrent in-flight runs (worker-pool width). */
  concurrency: number;
  /** Total runs to complete. */
  total: number;
}

export interface LoadResult {
  id: string;
  dimension: LoadDimension;
  concurrency: number;
  total: number;
  completed: number;
  failed: number;
  latency: DurationSummary;
  p99Ms: number;
  throughputPerSec: number;
  peakQueueDepth: number;
  /** Queue depth grew beyond concurrency → backpressure engaged. */
  backpressure: boolean;
}

/* ─────────────────────────────── stress (Step 4) ─────────────────────────────── */

export type StressDimension =
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'network'
  | 'dataset'
  | 'graph'
  | 'timeline'
  | 'memory-store'
  | 'plugins'
  | 'connectors'
  | 'erp-dataset';

export interface StressPlan {
  id: string;
  dimension: StressDimension;
  /** Magnitude — rows / entities / size the run is stressed with. */
  magnitude: number;
}

export interface StressResult {
  id: string;
  dimension: StressDimension;
  magnitude: number;
  completed: number;
  failed: number;
  latencyMs: number;
  /** % slower than the profile baseline (0 if no regression). */
  degradationPct: number;
  peakRssBytes: number;
}

/* ─────────────────────────────── chaos (Step 5) ─────────────────────────────── */

export type ChaosFaultKind =
  | 'desktop-crash'
  | 'renderer-crash'
  | 'worker-crash'
  | 'automation-failure'
  | 'connector-timeout'
  | 'rest-timeout'
  | 'sdk-failure'
  | 'cli-failure'
  | 'webhook-failure'
  | 'plugin-failure'
  | 'queue-failure'
  | 'memory-pressure'
  | 'disk-full'
  | 'network-loss'
  | 'oauth-expiry'
  | 'auth-failure'
  | 'permission-failure';

/** `induce` runs a fault-inducing scenario through the sandbox; `probe` reads diagnostics
 *  to confirm resilience without causing a host/production fault (Safety). */
export type ChaosMode = 'induce' | 'probe';

export interface ChaosExperiment {
  id: string;
  fault: ChaosFaultKind;
  mode: ChaosMode;
}

export interface ChaosResult {
  id: string;
  fault: ChaosFaultKind;
  mode: ChaosMode;
  induced: boolean;
  recovered: boolean;
  recoveryMs: number;
  failureClass: string;
  healthLevelAfter: string;
}

/* ─────────────────────────────── security (Step 6) ─────────────────────────────── */

export type SecurityCheckKind =
  | 'rbac'
  | 'permission-escalation'
  | 'oauth'
  | 'api-keys'
  | 'sdk-auth'
  | 'cli-auth'
  | 'webhook-signature'
  | 'plugin-permission'
  | 'connector-permission'
  | 'desktop-permission'
  | 'session-isolation'
  | 'secrets'
  | 'rate-limit'
  | 'quota'
  | 'audit-trail';

export interface SecurityCheck {
  id: string;
  kind: SecurityCheckKind;
}

export interface SecurityResult {
  id: string;
  kind: SecurityCheckKind;
  /** The check passed = the security control is correctly ENFORCED. */
  passed: boolean;
  enforced: boolean;
  detail: string;
}

/* ─────────────────────────────── recovery (Step 7) ─────────────────────────────── */

export type RecoveryKind =
  | 'retry'
  | 'resume'
  | 'rollback'
  | 'reconnect'
  | 'failover'
  | 'graceful-shutdown'
  | 'restart'
  | 'session-recovery'
  | 'connector-recovery'
  | 'automation-recovery'
  | 'plugin-recovery';

export interface RecoveryCheck {
  id: string;
  kind: RecoveryKind;
}

export interface RecoveryResult {
  id: string;
  kind: RecoveryKind;
  recovered: boolean;
  recoveryMs: number;
}

/* ─────────────────────────────── benchmarks (Step 9) ─────────────────────────────── */

export interface BenchmarkRecord {
  id: string;
  /**
   * The organization this measurement belongs to (P13C N3, second pass).
   *
   * A baseline is echoed verbatim into the next run's regression findings, so
   * an unscoped store means one tenant's measured latency and memory numbers
   * appear inside another tenant's certification report.
   */
  tenantId?: string | null;
  target: LabTargetKind;
  metric: string;
  version: string;
  value: number;
  at: string;
}

export type BenchmarkTrend = 'improved' | 'regressed' | 'stable';

export interface BenchmarkComparison {
  id: string;
  metric: string;
  current: number;
  baseline: number | null;
  deltaPct: number;
  trend: BenchmarkTrend;
}

/* ─────────────────────────────── report + dashboard (Steps 8 + 10) ─────────────────────────────── */

export type LabVerdict = 'pass' | 'warn' | 'fail';

export interface LabReport {
  id: string;
  title: string;
  generatedAt: string;
  verdict: LabVerdict;
  performance: PerfProfileResult[];
  load: LoadResult[];
  stress: StressResult[];
  chaos: ChaosResult[];
  security: SecurityResult[];
  recovery: RecoveryResult[];
  benchmarks: BenchmarkComparison[];
  recommendations: string[];
  summary: string;
}

export interface LabDashboard {
  generatedAt: string;
  latencyP95Ms: number;
  throughputPerSec: number;
  cpuPercent: number;
  memoryUsedMb: number;
  queueDepth: number;
  scenarioSuccessPct: number;
  recoveryRatePct: number;
  securityFailures: number;
  regressionTrend: BenchmarkTrend;
  panels: { key: string; label: string; value: string; band: 'healthy' | 'watch' | 'at-risk' | 'critical' }[];
}

export const LAB_METRIC_KEYS = [
  'profilesRun', 'loadRun', 'stressRun', 'chaosRun', 'securityRun', 'recoveryRun',
  'latencyP95Ms', 'throughputPerSec', 'scenarioSuccessPct', 'recoveryRatePct',
  'securityFailures', 'peakQueueDepth', 'peakRssBytes', 'labMs',
] as const;

/* ─────────────────────────── pure helpers (REUSE perfMetrics) ─────────────────────────── */

/** Aggregate raw latency samples into a summary + p99 — reuses the shared perfMetrics math. */
export function aggregateLatency(samplesMs: readonly number[]): { summary: DurationSummary; p99Ms: number } {
  const summary = summarizeDurations(samplesMs);
  const sorted = [...samplesMs].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  return { summary, p99Ms: percentile(sorted, 99) };
}

export function throughputPerSec(count: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.round((count / totalMs) * 1000 * 100) / 100;
}

/** Compare a current benchmark value to a baseline; lower-is-better metrics regress when higher. */
export function compareBenchmark(record: BenchmarkRecord, baseline: number | null, lowerIsBetter = true): BenchmarkComparison {
  if (baseline === null || baseline === 0) {
    return { id: record.id, metric: record.metric, current: record.value, baseline, deltaPct: 0, trend: 'stable' };
  }
  const deltaPct = Math.round(((record.value - baseline) / baseline) * 1000) / 10;
  let trend: BenchmarkTrend = 'stable';
  if (Math.abs(deltaPct) >= 5) {
    const worse = lowerIsBetter ? deltaPct > 0 : deltaPct < 0;
    trend = worse ? 'regressed' : 'improved';
  }
  return { id: record.id, metric: record.metric, current: record.value, baseline, deltaPct, trend };
}

/** Overall lab verdict from the section results. Pure. */
export function labVerdict(input: {
  performance: PerfProfileResult[];
  load: LoadResult[];
  chaos: ChaosResult[];
  security: SecurityResult[];
  recovery: RecoveryResult[];
  benchmarks: BenchmarkComparison[];
}): LabVerdict {
  const securityFail = input.security.some((s) => !s.passed);
  const chaosUnrecovered = input.chaos.some((c) => c.induced && !c.recovered);
  const recoveryFail = input.recovery.some((r) => !r.recovered);
  const regressed = input.benchmarks.some((b) => b.trend === 'regressed');
  if (securityFail || chaosUnrecovered) return 'fail';
  if (recoveryFail || regressed || input.load.some((l) => l.failed > 0)) return 'warn';
  return 'pass';
}

export function scenarioSuccessPct(performance: PerfProfileResult[]): number {
  const runs = performance.reduce((s, p) => s + p.runs, 0);
  const passed = performance.reduce((s, p) => s + p.passed, 0);
  return runs ? Math.round((passed / runs) * 100) : 0;
}

export function recoveryRatePct(recovery: RecoveryResult[], chaos: ChaosResult[]): number {
  const items = [...recovery.map((r) => r.recovered), ...chaos.filter((c) => c.induced).map((c) => c.recovered)];
  if (!items.length) return 100;
  return Math.round((items.filter(Boolean).length / items.length) * 100);
}

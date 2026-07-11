/**
 * AI Sandbox — Continuous Validation Platform (S6): the contract.
 *
 * S6 is the ORCHESTRATION layer (not another test framework). It continuously executes the
 * S1–S5 sandbox — Core, Desktop Executor, Enterprise Scenario Runner, AI QA Agent, and the
 * Performance & Security Lab — against the REAL platform, composed into named pipelines,
 * fired by the existing scheduler, compared against the existing benchmark store, recorded
 * in the existing memory, and certified into reports. These types + the pure helpers are
 * the shared shape the orchestrator and the portal author against. No runtime here — and it
 * REUSES everything (the S6 analog of S5's lab contract).
 */

/* ─────────────────────────────── pipelines (Step 3) ─────────────────────────────── */

export type PipelineKind =
  | 'quick'
  | 'smoke'
  | 'regression'
  | 'performance'
  | 'security'
  | 'enterprise'
  | 'connector'
  | 'plugin'
  | 'sdk'
  | 'cli'
  | 'desktop'
  | 'release-candidate'
  | 'certification';

export const PIPELINE_KINDS: readonly PipelineKind[] = [
  'quick', 'smoke', 'regression', 'performance', 'security', 'enterprise', 'connector',
  'plugin', 'sdk', 'cli', 'desktop', 'release-candidate', 'certification',
];

/** Each stage dispatches to ONE existing executor — never a new engine. */
export type StageKind = 'scenario' | 'ai-qa' | 'lab';

export interface PipelineStage {
  id: string;
  name: string;
  kind: StageKind;
  /** Stage config: `{ spec }` for scenario, `{ goal }` for ai-qa, `{ labConfig }` for lab. */
  config: Record<string, unknown>;
  /** A failing non-optional stage fails the run; an optional stage only warns. */
  optional?: boolean;
}

export interface ValidationPipeline {
  kind: PipelineKind;
  name: string;
  description: string;
  stages: PipelineStage[];
  /** Whether this pipeline produces a certification report. */
  certifies: boolean;
}

/* ─────────────────────────────── schedule + triggers (Step 2) ─────────────────────────────── */

export type TriggerKind =
  | 'manual'
  | 'scheduled'
  | 'nightly'
  | 'weekly'
  | 'pre-release'
  | 'post-upgrade'
  | 'regression'
  | 'certification';

export type CadenceKind = 'manual' | 'nightly' | 'weekly' | 'interval';

export interface ScheduleCadence {
  kind: CadenceKind;
  /** Minute-of-day for nightly/weekly (0–1439). */
  atMinutes?: number;
  /** 0=Sun … 6=Sat for weekly. */
  dayOfWeek?: number;
  /** Interval in ms for `interval`. */
  everyMs?: number;
}

export interface ScheduledValidation {
  id: string;
  pipeline: PipelineKind;
  cadence: ScheduleCadence;
  trigger: TriggerKind;
  enabled: boolean;
  lastRunAt: string | null;
  nextDueLabel: string;
}

/* ─────────────────────────────── runs + stage results (Step 4) ─────────────────────────────── */

export type StageStatus = 'pass' | 'fail' | 'warn' | 'error' | 'skipped';
export type ValidationRunStatus = 'running' | 'passed' | 'failed' | 'warning' | 'error';

export interface StageResult {
  id: string;
  name: string;
  kind: StageKind;
  status: StageStatus;
  durationMs: number;
  summary: string;
  metrics: Record<string, number>;
}

export interface ValidationRun {
  id: string;
  pipeline: PipelineKind;
  trigger: TriggerKind;
  status: ValidationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  stages: StageResult[];
  metrics: Record<string, number>;
  /** Present when the pipeline certifies. */
  certificationLevel: CertificationLevel | null;
  regressionCount: number;
}

/* ─────────────────────────────── regression (Step 5) ─────────────────────────────── */

export type RegressionKind =
  | 'performance'
  | 'functional'
  | 'security'
  | 'recovery'
  | 'benchmark'
  | 'memory'
  | 'cpu'
  | 'latency'
  | 'failure-trend';

export type RegressionSeverity = 'info' | 'minor' | 'major' | 'critical';

export interface RegressionFinding {
  kind: RegressionKind;
  metric: string;
  current: number;
  baseline: number | null;
  deltaPct: number;
  severity: RegressionSeverity;
  detail: string;
}

export interface RegressionAnalysis {
  findings: RegressionFinding[];
  regressed: boolean;
  worst: RegressionSeverity;
  summary: string;
}

/* ─────────────────────────────── certification (Step 7) ─────────────────────────────── */

export type CertificationLevel = 'pass' | 'warning' | 'fail';

export interface CertificationReport {
  id: string;
  pipeline: PipelineKind;
  level: CertificationLevel;
  generatedAt: string;
  buildStatus: string;
  scenarioResults: { total: number; passed: number; failed: number };
  aiQaResults: { sessions: number; bugs: number };
  performance: { latencyP95Ms: number; throughputPerSec: number };
  security: { checks: number; failures: number };
  recovery: { rate: number };
  benchmarks: { compared: number; regressed: number };
  regressionSummary: string;
  kpis: { key: string; value: number | null }[];
  diagnostics: { level: string; cpuPercent: number; memoryUsedMb: number };
  summary: string;
}

/* ─────────────────────────────── dashboard (Step 8) ─────────────────────────────── */

export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface ValidationHistoryEntry {
  runId: string;
  pipeline: PipelineKind;
  level: CertificationLevel | null;
  status: ValidationRunStatus;
  at: string;
  passed: number;
  failed: number;
}

export interface ValidationDashboard {
  generatedAt: string;
  current: { runId: string; pipeline: PipelineKind; status: ValidationRunStatus } | null;
  queueDepth: number;
  scheduled: ScheduledValidation[];
  latest: ValidationHistoryEntry | null;
  history: ValidationHistoryEntry[];
  certificationStatus: CertificationLevel | null;
  trends: {
    regression: TrendDirection;
    performance: TrendDirection;
    security: TrendDirection;
    aiQa: TrendDirection;
    benchmark: TrendDirection;
  };
  panels: { key: string; label: string; value: string; band: 'healthy' | 'watch' | 'at-risk' | 'critical' }[];
}

/** The read-only summary the Developer Portal consumes (runtime metadata projection). */
export interface ValidationSummary {
  generatedAt: string;
  pipelines: { kind: PipelineKind; name: string; stages: number; certifies: boolean }[];
  scheduled: ScheduledValidation[];
  recent: ValidationHistoryEntry[];
  latestCertification: CertificationLevel | null;
  totalRuns: number;
}

/* ─────────────────────────────── notifications (Step 9) ─────────────────────────────── */

export type NotificationKind =
  | 'validation-complete'
  | 'validation-failed'
  | 'certification-ready'
  | 'regression-detected'
  | 'security-issue'
  | 'performance-issue'
  | 'critical-failure';

export interface ValidationNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  priority: 'normal' | 'high' | 'critical';
  runId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export const VALIDATION_METRIC_KEYS = [
  'pipelineMs', 'queueMs', 'executionMs', 'stagesRun', 'stagesPassed', 'stagesFailed',
  'scenarioTotal', 'scenarioPassed', 'aiQaBugs', 'securityFailures', 'regressionCount',
  'latencyP95Ms', 'recoveryRatePct', 'reportMs', 'rssBytes',
] as const;

/* ─────────────────────────── pure helpers ─────────────────────────── */

/** Certification level from stage results + regression + security. Pure. */
export function certifyLevel(input: {
  stages: StageResult[];
  regression: RegressionAnalysis | null;
  securityFailures: number;
}): CertificationLevel {
  if (input.securityFailures > 0) return 'fail';
  if (input.stages.some((s) => s.status === 'fail' || s.status === 'error')) return 'fail';
  if (input.regression?.regressed || input.stages.some((s) => s.status === 'warn')) return 'warning';
  return 'pass';
}

/** Roll stage statuses into an overall run status. Pure. */
export function runStatusFrom(stages: StageResult[]): ValidationRunStatus {
  if (!stages.length) return 'error';
  if (stages.some((s) => s.status === 'error')) return 'error';
  if (stages.some((s) => s.status === 'fail')) return 'failed';
  if (stages.some((s) => s.status === 'warn')) return 'warning';
  return 'passed';
}

/** Classify a benchmark delta into a regression finding (lower-is-better). Pure. */
export function classifyRegression(kind: RegressionKind, metric: string, current: number, baseline: number | null): RegressionFinding | null {
  if (baseline === null || baseline === 0) return null;
  const deltaPct = Math.round(((current - baseline) / baseline) * 1000) / 10;
  if (deltaPct <= 5) return null; // within noise or improved
  const severity: RegressionSeverity = deltaPct >= 50 ? 'critical' : deltaPct >= 25 ? 'major' : deltaPct >= 10 ? 'minor' : 'info';
  return { kind, metric, current, baseline, deltaPct, severity, detail: `${metric} +${deltaPct}% vs baseline` };
}

export function worstSeverity(findings: RegressionFinding[]): RegressionSeverity {
  const order: RegressionSeverity[] = ['info', 'minor', 'major', 'critical'];
  return findings.reduce<RegressionSeverity>((w, f) => (order.indexOf(f.severity) > order.indexOf(w) ? f.severity : w), 'info');
}

/** Trend from a series of pass/fail history (recent last). Pure. */
export function computeTrend(recentPassRates: number[]): TrendDirection {
  if (recentPassRates.length < 2) return 'stable';
  const first = recentPassRates[0];
  const last = recentPassRates[recentPassRates.length - 1];
  if (last - first >= 5) return 'improving';
  if (first - last >= 5) return 'declining';
  return 'stable';
}

/** Whether a cadence is due at the given wall-clock minute-of-day + weekday. Pure. */
export function cadenceDue(cadence: ScheduleCadence, minuteOfDay: number, dayOfWeek: number, lastRunDayKey: string, todayKey: string): boolean {
  switch (cadence.kind) {
    case 'manual':
      return false;
    case 'interval':
      return false; // interval firing is driven by the tick, not wall-clock matching
    case 'nightly':
      return minuteOfDay === (cadence.atMinutes ?? 120) && lastRunDayKey !== todayKey;
    case 'weekly':
      return dayOfWeek === (cadence.dayOfWeek ?? 1) && minuteOfDay === (cadence.atMinutes ?? 120) && lastRunDayKey !== todayKey;
    default:
      return false;
  }
}

export function cadenceLabel(cadence: ScheduleCadence): string {
  switch (cadence.kind) {
    case 'nightly': return `nightly at ${fmtMin(cadence.atMinutes ?? 120)}`;
    case 'weekly': return `weekly (day ${cadence.dayOfWeek ?? 1}) at ${fmtMin(cadence.atMinutes ?? 120)}`;
    case 'interval': return `every ${Math.round((cadence.everyMs ?? 0) / 1000)}s`;
    default: return 'manual';
  }
}

function fmtMin(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

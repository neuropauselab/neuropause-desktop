/**
 * Workforce intelligence contract — the shape carried by the `workforce:intelligence`
 * IPC response.
 *
 * A7. These interfaces previously existed TWICE: once in the main process
 * (`apps/desktop/src/main/workforce/intelligence/{workerPerformance,
 * goalExecutionAnalytics,bottlenecks,workforceIntelligence}.ts`) where the values are
 * produced, and once in the renderer
 * (`apps/desktop/src/renderer/src/workforce/intelligenceTypes.ts`) where they are
 * consumed. The renderer copy described itself as a mirror of the main-process shape
 * and was field-for-field identical, but nothing checked that: two hand-maintained
 * declarations of one wire contract, on opposite sides of a boundary, free to drift
 * silently.
 *
 * They now live here once, in the package both sides already depend on, and both
 * sides re-export from this module so every existing import path keeps resolving.
 * The declarations below are the main-process originals verbatim — this is a move,
 * not a redesign, and the emitted types are unchanged.
 */

/** Per-worker execution performance, derived from the job history. */
export interface WorkerPerformance {
  workerId: string;
  /** Most recent role seen for this worker (roles are stable per worker). */
  workerRole: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** Jobs still queued/running/awaiting approval at snapshot time. */
  inFlight: number;
  /** succeeded / (succeeded + failed); 0 when none have terminated. */
  successRate: number;
  /** Mean durationMs over terminated jobs that recorded a duration. */
  avgDurationMs: number | null;
  /** Median (p50) durationMs over the same set. */
  p50DurationMs: number | null;
  /** Fraction of terminated jobs where the worker had no connected data. */
  ungroundedRate: number;
  /** Latest finishedAt (ISO) across this worker's jobs, or null. */
  lastActiveAt: string | null;
}

/** One row of grouped execution analytics (grouped by skill or by role). */
export interface ExecutionStat {
  /** The grouping key value (a skillId or a workerRole). */
  key: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  /** succeeded / (succeeded + failed); 0 when none decided. */
  successRate: number;
  avgDurationMs: number | null;
  ungroundedRate: number;
}

/** Execution analytics grouped every way the workforce views need. */
export interface GoalExecutionAnalytics {
  bySkill: ExecutionStat[];
  byRole: ExecutionStat[];
  totals: ExecutionStat;
}

/**
 * Named `Workforce*` rather than the producer's local `BottleneckKind` /
 * `BottleneckScope` / `Bottleneck` because @neuropause/shared already exports an
 * unrelated `Bottleneck` — a graph node with throughput and degree
 * (`intelligence/enterpriseGraph.ts:286`). Two different domains, one word. The
 * producer keeps its short local spellings via aliases, so nothing in the main
 * process changes; these are the names that cross the package boundary.
 */
export type WorkforceBottleneckKind = 'high_failure' | 'backlog' | 'ungrounded';
export type WorkforceBottleneckScope = 'worker' | 'skill';

/** A detected execution constraint, with the evidence that flagged it. */
export interface WorkforceBottleneck {
  scope: WorkforceBottleneckScope;
  /** workerId or skillId. */
  key: string;
  kind: WorkforceBottleneckKind;
  /** Human-readable explanation of why this was flagged. */
  reason: string;
  /** The metric that tripped the threshold (0..1 for rates, a count for backlog). */
  value: number;
  /** Sample size behind the metric. */
  sampleSize: number;
}

/**
 * Executive-level snapshot of the workforce: the roll-up of worker performance,
 * goal execution analytics, and bottleneck detection over the existing job history.
 */
export interface WorkforceIntelligence {
  totalJobs: number;
  activeWorkers: number;
  /** succeeded / (succeeded + failed) across all jobs; 0 when none decided. */
  overallSuccessRate: number;
  inFlight: number;
  /** Top workers by volume (already sorted by the deriver). */
  workers: WorkerPerformance[];
  execution: GoalExecutionAnalytics;
  bottlenecks: WorkforceBottleneck[];
  /** The single most active worker, if any. */
  busiestWorkerId: string | null;
}

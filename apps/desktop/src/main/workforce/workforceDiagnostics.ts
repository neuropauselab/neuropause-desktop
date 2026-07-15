/**
 * P8.2 — AI Workforce diagnostics probe.
 *
 * A `DiagnosticProbe` for the EXISTING diagnostics runtime (no new system): it
 * folds live worker + job state into one rollup `DiagnosticCheck` that appears in
 * `ipc.diagnostics.get` and release diagnostics automatically. It REUSES the
 * existing pure folds — `summarizeWorkforceHealth` (registry health band) and
 * `workforceIntelligence` (job totals, in-flight, success rate, bottlenecks) — and
 * computes availability, execution rate, avg duration, and approval wait inline.
 *
 * Honesty: retry count, delegation health, and planning health are NOT derivable
 * from persisted state today (jobs carry no retry count; delegation/planning are
 * stateless on-demand planners), so they are intentionally omitted rather than
 * fabricated. Queue length uses the `queued`-status job count (a faithful proxy —
 * the live Scheduler is not reachable from a probe).
 *
 * The `workforceDiagnosticsSummary` fold is pure + injected-getter-testable,
 * mirroring `connectorDiagnostics`.
 */
import type {
  DiagnosticStatus,
  Job,
  WorkerSummary,
  WorkforceHealthInput,
  WorkforceHealthState,
} from '@neuropause/shared';
import { makeCheck, type DiagnosticProbe } from '../platform/diagnostics';
import { summarizeWorkforceHealth } from '../enterprise/workforceHealth';
import { workforceIntelligence } from './intelligence/workforceIntelligence';
import { pendingApprovalCount } from './runtime/executor';

/** Recent-completion window for the execution-rate metric. */
const WINDOW_MS = 10 * 60_000;
const DAY_MS = 24 * 3_600_000;
/** Backlog + stale-approval thresholds that escalate an otherwise-ok fleet. */
const QUEUE_DEGRADED_AT = 20;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function statusFor(state: WorkforceHealthState): DiagnosticStatus {
  switch (state) {
    case 'healthy':
      return 'ok';
    case 'degraded':
      return 'degraded';
    case 'unhealthy':
      return 'down';
    default:
      return 'unknown';
  }
}

export interface WorkforceProbeInput {
  workers: WorkerSummary[];
  /** recent-jobs sample (newest ≤500) used for rates + durations. */
  jobs: Job[];
  health: WorkforceHealthInput[];
  /** queued-status job count (queue-depth proxy). */
  queued: number;
  /** Accurate total jobs in the store (the `jobs` sample may be capped); defaults to jobs.length. */
  storedJobs?: number;
  nowMs: number;
}

export interface WorkforceDiagSummary {
  status: DiagnosticStatus;
  totalWorkers: number;
  available: number;
  unavailable: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  totalJobs: number;
  inFlight: number;
  queued: number;
  execPerMin: number;
  successRatePct: number;
  failureRatePct: number;
  avgDurationMs: number;
  pendingApprovals: number;
  oldestApprovalWaitMs: number;
  bottlenecks: number;
  detail: string;
  recommendation: string | null;
}

/**
 * Pure fold of workforce runtime state into diagnostics metrics + a status band.
 * Status spine = the registry health band, escalated by unavailability, backlog,
 * bottlenecks, or long-stale approvals; a fleet with workers but none available is
 * `down`.
 */
export function workforceDiagnosticsSummary(input: WorkforceProbeInput): WorkforceDiagSummary {
  const { workers, health, jobs, queued, nowMs } = input;
  const summary = summarizeWorkforceHealth(health);
  const wi = workforceIntelligence(jobs);
  const totalJobs = input.storedJobs ?? jobs.length;

  const unavailable = workers.filter(
    (w) => w.lifecycle === 'paused' || w.lifecycle === 'stopped' || w.lifecycle === 'errored',
  ).length;
  const available = workers.length - unavailable;

  const finishedRecently = jobs.filter(
    (j) => j.finishedAt != null && nowMs - Date.parse(j.finishedAt) <= WINDOW_MS,
  ).length;
  const execPerMin = round2(finishedRecently / (WINDOW_MS / 60_000));

  const durations = jobs
    .map((j) => j.durationMs)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0;

  const decided = jobs.filter((j) => j.status === 'succeeded' || j.status === 'failed').length;
  const successRatePct = Math.round(Math.max(0, Math.min(1, wi.overallSuccessRate)) * 100);
  // Undecided fleet has no failures — avoid the misleading 100 - 0 = 100%.
  const failureRatePct = decided > 0 ? 100 - successRatePct : 0;

  const pendingApprovals = jobs.reduce((n, j) => n + pendingApprovalCount(j), 0);
  const parked = jobs.filter((j) => j.status === 'awaiting_approval' && j.startedAt != null);
  const oldestApprovalWaitMs = parked.length
    ? Math.max(...parked.map((j) => nowMs - Date.parse(j.startedAt as string)))
    : 0;

  let status = statusFor(summary.state);
  if (workers.length > 0 && available === 0) status = 'down';
  if (
    status === 'ok' &&
    (wi.bottlenecks.length > 0 || queued >= QUEUE_DEGRADED_AT || unavailable > 0 || oldestApprovalWaitMs > DAY_MS)
  ) {
    status = 'degraded';
  }

  const detail =
    `${workers.length} worker(s) · ${available} available · ` +
    `${summary.healthy} healthy/${summary.degraded} degraded/${summary.unhealthy} unhealthy · ` +
    `${totalJobs} jobs · ${queued} queued · ${wi.inFlight} in-flight · ` +
    `${execPerMin}/min · ${successRatePct}% success · avg ${avgDurationMs}ms · ` +
    `${pendingApprovals} pending approval(s)` +
    (wi.bottlenecks.length ? ` · ${wi.bottlenecks.length} bottleneck(s)` : '');

  const recommendation =
    status === 'ok'
      ? null
      : 'Open the AI Workforce view — workers are degraded, backlogged, or awaiting approvals.';

  return {
    status,
    totalWorkers: workers.length,
    available,
    unavailable,
    healthy: summary.healthy,
    degraded: summary.degraded,
    unhealthy: summary.unhealthy,
    totalJobs,
    inFlight: wi.inFlight,
    queued,
    execPerMin,
    successRatePct,
    failureRatePct,
    avgDurationMs,
    pendingApprovals,
    oldestApprovalWaitMs,
    bottlenecks: wi.bottlenecks.length,
    detail,
    recommendation,
  };
}

export interface WorkforceProbeDeps {
  workers: () => WorkerSummary[];
  health: () => WorkforceHealthInput[];
  jobs: () => Job[];
  queued: () => number;
  /** Accurate total job count (the `jobs` sample is capped at 500). */
  storedJobs?: () => number;
  now?: () => number;
}

/** Build the workforce `DiagnosticProbe` (fails soft to a `down` check on error). */
export function workforceProbe(deps: WorkforceProbeDeps): DiagnosticProbe {
  const now = deps.now ?? ((): number => Date.now());
  return () => {
    try {
      const s = workforceDiagnosticsSummary({
        workers: deps.workers(),
        health: deps.health(),
        jobs: deps.jobs(),
        queued: deps.queued(),
        storedJobs: deps.storedJobs?.(),
        nowMs: now(),
      });
      return makeCheck('workforce', 'AI Workforce', s.status, {
        detail: s.detail,
        recommendation: s.recommendation,
      });
    } catch (err) {
      return makeCheck('workforce', 'AI Workforce', 'down', {
        detail: err instanceof Error ? err.message : 'Workforce health unavailable',
        recommendation: 'The workforce runtime failed to report health; check the main-process logs.',
      });
    }
  };
}

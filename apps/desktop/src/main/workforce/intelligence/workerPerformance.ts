/**
 * Worker performance intelligence (V8.4 inc1) — the first workforce-intelligence
 * deriver.
 *
 * Folds the existing Job history (from the runtime's jobStore, the source of truth)
 * into per-worker performance metrics. It reads only what the runtime already
 * records per job — status, durationMs, grounded, timestamps — and computes nothing
 * the runtime didn't already observe. It does NOT duplicate workforceHealth (V8.1),
 * which aggregates the registry's live health; this derives throughput/latency/
 * outcome analytics from completed work, a dimension the health fold doesn't cover.
 *
 * Pure and I/O-free: the caller passes jobStore.page(...).jobs (or a filtered slice)
 * and this returns metrics. Unit-tests from synthetic jobs; touches no runtime state.
 */
import type { Job, JobStatus } from '@neuropause/shared';

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

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Per-worker performance, one entry per worker seen in the jobs, sorted by volume
 * (most active first). Deterministic.
 */
export function workerPerformance(jobs: readonly Job[]): WorkerPerformance[] {
  interface Acc {
    workerId: string;
    workerRole: string;
    total: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    inFlight: number;
    durations: number[];
    terminated: number;
    ungrounded: number;
    lastActiveAt: string | null;
  }

  const byWorker = new Map<string, Acc>();

  for (const job of jobs) {
    let acc = byWorker.get(job.workerId);
    if (!acc) {
      acc = {
        workerId: job.workerId,
        workerRole: job.workerRole,
        total: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        inFlight: 0,
        durations: [],
        terminated: 0,
        ungrounded: 0,
        lastActiveAt: null,
      };
      byWorker.set(job.workerId, acc);
    }
    // Keep the most recent role (jobs carry the role they ran under).
    acc.workerRole = job.workerRole;
    acc.total += 1;

    if (job.status === 'succeeded') acc.succeeded += 1;
    else if (job.status === 'failed') acc.failed += 1;
    else if (job.status === 'cancelled') acc.cancelled += 1;
    else acc.inFlight += 1;

    if (TERMINAL.has(job.status)) {
      acc.terminated += 1;
      if (typeof job.durationMs === 'number') acc.durations.push(job.durationMs);
      if (!job.grounded) acc.ungrounded += 1;
    }

    if (job.finishedAt && (!acc.lastActiveAt || job.finishedAt > acc.lastActiveAt)) {
      acc.lastActiveAt = job.finishedAt;
    }
  }

  const out: WorkerPerformance[] = [];
  for (const acc of byWorker.values()) {
    const decided = acc.succeeded + acc.failed;
    const avg =
      acc.durations.length > 0
        ? Math.round(acc.durations.reduce((s, d) => s + d, 0) / acc.durations.length)
        : null;
    out.push({
      workerId: acc.workerId,
      workerRole: acc.workerRole,
      total: acc.total,
      succeeded: acc.succeeded,
      failed: acc.failed,
      cancelled: acc.cancelled,
      inFlight: acc.inFlight,
      successRate: decided > 0 ? Number((acc.succeeded / decided).toFixed(4)) : 0,
      avgDurationMs: avg,
      p50DurationMs: median(acc.durations),
      ungroundedRate: acc.terminated > 0 ? Number((acc.ungrounded / acc.terminated).toFixed(4)) : 0,
      lastActiveAt: acc.lastActiveAt,
    });
  }

  out.sort((a, b) => b.total - a.total || (a.workerId < b.workerId ? -1 : 1));
  return out;
}

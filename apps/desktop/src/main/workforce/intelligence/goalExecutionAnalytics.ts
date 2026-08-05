/**
 * Goal execution analytics (V8.4 inc3). Pure derivation over the existing Job
 * history, grouped by the *work* being done — skill and role — rather than by
 * worker (that's inc1). Answers "which kinds of goals succeed, and how fast?"
 *
 * Reads only what the runtime records (status, durationMs, grounded). No I/O; the
 * caller passes jobStore.page(...).jobs. Does not duplicate workerPerformance
 * (per-worker) or workforceHealth (registry health) — this is the per-skill/role cut.
 */
import type {
  ExecutionStat,
  GoalExecutionAnalytics,
  Job,
  JobStatus,
} from '@neuropause/shared';

/**
 * A7 — both shapes cross the IPC boundary inside the `workforce:intelligence`
 * response, so they are declared once in @neuropause/shared. Re-exported here so
 * every existing `from './goalExecutionAnalytics'` import keeps resolving unchanged.
 */
export type { ExecutionStat, GoalExecutionAnalytics };

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);

interface Acc {
  key: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  durations: number[];
  terminated: number;
  ungrounded: number;
}

function emptyAcc(key: string): Acc {
  return { key, total: 0, succeeded: 0, failed: 0, cancelled: 0, inFlight: 0, durations: [], terminated: 0, ungrounded: 0 };
}

function fold(acc: Acc, job: Job): void {
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
}

function finalize(acc: Acc): ExecutionStat {
  const decided = acc.succeeded + acc.failed;
  const avg =
    acc.durations.length > 0 ? Math.round(acc.durations.reduce((s, d) => s + d, 0) / acc.durations.length) : null;
  return {
    key: acc.key,
    total: acc.total,
    succeeded: acc.succeeded,
    failed: acc.failed,
    cancelled: acc.cancelled,
    inFlight: acc.inFlight,
    successRate: decided > 0 ? Number((acc.succeeded / decided).toFixed(4)) : 0,
    avgDurationMs: avg,
    ungroundedRate: acc.terminated > 0 ? Number((acc.ungrounded / acc.terminated).toFixed(4)) : 0,
  };
}

function group(jobs: readonly Job[], keyOf: (j: Job) => string): ExecutionStat[] {
  const map = new Map<string, Acc>();
  for (const job of jobs) {
    const key = keyOf(job);
    let acc = map.get(key);
    if (!acc) {
      acc = emptyAcc(key);
      map.set(key, acc);
    }
    fold(acc, job);
  }
  const out = [...map.values()].map(finalize);
  out.sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1));
  return out;
}

export function goalExecutionAnalytics(jobs: readonly Job[]): GoalExecutionAnalytics {
  const totalsAcc = emptyAcc('all');
  for (const job of jobs) fold(totalsAcc, job);
  return {
    bySkill: group(jobs, (j) => j.skillId),
    byRole: group(jobs, (j) => j.workerRole),
    totals: finalize(totalsAcc),
  };
}

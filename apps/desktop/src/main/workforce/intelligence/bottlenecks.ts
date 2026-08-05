/**
 * Bottleneck detection (V8.4 inc4). Pure derivation that flags where the workforce
 * is struggling, from the existing Job history: workers/skills with high failure
 * rates, large in-flight backlogs, or slow throughput. Reuses the per-worker and
 * per-skill folds' notion of outcomes; adds no store and touches no runtime.
 *
 * A "bottleneck" is evidence-based and explainable — each carries the reason and
 * the numbers behind it, never a fabricated score.
 */
import type {
  Job,
  JobStatus,
  WorkforceBottleneck,
  WorkforceBottleneckKind,
  WorkforceBottleneckScope,
} from '@neuropause/shared';

/**
 * A7 — the bottleneck shape and its two unions cross the IPC boundary inside the
 * `workforce:intelligence` response, so they are declared once in
 * @neuropause/shared. They carry a `Workforce` prefix there because the package
 * already exports an unrelated `Bottleneck` (the enterprise-graph node); this
 * module keeps the short local spellings it has always used, so every existing
 * `from './bottlenecks'` import keeps resolving unchanged. `BottleneckOptions`
 * below stays local: it is a detector tuning input, never part of the wire
 * contract.
 */
export type BottleneckKind = WorkforceBottleneckKind;
export type BottleneckScope = WorkforceBottleneckScope;
export type Bottleneck = WorkforceBottleneck;

export interface BottleneckOptions {
  /** Failure-rate threshold to flag (over decided jobs). Default 0.4. */
  failureRateAbove?: number;
  /** In-flight count threshold to flag a backlog. Default 5. */
  backlogAtLeast?: number;
  /** Ungrounded-rate threshold to flag. Default 0.5. */
  ungroundedRateAbove?: number;
  /** Minimum decided jobs before a rate-based flag is trustworthy. Default 3. */
  minSample?: number;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);
const IN_FLIGHT: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'running', 'awaiting_approval']);

interface Acc {
  key: string;
  succeeded: number;
  failed: number;
  inFlight: number;
  terminated: number;
  ungrounded: number;
}

function accumulate(jobs: readonly Job[], keyOf: (j: Job) => string): Map<string, Acc> {
  const map = new Map<string, Acc>();
  for (const job of jobs) {
    const key = keyOf(job);
    let acc = map.get(key);
    if (!acc) {
      acc = { key, succeeded: 0, failed: 0, inFlight: 0, terminated: 0, ungrounded: 0 };
      map.set(key, acc);
    }
    if (job.status === 'succeeded') acc.succeeded += 1;
    else if (job.status === 'failed') acc.failed += 1;
    if (IN_FLIGHT.has(job.status)) acc.inFlight += 1;
    if (TERMINAL.has(job.status)) {
      acc.terminated += 1;
      if (!job.grounded) acc.ungrounded += 1;
    }
  }
  return map;
}

function flagsFor(scope: BottleneckScope, accs: Map<string, Acc>, o: Required<BottleneckOptions>): Bottleneck[] {
  const out: Bottleneck[] = [];
  for (const acc of accs.values()) {
    const decided = acc.succeeded + acc.failed;
    if (decided >= o.minSample) {
      const failureRate = acc.failed / decided;
      if (failureRate > o.failureRateAbove) {
        out.push({
          scope,
          key: acc.key,
          kind: 'high_failure',
          reason: `${Math.round(failureRate * 100)}% of ${decided} decided jobs failed`,
          value: Number(failureRate.toFixed(4)),
          sampleSize: decided,
        });
      }
    }
    if (acc.terminated >= o.minSample) {
      const ungroundedRate = acc.ungrounded / acc.terminated;
      if (ungroundedRate > o.ungroundedRateAbove) {
        out.push({
          scope,
          key: acc.key,
          kind: 'ungrounded',
          reason: `${Math.round(ungroundedRate * 100)}% of ${acc.terminated} jobs ran without connected data`,
          value: Number(ungroundedRate.toFixed(4)),
          sampleSize: acc.terminated,
        });
      }
    }
    if (acc.inFlight >= o.backlogAtLeast) {
      out.push({
        scope,
        key: acc.key,
        kind: 'backlog',
        reason: `${acc.inFlight} jobs queued or running`,
        value: acc.inFlight,
        sampleSize: acc.inFlight,
      });
    }
  }
  return out;
}

export function detectBottlenecks(jobs: readonly Job[], options: BottleneckOptions = {}): Bottleneck[] {
  const o: Required<BottleneckOptions> = {
    failureRateAbove: options.failureRateAbove ?? 0.4,
    backlogAtLeast: options.backlogAtLeast ?? 5,
    ungroundedRateAbove: options.ungroundedRateAbove ?? 0.5,
    minSample: Math.max(1, options.minSample ?? 3),
  };

  const flags = [
    ...flagsFor('worker', accumulate(jobs, (j) => j.workerId), o),
    ...flagsFor('skill', accumulate(jobs, (j) => j.skillId), o),
  ];

  // Worst first: higher metric value, then stable by scope/key/kind.
  flags.sort(
    (a, b) =>
      b.value - a.value ||
      (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  return flags;
}

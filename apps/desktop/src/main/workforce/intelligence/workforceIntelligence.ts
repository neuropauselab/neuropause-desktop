/**
 * Workforce intelligence summary (V8.4 inc5). A pure roll-up that composes the
 * existing derivers — worker performance (inc1), goal execution analytics (inc3),
 * and bottleneck detection (inc4) — into one executive-level snapshot of the
 * workforce, derived entirely from the existing Job history.
 *
 * Composes; it does not re-implement. No I/O, no new metrics beyond aggregation of
 * the derivers' outputs. This is the shape a workforce dashboard / Executive Center
 * KPI reads from.
 */
import type { Job, WorkforceIntelligence } from '@neuropause/shared';
import { workerPerformance } from './workerPerformance';
import { goalExecutionAnalytics } from './goalExecutionAnalytics';
import { detectBottlenecks, type BottleneckOptions } from './bottlenecks';

/**
 * A7 — this is the `workforce:intelligence` IPC response body, so its declaration
 * now lives once in @neuropause/shared and is consumed by both the producer (below)
 * and the renderer. Re-exported here so every existing
 * `from './workforceIntelligence'` import keeps resolving unchanged.
 */
export type { WorkforceIntelligence };

export interface WorkforceIntelligenceOptions {
  bottlenecks?: BottleneckOptions;
}

export function workforceIntelligence(
  jobs: readonly Job[],
  options: WorkforceIntelligenceOptions = {},
): WorkforceIntelligence {
  const workers = workerPerformance(jobs);
  const execution = goalExecutionAnalytics(jobs);
  const bottlenecks = detectBottlenecks(jobs, options.bottlenecks);

  const inFlight = workers.reduce((s, w) => s + w.inFlight, 0);

  return {
    totalJobs: jobs.length,
    activeWorkers: workers.length,
    overallSuccessRate: execution.totals.successRate,
    inFlight,
    workers,
    execution,
    bottlenecks,
    busiestWorkerId: workers.length > 0 ? workers[0].workerId : null,
  };
}

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
import type { Job } from '@neuropause/shared';
import { workerPerformance, type WorkerPerformance } from './workerPerformance';
import { goalExecutionAnalytics, type GoalExecutionAnalytics } from './goalExecutionAnalytics';
import { detectBottlenecks, type Bottleneck, type BottleneckOptions } from './bottlenecks';

export interface WorkforceIntelligence {
  totalJobs: number;
  activeWorkers: number;
  /** succeeded / (succeeded + failed) across all jobs; 0 when none decided. */
  overallSuccessRate: number;
  inFlight: number;
  /** Top workers by volume (already sorted by the deriver). */
  workers: WorkerPerformance[];
  execution: GoalExecutionAnalytics;
  bottlenecks: Bottleneck[];
  /** The single most active worker, if any. */
  busiestWorkerId: string | null;
}

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

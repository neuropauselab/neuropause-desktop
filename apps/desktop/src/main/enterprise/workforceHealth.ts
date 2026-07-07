/**
 * Workforce health aggregation (V8.1).
 *
 * A pure fold over the worker registry's existing per-worker health into one
 * workforce-level summary for the Executive Center. It introduces NO new
 * intelligence and NO new source of truth — it aggregates what the registry
 * already computes, and reuses the registry's own thresholds (successRate < 0.5 →
 * unhealthy, < 0.8 → degraded) so the rolled-up band never disagrees with the
 * per-worker states it summarizes.
 *
 * It reads only the `health` fields it needs, via WorkerHealthLike; the registry's
 * `WorkerSummary` satisfies that structurally, so `registry.summaries()` is passed
 * directly at the call site while this module stays decoupled from the full shape.
 * Pure and Electron-free, so it unit-tests in isolation.
 */
import type { WorkerHealthState, WorkforceHealthState, WorkforceHealthSummary } from '@neuropause/shared';

/** The subset of a worker this aggregation reads. WorkerSummary satisfies it. */
export interface WorkerHealthLike {
  health: {
    state: WorkerHealthState;
    successRate: number; // 0..1
    jobsRun: number;
    jobsFailed: number;
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Registry thresholds (mirror of workerRegistry.ts:152-153), applied to the fleet mean. */
const DEGRADED_BELOW = 0.8;
const UNHEALTHY_BELOW = 0.5;

/**
 * Aggregate per-worker health into a workforce-level summary. `meanSuccessRate`
 * averages only workers that have actually run jobs, so idle (never-run) workers
 * don't dilute the signal toward a misleading 100%.
 */
export function summarizeWorkforceHealth(
  workers: readonly WorkerHealthLike[],
): WorkforceHealthSummary {
  let healthy = 0;
  let degraded = 0;
  let unhealthy = 0;
  let unknown = 0;
  let totalJobsRun = 0;
  let totalJobsFailed = 0;
  let successSum = 0;
  let successCounted = 0;

  for (const w of workers) {
    const h = w.health;
    switch (h.state) {
      case 'healthy':
        healthy += 1;
        break;
      case 'degraded':
        degraded += 1;
        break;
      case 'unhealthy':
        unhealthy += 1;
        break;
      default:
        unknown += 1;
        break;
    }
    totalJobsRun += h.jobsRun;
    totalJobsFailed += h.jobsFailed;
    if (h.jobsRun > 0) {
      successSum += h.successRate;
      successCounted += 1;
    }
  }

  const meanSuccessRate = successCounted > 0 ? round3(successSum / successCounted) : 1;
  const state = rollUpState({
    total: workers.length,
    unhealthy,
    degraded,
    meanSuccessRate,
    hasActive: successCounted > 0,
  });

  return {
    totalWorkers: workers.length,
    healthy,
    degraded,
    unhealthy,
    unknown,
    meanSuccessRate,
    totalJobsRun,
    totalJobsFailed,
    state,
  };
}

function rollUpState(x: {
  total: number;
  unhealthy: number;
  degraded: number;
  meanSuccessRate: number;
  hasActive: boolean;
}): WorkforceHealthState {
  if (x.total === 0) return 'unknown';
  if (x.unhealthy > 0 || (x.hasActive && x.meanSuccessRate < UNHEALTHY_BELOW)) return 'unhealthy';
  if (x.degraded > 0 || (x.hasActive && x.meanSuccessRate < DEGRADED_BELOW)) return 'degraded';
  return 'healthy';
}

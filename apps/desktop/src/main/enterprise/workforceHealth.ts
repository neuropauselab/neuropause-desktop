/**
 * Workforce health aggregation (V8.1).
 *
 * A pure fold over the worker registry's existing per-worker health into one
 * workforce-level summary for the Executive Center. Introduces NO new intelligence
 * and NO new source of truth — it aggregates the health fields the registry already
 * computes (exposed via WorkerRegistry.healthSummaries()), and reuses the
 * registry's own thresholds (successRate < 0.5 → unhealthy, < 0.8 → degraded) so
 * the rolled-up band never disagrees with the per-worker states it summarizes.
 *
 * Pure and Electron-free, so it unit-tests in isolation and can be called from the
 * Executive Center composer without pulling in the registry singleton.
 */
import type {
  ExecutiveKpi,
  WorkforceHealthInput,
  WorkforceHealthState,
  WorkforceHealthSummary,
} from '@neuropause/shared';

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
  workers: readonly WorkforceHealthInput[],
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
    switch (w.state) {
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
    totalJobsRun += w.jobsRun;
    totalJobsFailed += w.jobsFailed;
    if (w.jobsRun > 0) {
      successSum += w.successRate;
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

/** Band a WorkforceHealthState onto the ExecutiveKpi band vocabulary. Presentation-only. */
export function workforceHealthBand(
  state: WorkforceHealthState,
): 'healthy' | 'watch' | 'at-risk' | 'critical' {
  switch (state) {
    case 'healthy':
      return 'healthy';
    case 'degraded':
      return 'watch';
    case 'unhealthy':
      return 'critical';
    default:
      return 'watch';
  }
}

/** Build the Workforce Health KPI for the Executive Center strip (V8.1). */
export function workforceHealthKpi(summary: WorkforceHealthSummary): ExecutiveKpi {
  const pct = Math.round(summary.meanSuccessRate * 100);
  return {
    key: 'workforce-health',
    label: 'AI Workforce',
    value: pct,
    display:
      summary.totalWorkers === 0
        ? 'No workers'
        : `${summary.healthy}/${summary.totalWorkers} healthy · ${pct}%`,
    band: workforceHealthBand(summary.state),
    deepLink: 'ai-workforce',
  };
}

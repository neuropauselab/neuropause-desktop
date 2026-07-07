/**
 * Workforce performance KPI (V8.4 inc2). Projects the workforce intelligence
 * summary into the existing ExecutiveKpi shape, mirroring workforceHealthKpi so it
 * plugs into the Executive Center's existing KPI path — no parallel surface.
 *
 * Pure: takes the summary (from workforceIntelligence) and returns one ExecutiveKpi.
 */
import type { ExecutiveKpi } from '@neuropause/shared';
import type { WorkforceIntelligence } from './workforceIntelligence';

export function workforcePerformanceKpi(wi: WorkforceIntelligence): ExecutiveKpi {
  const pct = Math.round(wi.overallSuccessRate * 100);
  const hasBottleneck = wi.bottlenecks.length > 0;

  const band: ExecutiveKpi['band'] =
    wi.totalJobs === 0 ? 'watch' : hasBottleneck ? 'at-risk' : pct >= 80 ? 'healthy' : pct >= 50 ? 'watch' : 'critical';

  return {
    key: 'workforce-performance',
    label: 'Workforce Output',
    value: wi.totalJobs === 0 ? null : pct,
    display:
      wi.totalJobs === 0
        ? 'No jobs yet'
        : `${wi.totalJobs} jobs · ${pct}% success${hasBottleneck ? ` · ${wi.bottlenecks.length} bottleneck${wi.bottlenecks.length === 1 ? '' : 's'}` : ''}`,
    band,
    deepLink: 'ai-workforce',
  };
}

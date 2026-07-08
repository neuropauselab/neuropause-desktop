/**
 * Enterprise insights KPI (V8.5 inc1). Projects the enterprise insights snapshot
 * into the existing ExecutiveKpi shape so it plugs into the Executive Center's
 * existing KPI strip — no parallel surface. Pure.
 */
import type { ExecutiveKpi } from '@neuropause/shared';
import type { EnterpriseInsights } from './enterpriseInsights';

const BAND_TO_KPI: Record<EnterpriseInsights['band'], NonNullable<ExecutiveKpi['band']>> = {
  healthy: 'healthy',
  watch: 'watch',
  'at-risk': 'at-risk',
  critical: 'critical',
};

export function enterpriseInsightsKpi(insights: EnterpriseInsights): ExecutiveKpi {
  const hasSignal = insights.memoryTotal > 0 || insights.knowledgeTopics > 0 || insights.workforceJobs > 0;
  return {
    key: 'enterprise-intelligence',
    label: 'Enterprise Intelligence',
    value: hasSignal ? insights.knowledgeCoveragePercent : null,
    display: hasSignal ? insights.headline : 'No signals yet',
    band: BAND_TO_KPI[insights.band],
    deepLink: 'executive',
  };
}

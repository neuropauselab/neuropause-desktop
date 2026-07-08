import { describe, expect, it } from 'vitest';
import { enterpriseInsightsKpi } from './enterpriseKpi';
import { enterpriseInsights } from './enterpriseInsights';

describe('enterpriseInsightsKpi', () => {
  it('projects a populated snapshot into an ExecutiveKpi', () => {
    const kpi = enterpriseInsightsKpi(
      enterpriseInsights({
        knowledge: { totalMemories: 10, topicCount: 3, memoriesInTopics: 8, orphanCount: 2, coveragePercent: 75 },
        memory: { total: 10, byKind: { note: 10 }, lastBuiltAt: null },
        workforce: { totalJobs: 5, activeWorkers: 2, overallSuccessRate: 1, bottlenecks: [] },
      }),
    );
    expect(kpi).toMatchObject({ key: 'enterprise-intelligence', label: 'Enterprise Intelligence', value: 75, band: 'healthy', deepLink: 'executive' });
    expect(kpi.display).toContain('memories');
  });

  it('empty snapshot → null value, no signals', () => {
    const kpi = enterpriseInsightsKpi(enterpriseInsights({}));
    expect(kpi).toMatchObject({ value: null, display: 'No signals yet' });
  });
});

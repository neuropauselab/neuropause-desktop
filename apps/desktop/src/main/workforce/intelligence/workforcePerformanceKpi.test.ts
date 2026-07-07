import { describe, expect, it } from 'vitest';
import { workforcePerformanceKpi } from './workforcePerformanceKpi';
import { workforceIntelligence } from './workforceIntelligence';
import { job } from './_jobFixture';

describe('workforcePerformanceKpi', () => {
  it('projects a healthy summary into an ExecutiveKpi', () => {
    const wi = workforceIntelligence([
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
    ]);
    const kpi = workforcePerformanceKpi(wi);
    expect(kpi).toMatchObject({ key: 'workforce-performance', label: 'Workforce Output', value: 100, band: 'healthy', deepLink: 'ai-workforce' });
    expect(kpi.display).toContain('jobs');
  });

  it('is at-risk when a bottleneck exists', () => {
    const wi = workforceIntelligence([
      job({ workerId: 'flaky', status: 'failed' }),
      job({ workerId: 'flaky', status: 'failed' }),
      job({ workerId: 'flaky', status: 'succeeded' }),
    ]);
    const kpi = workforcePerformanceKpi(wi);
    expect(kpi.band).toBe('at-risk');
    expect(kpi.display).toContain('bottleneck');
  });

  it('handles the empty workforce (null value, no jobs)', () => {
    const kpi = workforcePerformanceKpi(workforceIntelligence([]));
    expect(kpi).toMatchObject({ value: null, band: 'watch' });
    expect(kpi.display).toBe('No jobs yet');
  });
});

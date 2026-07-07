import { describe, expect, it } from 'vitest';
import { workforceIntelligence } from './workforceIntelligence';
import { job } from './_jobFixture';

describe('workforceIntelligence', () => {
  it('composes performance, analytics, and bottlenecks into one snapshot', () => {
    const jobs = [
      job({ workerId: 'w1', skillId: 's1', status: 'succeeded' }),
      job({ workerId: 'w1', skillId: 's1', status: 'succeeded' }),
      job({ workerId: 'w2', skillId: 's2', status: 'failed' }),
      job({ workerId: 'w2', skillId: 's2', status: 'running' }),
    ];
    const wi = workforceIntelligence(jobs);
    expect(wi.totalJobs).toBe(4);
    expect(wi.activeWorkers).toBe(2);
    expect(wi.busiestWorkerId).toBe('w1'); // most jobs
    expect(wi.inFlight).toBe(1);
    expect(wi.overallSuccessRate).toBe(0.6667); // 2 of 3 decided
    expect(wi.workers).toHaveLength(2);
    expect(wi.execution.bySkill.length).toBe(2);
  });

  it('empty workforce → zeroed snapshot', () => {
    const wi = workforceIntelligence([]);
    expect(wi).toMatchObject({ totalJobs: 0, activeWorkers: 0, inFlight: 0, busiestWorkerId: null });
    expect(wi.workers).toEqual([]);
    expect(wi.bottlenecks).toEqual([]);
  });
});

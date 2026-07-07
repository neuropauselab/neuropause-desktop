import { describe, expect, it } from 'vitest';
import { goalExecutionAnalytics } from './goalExecutionAnalytics';
import { job } from './_jobFixture';

describe('goalExecutionAnalytics', () => {
  it('groups by skill and by role with totals', () => {
    const a = goalExecutionAnalytics([
      job({ workerId: 'w1', skillId: 'summarize', workerRole: 'research', status: 'succeeded' }),
      job({ workerId: 'w2', skillId: 'summarize', workerRole: 'research', status: 'failed' }),
      job({ workerId: 'w3', skillId: 'draft', workerRole: 'marketing', status: 'succeeded' }),
    ]);
    expect(a.bySkill.map((s) => s.key)).toEqual(['summarize', 'draft']); // summarize has more
    expect(a.byRole.map((r) => r.key)).toEqual(['research', 'marketing']);
    expect(a.totals.total).toBe(3);
    expect(a.totals.successRate).toBe(0.6667); // 2/(2+1)
  });

  it('per-skill success rate ignores in-flight', () => {
    const a = goalExecutionAnalytics([
      job({ workerId: 'w', skillId: 's', status: 'succeeded' }),
      job({ workerId: 'w', skillId: 's', status: 'running' }),
    ]);
    expect(a.bySkill[0].successRate).toBe(1); // 1/(1+0)
    expect(a.bySkill[0].inFlight).toBe(1);
  });

  it('empty → empty groups, zeroed totals', () => {
    const a = goalExecutionAnalytics([]);
    expect(a.bySkill).toEqual([]);
    expect(a.byRole).toEqual([]);
    expect(a.totals).toMatchObject({ total: 0, successRate: 0, avgDurationMs: null });
  });
});

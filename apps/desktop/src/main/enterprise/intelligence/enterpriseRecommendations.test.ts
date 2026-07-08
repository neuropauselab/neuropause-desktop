import { describe, expect, it } from 'vitest';
import { enterpriseRecommendations } from './enterpriseRecommendations';
import { enterpriseInsights } from './enterpriseInsights';

describe('enterpriseRecommendations', () => {
  it('produces no recommendations for a healthy enterprise', () => {
    const recs = enterpriseRecommendations(
      enterpriseInsights({
        knowledge: { totalMemories: 10, topicCount: 3, memoriesInTopics: 9, orphanCount: 1, coveragePercent: 90 },
        workforce: { totalJobs: 10, activeWorkers: 3, overallSuccessRate: 0.95, bottlenecks: [] },
      }),
    );
    expect(recs).toEqual([]);
  });

  it('flags a knowledge gap when coverage is low', () => {
    const recs = enterpriseRecommendations(
      enterpriseInsights({
        knowledge: { totalMemories: 20, topicCount: 2, memoriesInTopics: 3, orphanCount: 17, coveragePercent: 15 },
      }),
    );
    const gap = recs.find((r) => r.id === 'enterprise-knowledge-gap');
    expect(gap).toBeTruthy();
    expect(gap?.priority).toBe('high'); // 15% < 20 → high
    expect(gap?.sourceSystems).toContain('knowledge');
    expect(gap?.evidence.some((e) => e.includes('orphaned'))).toBe(true);
  });

  it('flags a workforce bottleneck', () => {
    const recs = enterpriseRecommendations(
      enterpriseInsights({
        workforce: { totalJobs: 10, activeWorkers: 2, overallSuccessRate: 0.9, bottlenecks: [{}, {}, {}] },
      }),
    );
    const b = recs.find((r) => r.id === 'enterprise-workforce-bottleneck');
    expect(b).toBeTruthy();
    expect(b?.priority).toBe('high'); // >=3 bottlenecks
  });

  it('flags low workforce success only when there is no bottleneck already flagged', () => {
    const recs = enterpriseRecommendations(
      enterpriseInsights({
        workforce: { totalJobs: 10, activeWorkers: 2, overallSuccessRate: 0.3, bottlenecks: [] },
      }),
    );
    expect(recs.find((r) => r.id === 'enterprise-workforce-success')).toBeTruthy();
  });

  it('emits valid ExecutiveRecommendation shape and ranks by priority', () => {
    const recs = enterpriseRecommendations(
      enterpriseInsights({
        knowledge: { totalMemories: 20, topicCount: 2, memoriesInTopics: 5, orphanCount: 15, coveragePercent: 25 },
        workforce: { totalJobs: 10, activeWorkers: 2, overallSuccessRate: 0.9, bottlenecks: [{}, {}, {}] },
      }),
    );
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const r of recs) {
      expect(r).toHaveProperty('recommendedAction');
      expect(r).toHaveProperty('owner');
      expect(Array.isArray(r.sourceSystems)).toBe(true);
      expect(r.confidence).toBeGreaterThan(0);
    }
    // high before medium
    const prio = recs.map((r) => r.priority);
    expect(prio.indexOf('high')).toBeLessThanOrEqual(prio.lastIndexOf('medium') === -1 ? Infinity : prio.indexOf('medium'));
  });
});

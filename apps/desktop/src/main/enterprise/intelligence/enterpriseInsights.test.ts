import { describe, expect, it } from 'vitest';
import { enterpriseInsights } from './enterpriseInsights';

describe('enterpriseInsights', () => {
  it('folds all three signals into one snapshot', () => {
    const e = enterpriseInsights({
      knowledge: { totalMemories: 10, topicCount: 3, memoriesInTopics: 8, orphanCount: 2, coveragePercent: 80 },
      memory: { total: 10, byKind: { note: 6, task: 4 }, lastBuiltAt: '2026-01-01T00:00:00Z' },
      workforce: { totalJobs: 20, activeWorkers: 4, overallSuccessRate: 0.9, bottlenecks: [] },
    });
    expect(e.memoryTotal).toBe(10);
    expect(e.memoryKinds).toBe(2);
    expect(e.knowledgeTopics).toBe(3);
    expect(e.knowledgeCoveragePercent).toBe(80);
    expect(e.workforceSuccessPercent).toBe(90);
    expect(e.band).toBe('healthy');
    expect(e.headline).toContain('memories');
  });

  it('absent signals do not drag the band down', () => {
    const e = enterpriseInsights({ memory: { total: 5, byKind: { note: 5 }, lastBuiltAt: null } });
    expect(e.band).toBe('healthy'); // only memory present, nothing unhealthy
    expect(e.workforceJobs).toBe(0);
    expect(e.knowledgeTopics).toBe(0);
  });

  it('a workforce bottleneck moves the band to at-risk', () => {
    const e = enterpriseInsights({
      workforce: { totalJobs: 10, activeWorkers: 2, overallSuccessRate: 0.9, bottlenecks: [{}] },
    });
    expect(e.band).toBe('at-risk');
    expect(e.workforceBottlenecks).toBe(1);
  });

  it('low knowledge coverage moves the band to watch/at-risk', () => {
    const e = enterpriseInsights({
      knowledge: { totalMemories: 10, topicCount: 1, memoriesInTopics: 2, orphanCount: 8, coveragePercent: 20 },
    });
    expect(e.band).toBe('at-risk'); // 20% coverage
  });

  it('low workforce success is critical', () => {
    const e = enterpriseInsights({
      workforce: { totalJobs: 10, activeWorkers: 2, overallSuccessRate: 0.3, bottlenecks: [] },
    });
    expect(e.band).toBe('critical'); // 30% success, no bottleneck but failing
  });

  it('empty input → healthy with a no-signals headline', () => {
    const e = enterpriseInsights({});
    expect(e).toMatchObject({ band: 'healthy', memoryTotal: 0, workforceJobs: 0 });
    expect(e.headline).toBe('No enterprise signals yet');
  });
});

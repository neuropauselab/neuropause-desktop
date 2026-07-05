import { describe, expect, it } from 'vitest';
import type { ExecutiveCenterSnapshot, IntelligenceItem } from '@neuropause/shared';
import { buildExecutiveRecommendations, buildExecutiveSummary } from './executiveRecommendations';

function baseSnapshot(over: Partial<ExecutiveCenterSnapshot> = {}): ExecutiveCenterSnapshot {
  const base: ExecutiveCenterSnapshot = {
    generatedAt: new Date().toISOString(),
    kpis: [],
    orgHealth: {
      activity: 90,
      adoption: 85,
      engineering: 94,
      reliability: 90,
      aiUsage: 80,
      connectorHealth: 100,
      licenseHealth: 100,
      security: 90,
      operational: 90,
      overall: 91,
    },
    criticalAlerts: {
      key: 'critical-alerts',
      title: 'Critical Alerts',
      items: [],
      deepLink: 'notifications',
    },
    founderRecommendations: {
      key: 'founder-recommendations',
      title: 'Founder',
      items: [],
      deepLink: 'ai-workforce/founder',
    },
    organizationHealth: {
      key: 'organization-health',
      title: 'Org',
      items: [],
      deepLink: 'enterprise/organization',
    },
    engineeringHealth: {
      key: 'engineering-health',
      title: 'Eng',
      items: [],
      deepLink: 'ai-workforce/engineering',
    },
    upcomingPriorities: {
      key: 'upcoming-priorities',
      title: 'Upcoming',
      items: [],
      deepLink: 'enterprise/briefings',
    },
    attentionCounts: { critical: 0, high: 0, normal: 0 },
  };
  return { ...base, ...over };
}

describe('buildExecutiveRecommendations', () => {
  it('a fully healthy org yields no KPI recommendations', () => {
    const recs = buildExecutiveRecommendations(baseSnapshot());
    expect(recs).toHaveLength(0);
  });

  it('a weak KPI produces a recommendation with full decision fields', () => {
    const snap = baseSnapshot({
      orgHealth: { ...baseSnapshot().orgHealth, engineering: 35, overall: 55 },
    });
    const recs = buildExecutiveRecommendations(snap);
    const eng = recs.find((r) => r.metric === 'engineering');
    expect(eng).toBeDefined();
    expect(eng!.priority).toBe('critical'); // <40 → critical
    expect(eng!.businessImpact).toBeTruthy();
    expect(eng!.rootCause).toBeTruthy();
    expect(eng!.recommendedAction).toBeTruthy();
    expect(eng!.owner).toBe('Engineering Lead');
    expect(eng!.evidence.length).toBeGreaterThan(0);
    expect(eng!.confidence).toBeGreaterThan(0);
  });

  it('bands map score → priority correctly', () => {
    const mk = (engineering: number) =>
      buildExecutiveRecommendations(
        baseSnapshot({ orgHealth: { ...baseSnapshot().orgHealth, engineering } }),
      ).find((r) => r.metric === 'engineering');
    expect(mk(35)!.priority).toBe('critical');
    expect(mk(50)!.priority).toBe('high');
    expect(mk(70)!.priority).toBe('medium');
    expect(mk(85)).toBeUndefined(); // healthy → no rec
  });

  it('ranks critical above medium by composite score', () => {
    const snap = baseSnapshot({
      orgHealth: { ...baseSnapshot().orgHealth, engineering: 35, adoption: 70 },
    });
    const recs = buildExecutiveRecommendations(snap);
    expect(recs[0].priority).toBe('critical');
    expect(recs[0].score).toBeGreaterThan(recs[recs.length - 1].score);
  });

  it('surfaces governance-critical alerts as recommendations with their evidence', () => {
    const alert: IntelligenceItem = {
      id: 'org:license:invalid',
      title: 'License is invalid',
      body: 'b',
      priority: 'critical',
      producedAt: new Date().toISOString(),
      governance: {
        evidence: ['license.valid=false'],
        sourceSystems: ['licensing'],
        confidence: 0.95,
        reasoning: 'License did not validate.',
        recommendedAction: 'Renew the license.',
      },
    };
    const snap = baseSnapshot({
      criticalAlerts: {
        key: 'critical-alerts',
        title: 'Critical',
        items: [alert],
        deepLink: 'notifications',
      },
    });
    const recs = buildExecutiveRecommendations(snap);
    const gov = recs.find((r) => r.id.startsWith('rec:alert:'));
    expect(gov).toBeDefined();
    expect(gov!.priority).toBe('critical');
    expect(gov!.evidence).toContain('license.valid=false');
    expect(gov!.recommendedAction).toBe('Renew the license.');
  });

  it('incorporates a declining monthly trend into the problem + score', () => {
    const snap = baseSnapshot({
      orgHealth: { ...baseSnapshot().orgHealth, engineering: 55 },
      monthlyTrends: [
        {
          key: 'engineering',
          label: 'Engineering Health',
          current: 55,
          monthAgo: 75,
          delta: -20,
          percentChange: -27,
          direction: 'down',
          movingAverage: 65,
          highest: 75,
          lowest: 55,
          stability: 'volatile',
          sparkline: [75, 70, 60, 55],
          confidence: 'high',
        },
      ],
    });
    const recs = buildExecutiveRecommendations(snap);
    const eng = recs.find((r) => r.metric === 'engineering')!;
    expect(eng.problem).toContain('declining');
    expect(eng.confidence).toBe(0.9); // high monthly confidence
  });
});

describe('buildExecutiveSummary', () => {
  it('produces a summary with an executive score tempered by criticals', () => {
    const snap = baseSnapshot({
      orgHealth: { ...baseSnapshot().orgHealth, engineering: 35, overall: 60 },
    });
    const recs = buildExecutiveRecommendations(snap);
    const sum = buildExecutiveSummary(snap, recs);
    expect(sum.topRecommendation).toBeTruthy();
    expect(sum.topRisk).toBeTruthy();
    // one critical (engineering=35) → 60 - 8 = 52
    expect(sum.executiveScore).toBe(52);
  });

  it('healthy org summary has no material risk and full score', () => {
    const snap = baseSnapshot();
    const sum = buildExecutiveSummary(snap, buildExecutiveRecommendations(snap));
    expect(sum.topRisk).toBe('No material risks detected');
    expect(sum.executiveScore).toBe(91);
  });

  it('reports top win/loss from monthly trends', () => {
    const snap = baseSnapshot({
      monthlyTrends: [
        {
          key: 'overall',
          label: 'Organization Health',
          current: 90,
          monthAgo: 80,
          delta: 10,
          percentChange: 12,
          direction: 'up',
          movingAverage: 85,
          highest: 90,
          lowest: 80,
          stability: 'stable',
          sparkline: [80, 85, 90],
          confidence: 'high',
        },
      ],
    });
    const sum = buildExecutiveSummary(snap, buildExecutiveRecommendations(snap));
    expect(sum.topWin).toContain('up 12%');
  });
});

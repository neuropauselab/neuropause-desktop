import { describe, expect, it } from 'vitest';
import type { IntelligenceItem, OrgHealthInputs } from '@neuropause/shared';
import { composeExecutiveSnapshot, type ExecutiveCenterSources } from './executiveCenter';

function item(
  id: string,
  priority: IntelligenceItem['priority'],
  sourceSystems: string[] = [],
): IntelligenceItem {
  return {
    id,
    title: id,
    body: 'b',
    priority,
    producedAt: new Date().toISOString(),
    governance: {
      evidence: ['e'],
      sourceSystems,
      confidence: 0.8,
      reasoning: 'r',
      recommendedAction: 'a',
    },
  };
}

const healthyInputs: OrgHealthInputs = {
  connectorsTotal: 3,
  connectorsHealthy: 3,
  connectorsError: 0,
  licenseValid: true,
  licenseDaysToExpiry: 200,
  memberCount: 4,
  activeMemberCount: 4,
  workspaceCount: 2,
  recentEventCount: 60,
  aiSourcesUsed: 5,
  engineeringHealth01: 0.9,
  syncFailures: 0,
  executiveActiveRecently: true,
};

function sources(over: Partial<ExecutiveCenterSources> = {}): ExecutiveCenterSources {
  return {
    now: () => new Date(2026, 0, 5, 9, 0, 0),
    founderItems: () => [],
    orgItems: () => [],
    orgHealthInputs: () => healthyInputs,
    ...over,
  };
}

describe('composeExecutiveSnapshot', () => {
  it('produces all sections and a KPI strip', () => {
    const snap = composeExecutiveSnapshot(sources());
    expect(snap.kpis.length).toBeGreaterThanOrEqual(6);
    expect(snap.criticalAlerts).toBeDefined();
    expect(snap.founderRecommendations).toBeDefined();
    expect(snap.organizationHealth).toBeDefined();
    expect(snap.engineeringHealth).toBeDefined();
    expect(snap.upcomingPriorities).toBeDefined();
  });

  it('reuses the org-health calculation for KPIs (healthy org scores high)', () => {
    const snap = composeExecutiveSnapshot(sources());
    const orgKpi = snap.kpis.find((k) => k.key === 'org-health');
    expect(orgKpi!.value).toBeGreaterThanOrEqual(80);
    expect(orgKpi!.band).toBe('healthy');
    expect(orgKpi!.deepLink).toBe('enterprise/organization');
  });

  it('every KPI carries a deep-link (drill-down, no duplicated views)', () => {
    const snap = composeExecutiveSnapshot(sources());
    for (const k of snap.kpis) {
      // active-members has a deep link too; all KPIs should route somewhere useful
      expect(k.deepLink).toBeTruthy();
    }
  });

  it('aggregates critical items from founder + org into Critical Alerts (deduped)', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        founderItems: () => [
          item('founder-proactive:x', 'critical'),
          item('shared-id', 'critical'),
        ],
        orgItems: () => [item('org:license:invalid', 'critical'), item('shared-id', 'critical')],
      }),
    );
    // 3 unique criticals (founder x, org license, shared-id once)
    expect(snap.criticalAlerts.items).toHaveLength(3);
    expect(snap.attentionCounts.critical).toBeGreaterThanOrEqual(3);
  });

  it('routes engineering-flavored items into the Engineering card', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        orgItems: () => [item('org:engineering:declining', 'high', ['engineering'])],
      }),
    );
    expect(snap.engineeringHealth.items.map((i) => i.id)).toContain('org:engineering:declining');
  });

  it('puts high-priority items into Upcoming Priorities', () => {
    const snap = composeExecutiveSnapshot(
      sources({ founderItems: () => [item('founder-proactive:deadline', 'high')] }),
    );
    expect(snap.upcomingPriorities.items.map((i) => i.id)).toContain('founder-proactive:deadline');
  });

  it('shows a friendly summary when there are no critical alerts', () => {
    const snap = composeExecutiveSnapshot(sources());
    expect(snap.criticalAlerts.summary).toBe('No critical alerts');
  });

  it('every card deep-links to an existing page', () => {
    const snap = composeExecutiveSnapshot(sources());
    expect(snap.founderRecommendations.deepLink).toBe('ai-workforce/founder');
    expect(snap.organizationHealth.deepLink).toBe('enterprise/organization');
    expect(snap.criticalAlerts.deepLink).toBe('notifications');
    expect(snap.upcomingPriorities.deepLink).toBe('enterprise/briefings');
  });

  // ── V2.9 completion cards ──
  it('builds an Executive Timeline from recent timeline entries', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        timelineEntries: () => [
          {
            id: 'e1',
            at: new Date().toISOString(),
            kind: 'commit',
            category: 'engineering',
            title: 'Merged PR #42',
            summary: null,
          },
          {
            id: 'e2',
            at: new Date().toISOString(),
            kind: 'doc',
            category: 'ops',
            title: 'Updated runbook',
            summary: 'ops notes',
          },
        ],
      }),
    );
    expect(snap.executiveTimeline?.items).toHaveLength(2);
    expect(snap.executiveTimeline?.items[0].title).toBe('Merged PR #42');
    expect(snap.executiveTimeline?.deepLink).toBe('enterprise/organization');
  });

  it('routes delivery-flavored entries into Recent Deliveries', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        timelineEntries: () => [
          {
            id: 'd1',
            at: new Date().toISOString(),
            kind: 'deploy',
            category: 'release',
            title: 'Deployed v1.2',
            summary: null,
          },
          {
            id: 'n1',
            at: new Date().toISOString(),
            kind: 'note',
            category: 'misc',
            title: 'Random note',
            summary: null,
          },
        ],
      }),
    );
    const titles = snap.recentDeliveries?.items.map((i) => i.title) ?? [];
    expect(titles).toContain('Deployed v1.2');
    expect(titles).not.toContain('Random note');
  });

  it('routes decision-flavored entries into Recent Decisions', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        timelineEntries: () => [
          {
            id: 'x1',
            at: new Date().toISOString(),
            kind: 'decision',
            category: 'governance',
            title: 'Approved Q3 budget',
            summary: null,
          },
        ],
      }),
    );
    expect(snap.recentDecisions?.items.map((i) => i.title)).toContain('Approved Q3 budget');
  });

  it('builds an Evidence Summary from governance-bearing critical/high items', () => {
    const snap = composeExecutiveSnapshot(
      sources({
        orgItems: () => [
          {
            id: 'org:license:invalid',
            title: 'License invalid',
            body: 'b',
            priority: 'critical',
            producedAt: new Date().toISOString(),
            governance: {
              evidence: ['license.valid=false'],
              sourceSystems: ['licensing'],
              confidence: 0.95,
              reasoning: 'r',
              recommendedAction: 'a',
            },
          },
        ],
      }),
    );
    expect(snap.evidenceSummary?.items.length).toBeGreaterThan(0);
    expect(snap.evidenceSummary?.items[0].body).toContain('license.valid=false');
  });

  it('computes Weekly Trends when previous-week data is available', () => {
    const snap = composeExecutiveSnapshot(
      sources({ previousWeek: () => ({ overall: 80, engineering: 90 }) }),
    );
    const overall = snap.weeklyTrends?.find((t) => t.key === 'overall');
    expect(overall).toBeDefined();
    expect(overall!.previous).toBe(80);
    expect(['up', 'down', 'flat']).toContain(overall!.direction);
  });

  it('omits Weekly Trends when there is no previous-week data', () => {
    const snap = composeExecutiveSnapshot(sources());
    expect(snap.weeklyTrends).toBeUndefined();
  });
});

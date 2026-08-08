/**
 * Mobile M1-07 — the briefing composer. Locks: KPIs are ordered attention-first
 * and capped; the headline reflects real approval + at-risk counts (with correct
 * pluralization and an all-clear fallback); urgent approvals + families are
 * capped; and period resolves deterministically from the timestamp.
 */
import { describe, expect, it } from 'vitest';
import type {
  CompanionApprovalItem,
  CompanionDashboardSnapshot,
  CompanionFamilySummary,
  CompanionKpi,
} from '@neuropause/shared';
import { buildCompanionBriefing, resolveBriefingPeriod } from './companionBriefing';

const kpi = (key: string, band?: CompanionKpi['band']): CompanionKpi => ({
  key,
  label: key,
  display: '—',
  ...(band ? { band } : {}),
});

const snapshot = (kpis: CompanionKpi[]): CompanionDashboardSnapshot => ({
  generatedAt: '2026-08-07T07:00:00.000Z',
  kpis,
});

const approval = (moduleTitle: string, title: string): CompanionApprovalItem =>
  ({ moduleTitle, title }) as CompanionApprovalItem;

const family = (group: string, recordCount: number): CompanionFamilySummary => ({
  group,
  moduleCount: 1,
  recordCount,
});

describe('resolveBriefingPeriod', () => {
  it('splits morning/evening by UTC hour and defaults to morning on garbage', () => {
    expect(resolveBriefingPeriod('2026-08-07T07:00:00.000Z')).toBe('morning');
    expect(resolveBriefingPeriod('2026-08-07T18:00:00.000Z')).toBe('evening');
    expect(resolveBriefingPeriod('not-a-date')).toBe('morning');
  });
});

describe('buildCompanionBriefing', () => {
  it('orders KPIs attention-first, caps at 4, and composes the headline', () => {
    const brief = buildCompanionBriefing({
      period: 'morning',
      nowIso: '2026-08-07T07:00:00.000Z',
      snapshot: snapshot([
        kpi('a', 'healthy'),
        kpi('b', 'critical'),
        kpi('c'),
        kpi('d', 'at-risk'),
        kpi('e', 'watch'),
      ]),
      approvals: [approval('Leave Requests', 'LR-1'), approval('Vendor Bills', 'VB-9')],
      families: [family('Finance', 20), family('HR', 5)],
    });
    expect(brief.kpis.map((k) => k.key)).toEqual(['b', 'd', 'e', 'a']); // critical, at-risk, watch, healthy
    expect(brief.period).toBe('morning');
    expect(brief.pendingApprovals).toBe(2);
    expect(brief.urgentApprovals).toEqual([
      { moduleTitle: 'Leave Requests', title: 'LR-1' },
      { moduleTitle: 'Vendor Bills', title: 'VB-9' },
    ]);
    // 2 approvals + 2 at-risk/critical metrics (b, d).
    expect(brief.headline).toBe('Good morning. 2 approvals waiting · 2 metrics need attention');
  });

  it('singularizes and gives an all-clear when nothing is pending', () => {
    const one = buildCompanionBriefing({
      period: 'evening',
      nowIso: '2026-08-07T18:00:00.000Z',
      snapshot: snapshot([kpi('x', 'critical')]),
      approvals: [approval('Leave Requests', 'LR-1')],
      families: [],
    });
    expect(one.headline).toBe('Good evening. 1 approval waiting · 1 metric need attention');

    const clear = buildCompanionBriefing({
      period: 'evening',
      nowIso: '2026-08-07T18:00:00.000Z',
      snapshot: snapshot([kpi('x', 'healthy')]),
      approvals: [],
      families: [],
    });
    expect(clear.headline).toBe('Good evening. everything looks clear');
  });

  it('caps urgent approvals at 3 and families at 4', () => {
    const brief = buildCompanionBriefing({
      period: 'morning',
      nowIso: '2026-08-07T07:00:00.000Z',
      snapshot: snapshot([]),
      approvals: [1, 2, 3, 4, 5].map((n) => approval('M', `A${n}`)),
      families: [1, 2, 3, 4, 5].map((n) => family(`F${n}`, n)),
    });
    expect(brief.urgentApprovals).toHaveLength(3);
    expect(brief.families).toHaveLength(4);
    expect(brief.pendingApprovals).toBe(5);
  });
});

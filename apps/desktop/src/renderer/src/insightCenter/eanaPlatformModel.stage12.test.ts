/**
 * Phase 6 Stage 12 — the Analytics tab's pure view-model: total tone maps,
 * header stats over the dashboard, attribution-visible KPI rows, recorded-
 * before-untrendable trend ordering, cannot-predict forecast rows, decision
 * lines, Principle-C recommendation rows, and the deduped honesty strip.
 */
import { describe, expect, it } from 'vitest';
import type { EanaDashboard, EanaDecisionReport, EanaForecastInventory, EanaKpiCatalog, EanaTrendReport } from '@neuropause/shared';
import {
  bandTone,
  decisionLines,
  directionTone,
  domainTone,
  eanaHeaderStats,
  eanaRecommendationRows,
  forecastRows,
  kpiRows,
  trendRows,
  unavailableLines,
} from '../enterpriseAnalytics/eanaPlatformModel';

const NOW = '2026-08-01T09:00:00.000Z';

function mkDashboard(over: Partial<EanaDashboard> = {}): EanaDashboard {
  return {
    generatedAt: NOW,
    kpis: { total: 12, live: 12, healthy: 9, attention: 2, unregistered: 1 },
    trends: { improving: 1, stable: 1, regressing: 1, unavailable: 3 },
    forecasts: { registered: 9, liveInstances: 2 },
    decisions: { total: 5, verified: 2, delivered: 1 },
    domains: [
      { stage: 's8', label: 'Automation (Stage 8)', state: 'steady', summary: '0 critical/high of 2 finding(s)' },
      { stage: 's9', label: 'Operations (Stage 9)', state: 'unknown', summary: 'operations slices unreadable this pass' },
    ],
    benchmarks: { position: 'average', healthBand: 'watch' },
    recommendations: [],
    disclosures: ['d1'],
    unavailable: [],
    ...over,
  };
}

describe('tone maps (total)', () => {
  it('bands, directions, and domain states map to presentation tones — unknowns gray, never invented', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandTone(null)).toBe('gray');
    expect(bandTone('something-new')).toBe('gray');
    expect(directionTone('improving')).toBe('green');
    expect(directionTone('stable')).toBe('blue');
    expect(directionTone('regressing')).toBe('orange');
    expect(directionTone('unavailable')).toBe('gray');
    expect(domainTone('steady')).toBe('green');
    expect(domainTone('attention')).toBe('orange');
    expect(domainTone('unknown')).toBe('gray');
  });
});

describe('eanaHeaderStats', () => {
  it('renders the five stats with honest hints; unreadable benchmarks read n/a', () => {
    const stats = eanaHeaderStats(mkDashboard());
    expect(stats.map((s) => s.label)).toEqual(['KPIs', 'Trends', 'Forecast capability', 'Decisions', 'Benchmarks']);
    expect(stats[0].value).toBe('9/12 healthy');
    expect(stats[0].tone).toBe('orange'); // attention > 0
    expect(stats[1].tone).toBe('orange'); // regressing > 0
    expect(stats[4].value).toBe('average');
    const noBench = eanaHeaderStats(mkDashboard({ benchmarks: null }));
    expect(noBench[4].value).toBe('n/a');
    expect(noBench[4].tone).toBe('gray');
    expect(noBench[4].hint).toContain('declared, not defaulted');
  });
});

describe('kpiRows', () => {
  it('carries attribution on every row and flags unregistered producers', () => {
    const catalog = {
      generatedAt: NOW,
      rows: [
        { key: 'org-health', label: 'Org health', value: 82, display: '82/100', band: 'healthy', source: 'executive-center', producerId: 'executive-core', surfaces: ['mission-control'], availability: 'live', evidence: ['org-health'] },
        { key: 'plugin.tile', label: 'Plugin tile', value: null, display: '7', band: null, source: 'executive-center', producerId: 'unregistered', surfaces: ['mission-control'], availability: 'live', evidence: ['plugin.tile'] },
      ],
      totals: { total: 2, live: 2, healthy: 1, attention: 0, unregistered: 1 },
      overlaps: [],
      gaps: [],
      disclosure: 'x',
      unavailable: [],
    } as EanaKpiCatalog;
    const rows = kpiRows(catalog);
    expect(rows[0].attributionText).toBe('via executive-center · producer executive-core');
    expect(rows[0].unregistered).toBe(false);
    expect(rows[1].attributionText).toContain('UNREGISTERED (attribution gap)');
    expect(rows[1].unregistered).toBe(true);
  });
});

describe('trendRows', () => {
  it('orders recorded windows before declared-untrendable point-in-time rows', () => {
    const report = {
      generatedAt: NOW,
      rows: [
        { seriesId: 'kpi-bands', label: 'KPI bands', kind: 'point-in-time', windowLabel: 'no recorded series', from: null, to: null, delta: null, direction: 'unavailable', detail: 'snapshot' },
        { seriesId: 'org-health-history', label: 'Org health', kind: 'daily-history', windowLabel: 'w', from: 70, to: 78, delta: 8, direction: 'improving', detail: '70 → 78' },
        { seriesId: 'decision:d1:x', label: 'Decision', kind: 'decision-window', windowLabel: 'w', from: 70, to: 68, delta: -2, direction: 'regressing', detail: '70 → 68' },
      ],
      totals: { improving: 1, stable: 0, regressing: 1, unavailable: 1 },
      disclosure: 'x',
      unavailable: [],
    } as EanaTrendReport;
    const rows = trendRows(report);
    expect(rows.map((r) => r.seriesId)).toEqual(['org-health-history', 'decision:d1:x', 'kpi-bands']);
    expect(rows[0].pointInTime).toBe(false);
    expect(rows[2].pointInTime).toBe(true);
    expect(rows[2].tone).toBe('gray');
  });
});

describe('forecastRows', () => {
  it('carries CAN/CANNOT verbatim; firing heuristics tone orange, unreadable joins gray', () => {
    const inv = {
      generatedAt: NOW,
      entries: [
        { id: 'connector-instability', kind: 'deterministic-heuristic', source: 's', live: { count: 2, detail: '2 instance(s) firing' }, canPredict: 'can', cannotPredict: 'cannot', basis: 'b' },
        { id: 'p14-simulation', kind: 'scenario-projection', source: 's', live: { count: 3, detail: '3 authored scenario(s)' }, canPredict: 'can', cannotPredict: 'cannot', basis: 'b' },
        { id: 'risk-trend', kind: 'deterministic-heuristic', source: 's', live: null, canPredict: 'can', cannotPredict: 'cannot', basis: 'b' },
      ],
      totals: { registered: 3, liveInstances: 2 },
      disclosure: 'x',
      unavailable: [],
    } as EanaForecastInventory;
    const rows = forecastRows(inv);
    expect(rows[0].liveTone).toBe('orange');
    expect(rows[1].liveTone).toBe('blue'); // scenarios are not firing predictions
    expect(rows[2].liveTone).toBe('gray');
    expect(rows[2].liveText).toContain('unreadable');
    for (const r of rows) {
      expect(r.canPredict.length).toBeGreaterThan(0);
      expect(r.cannotPredict.length).toBeGreaterThan(0);
    }
  });
});

describe('decisionLines + eanaRecommendationRows', () => {
  it('states the funnel, the outcome loop, and the verbatim/unreadable value line', () => {
    const report = {
      generatedAt: NOW,
      funnel: { total: 3, byStatus: [{ status: 'approved', count: 2 }, { status: 'proposed', count: 1 }], outcomeLoop: { recommended: 0, approved: 1, executed: 0, verified: 1 } },
      value: null,
      recommendations: [{ source: 's10-strategy-recommendations', count: 2, criticalOrHigh: 1 }],
      disclosure: 'x',
      unavailable: [],
    } as EanaDecisionReport;
    const lines = decisionLines(report);
    expect(lines[0]).toContain('3 decision(s) recorded: 2 approved · 1 proposed');
    expect(lines[1]).toContain('1 approved');
    expect(lines[2]).toContain('unreadable this pass');
    expect(lines[3]).toContain('s10-strategy-recommendations: 2 recommendation(s), 1 critical/high');
  });

  it('recommendation rows expose the full Principle-C line', () => {
    const d = mkDashboard({
      recommendations: [
        {
          id: 'eanarec:kpi:attention',
          title: '1 KPI(s) outside the healthy band',
          detail: 'org-health: critical',
          priority: 'critical',
          suggestedAction: 'Open the producing surfaces.',
          evidence: ['org-health'],
          reasoning: 'Producer-authoritative bands.',
          confidence: 0.9,
          affectedSystems: ['analytics'],
          operationalImpact: 'Executive KPIs degraded.',
          expectedBusinessOutcome: 'Producers recover.',
          rollbackImplications: 'Recommendation only.',
        },
      ],
    });
    const rows = eanaRecommendationRows(d);
    expect(rows[0].tone).toBe('red');
    expect(rows[0].principleC).toContain('Impact: Executive KPIs degraded.');
    expect(rows[0].principleC).toContain('Rollback: Recommendation only.');
    expect(rows[0].principleC).toContain('confidence 90%');
  });
});

describe('unavailableLines', () => {
  it('dedups identical system:reason lines across views', () => {
    const lines = unavailableLines([
      { unavailable: [{ system: 'p18-kpis', reason: 'offline' }] },
      { unavailable: [{ system: 'p18-kpis', reason: 'offline' }, { system: 'process-kpis', reason: 'threw' }] },
    ]);
    expect(lines).toEqual(['p18-kpis: offline', 'process-kpis: threw']);
  });
});

/**
 * Phase 6 Stage 12 — the executive analytics dashboard + report: analytics
 * recommendations (regressing recorded series / attention-band KPIs /
 * unregistered producers) built through the SAME Stage 9 throwing guard and
 * Principle-C complete; the dashboard's slice totals passed through verbatim;
 * unavailability deduplicated; report sections carrying the disclosures.
 */
import { describe, expect, it } from 'vitest';
import { recommendationIssues } from '@neuropause/shared';
import { buildDecisionReport } from './decisionAnalytics';
import { buildForecastInventory } from './forecastInventory';
import { buildKpiCatalog } from './kpiCatalog';
import { buildTrendReport } from './trendAnalytics';
import {
  composeAnalyticsDashboard,
  composeAnalyticsRecommendations,
  composeAnalyticsReport,
  EANA_DISCLOSURES,
  type EanaDashboardInputs,
} from './executiveAnalytics';

const NOW = '2026-08-01T09:00:00.000Z';

function mkInputs(opts: { regress?: boolean; critical?: boolean; unregistered?: boolean } = {}): EanaDashboardInputs {
  const kpis = buildKpiCatalog({
    nowIso: NOW,
    executive: [
      { key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: opts.critical ? 'critical' : 'healthy' },
      ...(opts.unregistered ? [{ key: 'plugin.tile', label: 'Plugin tile', display: '7', value: 7 }] : []),
    ],
    process: [],
    p14: [],
    p18: [],
    failures: {},
  });
  const trends = buildTrendReport({
    nowIso: NOW,
    history: opts.regress
      ? [
          { day: '2026-07-01', overall: 80, engineering: 70 },
          { day: '2026-07-30', overall: 72, engineering: 70 },
        ]
      : [
          { day: '2026-07-01', overall: 80, engineering: 70 },
          { day: '2026-07-30', overall: 80, engineering: 70 },
        ],
    valueDeltas: [],
    failures: {},
  });
  const forecasts = buildForecastInventory({ nowIso: NOW, predictions: [], simulation: null, capacityPressure: null, failures: {} });
  const decisions = buildDecisionReport({
    nowIso: NOW,
    decisions: [],
    outcomes: [],
    valueTotals: { delivered: 1, partial: 0, notYetObserved: 0, unmeasurable: 0 },
    strategyRecs: null,
    federationRecs: null,
    failures: {},
  });
  return {
    nowIso: NOW,
    kpis,
    trends,
    forecasts,
    decisions,
    domains: [
      { stage: 's8', label: 'Automation (Stage 8)', state: 'steady', summary: '0 critical/high of 2 monitor finding(s)' },
      { stage: 's9', label: 'Operations (Stage 9)', state: 'unknown', summary: 'operations slices unreadable this pass' },
    ],
    benchmarks: { position: 'average', healthBand: 'watch' },
  };
}

describe('composeAnalyticsRecommendations — Principle-C through the throwing guard', () => {
  it('a regressing recorded series produces a complete recommendation pointing at existing surfaces', () => {
    const recs = composeAnalyticsRecommendations(mkInputs({ regress: true }));
    const trend = recs.find((r) => r.id === 'eanarec:trend:org-health-history')!;
    expect(trend.priority).toBe('high');
    expect(recommendationIssues(trend)).toEqual([]);
    expect(trend.reasoning).toContain('measured, not extrapolated');
    expect(trend.suggestedAction).toContain('existing governed flows');
    expect(trend.rollbackImplications.length).toBeGreaterThan(0);
  });

  it('attention-band KPIs produce one rollup recommendation — critical band escalates priority', () => {
    const recs = composeAnalyticsRecommendations(mkInputs({ critical: true }));
    const kpi = recs.find((r) => r.id === 'eanarec:kpi:attention')!;
    expect(kpi.priority).toBe('critical');
    expect(recommendationIssues(kpi)).toEqual([]);
    expect(kpi.detail).toContain('org-health: critical');
  });

  it('unregistered live keys produce the attribution recommendation', () => {
    const recs = composeAnalyticsRecommendations(mkInputs({ unregistered: true }));
    const gap = recs.find((r) => r.id === 'eanarec:kpi:unregistered')!;
    expect(gap.priority).toBe('medium');
    expect(gap.evidence).toContain('plugin.tile');
    expect(recommendationIssues(gap)).toEqual([]);
  });

  it('healthy inputs produce zero recommendations — nothing is padded', () => {
    expect(composeAnalyticsRecommendations(mkInputs())).toEqual([]);
  });
});

describe('composeAnalyticsDashboard / composeAnalyticsReport', () => {
  it('passes slice totals through verbatim and dedups unavailability across views', () => {
    const inputs = mkInputs();
    inputs.kpis.unavailable.push({ system: 'p18-kpis', reason: 'x' });
    inputs.trends.unavailable.push({ system: 'p18-kpis', reason: 'x' });
    const d = composeAnalyticsDashboard(inputs);
    expect(d.kpis).toEqual(inputs.kpis.totals);
    expect(d.trends).toEqual(inputs.trends.totals);
    expect(d.forecasts).toEqual(inputs.forecasts.totals);
    expect(d.decisions).toEqual({ total: 0, verified: 0, delivered: 1 });
    expect(d.benchmarks).toEqual({ position: 'average', healthBand: 'watch' });
    expect(d.unavailable.filter((u) => u.system === 'p18-kpis')).toHaveLength(1);
    expect(d.disclosures).toEqual([...EANA_DISCLOSURES]);
    expect(d.disclosures).toHaveLength(4);
  });

  it('the report sections carry the four component disclosures and the domain rollups', () => {
    const r = composeAnalyticsReport(mkInputs({ regress: true }));
    expect(r.title).toBe('Enterprise analytics — executive report');
    const titles = r.sections.map((s) => s.title);
    expect(titles).toContain('KPI catalog (producers authoritative)');
    expect(titles).toContain('Trends (recorded windows only)');
    expect(titles).toContain('Forecast capability (registered, never invented)');
    expect(titles).toContain('Decision intelligence');
    const trendSection = r.sections.find((s) => s.title === 'Trends (recorded windows only)')!;
    expect(trendSection.lines.some((l) => l.startsWith('REGRESSING — Org health'))).toBe(true);
    const domains = r.sections.find((s) => s.title === 'Domain rollups (composed from the stage dashboards)')!;
    expect(domains.lines).toContain('Operations (Stage 9): UNKNOWN — operations slices unreadable this pass');
    const focus = r.sections.find((s) => s.title.startsWith('Executive focus'))!;
    expect(focus.lines.some((l) => l.startsWith('HIGH ·'))).toBe(true);
  });

  it('an unreadable Stage 10 value report reads as null delivered — stated in the report, never zeroed', () => {
    const inputs = mkInputs();
    inputs.decisions = buildDecisionReport({
      nowIso: NOW,
      decisions: [],
      outcomes: [],
      valueTotals: null,
      strategyRecs: null,
      federationRecs: null,
      failures: {},
    });
    const d = composeAnalyticsDashboard(inputs);
    expect(d.decisions.delivered).toBeNull();
    const r = composeAnalyticsReport(inputs);
    expect(r.sections.find((s) => s.title === 'Decision intelligence')!.lines[0]).toContain('unreadable this pass');
  });
});

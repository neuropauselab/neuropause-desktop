/**
 * Phase 6 Stage 12 — the executive analytics dashboard + report. Pure
 * COMPOSITIONS of the already-computed views: the KPI catalog, trends,
 * forecast inventory, decision rollup, the four stage-dashboard one-line
 * rollups (injected as PRE-COMPOSED slices — no dashboard logic duplicated),
 * and the P18 benchmark posture as ONE input. Its own recommendations are
 * analytics-specific (regressing recorded series; attention-band KPIs) —
 * Principle-C via the SAME throwing guard, pointing only at existing
 * governed surfaces. Pure.
 */
import type {
  EanaDashboard,
  EanaDecisionReport,
  EanaDomainRollup,
  EanaForecastInventory,
  EanaKpiCatalog,
  EanaReport,
  EanaTrendReport,
  EanaUnavailable,
  OperationsRecommendation,
} from '@neuropause/shared';
import { mkRecommendation } from '../operationsPlatform/operationsModel';
import { DECISION_DISCLOSURE } from './decisionAnalytics';
import { FORECAST_DISCLOSURE } from './forecastInventory';
import { KPI_CATALOG_DISCLOSURE } from './kpiCatalog';
import { TREND_DISCLOSURE } from './trendAnalytics';

export const EANA_DISCLOSURES: readonly string[] = [
  KPI_CATALOG_DISCLOSURE,
  TREND_DISCLOSURE,
  FORECAST_DISCLOSURE,
  DECISION_DISCLOSURE,
] as const;

export interface EanaDashboardInputs {
  nowIso: string;
  kpis: EanaKpiCatalog;
  trends: EanaTrendReport;
  forecasts: EanaForecastInventory;
  decisions: EanaDecisionReport;
  domains: EanaDomainRollup[];
  benchmarks: { position: string; healthBand: string } | null;
}

export function composeAnalyticsRecommendations(inp: EanaDashboardInputs): OperationsRecommendation[] {
  const recs: OperationsRecommendation[] = [];

  for (const r of inp.trends.rows.filter((x) => x.direction === 'regressing')) {
    recs.push(
      mkRecommendation({
        id: `eanarec:trend:${r.seriesId}`,
        title: `Recorded series regressing: ${r.label}`,
        detail: r.detail,
        priority: 'high',
        suggestedAction: 'Investigate on the owning surface (Intelligence / Operations / Strategy); corrective actions run only through the existing governed flows.',
        evidence: [r.seriesId, r.windowLabel],
        reasoning: 'A deterministic delta over recorded values moved beyond the stability threshold — measured, not extrapolated.',
        confidence: 0.85,
        affectedSystems: ['analytics'],
        operationalImpact: `${r.label} moved ${r.delta} over the recorded window.`,
        expectedBusinessOutcome: 'The owning surface identifies and reverses the recorded deterioration.',
        rollbackImplications: 'Recommendation only; the series itself is a recorded fact and changes nothing.',
      }),
    );
  }

  const attention = inp.kpis.rows.filter((r) => r.band !== null && ['at-risk', 'critical', 'watch'].includes(r.band));
  if (attention.length > 0) {
    recs.push(
      mkRecommendation({
        id: 'eanarec:kpi:attention',
        title: `${attention.length} KPI(s) outside the healthy band`,
        detail: attention.map((r) => `${r.key}: ${r.band}`).join('; '),
        priority: attention.some((r) => r.band === 'critical') ? 'critical' : 'high',
        suggestedAction: 'Open the producing surfaces (each KPI row names its producer and surfaces); recovery runs through the existing governed flows.',
        evidence: attention.map((r) => r.key).slice(0, 8),
        reasoning: 'Producer-authoritative bands, composed verbatim into the catalog.',
        confidence: 0.9,
        affectedSystems: ['analytics'],
        operationalImpact: 'Executive KPIs report degraded bands from their own producers.',
        expectedBusinessOutcome: 'Producers return their KPIs to the healthy band.',
        rollbackImplications: 'Recommendation only; the catalog computes nothing to roll back.',
      }),
    );
  }

  if (inp.kpis.totals.unregistered > 0) {
    recs.push(
      mkRecommendation({
        id: 'eanarec:kpi:unregistered',
        title: `${inp.kpis.totals.unregistered} live KPI key(s) without a registered producer`,
        detail: 'Attribution gaps: live keys the analytics registry does not map (typically plugin-contributed tiles).',
        priority: 'medium',
        suggestedAction: 'Register the producing module in the analytics registry (a Stage 12 registry edit reviewed like any code change).',
        evidence: inp.kpis.gaps.filter((g) => g.kind === 'unregistered-producer').map((g) => g.subject).slice(0, 8),
        reasoning: 'The catalog attributes only from the registry key map; unknown keys are flagged, never guessed.',
        confidence: 0.85,
        affectedSystems: ['analytics'],
        operationalImpact: 'Unattributed KPIs weaken the catalog’s source accountability.',
        expectedBusinessOutcome: 'Every live KPI key carries a registered, reviewable producer.',
        rollbackImplications: 'Registry data change only, reversible in review.',
      }),
    );
  }

  return recs;
}

export function composeAnalyticsDashboard(inp: EanaDashboardInputs): EanaDashboard {
  const recommendations = composeAnalyticsRecommendations(inp);
  const unavailable: EanaUnavailable[] = [
    ...inp.kpis.unavailable,
    ...inp.trends.unavailable,
    ...inp.forecasts.unavailable,
    ...inp.decisions.unavailable,
  ].filter((u, i, arr) => arr.findIndex((x) => x.system === u.system) === i);

  return {
    generatedAt: inp.nowIso,
    kpis: { ...inp.kpis.totals },
    trends: { ...inp.trends.totals },
    forecasts: { ...inp.forecasts.totals },
    decisions: {
      total: inp.decisions.funnel.total,
      verified: inp.decisions.funnel.outcomeLoop.verified,
      delivered: inp.decisions.value?.delivered ?? null,
    },
    domains: inp.domains,
    benchmarks: inp.benchmarks,
    recommendations,
    disclosures: [...EANA_DISCLOSURES],
    unavailable,
  };
}

export function composeAnalyticsReport(inp: EanaDashboardInputs): EanaReport {
  const d = composeAnalyticsDashboard(inp);
  return {
    generatedAt: inp.nowIso,
    title: 'Enterprise analytics — executive report',
    sections: [
      {
        title: 'KPI catalog (producers authoritative)',
        lines: [
          `${d.kpis.total} KPI(s) catalogued: ${d.kpis.healthy} healthy · ${d.kpis.attention} needing attention · ${d.kpis.unregistered} without a registered producer.`,
          ...(inp.kpis.overlaps.length > 0
            ? [`${inp.kpis.overlaps.length} key(s) served on multiple surfaces (reuse made visible): ${inp.kpis.overlaps.map((o) => o.key).join(', ')}.`]
            : ['No key is served by more than one live feed this pass.']),
          inp.kpis.disclosure,
        ],
      },
      {
        title: 'Trends (recorded windows only)',
        lines: [
          `${d.trends.improving} improving · ${d.trends.stable} stable · ${d.trends.regressing} regressing · ${d.trends.unavailable} without a recorded series.`,
          ...inp.trends.rows.filter((r) => r.direction === 'regressing').map((r) => `REGRESSING — ${r.label}: ${r.detail}`),
          inp.trends.disclosure,
        ],
      },
      {
        title: 'Forecast capability (registered, never invented)',
        lines: [
          `${d.forecasts.registered} registered capabilit(ies) · ${d.forecasts.liveInstances} heuristic instance(s) firing now.`,
          ...inp.forecasts.entries.filter((e) => e.live !== null && e.kind === 'deterministic-heuristic' && e.live.count > 0).map((e) => `${e.id}: ${e.live!.detail}`),
          inp.forecasts.disclosure,
        ],
      },
      {
        title: 'Decision intelligence',
        lines: [
          `${d.decisions.total} decision(s) · outcome loop ${inp.decisions.funnel.outcomeLoop.recommended}/${inp.decisions.funnel.outcomeLoop.approved}/${inp.decisions.funnel.outcomeLoop.executed}/${inp.decisions.funnel.outcomeLoop.verified} (recommended/approved/executed/verified)` +
            (inp.decisions.value ? ` · value: ${inp.decisions.value.delivered} delivered, ${inp.decisions.value.partial} partial.` : ' · Stage 10 value report unreadable this pass.'),
          inp.decisions.disclosure,
        ],
      },
      {
        title: 'Domain rollups (composed from the stage dashboards)',
        lines: d.domains.map((x) => `${x.label}: ${x.state.toUpperCase()} — ${x.summary}`),
      },
      {
        title: 'Executive focus (recommendations only — nothing executes from here)',
        lines:
          d.recommendations.length === 0
            ? ['No analytics focus items by the recorded values.']
            : d.recommendations.map((r) => `${r.priority.toUpperCase()} · ${r.title} → ${r.suggestedAction}`),
      },
    ],
  };
}

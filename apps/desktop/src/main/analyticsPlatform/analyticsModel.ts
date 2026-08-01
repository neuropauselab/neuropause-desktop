/**
 * Phase 6 Stage 12 — the analytics model: the ten assistant question resolvers
 * (EIGHT-WAY disjoint from the Stage 5/6/7/8/9/10/11 matchers, both directions
 * test-locked) and the ten read-only answers riding the existing
 * 'intelligence' structured-report kind. Answers cite the composed views
 * verbatim; recommending never executes. Pure.
 */
import type {
  AssistantStructuredReport,
  EanaDashboard,
  EanaDecisionReport,
  EanaForecastInventory,
  EanaKpiCatalog,
  EanaQuestionKey,
  EanaReport,
  EanaTrendReport,
} from '@neuropause/shared';

/* ── the ten resolvers ────────────────────────────────────────────────────── */

export function resolveAnalyticsQuestion(text: string): EanaQuestionKey | null {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return null;
  if (/\banalytics report\b/.test(t) || /\bexecutive analytics\b/.test(t)) return 'analytics-report';
  if (/\bwhich kpis? (are )?(regress|deteriorat|declin|dropp)/.test(t) || /\bregress(ing|ions?)\b/.test(t) || /\bwhat('s| is) (getting )?worse\b/.test(t))
    return 'regressions';
  if (/\bkpi catalog\b/.test(t) || /\b(list|show|all) (our |the )?kpis?\b/.test(t) || /\bwho produces\b.*\bkpis?\b/.test(t)) return 'kpi-catalog';
  if (/\bkpi (health|bands?|status)\b/.test(t) || /\bwhich kpis?\b.*\b(unhealthy|at.?risk|attention)\b/.test(t)) return 'kpi-health';
  if (/\btrends?\b/.test(t)) return 'trends';
  if (/\bforecast(s|ing)?\b/.test(t) || /\bwhat can (the platform|we|it) (predict|foresee)\b/.test(t)) return 'forecast-capability';
  if (/\bdecision (intelligence|funnel|analytics)\b/.test(t) || /\boutcome loop\b/.test(t)) return 'decision-intelligence';
  if (/\bbenchmark (position|posture|standing)\b/.test(t) || /\bhow do we (compare|benchmark)\b/.test(t)) return 'benchmark-position';
  if (/\bdata coverage\b/.test(t) || /\bwhat (data|series) (do we|does the platform) (record|track)\b/.test(t)) return 'data-coverage';
  if (/\banalytics (status|overview|state|summary)\b/.test(t) || /\bwhat (do|does) the (data|numbers|metrics) say\b/.test(t))
    return 'analytics-status';
  return null;
}

/* ── the answer context + answers ─────────────────────────────────────────── */

export interface AnalyticsQuestionContext {
  kpis: EanaKpiCatalog;
  trends: EanaTrendReport;
  forecasts: EanaForecastInventory;
  decisions: EanaDecisionReport;
  dashboard: EanaDashboard;
  report: EanaReport;
  nowIso: string;
}

type Section = { title: string; lines: string[] };

function report(title: string, sections: Section[]): AssistantStructuredReport {
  return { kind: 'intelligence', title, sections: sections.filter((s) => s.lines.length > 0), grounded: true };
}

export function answerAnalyticsQuestion(key: EanaQuestionKey, ctx: AnalyticsQuestionContext): AssistantStructuredReport {
  switch (key) {
    case 'analytics-status': {
      const d = ctx.dashboard;
      return report('Enterprise analytics status (composed from the platform’s own producers)', [
        {
          title: 'Answer',
          lines: [
            `KPIs: ${d.kpis.total} catalogued (${d.kpis.healthy} healthy · ${d.kpis.attention} attention · ${d.kpis.unregistered} unattributed).`,
            `Trends: ${d.trends.improving} improving · ${d.trends.stable} stable · ${d.trends.regressing} regressing · ${d.trends.unavailable} without a recorded series.`,
            `Forecast capability: ${d.forecasts.registered} registered · ${d.forecasts.liveInstances} heuristic instance(s) firing.`,
            `Decisions: ${d.decisions.total} recorded · ${d.decisions.verified} verified${d.decisions.delivered !== null ? ` · ${d.decisions.delivered} delivered value` : ''}.`,
          ],
        },
        { title: 'Domains', lines: d.domains.map((x) => `${x.label}: ${x.state} — ${x.summary}`) },
        { title: 'Uncertainty', lines: [...d.unavailable.map((u) => `${u.system}: ${u.reason}`), d.disclosures[0]] },
      ]);
    }
    case 'kpi-catalog': {
      return report('The unified KPI catalog (producers authoritative)', [
        {
          title: 'Answer',
          lines: ctx.kpis.rows.map((r) => `${r.key}: ${r.display}${r.band ? ` (${r.band})` : ''} — producer ${r.producerId} · via ${r.source} · on ${r.surfaces.join(', ')}`),
        },
        { title: 'Uncertainty', lines: [...ctx.kpis.gaps.map((g) => `${g.subject}: ${g.detail}`), ctx.kpis.disclosure] },
      ]);
    }
    case 'kpi-health': {
      const attention = ctx.kpis.rows.filter((r) => r.band !== null && ['at-risk', 'critical', 'watch'].includes(r.band));
      return report('KPI health (bands composed verbatim)', [
        {
          title: 'Answer',
          lines:
            attention.length === 0
              ? [`Every banded KPI is healthy (${ctx.kpis.totals.healthy} of ${ctx.kpis.totals.total}; bandless status KPIs excluded).`]
              : attention.map((r) => `${r.key}: ${r.band?.toUpperCase()} — ${r.display} (producer ${r.producerId})`),
        },
        { title: 'Uncertainty', lines: [ctx.kpis.disclosure] },
      ]);
    }
    case 'trends': {
      return report('Trends over recorded windows', [
        {
          title: 'Answer',
          lines: ctx.trends.rows.filter((r) => r.kind !== 'point-in-time').map((r) => `${r.label}: ${r.direction.toUpperCase()} — ${r.detail}`),
        },
        { title: 'Not trendable (declared)', lines: ctx.trends.rows.filter((r) => r.kind === 'point-in-time').map((r) => `${r.label}: ${r.detail}`) },
        { title: 'Uncertainty', lines: [ctx.trends.disclosure] },
      ]);
    }
    case 'regressions': {
      const regressing = ctx.trends.rows.filter((r) => r.direction === 'regressing');
      const attention = ctx.kpis.rows.filter((r) => r.band !== null && ['at-risk', 'critical'].includes(r.band));
      return report('What is regressing (recorded values only)', [
        {
          title: 'Answer',
          lines:
            regressing.length === 0 && attention.length === 0
              ? ['No recorded series is regressing and no KPI reports an at-risk/critical band — stated from the records, not asserted.']
              : [
                  ...regressing.map((r) => `${r.label}: ${r.detail}`),
                  ...attention.map((r) => `KPI ${r.key}: ${r.band} (${r.display})`),
                ],
        },
        { title: 'Uncertainty', lines: [ctx.trends.disclosure] },
      ]);
    }
    case 'forecast-capability': {
      return report('What the platform can — and cannot — predict', [
        {
          title: 'Answer',
          lines: ctx.forecasts.entries.map((e) => `${e.id} (${e.kind}): CAN — ${e.canPredict} CANNOT — ${e.cannotPredict}`),
        },
        {
          title: 'Firing now',
          lines: ctx.forecasts.entries.filter((e) => e.live !== null && e.kind === 'deterministic-heuristic' && e.live.count > 0).map((e) => `${e.id}: ${e.live!.detail}`),
        },
        { title: 'Uncertainty', lines: [ctx.forecasts.disclosure] },
      ]);
    }
    case 'decision-intelligence': {
      const f = ctx.decisions.funnel;
      return report('Decision intelligence (composed)', [
        {
          title: 'Answer',
          lines: [
            `${f.total} decision(s): ${f.byStatus.map((s) => `${s.count} ${s.status}`).join(' · ') || 'none recorded'}.`,
            `Outcome loop: ${f.outcomeLoop.recommended} recommended · ${f.outcomeLoop.approved} approved · ${f.outcomeLoop.executed} executed · ${f.outcomeLoop.verified} verified.`,
            ctx.decisions.value
              ? `Value (Stage 10, computed): ${ctx.decisions.value.delivered} delivered · ${ctx.decisions.value.partial} partial · ${ctx.decisions.value.notYetObserved} not yet observed · ${ctx.decisions.value.unmeasurable} unmeasurable.`
              : 'The Stage 10 value report was unreadable this pass.',
            ...ctx.decisions.recommendations.map((r) => `${r.source}: ${r.count} recommendation(s), ${r.criticalOrHigh} critical/high.`),
          ],
        },
        { title: 'Uncertainty', lines: [ctx.decisions.disclosure] },
      ]);
    }
    case 'benchmark-position': {
      const b = ctx.dashboard.benchmarks;
      return report('Benchmark position (P18, sanitized)', [
        {
          title: 'Answer',
          lines: b
            ? [`Network benchmark position: ${b.position} · health band ${b.healthBand} — from the P18 sanitized exchange (which composes the P13 industry reference).`]
            : ['The P18 network benchmarks were unreadable this pass — declared, not defaulted.'],
        },
        { title: 'Uncertainty', lines: ['Benchmarks are the P18 sanitized projection — no raw enterprise records are exchanged, and Stage 12 composes that projection unchanged.'] },
      ]);
    }
    case 'data-coverage': {
      return report('What the platform records (data coverage, stated honestly)', [
        {
          title: 'Answer',
          lines: ctx.trends.rows.map((r) => `${r.label}: ${r.kind === 'point-in-time' ? 'point-in-time composition — no recorded series' : `recorded (${r.windowLabel})`}`),
        },
        { title: 'Uncertainty', lines: [ctx.trends.disclosure] },
      ]);
    }
    case 'analytics-report': {
      return report(ctx.report.title, ctx.report.sections);
    }
    default:
      return report('Analytics question', [{ title: 'Answer', lines: ['Unrecognized analytics question key.'] }]);
  }
}

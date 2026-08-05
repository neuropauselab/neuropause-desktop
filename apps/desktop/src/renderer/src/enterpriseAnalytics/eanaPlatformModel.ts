/**
 * Phase 6 Stage 12 — the Analytics tab's pure view-model (no DOM, no React,
 * no I/O; tested). Projects the read-only `eana:*` surfaces — the unified KPI
 * catalog, recorded-window trends, the forecast-capability inventory, the
 * decision rollup, and the executive dashboard — into presentation rows.
 * Everything renders what the main-process composition computed; producer
 * attributions, cannot-predict statements, gaps, and unavailable reasons
 * always ride along — nothing is invented here either.
 */
import type {
  EanaDashboard,
  EanaDecisionReport,
  EanaForecastInventory,
  EanaKpiCatalog,
  EanaTrendDirection,
  EanaTrendReport,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7–11 pattern — accepted by StatusBadge/Pill). */
export type EanaTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── tone maps (total; tested) ────────────────────────────────────────────── */

export function bandTone(band: string | null): EanaTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'blue';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

export function directionTone(direction: EanaTrendDirection): EanaTone {
  switch (direction) {
    case 'improving':
      return 'green';
    case 'stable':
      return 'blue';
    case 'regressing':
      return 'orange';
    case 'unavailable':
      return 'gray';
  }
}

export function domainTone(state: 'attention' | 'steady' | 'unknown'): EanaTone {
  switch (state) {
    case 'steady':
      return 'green';
    case 'attention':
      return 'orange';
    case 'unknown':
      return 'gray';
  }
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface EanaStat {
  label: string;
  value: string;
  hint: string;
  tone: EanaTone;
  icon: IconName;
}

export function eanaHeaderStats(d: EanaDashboard): EanaStat[] {
  return [
    {
      label: 'KPIs',
      value: `${d.kpis.healthy}/${d.kpis.total} healthy`,
      hint: `${d.kpis.attention} needing attention · ${d.kpis.unregistered} without a registered producer (bands composed verbatim from the producers)`,
      tone: d.kpis.total === 0 ? 'gray' : d.kpis.attention > 0 ? 'orange' : 'green',
      icon: 'pulse',
    },
    {
      label: 'Trends',
      value: `${d.trends.improving}↑ ${d.trends.stable}→ ${d.trends.regressing}↓`,
      hint: `${d.trends.unavailable} series without a recorded window — deterministic deltas over RECORDED values only, never extrapolated`,
      tone: d.trends.regressing > 0 ? 'orange' : d.trends.improving > 0 ? 'green' : 'gray',
      icon: 'sparkles',
    },
    {
      label: 'Forecast capability',
      value: `${d.forecasts.registered} registered`,
      hint: `${d.forecasts.liveInstances} heuristic instance(s) firing now — the inventory registers existing capability and adds zero forecasting`,
      tone: d.forecasts.liveInstances > 0 ? 'orange' : 'green',
      icon: 'lightbulb',
    },
    {
      label: 'Decisions',
      value: `${d.decisions.total}`,
      hint: `${d.decisions.verified} verified via the Stage 6 outcome loop${d.decisions.delivered !== null ? ` · ${d.decisions.delivered} delivered value (Stage 10, computed)` : ' · Stage 10 value unreadable this pass'}`,
      tone: d.decisions.total === 0 ? 'gray' : d.decisions.verified > 0 ? 'green' : 'blue',
      icon: 'clipboard',
    },
    {
      label: 'Benchmarks',
      value: d.benchmarks ? d.benchmarks.position : 'n/a',
      hint: d.benchmarks
        ? `network health band ${d.benchmarks.healthBand} — the P18 sanitized exchange, composed unchanged`
        : 'P18 network benchmarks unreadable this pass — declared, not defaulted',
      tone: !d.benchmarks ? 'gray' : d.benchmarks.healthBand === 'healthy' ? 'green' : 'orange',
      icon: 'shield',
    },
  ];
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export interface EanaKpiRowVm {
  key: string;
  label: string;
  display: string;
  band: string | null;
  bandTone: EanaTone;
  attributionText: string;
  surfacesText: string;
  unregistered: boolean;
}

export function kpiRows(c: EanaKpiCatalog): EanaKpiRowVm[] {
  return c.rows.map((r) => ({
    key: r.key,
    label: r.label,
    display: r.display,
    band: r.band,
    bandTone: bandTone(r.band),
    attributionText: r.producerId === 'unregistered' ? `via ${r.source} · producer UNREGISTERED (attribution gap)` : `via ${r.source} · producer ${r.producerId}`,
    surfacesText: r.surfaces.join(', '),
    unregistered: r.producerId === 'unregistered',
  }));
}

export interface EanaTrendRowVm {
  seriesId: string;
  label: string;
  windowLabel: string;
  direction: EanaTrendDirection;
  tone: EanaTone;
  detail: string;
  pointInTime: boolean;
}

export function trendRows(t: EanaTrendReport): EanaTrendRowVm[] {
  const rows = t.rows.map((r) => ({
    seriesId: r.seriesId,
    label: r.label,
    windowLabel: r.windowLabel,
    direction: r.direction,
    tone: directionTone(r.direction),
    detail: r.detail,
    pointInTime: r.kind === 'point-in-time',
  }));
  // Recorded windows first (they carry directions); declared-untrendable last.
  return [...rows.filter((r) => !r.pointInTime), ...rows.filter((r) => r.pointInTime)];
}

export interface EanaForecastRowVm {
  id: string;
  kindText: string;
  liveText: string;
  liveTone: EanaTone;
  canPredict: string;
  cannotPredict: string;
  basis: string;
}

export function forecastRows(f: EanaForecastInventory): EanaForecastRowVm[] {
  return f.entries.map((e) => ({
    id: e.id,
    kindText: `${e.kind} · ${e.source}`,
    liveText: e.live === null ? 'live join unreadable this pass' : e.live.detail,
    liveTone:
      e.live === null
        ? 'gray'
        : e.kind === 'deterministic-heuristic' && e.live.count > 0
          ? 'orange'
          : 'blue',
    canPredict: e.canPredict,
    cannotPredict: e.cannotPredict,
    basis: e.basis,
  }));
}

export function decisionLines(d: EanaDecisionReport): string[] {
  const loop = d.funnel.outcomeLoop;
  return [
    `${d.funnel.total} decision(s) recorded${d.funnel.byStatus.length > 0 ? `: ${d.funnel.byStatus.map((s) => `${s.count} ${s.status}`).join(' · ')}` : ''}`,
    `Outcome loop (Stage 6, derived from real records): ${loop.recommended} recommended · ${loop.approved} approved · ${loop.executed} executed · ${loop.verified} verified`,
    d.value
      ? `Business value (Stage 10, computed — never estimated): ${d.value.delivered} delivered · ${d.value.partial} partial · ${d.value.notYetObserved} not yet observed · ${d.value.unmeasurable} unmeasurable`
      : 'The Stage 10 value report was unreadable this pass — declared, not defaulted.',
    ...d.recommendations.map((r) => `${r.source}: ${r.count} recommendation(s), ${r.criticalOrHigh} critical/high`),
  ];
}

export interface EanaRecommendationRow {
  id: string;
  title: string;
  priority: string;
  tone: EanaTone;
  detail: string;
  suggestedAction: string;
  principleC: string;
}

export function eanaRecommendationRows(d: EanaDashboard): EanaRecommendationRow[] {
  return d.recommendations.map((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    tone: r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'orange' : r.priority === 'medium' ? 'blue' : 'gray',
    detail: r.detail,
    suggestedAction: r.suggestedAction,
    principleC: `Impact: ${r.operationalImpact} Outcome: ${r.expectedBusinessOutcome} Rollback: ${r.rollbackImplications} (confidence ${(r.confidence * 100).toFixed(0)}%, ${r.evidence.length} evidence ref(s))`,
  }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

export function unavailableLines(parts: { unavailable: { system: string; reason: string }[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

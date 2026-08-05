/**
 * Phase 6 Stage 6 — the Intelligence Center's pure view-model (no DOM, no
 * React). Projects the composed insight report/dashboard into presentation
 * rows: health domain cards, the signal honesty strip, prediction and
 * recommendation rows with outcome-lifecycle badges, the dependency-graph
 * explanation for a selected recommendation, and the health trend spark.
 * Everything renders what was computed — nothing is invented here.
 */
import type {
  ConfidenceBreakdown,
  InsightDashboard,
  InsightDependencyGraph,
  InsightHealthFramework,
  InsightIncidentView,
  InsightPrediction,
  InsightRecommendation,
  InsightTrendPoint,
  SignalRuntimeStatus,
} from '@neuropause/shared';

/** Tone vocabulary compatible with the existing OpsTone palette (subset). */
export type InsightTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

export function insightBandTone(band: string): InsightTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'orange';
    case 'at-risk':
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

export function confidenceLine(c: ConfidenceBreakdown): string {
  return `data ${Math.round(c.dataAvailability * 100)}% · quality ${Math.round(c.signalQuality * 100)}% · history ${Math.round(c.historicalCoverage * 100)}% · correlation ${Math.round(c.correlationStrength * 100)}%`;
}

/* ── health domains ───────────────────────────────────────────────────────── */

export interface DomainRow {
  key: string;
  label: string;
  scoreText: string;
  band: string;
  tone: InsightTone;
  explanation: string;
  evidenceCount: number;
  confidencePct: number;
  lowConfidence: boolean;
  unavailable: string | null;
}

export function domainRows(health: InsightHealthFramework): DomainRow[] {
  return health.domains.map((d) => ({
    key: d.key,
    label: d.label,
    scoreText: d.score == null ? '—' : `${d.score}/100`,
    band: d.band,
    tone: insightBandTone(d.band),
    explanation: d.explanation[0] ?? '',
    evidenceCount: d.evidence.length,
    confidencePct: Math.round(d.confidence * 100),
    lowConfidence: d.unavailable == null && d.confidence < 0.6,
    unavailable: d.unavailable,
  }));
}

/* ── signal honesty strip ─────────────────────────────────────────────────── */

export interface SignalSummary {
  available: number;
  total: number;
  stale: number;
  unavailableIds: string[];
}

export function signalSummary(signals: SignalRuntimeStatus[]): SignalSummary {
  return {
    available: signals.filter((s) => s.available).length,
    total: signals.length,
    stale: signals.filter((s) => s.freshness === 'stale' || s.freshness === 'aging').length,
    unavailableIds: signals.filter((s) => !s.available).map((s) => s.id),
  };
}

export interface SignalRow {
  id: string;
  statusText: string;
  tone: InsightTone;
  note: string | null;
}

/** Unavailable first, then stale/aging, then fresh — the problems lead. */
export function signalRows(signals: SignalRuntimeStatus[]): SignalRow[] {
  const rank = (s: SignalRuntimeStatus): number =>
    !s.available ? 0 : s.freshness === 'stale' ? 1 : s.freshness === 'aging' ? 2 : s.freshness === 'unknown' ? 3 : 4;
  return [...signals]
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    .map((s) => ({
      id: s.id,
      statusText: !s.available
        ? 'unavailable'
        : `${s.freshness}${s.itemCount != null ? ` · ${s.itemCount} record(s)` : ''} · ${Math.round(s.completeness * 100)}% complete`,
      tone: !s.available ? 'red' : s.freshness === 'stale' ? 'orange' : s.freshness === 'aging' ? 'orange' : 'green',
      note: s.note,
    }));
}

/* ── incidents / predictions / recommendations ────────────────────────────── */

export interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  tone: InsightTone;
  causeText: string;
  blastRadius: number;
  action: string | null;
}

export function incidentRows(incidents: InsightIncidentView[], limit = 8): IncidentRow[] {
  return incidents.slice(0, limit).map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    tone: i.severity === 'critical' ? 'red' : i.severity === 'warning' ? 'orange' : 'blue',
    causeText: i.rootCauseLabel
      ? `probable cause: ${i.rootCauseLabel} (${Math.round(i.rootCauseConfidence * 100)}%)`
      : 'no upstream cause ranked',
    blastRadius: i.blastRadius,
    action: i.recommendedActions[0] ?? null,
  }));
}

export interface PredictionRow {
  id: string;
  title: string;
  likelihoodPct: number;
  horizonText: string;
  detail: string;
  basis: string;
  action: string;
  confidencePct: number;
  evidenceCount: number;
}

export function predictionRows(predictions: InsightPrediction[], limit = 8): PredictionRow[] {
  return predictions.slice(0, limit).map((p) => ({
    id: p.id,
    title: p.title,
    likelihoodPct: Math.round(p.likelihood * 100),
    horizonText: `${p.horizonDays}d`,
    detail: p.detail,
    basis: p.basis,
    action: p.suggestedAction,
    confidencePct: Math.round(p.confidence.overall * 100),
    evidenceCount: p.evidence.length,
  }));
}

export interface OutcomeBadge {
  label: string;
  tone: InsightTone;
}

export function outcomeBadge(stage: string): OutcomeBadge {
  switch (stage) {
    case 'verified':
      return { label: 'Verified', tone: 'green' };
    case 'executed':
      return { label: 'Executed', tone: 'blue' };
    case 'approved':
      return { label: 'Approved', tone: 'blue' };
    default:
      return { label: 'Recommended', tone: 'gray' };
  }
}

export interface RecommendationRow {
  id: string;
  title: string;
  detail: string;
  priority: string;
  tone: InsightTone;
  action: string;
  confidencePct: number;
  confidenceDetail: string;
  signals: string[];
  evidence: string[];
  outcome: OutcomeBadge;
  outcomeSteps: { stage: string; detail: string; at: string }[];
}

export function recommendationRows(recs: InsightRecommendation[], limit = 10): RecommendationRow[] {
  return recs.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    priority: r.priority,
    tone: r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'orange' : r.priority === 'medium' ? 'blue' : 'gray',
    action: r.suggestedAction,
    confidencePct: Math.round(r.confidence.overall * 100),
    confidenceDetail: confidenceLine(r.confidence),
    signals: r.signals,
    evidence: r.evidence.slice(0, 6),
    outcome: outcomeBadge(r.outcome.stage),
    outcomeSteps: r.outcome.steps.map((s) => ({ stage: s.stage, detail: s.detail, at: s.at })),
  }));
}

/* ── dependency explanation (enhancement #2, rendered) ────────────────────── */

export interface ExplanationLine {
  kind: 'signal' | 'finding' | 'recommendation';
  label: string;
}

/**
 * Walk the dependency graph backwards from a recommendation: the findings it
 * derives from, and the signals evidencing those findings (or the
 * recommendation directly). Deterministic order; empty when the id is unknown.
 */
export function explainRecommendation(graph: InsightDependencyGraph, recoId: string): ExplanationLine[] {
  const target = `recommendation:${recoId}`;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  if (!byId.has(target)) return [];
  const findings = graph.edges
    .filter((e) => e.to === target && e.from.startsWith('finding:'))
    .map((e) => e.from);
  const signalSources = new Set<string>(
    graph.edges.filter((e) => e.to === target && e.from.startsWith('signal:')).map((e) => e.from),
  );
  for (const f of findings) {
    for (const e of graph.edges) {
      if (e.to === f && e.from.startsWith('signal:')) signalSources.add(e.from);
    }
  }
  const lines: ExplanationLine[] = [];
  for (const s of [...signalSources].sort()) {
    const n = byId.get(s);
    if (n) lines.push({ kind: 'signal', label: n.label });
  }
  for (const f of findings) {
    const n = byId.get(f);
    if (n) lines.push({ kind: 'finding', label: n.label });
  }
  const t = byId.get(target);
  if (t) lines.push({ kind: 'recommendation', label: t.label });
  return lines;
}

/* ── trend spark ──────────────────────────────────────────────────────────── */

export interface TrendModel {
  points: { day: string; overall: number; y01: number }[];
  deltaText: string | null;
}

export function trendModel(trend: InsightTrendPoint[]): TrendModel {
  if (trend.length === 0) return { points: [], deltaText: null };
  const points = trend.map((p) => ({ day: p.day, overall: p.overall, y01: Math.max(0, Math.min(1, p.overall / 100)) }));
  const delta = trend.length >= 2 ? trend[trend.length - 1].overall - trend[0].overall : null;
  return {
    points,
    deltaText: delta == null ? null : delta === 0 ? '±0' : delta > 0 ? `+${delta}` : String(delta),
  };
}

/* ── dashboard header ─────────────────────────────────────────────────────── */

export interface DashboardHeader {
  healthText: string;
  band: string;
  tone: InsightTone;
  confidencePct: number;
  confidenceDetail: string;
  signals: SignalSummary;
  unavailableCount: number;
}

export function dashboardHeader(d: InsightDashboard): DashboardHeader {
  return {
    healthText: d.health.overall == null ? '—' : `${d.health.overall}/100`,
    band: d.health.band,
    tone: insightBandTone(d.health.band),
    confidencePct: Math.round(d.confidence.overall * 100),
    confidenceDetail: confidenceLine(d.confidence),
    signals: signalSummary(d.signals),
    unavailableCount: d.unavailable.length,
  };
}

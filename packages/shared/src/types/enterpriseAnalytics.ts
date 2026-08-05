/**
 * Enterprise Analytics & Decision Intelligence — shared types (Phase 6 Stage 12).
 *
 * Stage 12 is a COMPOSITION LAYER over the analytics the repository already
 * computes: the ten KPI producers (aggregated live through the executive
 * snapshot + process mining + the P14/P18 reuse surfaces), the recorded
 * series (the 90-day health history and the Stage 10 decision windows — the
 * only real recorded windows; everything else is point-in-time and SAYS so),
 * the platform's existing predictive capability (seven deterministic Stage 6
 * heuristics, P14 scenario projections, capacity pressure — registered with
 * what each CAN and CANNOT predict), the decision funnel (decision store ×
 * Stage 6 outcome loop × Stage 10 value verdicts), and one cross-domain
 * executive analytics dashboard + report.
 *
 * STRUCTURAL HONESTY: no analytics engine, no metrics database, no statistics,
 * no ML, no extrapolation — trends are deterministic deltas over RECORDED
 * values; forecasting capability is REGISTERED, never invented; producers stay
 * authoritative; a failing producer becomes an explicit unavailable entry.
 *
 * Types + small pure vocabularies only. No engine, store, scheduler, or
 * executor lives here — or anywhere else in Stage 12.
 */
import type { OperationsRecommendation } from './operationsPlatform';

/* ── shared fragments ─────────────────────────────────────────────────────── */

export interface EanaUnavailable {
  system: string;
  reason: string;
}

export interface EanaGap {
  kind: 'unregistered-producer' | 'series' | 'coverage' | 'attribution';
  subject: string;
  detail: string;
}

/* ── registry definitions (typed data over REAL modules and vocabularies) ─── */

export type KpiProducerKind = 'producer' | 'reuse-surface' | 'partial-catalog';

export interface KpiProducerDef {
  id: string;
  /** The REAL module that computes (or re-surfaces) the KPIs. */
  module: string;
  kind: KpiProducerKind;
  /** Static keys this producer emits, or 'dynamic' when keys are data-driven. */
  keys: string[] | 'dynamic';
  /** The renderer surfaces the producer's KPIs appear on. */
  surfaces: string[];
  detail: string;
}

export type SeriesKind = 'daily-history' | 'decision-window' | 'point-in-time';

export interface SeriesDef {
  id: string;
  label: string;
  kind: SeriesKind;
  source: string;
  detail: string;
}

export type PredictionProducerKind = 'deterministic-heuristic' | 'scenario-projection' | 'present-state-composition';

export interface PredictionProducerDef {
  id: string;
  kind: PredictionProducerKind;
  source: string;
  /** What this capability CAN honestly foresee. */
  canPredict: string;
  /** What it explicitly CANNOT — stated, never implied. */
  cannotPredict: string;
  basis: string;
}

export interface ReportProducerDef {
  id: string;
  label: string;
  source: string;
}

export interface DashboardProducerDef {
  id: string;
  label: string;
  source: string;
}

export interface DecisionSourceDef {
  id: string;
  label: string;
  source: string;
}

/* ── computed: the unified KPI catalog ────────────────────────────────────── */

export type KpiAvailability = 'live' | 'unavailable';

export interface EanaKpiRow {
  key: string;
  label: string;
  value: number | null;
  display: string;
  band: string | null;
  /** The FEED the value was read from this pass. */
  source: string;
  /** The registered producing module, or 'unregistered' (an attribution gap). */
  producerId: string;
  /** Every surface this key is known to appear on (registry + live feeds). */
  surfaces: string[];
  availability: KpiAvailability;
  evidence: string[];
}

export interface EanaKpiCatalog {
  generatedAt: string;
  rows: EanaKpiRow[];
  totals: { total: number; live: number; healthy: number; attention: number; unregistered: number };
  /** Keys served by more than one live feed (reuse made visible, not resolved). */
  overlaps: { key: string; sources: string[] }[];
  gaps: EanaGap[];
  disclosure: string;
  unavailable: EanaUnavailable[];
}

/* ── computed: deterministic trend composition ────────────────────────────── */

// Named Eana* because continuousValidation.ts already exports a TrendDirection
// (the barrel must stay unambiguous — the Stage 10 TS2308 lesson).
export type EanaTrendDirection = 'improving' | 'stable' | 'regressing' | 'unavailable';

export interface EanaTrendRow {
  seriesId: string;
  label: string;
  kind: SeriesKind;
  windowLabel: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  direction: EanaTrendDirection;
  detail: string;
}

export interface EanaTrendReport {
  generatedAt: string;
  rows: EanaTrendRow[];
  totals: { improving: number; stable: number; regressing: number; unavailable: number };
  disclosure: string;
  unavailable: EanaUnavailable[];
}

/* ── computed: the forecast inventory (a register, never a forecaster) ────── */

export interface EanaForecastEntry {
  id: string;
  kind: PredictionProducerKind;
  source: string;
  /** Live instances this pass (e.g. currently-firing predictions), or null. */
  live: { count: number; detail: string } | null;
  canPredict: string;
  cannotPredict: string;
  basis: string;
}

export interface EanaForecastInventory {
  generatedAt: string;
  entries: EanaForecastEntry[];
  totals: { registered: number; liveInstances: number };
  disclosure: string;
  unavailable: EanaUnavailable[];
}

/* ── computed: decision intelligence rollup ───────────────────────────────── */

export interface EanaDecisionReport {
  generatedAt: string;
  funnel: {
    total: number;
    byStatus: { status: string; count: number }[];
    outcomeLoop: { recommended: number; approved: number; executed: number; verified: number };
  };
  /** Stage 10's computed value verdicts, composed verbatim; null = unreadable. */
  value: { delivered: number; partial: number; notYetObserved: number; unmeasurable: number } | null;
  /** Principle-C recommendation inventory from the SYNC stage dashboards. */
  recommendations: { source: string; count: number; criticalOrHigh: number }[];
  disclosure: string;
  unavailable: EanaUnavailable[];
}

/* ── computed: the executive analytics dashboard + report ─────────────────── */

export interface EanaDomainRollup {
  stage: string;
  label: string;
  state: 'attention' | 'steady' | 'unknown';
  summary: string;
}

export interface EanaDashboard {
  generatedAt: string;
  kpis: { total: number; live: number; healthy: number; attention: number; unregistered: number };
  trends: { improving: number; stable: number; regressing: number; unavailable: number };
  forecasts: { registered: number; liveInstances: number };
  decisions: { total: number; verified: number; delivered: number | null };
  domains: EanaDomainRollup[];
  /** The P18 sanitized benchmark posture, composed as ONE input; null = unreadable. */
  benchmarks: { position: string; healthBand: string } | null;
  recommendations: OperationsRecommendation[];
  disclosures: string[];
  unavailable: EanaUnavailable[];
}

export interface EanaReport {
  generatedAt: string;
  title: string;
  sections: { title: string; lines: string[] }[];
}

/* ── assistant questions (D-8) ────────────────────────────────────────────── */

export type EanaQuestionKey =
  | 'analytics-status'
  | 'kpi-catalog'
  | 'kpi-health'
  | 'trends'
  | 'regressions'
  | 'forecast-capability'
  | 'decision-intelligence'
  | 'benchmark-position'
  | 'data-coverage'
  | 'analytics-report';

export const EANA_QUESTION_KEYS: readonly EanaQuestionKey[] = [
  'analytics-status',
  'kpi-catalog',
  'kpi-health',
  'trends',
  'regressions',
  'forecast-capability',
  'decision-intelligence',
  'benchmark-position',
  'data-coverage',
  'analytics-report',
] as const;

/**
 * Enterprise Intelligence Layer — shared types (Phase 6 Stage 6).
 *
 * The insight layer CONSUMES signals the platform already produces, projects
 * them into the EXISTING P7 pure engines (graph / correlation / root cause /
 * risk / health / recommendation), and composes explainable, evidence-cited
 * intelligence on top. These types describe:
 *
 *   - the Enterprise Signal Registry (the Stage 6.1 map as typed data, extended
 *     with freshness / completeness / trust metadata for every signal),
 *   - the Confidence Breakdown every composed output carries (data
 *     availability × signal quality × historical coverage × correlation
 *     strength — never a single opaque number),
 *   - the Intelligence Dependency Graph (how correlated signals produced each
 *     recommendation — computed per report, stored nowhere),
 *   - the outcome lifecycle (recommendation → approval → execution →
 *     verification, each stage derived from real records or absent),
 *   - the unified health framework (eight composed domains), deterministic
 *     predictions, insight recommendations, and the executive dashboard.
 *
 * Types + small pure constants only. No engine lives here.
 */
import type { RecoPriority } from '../intelligence/enterpriseRecommendation';

/** The shared severity band vocabulary (mirrors the P7 health engine's bands,
 *  which are structural there — exported here for the composed surfaces). */
export type InsightBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/* ── Signal Registry (Stage 6.1 + enhancement #1) ─────────────────────────── */

/** How trustworthy a signal is as evidence, by provenance. */
export type SignalTrustTier =
  | 'provider-authoritative' // synced from the owning provider (UDM entities)
  | 'runtime-recorded' // recorded by our runtime at the moment it happened
  | 'derived' // deterministically computed from other signals
  | 'heuristic'; // scored/estimated (still deterministic, but interpretive)

/** How often a signal's value changes. */
export type SignalCadence = 'realtime' | 'per-sync' | 'scheduled' | 'daily' | 'on-demand' | 'on-view';

/** Enhancement #1 — expected freshness metadata for a signal. */
export interface SignalFreshness {
  cadence: SignalCadence;
  /** Minutes after which the signal should be considered stale; null = freshness
   *  is not time-meaningful (computed-on-demand signals are always current). */
  staleAfterMinutes: number | null;
}

/** Enhancement #1 — structural completeness metadata for a signal. */
export interface SignalCompleteness {
  /** 'full' = everything the platform knows · 'bounded' = capped/ring history ·
   *  'partial' = known structural gaps (documented in `note`). */
  coverage: 'full' | 'bounded' | 'partial';
  /** The bound or gap, stated plainly (e.g. "ring of last 200 runs"). */
  note: string | null;
}

/** Enhancement #1 — trust metadata for a signal. */
export interface SignalTrust {
  tier: SignalTrustTier;
  /** 0..1 — the evidence weight this signal contributes to confidence math. */
  score: number;
}

/** One entry of the Enterprise Signal Map (audit §3), as typed data (D-2). */
export interface SignalDefinition {
  /** Stable key, e.g. 'workforce-jobs'. */
  id: string;
  /** The audit table row number (1–22), locking code ↔ doc integrity. */
  mapIndex: number;
  name: string;
  /** Owning module / singleton, verbatim from the tree. */
  owner: string;
  freshness: SignalFreshness;
  completeness: SignalCompleteness;
  trust: SignalTrust;
  /** Signal ids this signal depends on. */
  dependsOn: string[];
  /** Existing consumers (documentation of reuse, not wiring). */
  consumers: string[];
}

/** Observed (runtime) status of one signal at report time. */
export interface SignalRuntimeStatus {
  id: string;
  /** False when the read port failed or is not wired — an explicit hole. */
  available: boolean;
  /** Records observed on this read (null when unavailable). */
  itemCount: number | null;
  /** Newest evidence timestamp observed (ISO), or null. */
  latestAt: string | null;
  /** Observed freshness vs the registry's expectation. */
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  /** 0..1 — observed completeness (available ∧ within declared bounds). */
  completeness: number;
  /** Why the signal is unavailable/degraded, stated plainly. Null when fine. */
  note: string | null;
}

/* ── Confidence Breakdown (enhancement #3) ────────────────────────────────── */

/**
 * Every composed insight output explains its confidence on four axes instead
 * of one opaque number. All values 0..1; `overall` is the weighted blend.
 */
export interface ConfidenceBreakdown {
  /** How many of the required signal reads were actually available. */
  dataAvailability: number;
  /** Trust-weighted quality of the signals that fed this output. */
  signalQuality: number;
  /** How much history backs trends/predictions (0 = none, 1 = full window). */
  historicalCoverage: number;
  /** Strength of the correlation/dependency links behind the finding. */
  correlationStrength: number;
  overall: number;
}

/* ── Intelligence Dependency Graph (enhancement #2) ───────────────────────── */

export type InsightDependencyNodeKind = 'signal' | 'finding' | 'recommendation';

export interface InsightDependencyNode {
  /** 'signal:<registryId>' | 'finding:<id>' | 'recommendation:<id>'. */
  id: string;
  kind: InsightDependencyNodeKind;
  label: string;
}

export interface InsightDependencyEdge {
  from: string;
  to: string;
  relation: 'evidence-of' | 'derived-from' | 'correlated-with';
}

/**
 * How correlated enterprise signals produced each recommendation — computed
 * with the report from the engines' own evidence links. No graph store: this
 * structure lives only inside the (briefly cached) report.
 */
export interface InsightDependencyGraph {
  nodes: InsightDependencyNode[];
  edges: InsightDependencyEdge[];
}

/* ── Outcome lifecycle (enhancement #3) ───────────────────────────────────── */

export type InsightOutcomeStage = 'recommended' | 'approved' | 'executed' | 'verified';

export const INSIGHT_OUTCOME_STAGES: readonly InsightOutcomeStage[] = [
  'recommended',
  'approved',
  'executed',
  'verified',
] as const;

/** One observed lifecycle step, always backed by a real record. */
export interface InsightOutcomeStep {
  stage: InsightOutcomeStage;
  at: string;
  /** The real record backing the stage (decision id / execution id / event id). */
  evidence: { kind: 'recommendation' | 'decision' | 'approval-event' | 'execution' | 'observation'; id: string };
  detail: string;
}

/**
 * The derived outcome lifecycle of a recommendation. Stages appear ONLY when a
 * real joinable record exists (a decision created from the recommendation, an
 * approval/execution sharing its correlation id, or a deterministic
 * re-observation that the underlying condition cleared). Nothing is assumed.
 */
export interface InsightOutcome {
  stage: InsightOutcomeStage;
  steps: InsightOutcomeStep[];
}

/* ── Health framework (Stage 6.7) ─────────────────────────────────────────── */

export type InsightHealthDomainKey =
  | 'organization'
  | 'departments'
  | 'projects'
  | 'workflows'
  | 'automations'
  | 'ai'
  | 'connectors'
  | 'approvals';

export const INSIGHT_HEALTH_DOMAINS: readonly InsightHealthDomainKey[] = [
  'organization',
  'departments',
  'projects',
  'workflows',
  'automations',
  'ai',
  'connectors',
  'approvals',
] as const;

/** One composed health domain — explained, evidenced, confidence-declared. */
export interface InsightHealthDomain {
  key: InsightHealthDomainKey;
  label: string;
  /** 0–100, or null when the domain's sources are unavailable. */
  score: number | null;
  band: InsightBand | 'unknown';
  /** WHY the score is what it is — computed statements, never narrative. */
  explanation: string[];
  /** Real record references backing the score (ids/keys). */
  evidence: string[];
  /** 0..1 — declared low when sources are missing ("at low confidence"). */
  confidence: number;
  /** Which composed source this domain reads (registry signal ids). */
  signals: string[];
  /** Set when the domain could not be computed at all. */
  unavailable: string | null;
}

export interface InsightHealthFramework {
  domains: InsightHealthDomain[];
  /** Weighted over available domains only; null when nothing was available. */
  overall: number | null;
  band: InsightBand | 'unknown';
  confidence: ConfidenceBreakdown;
  generatedAt: string;
}

/* ── Predictions (Stage 6.5) ──────────────────────────────────────────────── */

export type InsightPredictionKind =
  | 'approval-backlog'
  | 'project-delay'
  | 'connector-instability'
  | 'automation-failure'
  | 'inactivity'
  | 'operational-drift'
  | 'risk-trend';

export interface InsightPrediction {
  id: string;
  kind: InsightPredictionKind;
  title: string;
  detail: string;
  /** Days ahead the heuristic projects. */
  horizonDays: number;
  /** 0..1 likelihood the projected condition materializes (heuristic). */
  likelihood: number;
  confidence: ConfidenceBreakdown;
  /** Real record references (ids) the heuristic fired on. */
  evidence: string[];
  /** The deterministic basis, stated plainly (which history, which threshold). */
  basis: string;
  suggestedAction: string;
  /** Registry signal ids consumed. */
  signals: string[];
}

/* ── Recommendations + report (Stages 6.2–6.6, 6.10) ──────────────────────── */

export type InsightRecommendationCategory =
  | 'incident'
  | 'risk'
  | 'health'
  | 'dependency'
  | 'capacity'
  | 'drift'
  | 'security'
  | 'prediction'
  | 'monitor';

/**
 * A governed, explainable recommendation. The insight layer NEVER executes:
 * `suggestedAction` is what a human may run through the existing Assistant →
 * ExecuteEngine approval flow; `outcome` tracks what verifiably happened.
 */
export interface InsightRecommendation {
  id: string;
  category: InsightRecommendationCategory;
  title: string;
  detail: string;
  priority: RecoPriority;
  confidence: ConfidenceBreakdown;
  /** Real record references (node/incident/prediction ids). */
  evidence: string[];
  /** Registry signal ids that produced it (joins the dependency graph). */
  signals: string[];
  suggestedAction: string;
  /** The insight chain id (`ins_…`) its timeline events publish under. */
  correlationId: string;
  outcome: InsightOutcome;
}

/** An explicit hole in the report — a subsystem that could not be read. */
export interface InsightUnavailable {
  system: string;
  reason: string;
}

/** Summary of the projected intelligence graph (counts only — the full graph
 *  stays inside the engines; the dependency graph explains the links). */
export interface InsightGraphSummary {
  nodes: number;
  edges: number;
  byDomain: Record<string, number>;
  crossDomainEdges: number;
  /** How many nodes/edges/events the ops projection contributed. */
  projectedNodes: number;
  projectedEdges: number;
  projectedEvents: number;
}

export interface InsightIncidentView {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  startTs: number;
  endTs: number;
  eventIds: string[];
  resourceIds: string[];
  rootCauseLabel: string | null;
  rootCauseConfidence: number;
  blastRadius: number;
  recommendedActions: string[];
}

/** The composed Stage 6 report (computed on demand, cached ~3 s, stored nowhere). */
export interface InsightReport {
  generatedAt: string;
  signals: SignalRuntimeStatus[];
  graph: InsightGraphSummary;
  incidents: InsightIncidentView[];
  health: InsightHealthFramework;
  predictions: InsightPrediction[];
  recommendations: InsightRecommendation[];
  dependencies: InsightDependencyGraph;
  confidence: ConfidenceBreakdown;
  unavailable: InsightUnavailable[];
}

/* ── Executive Intelligence Dashboard (Stage 6.11) ────────────────────────── */

export interface InsightTrendPoint {
  day: string;
  overall: number;
}

export interface InsightDashboard {
  generatedAt: string;
  /** Current enterprise status, domain by domain. */
  health: InsightHealthFramework;
  /** Active risks = open (non-info) incidents, worst first. */
  activeIncidents: InsightIncidentView[];
  /** Tracked predictions, highest likelihood first. */
  predictions: InsightPrediction[];
  /** Recommended actions, ranked; each with evidence + outcome lifecycle. */
  recommendations: InsightRecommendation[];
  /** Health trend from the EXISTING 90-day history store. */
  trend: InsightTrendPoint[];
  /** Signal availability strip (the honesty header). */
  signals: SignalRuntimeStatus[];
  /** How correlated signals produced each recommendation (enhancement #2). */
  dependencies: InsightDependencyGraph;
  /** Outcome loop: previously-recommended conditions observed to have cleared
   *  (each was published as an `insight.outcome_verified` timeline event).
   *  In-memory observation log — bounded, never persisted. */
  recentlyVerified: { id: string; title: string; at: string }[];
  confidence: ConfidenceBreakdown;
  unavailable: InsightUnavailable[];
}

/* ── The ten questions (Primary Objective) ────────────────────────────────── */

export type InsightQuestionKey =
  | 'why-sales-decreased'
  | 'projects-at-risk'
  | 'what-changed-today'
  | 'teams-need-attention'
  | 'operational-anomalies'
  | 'yesterdays-failures'
  | 'workflows-failing'
  | 'blocking-approvals'
  | 'predict-next-week'
  | 'enterprise-health-summary';

export const INSIGHT_QUESTION_KEYS: readonly InsightQuestionKey[] = [
  'why-sales-decreased',
  'projects-at-risk',
  'what-changed-today',
  'teams-need-attention',
  'operational-anomalies',
  'yesterdays-failures',
  'workflows-failing',
  'blocking-approvals',
  'predict-next-week',
  'enterprise-health-summary',
] as const;

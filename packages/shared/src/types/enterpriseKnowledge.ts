/**
 * Enterprise Knowledge Fabric (P16) — view-model types.
 *
 * P16 is a READ-ONLY enrichment / projection LAYER. It is NOT a new graph, memory, search engine, or
 * vector database: it composes a unified, explainable Knowledge Fabric by projecting the EXISTING
 * systems — the Enterprise Relationship graph, the P7 Enterprise Intelligence report (graph summary /
 * health / risk / dependencies / incidents / recommendations), the P14 Strategy Platform (goals /
 * decisions / optimization / reasoning / simulation / KPIs), the P15 Digital Twin, the platform Timeline
 * (lineage), the AI-Memory corpus, the Marketplace, Federation, and Connector metadata — plus the
 * already-shipped knowledge derivations (`topicClusters` / `knowledgeHealth`). Every view is a
 * projection: it relates, contextualizes, classifies, traces lineage, and EXPLAINS enterprise objects
 * but executes nothing, mutates nothing, and introduces no duplicate graph, memory, or search.
 *
 * Names are prefixed `Fabric*` — verified collision-free — because the bare `Knowledge*` namespace is
 * already owned by the existing memory-derived Knowledge subsystem (`main/knowledge`, `knowledge:*`
 * channels). It reuses the platform `ExecutiveKpi` type unmodified.
 */
import type { ExecutiveKpi } from './executiveCenter';

/** Health/confidence band, mirrored locally (the intelligence `Band` is not exported). */
export type FabricBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/* ── Knowledge sources (Source Traceability) ─────────────────────────────────────── */

export type FabricSourceCategory = 'graph' | 'signal' | 'catalog' | 'operational' | 'intelligence' | 'corpus';

/** One knowledge source projected from an existing platform system — never a new store. */
export interface FabricSource {
  id: string;
  name: string;
  category: FabricSourceCategory;
  /** Entities/records this source contributes to the fabric (0 when the count lives in its own center). */
  entityCount: number;
  /** Share of the fabric's total known entities this source contributes, 0..100. */
  contributionPercent: number;
  band: FabricBand;
  /** Whether the source is populated/live (false = present but not yet seeded — honest on fresh installs). */
  live: boolean;
  /** The existing system + RBAC scope this source is gated by (provenance). */
  provenance: string;
  note: string;
}

export interface FabricSourceCatalog {
  sources: FabricSource[];
  total: number;
  liveCount: number;
  totalEntities: number;
  note: string;
}

/* ── Entity relationships (projected from the Enterprise Relationship graph — no new graph) ── */

export interface FabricKindCount {
  key: string;
  label: string;
  count: number;
}

/** A top-connected entity — kind/label/degree/health only; sensitive numeric internals are redacted. */
export interface FabricRelationEntity {
  kind: string;
  label: string;
  degree: number;
  band: FabricBand;
}

export interface FabricRelationshipMap {
  nodes: number;
  edges: number;
  /** Overall relationship-graph health (0..100), reused from the relationship model. */
  relationshipHealth: number;
  averageDegree: number;
  criticalEdges: number;
  highRiskEdges: number;
  disconnected: number;
  /** Entity-kind distribution (23 ERP kinds). */
  byKind: FabricKindCount[];
  /** Relation-type distribution (27 typed relations). */
  byType: FabricKindCount[];
  /** Health-band distribution over relationship edges. */
  byHealth: FabricKindCount[];
  topEntities: FabricRelationEntity[];
  /** Fabric-generated AGGREGATE narrative — the relationship model's named prose is NOT passed through. */
  narrative: { summary: string; grounded: boolean };
  note: string;
}

/* ── Classification + semantic tags ──────────────────────────────────────────────── */

export interface FabricTag {
  tag: string;
  count: number;
}

export interface FabricClassification {
  /** Knowledge by memory kind (decision/document/conversation/…). */
  byKind: FabricKindCount[];
  /** Knowledge by enterprise-graph domain (from the report graph summary). */
  byDomain: FabricKindCount[];
  /** Knowledge by origin source (connector id / manual). */
  bySource: FabricKindCount[];
  /** Semantic tag cloud (top tags across the corpus). */
  topTags: FabricTag[];
  /** Retention bands by recency (fresh / active / aging / stale). */
  retention: FabricKindCount[];
  /** Sensitivity bands derived from kind (restricted / internal / general). */
  sensitivity: FabricKindCount[];
  note: string;
}

/* ── Knowledge lineage (origin → transformation → usage → consumers, from the Timeline) ── */

export interface FabricLineageStage {
  stage: 'origin' | 'transformation' | 'usage' | 'consumers';
  label: string;
  count: number;
  /** The event categories/types this stage aggregates (traceability). */
  signals: string[];
  note: string;
}

/** A causal chain sample — correlation-keyed, redacted to metadata (no entity identities). */
export interface FabricLineageChain {
  correlationRef: string;
  events: number;
  categories: string[];
  since: string;
  until: string;
}

export interface FabricLineage {
  stages: FabricLineageStage[];
  chains: FabricLineageChain[];
  totalEvents: number;
  windowDays: number;
  note: string;
}

/* ── Evidence + explanations (every subject exposes Evidence / Sources / Reasoning / Confidence) ── */

export type FabricExplanationKind =
  | 'recommendation'
  | 'goal'
  | 'decision'
  | 'optimization'
  | 'reasoning'
  | 'simulation'
  | 'twin'
  | 'kpi';

/** A resolved evidence reference — the raw id enriched into semantic knowledge (the fabric's core value). */
export interface FabricEvidenceRef {
  id: string;
  label: string;
  /** Classified ref kind: entity / domain / signal / incident / industry / cloud / other. */
  kind: string;
  sourceSystem: string;
}

/** A unified explanation for one explainable subject — the canonical shape mirrors P14 StrategicDecision. */
export interface FabricExplanation {
  id: string;
  kind: FabricExplanationKind;
  subject: string;
  /** The reasoning / rationale (free text from the source, or a derived summary). */
  reasoning: string;
  /** The existing platform systems this subject draws on. */
  sources: string[];
  /** Evidence ids resolved into semantic knowledge refs. */
  evidence: FabricEvidenceRef[];
  /** 0..1. */
  confidence: number;
  confidenceBand: FabricBand;
  /** Whether the subject carries an approval requirement (approval-aware). */
  approvalAware: boolean;
}

export interface FabricEvidenceReport {
  explanations: FabricExplanation[];
  total: number;
  byKind: FabricKindCount[];
  /** Fraction of subjects that carry at least one resolved evidence ref, 0..100. */
  evidenceCoverage: number;
  /** Mean confidence across all explanations, 0..1. */
  avgConfidence: number;
  note: string;
}

/* ── Knowledge governance (reuses RBAC / Governance / Audit — no new governance) ── */

export interface FabricScopeRow {
  source: string;
  /** The RBAC permission gating this source in production. */
  permission: string;
  /** Whether the source's read is auditable via the existing timeline/audit. */
  auditable: boolean;
  note: string;
}

export interface FabricGovernance {
  /** All fabric channels are gated by this single read scope. */
  fabricScope: string;
  scopes: FabricScopeRow[];
  /** Redaction posture inherited from the projected layers. */
  redactions: string[];
  auditableSources: number;
  totalSources: number;
  note: string;
}

/* ── Analytics ───────────────────────────────────────────────────────────────────── */

export interface FabricConfidenceBucket {
  band: FabricBand;
  count: number;
}

export interface FabricSourceContribution {
  source: string;
  entityCount: number;
  percent: number;
}

export interface FabricAnalytics {
  /** Topic coverage of the corpus (memoriesInTopics / total), 0..100. */
  knowledgeCoverage: number;
  /** Fraction of explainable subjects carrying evidence, 0..100. */
  explanationCoverage: number;
  confidenceDistribution: FabricConfidenceBucket[];
  sourceContribution: FabricSourceContribution[];
  topDomains: FabricKindCount[];
  topTags: FabricTag[];
  overallHealth: number;
  healthBand: FabricBand;
  note: string;
}

/* ── Summary + overview bundle ───────────────────────────────────────────────────── */

export interface FabricSummary {
  generatedAt: string;
  /** Total distinct knowledge entities across all sources. */
  totalEntities: number;
  /** Number of contributing knowledge sources. */
  sourceCount: number;
  liveSources: number;
  /** Relationship edges known to the fabric. */
  relationships: number;
  /** Explainable subjects with a unified explanation. */
  explanations: number;
  evidenceCoverage: number;
  knowledgeCoverage: number;
  overallHealth: number;
  healthBand: FabricBand;
  /** Semantic tags in the corpus. */
  semanticTags: number;
}

export interface FabricOverview {
  summary: FabricSummary;
  sources: FabricSourceCatalog;
  relationships: FabricRelationshipMap;
  classification: FabricClassification;
  analytics: FabricAnalytics;
  /** Strategic KPIs reused from the platform ExecutiveKpi type (traceable, never recomputed). */
  kpis: ExecutiveKpi[];
}

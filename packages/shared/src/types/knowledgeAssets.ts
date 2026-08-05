/**
 * Enterprise Knowledge & Decision Platform — shared types (Phase 6 Stage 7).
 *
 * Stage 7 turns the records the platform ALREADY holds (decisions, governance
 * chains/rules, versioned prompts, synced documents, explicit memories,
 * connector manifests, the org chart, workflow runs, computed intelligence)
 * into one governed knowledge-asset semantic. These types describe:
 *
 *   - the Knowledge Asset Inventory (assets are CLASSIFICATIONS of existing
 *     records — owner, authority, freshness, lifecycle, version, access,
 *     criticality, retention, and a provenance chain, every field derived from
 *     a real record or explicitly absent),
 *   - the deterministic Authority Resolution precedence (enhancement #4),
 *   - the Knowledge Relationship Matrix + Impact Analysis (computed at runtime
 *     from existing edges; never persisted — enhancements #3),
 *   - Decision Lineage (origin → discussion → evidence → approval →
 *     implementation → verification → current status, each stage backed by a
 *     real record or absent),
 *   - the Knowledge Coverage Map across organizational domains (enhancement #2),
 *   - knowledge quality (9 dimensions), organizational standards (8 domains),
 *     hygiene recommendations, and the Knowledge Platform dashboard.
 *
 * Types + small pure constants only. No store, no engine, no executor lives
 * here — and none exists elsewhere for these shapes either: everything below
 * is computed per read from existing stores.
 */

/* ── asset classes ────────────────────────────────────────────────────────── */

/** The knowledge-asset classes (each backed by an EXISTING store or a declared boundary). */
export type KnowledgeAssetClassId =
  | 'executive-decision' // enterprise/decisionStore
  | 'governance-policy' // enterprise/governance approval chains
  | 'compliance-rule' // enterprise/governance compliance rules
  | 'ai-prompt' // ai/promptManager versioned registry
  | 'governed-document' // UDM document/file records classified as policy/SOP/ADR/playbook/spec
  | 'explicit-memory' // memoryStore explicit items (decision/document/note/context)
  | 'workflow-definition' // per-run workflow specs observed via jobs (no persisted library — honest gap)
  | 'connector-doc' // connector manifests (description/docsUrl/capabilities/scopes)
  | 'org-structure' // enterprise org chart (units/roles/leads)
  | 'capability-standard' // renderer capability registry — a DECLARED main-process boundary (not readable here)
  | 'derived-intelligence'; // computed reports (insight, fabric) — always current, derived

export const KNOWLEDGE_ASSET_CLASS_IDS: readonly KnowledgeAssetClassId[] = [
  'executive-decision',
  'governance-policy',
  'compliance-rule',
  'ai-prompt',
  'governed-document',
  'explicit-memory',
  'workflow-definition',
  'connector-doc',
  'org-structure',
  'capability-standard',
  'derived-intelligence',
] as const;

/** Authority tiers (the §3 audit vocabulary; ordered strongest → weakest). */
export type KnowledgeAuthorityTier =
  | 'governed'
  | 'org-defined'
  | 'versioned-library'
  | 'provider-authoritative'
  | 'authored'
  | 'derived';

/* ── enhancement #4 — deterministic authority precedence ─────────────────── */

/** The eight precedence ranks, exactly as approved (rank 1 = highest authority). */
export type AuthorityRankKey =
  | 'governed-decision'
  | 'governance-policy'
  | 'organization-standard'
  | 'approved-document'
  | 'versioned-prompt'
  | 'provider-document'
  | 'explicit-memory'
  | 'derived-knowledge';

export interface AuthorityRank {
  rank: number;
  key: AuthorityRankKey;
  label: string;
}

/** Governed Decision → Governance Policy → Organization Standard → Approved
 *  Document → Versioned Prompt → Provider Document → Explicit Memory → Derived
 *  Knowledge. Conflicting assets ALWAYS resolve through this order. */
export const AUTHORITY_PRECEDENCE: readonly AuthorityRank[] = [
  { rank: 1, key: 'governed-decision', label: 'Governed Decision' },
  { rank: 2, key: 'governance-policy', label: 'Governance Policy' },
  { rank: 3, key: 'organization-standard', label: 'Organization Standard' },
  { rank: 4, key: 'approved-document', label: 'Approved Document' },
  { rank: 5, key: 'versioned-prompt', label: 'Versioned Prompt' },
  { rank: 6, key: 'provider-document', label: 'Provider Document' },
  { rank: 7, key: 'explicit-memory', label: 'Explicit Memory' },
  { rank: 8, key: 'derived-knowledge', label: 'Derived Knowledge' },
] as const;

/** How one conflict was resolved (deterministic; the method is part of the result). */
export interface AuthorityResolution {
  winnerAssetId: string | null;
  ranked: {
    assetId: string;
    title: string;
    rankKey: AuthorityRankKey;
    rank: number;
    /** Why this asset sits where it does in the resolution. */
    reason: string;
  }[];
  /** Always 'authority-precedence → freshness → stable-id' (documented determinism). */
  method: string;
}

/* ── lifecycle (7.4 — derivation only; transitions stay governed writes) ──── */

export type KnowledgeLifecycleState =
  | 'draft'
  | 'review'
  | 'approved'
  | 'deprecated'
  | 'archived'
  | 'superseded';

export const KNOWLEDGE_LIFECYCLE_STATES: readonly KnowledgeLifecycleState[] = [
  'draft',
  'review',
  'approved',
  'deprecated',
  'archived',
  'superseded',
] as const;

/**
 * The declared legal transitions. This table DOCUMENTS governance — Stage 7
 * ships NO transition executor: state only ever changes through the existing
 * governed writes (decision setStatus under operations:manage, governance
 * chain/rule toggles under governance:manage, memory updates under the memory
 * governance path). Locked by test.
 */
export const KNOWLEDGE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<KnowledgeLifecycleState, readonly KnowledgeLifecycleState[]>
> = {
  draft: ['review', 'archived'],
  review: ['approved', 'draft', 'archived'],
  approved: ['deprecated', 'superseded', 'archived'],
  deprecated: ['archived'],
  superseded: ['archived'],
  archived: [],
} as const;

/* ── enhancement #1 — criticality / retention / provenance ────────────────── */

export type KnowledgeCriticality = 'critical' | 'high' | 'medium' | 'low';

/** The Stage 6 freshness vocabulary, reused verbatim. */
export type KnowledgeFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface KnowledgeRetentionPolicy {
  /** What ACTUALLY happens to records of this class (describes real store behavior). */
  kind: 'indefinite' | 'store-capped' | 'provider-managed' | 'governed' | 'version-permanent';
  detail: string;
  /** Which existing store/mechanism enforces it. */
  source: string;
}

export type ProvenanceStage =
  | 'created'
  | 'reviewed'
  | 'approved'
  | 'referenced'
  | 'superseded'
  | 'archived';

export const PROVENANCE_STAGES: readonly ProvenanceStage[] = [
  'created',
  'reviewed',
  'approved',
  'referenced',
  'superseded',
  'archived',
] as const;

/** One provenance-chain entry — present ONLY when a real record backs it. */
export interface KnowledgeProvenanceEvent {
  stage: ProvenanceStage;
  /** ISO timestamp, or null when the backing record carries no timestamp for
   *  this stage (stated in `note` — never guessed). */
  at: string | null;
  /** Real record references backing the stage (ids or deterministic sub-record pointers). */
  evidence: string[];
  note: string | null;
}

/* ── standard domains (7.6) ───────────────────────────────────────────────── */

export type StandardDomain =
  | 'engineering'
  | 'deployment'
  | 'security'
  | 'data-handling'
  | 'ai-usage'
  | 'communication'
  | 'operations'
  | 'compliance';

export const STANDARD_DOMAINS: readonly StandardDomain[] = [
  'engineering',
  'deployment',
  'security',
  'data-handling',
  'ai-usage',
  'communication',
  'operations',
  'compliance',
] as const;

/* ── the class registry entry ─────────────────────────────────────────────── */

export interface KnowledgeAssetClass {
  id: KnowledgeAssetClassId;
  label: string;
  description: string;
  /** Which EXISTING store/mechanism backs records of this class. */
  backing: string;
  authorityTier: KnowledgeAuthorityTier;
  /** Enhancement #4 — the class's default precedence rank (per-asset refinement allowed, e.g. approved documents). */
  authorityRank: AuthorityRankKey;
  /** Enhancement #1 — the class-level criticality floor the derivation starts from. */
  criticalityBase: KnowledgeCriticality;
  retention: KnowledgeRetentionPolicy;
  /** Days after which an asset of this class is stale; null = staleness is not time-meaningful. */
  staleAfterDays: number | null;
  /** The existing RBAC scope that gates reads of the backing source. */
  accessScope: string;
  dependencies: string[];
  consumers: string[];
  /** Standard domains this class can define standards for (empty = none). */
  standardDomains: StandardDomain[];
  /** False for declared main-process boundaries (e.g. the renderer capability registry). */
  mainReadable: boolean;
}

/* ── the asset envelope ───────────────────────────────────────────────────── */

export interface KnowledgeAsset {
  /** `ka:<classId>:<recordId>` — deterministic, computed, stored nowhere. */
  id: string;
  classId: KnowledgeAssetClassId;
  /** The REAL backing record id in its source system. */
  recordId: string;
  sourceSystem: string;
  title: string;
  /** Finer classification inside the class (e.g. document subkind: policy/sop/adr/playbook/spec). */
  subkind: string | null;

  /* — enhancement #1 — */
  owner: string | null;
  reviewOwner: string | null;
  /** How ownership was resolved — or why it could not be (a finding, never a guess). */
  ownerResolution: string;
  criticality: KnowledgeCriticality;
  criticalityReasons: string[];
  retention: KnowledgeRetentionPolicy;
  provenance: KnowledgeProvenanceEvent[];

  /* — authority + lifecycle — */
  authorityTier: KnowledgeAuthorityTier;
  authorityRankKey: AuthorityRankKey;
  authorityRank: number;
  /** Derived lifecycle state; null = the backing record carries no lifecycle marker (honest). */
  lifecycle: KnowledgeLifecycleState | null;
  lifecycleBasis: string;
  lifecycleEvidence: string[];

  /* — freshness + versioning + access — */
  freshness: KnowledgeFreshness;
  createdAt: string | null;
  updatedAt: string | null;
  version: string | null;
  accessScope: string;

  /* — classification honesty — */
  /** 0..1 — how confident the classifier is that this record belongs to this class. */
  classificationConfidence: number;
  /** The real markers that matched (title keyword, label, kind, store). */
  classificationSignals: string[];

  /* — joins — */
  topics: string[];
  entityRefs: string[];
  /** Real record references backing this envelope. */
  evidence: string[];
  domains: StandardDomain[];
  /** How many other records reference this one (from the computed reference index). */
  referencedBy: number;
}

export interface KnowledgeUnavailable {
  system: string;
  reason: string;
}

export interface KnowledgeInventory {
  generatedAt: string;
  assets: KnowledgeAsset[];
  byClass: {
    classId: KnowledgeAssetClassId;
    label: string;
    count: number;
    authorityTier: KnowledgeAuthorityTier;
    note: string | null;
  }[];
  /** Classes with zero backing records or declared boundaries — documentation gaps, never fabricated assets. */
  gaps: { classId: KnowledgeAssetClassId; label: string; reason: string }[];
  totals: {
    assets: number;
    classesWithRecords: number;
    withOwner: number;
    withLifecycle: number;
    stale: number;
  };
  unavailable: KnowledgeUnavailable[];
}

/* ── relationship matrix (computed, never persisted) ──────────────────────── */

export interface KnowledgeMatrixCell {
  from: KnowledgeAssetClassId;
  to: KnowledgeAssetClassId;
  /** The EXISTING mechanism the relations came from (graph edge type, evidence refs, entityRef overlap, correlation join…). */
  edgeSource: string;
  count: number;
}

export interface KnowledgeRelationshipMatrix {
  generatedAt: string;
  cells: KnowledgeMatrixCell[];
  totalRelations: number;
  /** Every mechanism consulted this build (absent feeds surface in `unavailable`). */
  edgeSources: string[];
  /** Structural: the matrix is computed per read and stored nowhere. */
  computedOnly: true;
  unavailable: KnowledgeUnavailable[];
}

/* ── enhancement #3 — impact analysis ─────────────────────────────────────── */

export type KnowledgeImpactKind =
  | 'decision'
  | 'workflow'
  | 'policy'
  | 'connector'
  | 'intelligence'
  | 'document'
  | 'memory';

export interface KnowledgeImpactEntry {
  kind: KnowledgeImpactKind;
  id: string;
  title: string;
  /** Which existing edge mechanism connected it. */
  via: string;
  evidence: string[];
}

export interface KnowledgeImpactAnalysis {
  assetId: string;
  found: boolean;
  title: string | null;
  entries: KnowledgeImpactEntry[];
  byKind: { kind: KnowledgeImpactKind; count: number }[];
  note: string;
}

/* ── decision lineage (7.3) ───────────────────────────────────────────────── */

export type LineageStageKey =
  | 'origin'
  | 'discussion'
  | 'evidence'
  | 'approval'
  | 'implementation'
  | 'verification'
  | 'status';

export const LINEAGE_STAGES: readonly LineageStageKey[] = [
  'origin',
  'discussion',
  'evidence',
  'approval',
  'implementation',
  'verification',
  'status',
] as const;

export interface DecisionLineageStage {
  stage: LineageStageKey;
  /** False = no real record backs this stage (the stage is honestly absent). */
  present: boolean;
  summary: string | null;
  at: string | null;
  evidence: string[];
  /** Per-stage confidence in the join (1 = direct record; lower = declared heuristic join). */
  confidence: number;
}

export interface DecisionLineage {
  decisionId: string;
  found: boolean;
  title: string | null;
  stages: DecisionLineageStage[];
  currentStatus: string | null;
  lifecycle: KnowledgeLifecycleState | null;
  /** Mean stage confidence × stage coverage — never claims more than the records support. */
  overallConfidence: number;
}

/* ── quality (7.5 — nine dimensions) ──────────────────────────────────────── */

export type KnowledgeQualityDimensionKey =
  | 'freshness'
  | 'ownership'
  | 'authority'
  | 'evidence-integrity'
  | 'conflicts'
  | 'coverage'
  | 'lifecycle-clarity'
  | 'review-discipline'
  | 'classification-confidence';

export const KNOWLEDGE_QUALITY_DIMENSIONS: readonly KnowledgeQualityDimensionKey[] = [
  'freshness',
  'ownership',
  'authority',
  'evidence-integrity',
  'conflicts',
  'coverage',
  'lifecycle-clarity',
  'review-discipline',
  'classification-confidence',
] as const;

export interface KnowledgeQualityDimension {
  key: KnowledgeQualityDimensionKey;
  label: string;
  /** 0..100, or null when the inputs to measure it are unavailable (honest). */
  score: number | null;
  detail: string;
  findings: number;
}

export type KnowledgeFindingKind =
  | 'outdated'
  | 'missing-owner'
  | 'conflict'
  | 'broken-reference'
  | 'duplicate'
  | 'decision-without-evidence'
  | 'undocumented-standard'
  | 'review-overdue';

export const KNOWLEDGE_FINDING_KINDS: readonly KnowledgeFindingKind[] = [
  'outdated',
  'missing-owner',
  'conflict',
  'broken-reference',
  'duplicate',
  'decision-without-evidence',
  'undocumented-standard',
  'review-overdue',
] as const;

export interface KnowledgeQualityFinding {
  id: string;
  kind: KnowledgeFindingKind;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  assetIds: string[];
  /** Real record references (never fabricated). */
  evidence: string[];
  /** The authority context (e.g. which precedence rank wins a conflict). */
  authority: string;
  confidence: number;
  suggestedAction: string;
}

export interface KnowledgeQualityReport {
  generatedAt: string;
  dimensions: KnowledgeQualityDimension[];
  findings: KnowledgeQualityFinding[];
  /** Mean of measurable dimensions; null when none are measurable. */
  overall: number | null;
  unavailable: KnowledgeUnavailable[];
}

/* ── standards (7.6) ──────────────────────────────────────────────────────── */

export interface DomainStandardEntry {
  assetId: string;
  title: string;
  rankKey: AuthorityRankKey;
  rank: number;
  updatedAt: string | null;
  freshness: KnowledgeFreshness;
}

export interface DomainStandard {
  domain: StandardDomain;
  label: string;
  /** False = "no standard defined" — a first-class honest answer. */
  defined: boolean;
  /** The winning asset(s) after deterministic authority resolution. */
  current: DomainStandardEntry[];
  resolution: AuthorityResolution | null;
  candidates: number;
  note: string;
}

export interface StandardsReport {
  generatedAt: string;
  domains: DomainStandard[];
  definedCount: number;
  totalDomains: number;
}

/* ── enhancement #2 — coverage map ────────────────────────────────────────── */

export type CoverageStatus = 'covered' | 'partial' | 'gap';

export interface CoverageDomainRow {
  domain: StandardDomain;
  label: string;
  assets: number;
  classesPresent: KnowledgeAssetClassId[];
  freshest: string | null;
  bestAuthorityRank: number | null;
  standardDefined: boolean;
  status: CoverageStatus;
  note: string;
}

export interface CoverageUnitRow {
  unitId: string;
  unitName: string;
  ownedAssets: number;
  hasLead: boolean;
  status: CoverageStatus;
}

export interface KnowledgeCoverageMap {
  generatedAt: string;
  domains: CoverageDomainRow[];
  units: CoverageUnitRow[];
  coveredDomains: number;
  totalDomains: number;
  note: string;
}

/* ── recommendations (7.8) ────────────────────────────────────────────────── */

export interface KnowledgeRecommendation {
  id: string;
  rule: KnowledgeFindingKind;
  title: string;
  detail: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  evidence: string[];
  authority: string;
  confidence: number;
  suggestedAction: string;
}

/* ── dashboard (7.10) ─────────────────────────────────────────────────────── */

export interface KnowledgeReviewQueueRow {
  assetId: string;
  title: string;
  reason: string;
  owner: string | null;
}

export interface KnowledgeAssetDashboard {
  generatedAt: string;
  inventory: {
    total: number;
    byClass: KnowledgeInventory['byClass'];
    gaps: KnowledgeInventory['gaps'];
    withOwner: number;
    stale: number;
  };
  quality: {
    overall: number | null;
    findings: number;
    topFindings: KnowledgeQualityFinding[];
    /** The nine measured dimensions (null scores = honestly not measurable). */
    dimensions: KnowledgeQualityDimension[];
  };
  standards: { defined: number; total: number };
  coverage: KnowledgeCoverageMap;
  /** Decisions whose lineage has ≥3 present stages (composable chains). */
  lineageReady: number;
  recommendations: KnowledgeRecommendation[];
  reviewQueue: KnowledgeReviewQueueRow[];
  matrix: { totalRelations: number; cells: number };
  unavailable: KnowledgeUnavailable[];
}

/* ── search lens (7.7) ────────────────────────────────────────────────────── */

/** A federated search hit joined with its knowledge-asset classification (pure join; no second engine). */
export interface KnowledgeSearchHit {
  source: string;
  id: string;
  kind: string;
  title: string;
  snippet: string | null;
  score: number;
  asset: {
    assetId: string;
    classId: KnowledgeAssetClassId;
    authorityRank: number;
    lifecycle: KnowledgeLifecycleState | null;
    freshness: KnowledgeFreshness;
  } | null;
}

/* ── assistant questions (7.11) ───────────────────────────────────────────── */

export type KnowledgeQuestionKey =
  | 'why-architecture'
  | 'deployment-policy'
  | 'which-decision-approved'
  | 'discussions-for-project'
  | 'current-standard'
  | 'which-sop'
  | 'why-connector'
  | 'outdated-knowledge'
  | 'conflicting-documents'
  | 'standards-changes';

export const KNOWLEDGE_QUESTION_KEYS: readonly KnowledgeQuestionKey[] = [
  'why-architecture',
  'deployment-policy',
  'which-decision-approved',
  'discussions-for-project',
  'current-standard',
  'which-sop',
  'why-connector',
  'outdated-knowledge',
  'conflicting-documents',
  'standards-changes',
] as const;

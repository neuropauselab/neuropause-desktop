/**
 * Enterprise Intelligence Network (P18) — view-model types.
 *
 * P18 is a READ-ONLY, governed intelligence-EXCHANGE projection LAYER. It is NOT a new runtime, worker
 * runtime, knowledge store, graph, memory, search, or marketplace: it lets organizations exchange
 * GOVERNED, SANITIZED intelligence (recommendations, patterns, benchmarks, templates, aggregate metrics,
 * risk signals) by projecting the EXISTING systems — the P16 Knowledge Fabric (whose evidence is already
 * identity-redacted), the P13 Industry benchmark reference, the P15 Twin / P17 Orchestration aggregate
 * metrics, and the EXISTING federation exchange substrate (exchange artifacts, packs, marketplace
 * templates) + federation trust/consent/policy. The cardinal invariant: NO raw enterprise records ever
 * leave the tenant — only authored text + aggregate numbers + own-org provenance are ever projected, and
 * every source is already reduced to a sanitized form before it enters the model. Names are prefixed
 * `IntelNetwork*` (verified collision-free). It reuses the platform `ExecutiveKpi` type unmodified.
 */
import type { ExecutiveKpi } from './executiveCenter';

/** Health / position band, mirrored locally (the universal ≥75/≥50/≥25 cutoff across P13–P17). */
export type IntelNetworkBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/* ── Shared intelligence (sanitized — recommendations + patterns) ── */

/** A recommendation projected from the P16 Knowledge Fabric — evidence reduced to ref KINDS (no ids). */
export interface SharedRecommendation {
  id: string;
  category: string;
  title: string;
  detail: string;
  /** 0..1. */
  confidence: number;
  band: IntelNetworkBand;
  /** Originating platform systems (names, not records). */
  sources: string[];
  /** Resolved evidence-ref KINDS only (e.g. 'signal', 'domain') — never entity ids/keys. */
  evidenceKinds: string[];
  /** Whether this intelligence is green-lit for exchange under governance. */
  shareable: boolean;
}

export interface IntelPattern {
  key: string;
  label: string;
  count: number;
  dimension: 'kind' | 'domain' | 'tag';
}

export interface IntelNetworkExchange {
  recommendations: SharedRecommendation[];
  patterns: IntelPattern[];
  shareableCount: number;
  /** Intelligence held back (restricted-sensitivity tier) — surfaced, never exchanged. */
  restrictedCount: number;
  note: string;
}

/* ── Benchmark exchange (org metrics vs industry reference) ── */

export type BenchmarkPosition = 'above' | 'at' | 'below' | 'unbenchmarked';

export interface BenchmarkRow {
  metric: string;
  label: string;
  /** The org's own aggregate value, 0..100. */
  orgValue: number;
  orgBand: IntelNetworkBand;
  /** The industry reference value, 0..100, or null when no reference exists. */
  industryValue: number | null;
  industryBand: IntelNetworkBand | null;
  /** orgValue − industryValue, or null when unbenchmarked. */
  delta: number | null;
  position: BenchmarkPosition;
}

export interface IntelNetworkBenchmarks {
  rows: BenchmarkRow[];
  aboveCount: number;
  belowCount: number;
  overallPosition: BenchmarkPosition;
  note: string;
}

/* ── Insight registry (published artifacts / packs / templates — catalog only) ── */

export interface RegistryEntry {
  id: string;
  kind: string;
  name: string;
  summary: string;
  /** Exchange scope (private/public/partner/regional) or the listing status. */
  scope: string;
  /** Which existing substrate this catalog entry is projected from. */
  source: 'exchange' | 'pack' | 'marketplace';
  verification: string;
  /** Published by the home org (provenance). */
  local: boolean;
  installs: number;
}

export interface IntelNetworkInsights {
  entries: RegistryEntry[];
  total: number;
  published: number;
  byKind: { key: string; label: string; count: number }[];
  byScope: { key: string; label: string; count: number }[];
  note: string;
}

/* ── Trust exchange (federation trust + consent + policy) ── */

export interface TrustRow {
  peer: string;
  trustLevel: string;
  canShareData: boolean;
  canShareWorkers: boolean;
  delegatedApproval: boolean;
  band: IntelNetworkBand;
}

export interface ExchangePolicy {
  name: string;
  scope: string;
  effect: string;
  action: string;
  enabled: boolean;
}

export interface IntelNetworkTrust {
  peers: TrustRow[];
  policies: ExchangePolicy[];
  dataSharingPeers: number;
  trustedPeers: number;
  openApprovals: number;
  note: string;
}

/* ── Organization intelligence (per-peer aggregate posture) ── */

export interface OrgIntelligence {
  peer: string;
  trustLevel: string;
  band: IntelNetworkBand;
  /** Whether governed data exchange is permitted with this peer. */
  canExchange: boolean;
  sharedOut: number;
  sharedIn: number;
}

export interface IntelNetworkOrganizations {
  organizations: OrgIntelligence[];
  activePeers: number;
  totalPeers: number;
  note: string;
}

/* ── Collective intelligence (network-wide aggregate trends) ── */

export interface CollectiveTrend {
  key: string;
  label: string;
  value: number;
  band: IntelNetworkBand;
}

export interface IntelNetworkCollective {
  trends: CollectiveTrend[];
  totalArtifacts: number;
  totalInstalls: number;
  benchmarkPosition: BenchmarkPosition;
  networkHealth: number;
  healthBand: IntelNetworkBand;
  note: string;
}

/* ── Governance (privacy posture — never share raw) ── */

export interface NetworkScopeRow {
  system: string;
  permission: string;
}

export interface IntelNetworkGovernance {
  networkScope: string;
  /** The load-bearing assertion: no raw enterprise data leaves the tenant. */
  neverShareRaw: string;
  policies: ExchangePolicy[];
  scopes: NetworkScopeRow[];
  /** Proof-of-sanitization, reused from the Knowledge Fabric's redaction posture. */
  redactions: string[];
  sanitizedSources: number;
  note: string;
}

/* ── Modules + overview bundle ── */

export interface NetworkModuleStatus {
  id: string;
  name: string;
  /** What this module exchanges. */
  coordinates: string;
  entityCount: number;
  band: IntelNetworkBand;
  live: boolean;
  /** The existing system it projects from (provenance). */
  source: string;
  note: string;
}

export interface IntelNetworkSummary {
  generatedAt: string;
  modules: number;
  liveModules: number;
  shareableIntelligence: number;
  publishedInsights: number;
  trustedPeers: number;
  dataSharingPeers: number;
  benchmarkPosition: BenchmarkPosition;
  overallHealth: number;
  healthBand: IntelNetworkBand;
}

export interface IntelNetworkOverview {
  summary: IntelNetworkSummary;
  modules: NetworkModuleStatus[];
  /** Strategic KPIs reused from the platform ExecutiveKpi type (traceable, never recomputed). */
  kpis: ExecutiveKpi[];
}

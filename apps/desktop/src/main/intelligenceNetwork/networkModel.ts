/**
 * Enterprise Intelligence Network (P18) — the pure projection model.
 *
 * All non-trivial network logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It projects a composed, ALREADY-SANITIZED snapshot of the EXISTING platform — the P16
 * Knowledge Fabric (evidence with redacted refs / classification / analytics / governance), the P13
 * Industry benchmark reference, the P15 Twin / P17 Orchestration aggregate metrics, and the EXISTING
 * federation exchange substrate (artifacts / packs / marketplace templates) + federation trust / consent
 * / policy — into governed intelligence-EXCHANGE VIEW MODELS: knowledge + recommendation exchange,
 * benchmark exchange, insight registry, trust exchange, organization intelligence, collective
 * intelligence, and a governance/privacy posture. Every value is an authored string, an aggregate number,
 * or own-org provenance — NO raw enterprise record ever appears (the composition root reduces each source
 * to a sanitized form before it enters this model). It introduces NO new store, runtime, graph, or search.
 */
import type {
  BenchmarkPosition,
  BenchmarkRow,
  CollectiveTrend,
  ExchangePolicy,
  ExecutiveKpi,
  IntelNetworkBand,
  IntelNetworkBenchmarks,
  IntelNetworkCollective,
  IntelNetworkExchange,
  IntelNetworkGovernance,
  IntelNetworkInsights,
  IntelNetworkOrganizations,
  IntelNetworkOverview,
  IntelNetworkSummary,
  IntelNetworkTrust,
  IntelPattern,
  NetworkModuleStatus,
  OrgIntelligence,
  RegistryEntry,
  SharedRecommendation,
  TrustRow,
} from '@neuropause/shared';

/* ── The composed, sanitized snapshot the projections read (assembled by the service) ── */

export interface NetworkMetric {
  key: string;
  label: string;
  /** 0..100 aggregate value. */
  value: number;
  band: IntelNetworkBand;
  /** Benchmark dimension used to pair org vs industry (e.g. 'coverage', 'readiness'). */
  dimension: string;
}

export interface SharedRecommendationInput {
  id: string;
  category: string;
  title: string;
  detail: string;
  confidence: number;
  sources: string[];
  /** Evidence-ref KINDS only — never entity ids/keys. */
  evidenceKinds: string[];
  shareable: boolean;
}

export interface RegistryEntryInput {
  id: string;
  kind: string;
  name: string;
  summary: string;
  scope: string;
  source: RegistryEntry['source'];
  verification: string;
  local: boolean;
  installs: number;
}

export interface IntelNetworkState {
  generatedAt: string;
  health: { overall: number; band: IntelNetworkBand };
  recommendations: SharedRecommendationInput[];
  patterns: IntelPattern[];
  /** Intelligence held back (restricted-sensitivity tier). */
  restrictedCount: number;
  orgMetrics: NetworkMetric[];
  industryRef: NetworkMetric[];
  registry: RegistryEntryInput[];
  exchangeSummary: { artifacts: number; published: number; verified: number; installs: number };
  trust: { peer: string; trustLevel: string; canShareData: boolean; canShareWorkers: boolean; delegatedApproval: boolean }[];
  fedSummary: { orgs: number; peers: number; activePeers: number; trustedPeers: number; sharedOut: number; sharedIn: number };
  policies: ExchangePolicy[];
  openApprovals: number;
  /** Proof-of-sanitization, reused from the Knowledge Fabric's redaction posture. */
  redactions: string[];
  kpis: ExecutiveKpi[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);
const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

/** Score (0..100) → band; the universal ≥75/≥50/≥25 cutoff shared across P13–P17. */
export function bandFor(score: number): IntelNetworkBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}
/** Confidence (0..1) → band. */
export function confBand(c: number): IntelNetworkBand {
  return c >= 0.75 ? 'healthy' : c >= 0.5 ? 'watch' : c >= 0.25 ? 'at-risk' : 'critical';
}
/** Federation trust level → band. */
export function trustBand(level: string): IntelNetworkBand {
  return level === 'full' ? 'healthy' : level === 'verified' ? 'watch' : level === 'basic' ? 'at-risk' : 'critical';
}

/**
 * Deterministic short token (FNV-1a) from a raw id — so no raw entity/resource id (which upstream recommendation
 * ids can embed, e.g. `reco:spof:erp:customer:<id>`) is ever projected into the exchange. Same input → same token.
 */
export function synthId(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

const REC_CATEGORY_LABEL: Record<string, string> = {
  recommendation: 'Recommendation',
  reasoning: 'Reasoning',
  optimization: 'Optimization',
  goal: 'Goal',
  decision: 'Decision',
};
const recCategoryLabel = (c: string): string => REC_CATEGORY_LABEL[c] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Signal');
const confidenceWord = (b: IntelNetworkBand): string => (b === 'healthy' ? 'high' : b === 'watch' ? 'moderate' : 'low');

const toCounts = (rows: { key: string; label: string; count: number }[]): { key: string; label: string; count: number }[] =>
  [...rows].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

/* ── Knowledge + recommendation exchange (sanitized) ── */

export function buildIntelNetworkExchange(s: IntelNetworkState): IntelNetworkExchange {
  const recommendations: SharedRecommendation[] = s.recommendations
    .map((r) => {
      const band = confBand(r.confidence);
      // Defense-in-depth: keep only lowercase kind tokens (never entity ids/keys), matching the cardinal lock.
      const kinds = r.evidenceKinds.filter((k) => /^[a-z]+$/.test(k));
      // GOVERNED, entity-free projection. The upstream authored title/detail can embed raw enterprise entity
      // NAMES (e.g. a single-point-of-failure's graph label) and the id can embed raw entity/resource ids, so
      // the exchange projects ONLY the recommendation's TYPE + confidence band + evidence-kind basis. The
      // entity-specific text is retained locally under Knowledge Fabric governance and is never exchanged.
      return {
        id: `rec:${synthId(r.id)}`,
        category: r.category,
        title: `${recCategoryLabel(r.category)} · ${confidenceWord(band)} confidence`,
        detail: kinds.length
          ? `Governed ${r.category} backed by ${kinds.join(', ')} evidence. Entity-specific detail is retained locally under Knowledge Fabric governance and is never exchanged.`
          : `Governed ${r.category}. Entity-specific detail is retained locally under Knowledge Fabric governance and is never exchanged.`,
        confidence: Number(clamp01(r.confidence).toFixed(2)),
        band,
        sources: r.sources,
        evidenceKinds: kinds,
        shareable: r.shareable,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  const patterns = [...s.patterns].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 24);
  return {
    recommendations,
    patterns,
    shareableCount: recommendations.filter((r) => r.shareable).length,
    restrictedCount: s.restrictedCount,
    note: 'Governed intelligence projected from the P16 Knowledge Fabric. Recommendations are reduced to TYPE + confidence + evidence-kind basis (synthetic id, no raw entity ids); the entity-bearing authored text stays local and is never exchanged. Patterns are aggregate counts. Restricted-sensitivity intelligence is held back. No raw enterprise record is projected.',
  };
}

/* ── Benchmark exchange (org metrics vs industry reference) ── */

function positionFor(delta: number): BenchmarkPosition {
  return delta > 2 ? 'above' : delta < -2 ? 'below' : 'at';
}

export function buildIntelNetworkBenchmarks(s: IntelNetworkState): IntelNetworkBenchmarks {
  const baseline = s.industryRef.length ? s.industryRef.reduce((n, m) => n + m.value, 0) / s.industryRef.length : null;
  const rows: BenchmarkRow[] = s.orgMetrics
    .map((m) => {
      const matched = s.industryRef.find((r) => r.dimension === m.dimension);
      const industryValue = matched ? matched.value : baseline;
      const industryBand = matched ? matched.band : industryValue != null ? bandFor(industryValue) : null;
      const delta = industryValue != null ? round(m.value) - round(industryValue) : null;
      return {
        metric: m.key,
        label: m.label,
        orgValue: round(m.value),
        orgBand: m.band,
        industryValue: industryValue != null ? round(industryValue) : null,
        industryBand,
        delta,
        position: delta != null ? positionFor(delta) : ('unbenchmarked' as BenchmarkPosition),
      };
    })
    .sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999) || a.metric.localeCompare(b.metric));
  const benchmarked = rows.filter((r) => r.position !== 'unbenchmarked');
  const above = benchmarked.filter((r) => r.position === 'above').length;
  const below = benchmarked.filter((r) => r.position === 'below').length;
  const overallPosition: BenchmarkPosition = benchmarked.length === 0 ? 'unbenchmarked' : above > below ? 'above' : below > above ? 'below' : 'at';
  return {
    rows,
    aboveCount: above,
    belowCount: below,
    overallPosition,
    note: 'Benchmark position compares the org\'s own aggregate metrics against the P13 Industry reference bands (or the industry baseline where no dimension-specific reference exists). Only aggregate 0..100 metrics are compared — no raw records. Industry reference is the locally-available solution-pack maturity, not a live peer-data average.',
  };
}

/* ── Insight registry (published artifacts / packs / templates — catalog only) ── */

const KIND_LABEL: Record<string, string> = {
  knowledge_package: 'Knowledge pack',
  dashboard_template: 'Dashboard template',
  workflow_template: 'Workflow template',
  governance_policy: 'Governance policy',
  connector_pack: 'Connector pack',
  ai_worker: 'AI worker',
  enterprise_template: 'Enterprise template',
  knowledge: 'Knowledge pack',
  automation: 'Automation',
  connector: 'Connector',
};
const kindLabel = (k: string): string => KIND_LABEL[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ') : k);

export function buildIntelNetworkInsights(s: IntelNetworkState): IntelNetworkInsights {
  const entries: RegistryEntry[] = s.registry
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, summary: e.summary, scope: e.scope, source: e.source, verification: e.verification, local: e.local, installs: e.installs }))
    .sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name));
  const byKindMap = new Map<string, number>();
  const byScopeMap = new Map<string, number>();
  for (const e of entries) {
    byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + 1);
    byScopeMap.set(e.scope, (byScopeMap.get(e.scope) ?? 0) + 1);
  }
  return {
    entries,
    total: entries.length,
    published: entries.filter((e) => e.local).length,
    byKind: toCounts([...byKindMap.entries()].map(([key, count]) => ({ key, label: kindLabel(key), count }))),
    byScope: toCounts([...byScopeMap.entries()].map(([key, count]) => ({ key, label: key, count }))),
    note: 'The insight registry projects the EXISTING federation exchange artifacts, ecosystem packs, and marketplace enterprise-templates — catalog descriptors only (name / summary / scope / provenance / installs). These carriers hold no enterprise records by construction.',
  };
}

/* ── Trust exchange (federation trust + consent + policy) ── */

export function buildIntelNetworkTrust(s: IntelNetworkState): IntelNetworkTrust {
  const peers: TrustRow[] = s.trust
    .map((t) => ({ peer: t.peer, trustLevel: t.trustLevel, canShareData: t.canShareData, canShareWorkers: t.canShareWorkers, delegatedApproval: t.delegatedApproval, band: trustBand(t.trustLevel) }))
    .sort((a, b) => a.peer.localeCompare(b.peer));
  return {
    peers,
    policies: s.policies,
    dataSharingPeers: peers.filter((p) => p.canShareData).length,
    trustedPeers: s.fedSummary.trustedPeers,
    openApprovals: s.openApprovals,
    note: 'Trust exchange projects the EXISTING federation consent model — per-peer trust level + data/worker sharing flags + delegated approval — and the federation policies (allow / deny / require-approval). This is the who-may-exchange-what gate; the layer enforces it, never bypasses it.',
  };
}

/* ── Organization intelligence (per-peer aggregate posture) ── */

export function buildIntelNetworkOrganizations(s: IntelNetworkState): IntelNetworkOrganizations {
  const organizations: OrgIntelligence[] = s.trust
    .map((t) => ({
      peer: t.peer,
      trustLevel: t.trustLevel,
      band: trustBand(t.trustLevel),
      canExchange: t.canShareData,
      sharedOut: 0,
      sharedIn: 0,
    }))
    .sort((a, b) => a.peer.localeCompare(b.peer));
  return {
    organizations,
    activePeers: s.fedSummary.activePeers,
    totalPeers: s.fedSummary.peers,
    note: 'Organization intelligence projects each federated peer\'s aggregate exchange posture (trust level + whether governed exchange is permitted) — never any peer\'s private intelligence or raw data.',
  };
}

/* ── Collective intelligence (network-wide aggregate trends) ── */

export function buildIntelNetworkCollective(s: IntelNetworkState): IntelNetworkCollective {
  const bench = buildIntelNetworkBenchmarks(s);
  const avgOrg = s.orgMetrics.length ? s.orgMetrics.reduce((n, m) => n + m.value, 0) / s.orgMetrics.length : 0;
  // Share of the org's own recommendations that are exchange-eligible — a 0..100 metric, so value and band
  // are derived from the SAME number (no count-vs-scaled-count mismatch) and read consistently beside its siblings.
  const shareableRatio = s.recommendations.length ? round((s.recommendations.filter((r) => r.shareable).length / s.recommendations.length) * 100) : 0;
  const trends: CollectiveTrend[] = [
    { key: 'coverage', label: 'Aggregate coverage', value: round(avgOrg), band: bandFor(avgOrg) },
    { key: 'health', label: 'Network health', value: round(s.health.overall), band: s.health.band },
    { key: 'shareable', label: 'Shareable intelligence', value: shareableRatio, band: bandFor(shareableRatio) },
  ];
  return {
    trends,
    // registry already includes the federation-exchange artifacts (plus packs + templates); count it once.
    totalArtifacts: s.registry.length,
    totalInstalls: s.exchangeSummary.installs,
    benchmarkPosition: bench.overallPosition,
    networkHealth: round(s.health.overall),
    healthBand: s.health.band,
    note: 'Collective intelligence aggregates the network-wide exchange volume + the org\'s benchmark position + aggregate metric trends. Every figure is an aggregate; no per-org raw intelligence is combined.',
  };
}

/* ── Governance (privacy posture — never share raw) ── */

export function buildIntelNetworkGovernance(s: IntelNetworkState): IntelNetworkGovernance {
  return {
    networkScope: 'network:read',
    neverShareRaw: 'No raw enterprise records leave the tenant. Only authored text, aggregate numbers, and own-org provenance are ever projected; every recommendation\'s evidence is reduced to ref kinds (never entity ids), and restricted-sensitivity intelligence is held back. Exchange carriers (federation artifacts / packs / marketplace templates) hold no records by construction.',
    policies: s.policies,
    scopes: [
      { system: 'Shared knowledge + recommendations', permission: 'knowledge:read' },
      { system: 'Benchmark reference (industry)', permission: 'industry:read' },
      { system: 'Insight registry (exchange + marketplace)', permission: 'federation:read' },
      { system: 'Trust + consent + policy', permission: 'federation:read' },
      { system: 'Org metrics (twin / orchestration)', permission: 'twin:read' },
    ].sort((a, b) => a.system.localeCompare(b.system)),
    redactions: s.redactions,
    sanitizedSources: s.redactions.length,
    note: 'Network governance reuses the existing RBAC, federation trust/policy, and Knowledge-Fabric redaction posture. All channels require network:read; each source keeps its own production scope. The layer adds no new governance engine and shares no raw data.',
  };
}

/* ── Modules + summary + overview bundle ── */

export function buildNetworkModules(s: IntelNetworkState): NetworkModuleStatus[] {
  const shareable = s.recommendations.filter((r) => r.shareable).length;
  const bench = buildIntelNetworkBenchmarks(s);
  return [
    { id: 'knowledge-exchange', name: 'Knowledge Exchange', coordinates: 'Aggregate patterns + tags', entityCount: s.patterns.length, band: s.patterns.length > 0 ? 'healthy' : 'watch', live: s.patterns.length > 0, source: 'P16 Knowledge Fabric', note: 'Shareable patterns; knowledge stays local.' },
    { id: 'recommendation-exchange', name: 'Recommendation Exchange', coordinates: 'Sanitized recommendations', entityCount: s.recommendations.length, band: shareable > 0 ? 'healthy' : 'watch', live: s.recommendations.length > 0, source: 'P16 Knowledge Fabric', note: 'Evidence reduced to ref kinds.' },
    { id: 'benchmark-exchange', name: 'Benchmark Exchange', coordinates: 'Org vs industry position', entityCount: bench.rows.length, band: bench.overallPosition === 'below' ? 'at-risk' : bench.overallPosition === 'unbenchmarked' ? 'watch' : 'healthy', live: bench.rows.length > 0, source: 'P13 Industry reference', note: 'Aggregate metrics only.' },
    { id: 'insight-registry', name: 'Insight Registry', coordinates: 'Published artifacts / templates / packs', entityCount: s.registry.length, band: s.registry.length > 0 ? 'healthy' : 'watch', live: s.registry.length > 0, source: 'Federation exchange + Marketplace', note: 'Catalog descriptors only.' },
    { id: 'trust-exchange', name: 'Trust Exchange', coordinates: 'Consent + policies', entityCount: s.trust.length, band: s.fedSummary.trustedPeers > 0 ? 'healthy' : 'watch', live: s.trust.length > 0, source: 'Federation trust', note: 'Who may exchange what.' },
    { id: 'org-intelligence', name: 'Organization Intelligence', coordinates: 'Per-peer posture', entityCount: s.fedSummary.peers, band: s.fedSummary.activePeers > 0 ? 'healthy' : 'watch', live: s.fedSummary.peers > 0, source: 'Federation', note: 'Aggregate posture only.' },
    { id: 'collective-intelligence', name: 'Collective Intelligence', coordinates: 'Network-wide trends', entityCount: s.exchangeSummary.artifacts, band: s.health.band, live: true, source: 'Aggregate exchange', note: 'No per-org raw data combined.' },
  ];
}

export function buildIntelNetworkSummary(s: IntelNetworkState): IntelNetworkSummary {
  const modules = buildNetworkModules(s);
  const bench = buildIntelNetworkBenchmarks(s);
  return {
    generatedAt: s.generatedAt,
    modules: modules.length,
    liveModules: modules.filter((m) => m.live).length,
    shareableIntelligence: s.recommendations.filter((r) => r.shareable).length + s.patterns.length,
    publishedInsights: s.registry.filter((e) => e.local).length,
    trustedPeers: s.fedSummary.trustedPeers,
    dataSharingPeers: s.trust.filter((t) => t.canShareData).length,
    benchmarkPosition: bench.overallPosition,
    overallHealth: round(s.health.overall),
    healthBand: s.health.band,
  };
}

export function buildIntelNetworkOverview(s: IntelNetworkState): IntelNetworkOverview {
  return {
    summary: buildIntelNetworkSummary(s),
    modules: buildNetworkModules(s),
    kpis: s.kpis,
  };
}

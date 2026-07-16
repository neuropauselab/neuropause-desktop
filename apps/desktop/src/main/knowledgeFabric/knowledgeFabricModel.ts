/**
 * Enterprise Knowledge Fabric (P16) — the pure projection model.
 *
 * All non-trivial fabric logic lives here (the house pure-model pattern) so it is unit-tested under Node
 * with no I/O. It projects a composed snapshot of the EXISTING platform — the Enterprise Relationship
 * graph, the P7 Enterprise Intelligence report, the P14 Strategy Platform, the P15 Digital Twin, the
 * platform Timeline, the AI-Memory corpus (via the shipped `topicClusters`/`knowledgeHealth`
 * derivations), the Marketplace, Federation, and Connector metadata — into unified Knowledge Fabric
 * VIEW MODELS: a source catalog (traceability), an entity-relationship map, a classification/semantic-tag
 * report, a lineage report, a unified Evidence/Sources/Reasoning/Confidence explanation model, a
 * governance posture, and analytics. It relates, contextualizes, classifies, traces, and EXPLAINS the
 * enterprise but executes nothing, mutates nothing, and introduces NO new graph, memory, or search.
 */
import type {
  EnterpriseTwinOverview,
  ExecutiveKpi,
  FabricAnalytics,
  FabricBand,
  FabricClassification,
  FabricConfidenceBucket,
  FabricEvidenceRef,
  FabricEvidenceReport,
  FabricExplanation,
  FabricExplanationKind,
  FabricGovernance,
  FabricKindCount,
  FabricLineage,
  FabricLineageChain,
  FabricLineageStage,
  FabricOverview,
  FabricRelationEntity,
  FabricRelationshipMap,
  FabricScopeRow,
  FabricSource,
  FabricSourceCatalog,
  FabricSourceCategory,
  FabricSummary,
  FabricTag,
  PlatformEvent,
  StrategyOverview,
  TimelinePage,
  TimelineQuery,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the service from live sources) ── */

export interface FabricSourceInput {
  id: string;
  name: string;
  category: FabricSourceCategory;
  entityCount: number;
  live: boolean;
  provenance: string;
  note: string;
  /** RBAC scope this source is gated by in production (governance posture). */
  permission: string;
  band?: FabricBand;
}

export interface FabricExplanationInput {
  id: string;
  kind: FabricExplanationKind;
  subject: string;
  reasoning: string;
  sources: string[];
  /** Raw evidence ids/refs (resolved into semantic knowledge by the model). */
  evidence: string[];
  /** 0..1. */
  confidence: number;
  approvalAware: boolean;
}

export interface FabricRelationshipInput {
  nodes: number;
  edges: number;
  relationshipHealth: number;
  averageDegree: number;
  criticalEdges: number;
  highRiskEdges: number;
  disconnected: number;
  byKind: { key: string; count: number }[];
  byType: { key: string; count: number }[];
  byHealth: { key: string; count: number }[];
  topEntities: { kind: string; label: string; degree: number; health: string }[];
  narrative: { grounded: boolean };
}

export interface FabricCorpusInput {
  total: number;
  withEntities: number;
  byKind: { key: string; count: number }[];
  bySource: { key: string; count: number }[];
  topTags: { tag: string; count: number }[];
  tagCount: number;
  retention: { key: string; count: number }[];
  sensitivity: { key: string; count: number }[];
  topics: number;
  coveragePercent: number;
  orphanCount: number;
  avgEntitiesPerMemory: number;
  largestTopicSize: number;
}

export interface FabricGraphInput {
  nodes: number;
  edges: number;
  byDomain: { key: string; count: number }[];
  crossDomainEdges: number;
}

export interface FabricLineageInput {
  stages: { stage: FabricLineageStage['stage']; label: string; count: number; signals: string[]; note: string }[];
  chains: { correlationRef: string; events: number; categories: string[]; since: string; until: string }[];
  totalEvents: number;
  windowDays: number;
}

export interface FabricState {
  generatedAt: string;
  sources: FabricSourceInput[];
  corpus: FabricCorpusInput;
  relationships: FabricRelationshipInput;
  graph: FabricGraphInput;
  explanations: FabricExplanationInput[];
  lineage: FabricLineageInput;
  health: { overall: number; band: FabricBand };
  kpis: ExecutiveKpi[];
  /** Known enterprise-graph domain keys, used to resolve evidence refs. */
  knownDomains: string[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);
const pct = (n: number, d: number): number => (d <= 0 ? 0 : Math.round((n / d) * 100));
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const titleKind = (k: string): string => (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Entity');
/** Entities (real records) contributed to the fabric — timeline/signal sources are events, not entities. */
const entityTotal = (sources: readonly { category: FabricSourceCategory; entityCount: number }[]): number =>
  sources.filter((x) => x.category !== 'signal').reduce((n, x) => n + x.entityCount, 0);

/** Confidence (0..1) → band. */
export function confidenceBand(c: number): FabricBand {
  return c >= 0.75 ? 'healthy' : c >= 0.5 ? 'watch' : c >= 0.25 ? 'at-risk' : 'critical';
}
/** Score (0..100) → band; an empty/unpopulated signal reads 'watch', not the alarmist 'critical'. */
export function scoreBand(score: number): FabricBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}
/** Relationship-graph health string → band. */
function relHealthBand(h: string): FabricBand {
  return h === 'strong' || h === 'healthy' ? 'healthy' : h === 'weak' || h === 'dormant' ? 'watch' : h === 'broken' ? 'at-risk' : h === 'critical' ? 'critical' : 'watch';
}

function humanize(raw: string): string {
  const body = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  const spaced = body.replace(/[._-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}

const toCounts = (rows: { key: string; count: number }[]): FabricKindCount[] =>
  rows
    .map((r) => ({ key: r.key, label: humanize(r.key), count: r.count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

/* ── Evidence-ref resolution — the enrichment: raw ids/keys → semantic knowledge refs ── */

const RELATIONSHIP_KINDS: ReadonlySet<string> = new Set([
  'customer', 'supplier', 'product', 'warehouse', 'machine', 'workCenter', 'technician', 'asset',
  'bom', 'productionOrder', 'schedule', 'execution', 'quality', 'order', 'quote', 'invoice',
  'payment', 'purchaseOrder', 'goodsReceipt', 'workOrder', 'downtime', 'decision', 'proposal',
]);

/** Non-identifying label for a redacted entity evidence ref (never the entity key/name). */
const ENTITY_REF_LABEL: Record<string, string> = { res: 'Resource', erp: 'Business entity', node: 'Graph node' };

const REF_PREFIX_MAP: Record<string, { kind: string; system: string }> = {
  res: { kind: 'entity', system: 'Enterprise Graph' },
  erp: { kind: 'entity', system: 'Enterprise Graph' },
  node: { kind: 'entity', system: 'Enterprise Graph' },
  incident: { kind: 'incident', system: 'Enterprise Intelligence' },
  health: { kind: 'signal', system: 'Enterprise Intelligence' },
  risk: { kind: 'signal', system: 'Enterprise Intelligence' },
  score: { kind: 'signal', system: 'Enterprise Intelligence' },
  spof: { kind: 'signal', system: 'Enterprise Intelligence' },
  industry: { kind: 'industry', system: 'Industry Platform' },
  quota: { kind: 'cloud', system: 'Cloud Control Plane' },
  cloud: { kind: 'cloud', system: 'Cloud Control Plane' },
  deployment: { kind: 'cloud', system: 'Cloud Control Plane' },
  connector: { kind: 'connector', system: 'Connectors' },
  worker: { kind: 'workforce', system: 'AI Workforce' },
  job: { kind: 'workforce', system: 'AI Workforce' },
  goal: { kind: 'strategy', system: 'Strategy Platform' },
  federation: { kind: 'federation', system: 'Federation' },
  marketplace: { kind: 'catalog', system: 'Marketplace' },
};

/** Classify a raw evidence id into a semantic knowledge ref (kind + originating system + label). */
export function resolveEvidenceRef(raw: string, knownDomains: readonly string[]): FabricEvidenceRef {
  const prefix = raw.includes(':') ? raw.slice(0, raw.indexOf(':')) : '';
  let hit = REF_PREFIX_MAP[prefix];
  if (!hit && RELATIONSHIP_KINDS.has(prefix)) hit = { kind: 'entity', system: 'Relationship Graph' };
  if (!hit && knownDomains.includes(raw)) hit = { kind: 'domain', system: 'Enterprise Graph' };
  const resolved = hit ?? { kind: 'other', system: 'Platform' };
  // Redact identity for entity refs — expose only the kind + originating system, never the entity
  // key/name (which can be a customer/supplier/person). Signal/domain/incident refs are platform keys.
  if (resolved.kind === 'entity') {
    return { id: `entity:${prefix || 'ref'}`, label: ENTITY_REF_LABEL[prefix] ?? titleKind(prefix), kind: 'entity', sourceSystem: resolved.system };
  }
  return { id: raw, label: humanize(raw), kind: resolved.kind, sourceSystem: resolved.system };
}

/* ── Explanations: project every explainable subject into the unified evidence model (pure) ── */

/** KPI key prefix → originating system (for Sources on a KPI explanation). */
function kpiSource(key: string): string {
  if (key.startsWith('strategy')) return 'Strategy Platform';
  if (key.startsWith('industry')) return 'Industry Platform';
  if (key.startsWith('cloud')) return 'Cloud Control Plane';
  if (key.startsWith('relationship')) return 'Relationship Graph';
  if (key.startsWith('twin')) return 'Digital Twin';
  return 'Enterprise Intelligence';
}
function kpiConfidence(k: ExecutiveKpi): number {
  if (k.band) return k.band === 'healthy' ? 0.9 : k.band === 'watch' ? 0.65 : k.band === 'at-risk' ? 0.4 : 0.2;
  return k.value != null ? clamp01(k.value / 100) : 0.5;
}

/** Project P14 Strategy + P15 Twin + KPIs into the unified explanation inputs (pure → testable). */
export function buildExplanationInputs(strategy: StrategyOverview | null, twin: EnterpriseTwinOverview | null, kpis: readonly ExecutiveKpi[]): FabricExplanationInput[] {
  const out: FabricExplanationInput[] = [];
  if (strategy) {
    for (const r of strategy.recommendations) {
      out.push({ id: `rec:${r.id}`, kind: 'recommendation', subject: r.title, reasoning: r.detail, sources: ['Enterprise Intelligence'], evidence: r.evidence, confidence: clamp01(r.confidence), approvalAware: false });
    }
    for (const g of strategy.goals.goals) {
      out.push({ id: `goal:${g.id}`, kind: 'goal', subject: g.name, reasoning: g.description || g.successMetric, sources: ['Strategy Platform'], evidence: g.evidence, confidence: clamp01(Math.max(0.1, g.progress)), approvalAware: false });
    }
    for (const d of strategy.decisions.decisions) {
      out.push({ id: `dec:${d.id}`, kind: 'decision', subject: d.title, reasoning: d.rationale, sources: d.sourceSystems.length ? d.sourceSystems : ['Strategy Platform'], evidence: d.evidence, confidence: clamp01(d.confidence), approvalAware: d.requiredApprovals.length > 0 });
    }
    for (const o of strategy.optimization.opportunities) {
      out.push({ id: `opt:${o.id}`, kind: 'optimization', subject: o.title, reasoning: o.detail, sources: ['Strategy Platform'], evidence: o.evidence, confidence: clamp01(o.confidence), approvalAware: o.requiredApproval.governed });
    }
    strategy.reasoning.findings.forEach((f, i) => {
      out.push({ id: `rsn:${f.dimension}:${i}`, kind: 'reasoning', subject: f.title, reasoning: f.detail, sources: ['Strategy Platform'], evidence: f.evidence, confidence: clamp01(f.confidence), approvalAware: false });
    });
    for (const sc of strategy.simulation.scenarios) {
      out.push({ id: `sim:${sc.id}`, kind: 'simulation', subject: sc.name, reasoning: sc.description, sources: ['Strategy Platform'], evidence: sc.evidence, confidence: clamp01(sc.projected.probabilityPct / 100), approvalAware: false });
    }
  }
  if (twin) {
    for (const e of twin.health.entries) {
      out.push({ id: `twin:${e.key}`, kind: 'twin', subject: e.label, reasoning: e.factors.length ? e.factors.join('; ') : `${e.label} health`, sources: ['Digital Twin'], evidence: [`health:${e.key}`], confidence: clamp01(e.score / 100), approvalAware: false });
    }
  }
  for (const k of kpis.slice(0, 16)) {
    out.push({ id: `kpi:${k.key}`, kind: 'kpi', subject: k.label, reasoning: k.band ? `${k.display} · ${k.band}` : k.display, sources: [kpiSource(k.key)], evidence: [k.key], confidence: kpiConfidence(k), approvalAware: false });
  }
  return out;
}

/** Build lineage by FILTERING the injected timeline query into 4 stages + correlation chains (pure). */
export function buildLineage(query: (q: TimelineQuery) => TimelinePage, since: string, until: string, windowDays: number): FabricLineageInput {
  let page: TimelinePage | null = null;
  try {
    page = query({ since, until, order: 'desc', limit: 500 });
  } catch {
    page = null;
  }
  const events: PlatformEvent[] = page?.events ?? [];
  const stageOf = (e: PlatformEvent): 'origin' | 'transformation' | 'usage' | 'consumers' => {
    const t = e.type ?? '';
    if (t.endsWith('.created') || t.endsWith('_created')) return 'origin';
    if (/updated|status_changed|converted|renamed|moved/.test(t)) return 'transformation';
    if (e.causationId) return 'consumers';
    return 'usage';
  };
  const stageCounts = new Map<string, number>([['origin', 0], ['transformation', 0], ['usage', 0], ['consumers', 0]]);
  for (const e of events) stageCounts.set(stageOf(e), (stageCounts.get(stageOf(e)) ?? 0) + 1);

  const byCorr = new Map<string, PlatformEvent[]>();
  for (const e of events) {
    const cid = e.correlationId;
    if (!cid) continue;
    const list = byCorr.get(cid) ?? [];
    list.push(e);
    byCorr.set(cid, list);
  }
  const chains = [...byCorr.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([cid, list]) => {
      const times = list.map((e) => e.timestamp).sort();
      return {
        correlationRef: cid.length > 10 ? `${cid.slice(0, 8)}…` : cid,
        events: list.length,
        categories: [...new Set(list.map((e) => e.category))].sort(),
        since: times[0],
        until: times[times.length - 1],
      };
    });

  return {
    stages: [
      { stage: 'origin', label: 'Origin', count: stageCounts.get('origin') ?? 0, signals: ['record.created'], note: 'Records first written to the platform.' },
      { stage: 'transformation', label: 'Transformation', count: stageCounts.get('transformation') ?? 0, signals: ['record.updated', 'status_changed', 'converted'], note: 'Records changed, re-statused, or converted.' },
      { stage: 'usage', label: 'Usage', count: stageCounts.get('usage') ?? 0, signals: ['knowledge', 'connector', 'automation'], note: 'Knowledge/connector/automation activity referencing records.' },
      { stage: 'consumers', label: 'Consumers', count: stageCounts.get('consumers') ?? 0, signals: ['causationId'], note: 'Downstream events caused by an upstream change (causal fan-out).' },
    ],
    chains,
    totalEvents: page?.total ?? events.length,
    windowDays,
  };
}

/* ── Source catalog (traceability) ── */

export function buildFabricSources(s: FabricState): FabricSourceCatalog {
  const totalEntities = entityTotal(s.sources);
  const sources: FabricSource[] = s.sources
    .map((x) => ({
      id: x.id,
      name: x.name,
      category: x.category,
      entityCount: x.entityCount,
      // Signal sources (timeline events) are not entity contributors → 0% of the entity total.
      contributionPercent: x.category === 'signal' ? 0 : pct(x.entityCount, totalEntities),
      band: x.band ?? (x.entityCount > 0 ? 'healthy' : 'watch'),
      live: x.live,
      provenance: x.provenance,
      note: x.note,
    }))
    .sort((a, b) => b.contributionPercent - a.contributionPercent || b.entityCount - a.entityCount || a.id.localeCompare(b.id));
  return {
    sources,
    total: sources.length,
    liveCount: sources.filter((x) => x.live).length,
    totalEntities,
    note: 'Every knowledge source is a projection of an existing platform system — the fabric adds no store, index, or copy of record. Timeline events are a signal, not an entity source, and are excluded from the entity total.',
  };
}

/* ── Entity relationships (projected from the Enterprise Relationship graph) ── */

export function buildFabricRelationships(s: FabricState): FabricRelationshipMap {
  const r = s.relationships;
  // Redact named identities: rank the top-connected entities by degree and expose kind + rank only.
  // Named drill-down stays behind operations:read (Enterprise Search / Relationship Explore).
  const topEntities: FabricRelationEntity[] = [...r.topEntities]
    .sort((a, b) => b.degree - a.degree || a.kind.localeCompare(b.kind))
    .slice(0, 12)
    .map((e, i) => ({ kind: e.kind, label: `${titleKind(e.kind)} #${i + 1}`, degree: e.degree, band: relHealthBand(e.health) }));
  const narrative = {
    summary: `${r.nodes.toLocaleString()} entities across ${r.byKind.length} kinds and ${r.edges.toLocaleString()} typed relationships; ${r.criticalEdges} critical and ${r.highRiskEdges} high-risk edges; relationship health ${round(r.relationshipHealth)}/100.`,
    grounded: r.narrative.grounded,
  };
  return {
    nodes: r.nodes,
    edges: r.edges,
    relationshipHealth: round(r.relationshipHealth),
    averageDegree: Number(r.averageDegree.toFixed(2)),
    criticalEdges: r.criticalEdges,
    highRiskEdges: r.highRiskEdges,
    disconnected: r.disconnected,
    byKind: toCounts(r.byKind),
    byType: toCounts(r.byType),
    byHealth: toCounts(r.byHealth),
    topEntities,
    narrative,
    note: 'Entity relationships projected from the Enterprise Relationship graph. Aggregate distributions plus top-connected entities by kind and rank — named identities and per-edge risk are redacted; named drill-down stays behind operations:read (Enterprise Search / Relationship Explore).',
  };
}

/* ── Classification + semantic tags ── */

export function buildFabricClassification(s: FabricState): FabricClassification {
  const c = s.corpus;
  const topTags: FabricTag[] = [...c.topTags]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 24);
  return {
    byKind: toCounts(c.byKind),
    byDomain: toCounts(s.graph.byDomain),
    bySource: toCounts(c.bySource),
    topTags,
    retention: toCounts(c.retention),
    sensitivity: toCounts(c.sensitivity),
    note: 'Knowledge classified from the AI-Memory corpus (kind/origin/tags) and the enterprise-graph domains — a projection, not a re-tagged copy. Sensitivity is derived from memory kind; retention from recency.',
  };
}

/* ── Knowledge lineage (origin → transformation → usage → consumers, from the Timeline) ── */

export function buildFabricLineage(s: FabricState): FabricLineage {
  const stages: FabricLineageStage[] = s.lineage.stages.map((st) => ({
    stage: st.stage,
    label: st.label,
    count: st.count,
    signals: st.signals,
    note: st.note,
  }));
  const chains: FabricLineageChain[] = s.lineage.chains
    .map((ch) => ({ correlationRef: ch.correlationRef, events: ch.events, categories: ch.categories, since: ch.since, until: ch.until }))
    .sort((a, b) => b.events - a.events || a.correlationRef.localeCompare(b.correlationRef))
    .slice(0, 20);
  return {
    stages,
    chains,
    totalEvents: s.lineage.totalEvents,
    windowDays: s.lineage.windowDays,
    note: 'Lineage is projected by FILTERING the existing platform timeline (origin → transformation → usage → consumers) via record events + correlation chains — no new timeline. Stage counts reflect the most recent 500 events in the window; the event total reflects all matching events. Chains are redacted to correlation metadata (no entity identities).',
  };
}

/* ── Evidence + explanations (the unified Evidence/Sources/Reasoning/Confidence model) ── */

export function buildFabricEvidence(s: FabricState): FabricEvidenceReport {
  const explanations: FabricExplanation[] = s.explanations
    .map((x) => {
      // Band from the DISPLAYED (rounded) confidence so a 75%-labelled card never shows a watch badge.
      const confidence = Number(x.confidence.toFixed(2));
      return {
        id: x.id,
        kind: x.kind,
        subject: x.subject,
        reasoning: x.reasoning,
        sources: x.sources,
        evidence: x.evidence.map((e) => resolveEvidenceRef(e, s.knownDomains)),
        confidence,
        confidenceBand: confidenceBand(confidence),
        approvalAware: x.approvalAware,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));

  const total = explanations.length;
  const withEvidence = explanations.filter((x) => x.evidence.length > 0).length;
  const byKindMap = new Map<string, number>();
  for (const x of explanations) byKindMap.set(x.kind, (byKindMap.get(x.kind) ?? 0) + 1);
  const avg = total > 0 ? explanations.reduce((n, x) => n + x.confidence, 0) / total : 0;

  return {
    explanations,
    total,
    byKind: toCounts([...byKindMap.entries()].map(([key, count]) => ({ key, count }))),
    evidenceCoverage: pct(withEvidence, total),
    avgConfidence: Number(avg.toFixed(2)),
    note: 'Every recommendation, goal, decision, optimization, simulation, twin signal, and KPI is projected into one Evidence / Sources / Reasoning / Confidence explanation. Evidence ids are resolved into semantic knowledge refs; nothing is recomputed or executed.',
  };
}

/* ── Knowledge governance (reuses RBAC / Governance / Audit — posture projection, no new governance) ── */

export function buildFabricGovernance(s: FabricState): FabricGovernance {
  const scopes: FabricScopeRow[] = s.sources
    .map((x) => ({
      source: x.name,
      permission: x.permission,
      auditable: true,
      note: `Gated by ${x.permission}; reads flow through the existing RBAC spine and are auditable via the platform timeline.`,
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
  return {
    fabricScope: 'knowledge:read',
    scopes,
    redactions: [
      'Relationship top-entity identities are redacted to kind + rank; named drill-down stays behind operations:read.',
      'The relationship narrative is projected as an aggregate summary — named entities and per-edge risk are not passed through.',
      'Evidence references to graph/relationship entities are redacted to kind + originating system (no entity keys/names).',
      'Digital-twin single-point-of-failure identities remain redacted upstream (drill-down behind intelligence:read).',
      'Lineage chains are redacted to correlation metadata — no entity identities are exposed.',
    ],
    auditableSources: scopes.filter((x) => x.auditable).length,
    totalSources: scopes.length,
    note: 'Knowledge governance reuses the existing RBAC, governance, and audit spine. All fabric channels require knowledge:read; each underlying source keeps its own production scope. The fabric adds no new governance engine.',
  };
}

/* ── Analytics ── */

export function buildFabricAnalytics(s: FabricState): FabricAnalytics {
  const total = s.explanations.length;
  const withEvidence = s.explanations.filter((x) => x.evidence.length > 0).length;
  const bandCount = new Map<FabricBand, number>([
    ['healthy', 0],
    ['watch', 0],
    ['at-risk', 0],
    ['critical', 0],
  ]);
  for (const x of s.explanations) bandCount.set(confidenceBand(x.confidence), (bandCount.get(confidenceBand(x.confidence)) ?? 0) + 1);
  const confidenceDistribution: FabricConfidenceBucket[] = (['healthy', 'watch', 'at-risk', 'critical'] as FabricBand[]).map((band) => ({ band, count: bandCount.get(band) ?? 0 }));

  const totalEntities = entityTotal(s.sources);
  const sourceContribution = [...s.sources]
    .map((x) => ({ source: x.name, entityCount: x.entityCount, percent: x.category === 'signal' ? 0 : pct(x.entityCount, totalEntities) }))
    .sort((a, b) => b.percent - a.percent || b.entityCount - a.entityCount || a.source.localeCompare(b.source))
    .slice(0, 12);

  return {
    knowledgeCoverage: s.corpus.coveragePercent,
    explanationCoverage: pct(withEvidence, total),
    confidenceDistribution,
    sourceContribution,
    topDomains: toCounts(s.graph.byDomain).slice(0, 10),
    topTags: [...s.corpus.topTags].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 12),
    overallHealth: s.health.overall,
    healthBand: s.health.band,
    note: 'Knowledge analytics computed from the projected sources — coverage, explanation coverage, confidence distribution, and per-source contribution. Every figure traces back to an existing system.',
  };
}

/* ── Summary + overview bundle ── */

export function buildFabricSummary(s: FabricState): FabricSummary {
  const totalEntities = entityTotal(s.sources);
  const total = s.explanations.length;
  const withEvidence = s.explanations.filter((x) => x.evidence.length > 0).length;
  return {
    generatedAt: s.generatedAt,
    totalEntities,
    sourceCount: s.sources.length,
    liveSources: s.sources.filter((x) => x.live).length,
    relationships: s.relationships.edges,
    explanations: total,
    evidenceCoverage: pct(withEvidence, total),
    knowledgeCoverage: s.corpus.coveragePercent,
    overallHealth: s.health.overall,
    healthBand: s.health.band,
    semanticTags: s.corpus.tagCount,
  };
}

export function buildFabricOverview(s: FabricState): FabricOverview {
  return {
    summary: buildFabricSummary(s),
    sources: buildFabricSources(s),
    relationships: buildFabricRelationships(s),
    classification: buildFabricClassification(s),
    analytics: buildFabricAnalytics(s),
    kpis: s.kpis,
  };
}

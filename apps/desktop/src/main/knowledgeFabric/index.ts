/**
 * P16 — Enterprise Knowledge Fabric composition root.
 *
 * The knowledge-enrichment LAYER over the existing platform. It composes a READ-ONLY snapshot from the
 * EXISTING signals — the P7 Enterprise Intelligence report (injected), the P14 Strategy overview
 * (injected), the P15 Digital Twin overview (injected), the platform timeline query (injected), the
 * Enterprise Relationship graph (`getRelationshipModel`), the AI-Memory corpus (via the shipped
 * `knowledgeHealth` derivation), the Marketplace, Federation, and Connector stores — into Knowledge
 * Fabric projections (source catalog, entity-relationship map, classification, lineage, a unified
 * Evidence/Sources/Reasoning/Confidence explanation model, governance posture, and analytics) behind
 * RBAC-gated IPC (`knowledge:read`). It creates NO new store, graph, memory, timeline, search, or vector
 * index, executes nothing, and reuses the existing `ecosystem:event` broadcast for renderer liveness.
 * Every read source is wrapped defensively so a single failing subsystem degrades the projection rather
 * than crashing it.
 */
import {
  EmptyRequest,
  IpcChannel,
  type EnterpriseIntelligenceReport,
  type EnterpriseTwinOverview,
  type MemoryItem,
  type StrategyOverview,
  type TimelineQuery,
  type TimelinePage,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { memoryStore } from '../memory/memoryInstance';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { fedStore } from '../federation/runtime/fedInstance';
import { connectorService } from '../connectors/connectorService';
import { getRelationshipModel } from '../enterprise/relationshipProvider';
import { knowledgeHealth } from '../knowledge/knowledgeHealth';
import { KnowledgeFabricService } from './knowledgeFabricService';
import { buildExplanationInputs, buildLineage } from './knowledgeFabricModel';
import type { FabricSourceInput, FabricState } from './knowledgeFabricModel';
import { withKnowledgeAuthz } from './knowledgeFabricAuthz';

const log = createLogger('enterprise-knowledge');

export interface EnterpriseKnowledgeDeps {
  /** The P7 Enterprise Intelligence report accessor (memoized, 3s TTL) — injected, not re-created. */
  enterpriseReport: () => EnterpriseIntelligenceReport;
  /** The P14 Strategy overview accessor — injected (goals/decisions/optimization/reasoning/simulation/KPIs). */
  strategyOverview: () => StrategyOverview;
  /** The P15 Digital Twin overview accessor — injected (domains + health entries; augmented, not rebuilt). */
  twinOverview: () => EnterpriseTwinOverview;
  /** The existing platform timeline query — injected (for lineage). Reused, not re-created. */
  queryTimeline: (q: TimelineQuery) => TimelinePage;
}

export interface EnterpriseKnowledgeSubsystem {
  handlers: SecureHandlerDef[];
  service: KnowledgeFabricService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function countBy<T>(items: readonly T[], key: (t: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count }));
}

/** Sensitivity band derived from memory kind (the fabric never reads the content). */
const KIND_SENSITIVITY: Record<string, string> = {
  decision: 'restricted',
  relationship: 'restricted',
  document: 'internal',
  meeting: 'internal',
  task: 'internal',
  context: 'internal',
  conversation: 'general',
  note: 'general',
};

/** Bucket a memory's recency into a retention band. */
function retentionBand(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'active';
  const days = (nowMs - t) / 86_400_000;
  return days < 30 ? 'fresh' : days < 90 ? 'active' : days < 365 ? 'aging' : 'stale';
}

/** Compose the fabric snapshot from the EXISTING platform signals (no new store/graph/memory/search). */
function buildState(deps: EnterpriseKnowledgeDeps): FabricState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const report = safe(() => deps.enterpriseReport());
  const strategy = safe(() => deps.strategyOverview());
  const twin = safe(() => deps.twinOverview());
  const rel = safe(() => getRelationshipModel());
  const memories: MemoryItem[] = safe(() => memoryStore.allItems()) ?? [];
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const fedSummary = safe(() => fedStore.summary());
  const cstats = safe(() => connectorService.stats());

  // Corpus (reuse the shipped knowledgeHealth derivation — no new store, no re-index).
  const kh = safe(() => knowledgeHealth(memories));
  const tagFreq = new Map<string, number>();
  for (const m of memories) for (const t of m.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
  const topTags = [...tagFreq.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 40);
  const corpus = {
    total: memories.length,
    withEntities: kh?.memoriesWithEntities ?? memories.filter((m) => m.entityRefs.length > 0).length,
    byKind: countBy(memories, (m) => m.kind),
    bySource: countBy(memories, (m) => m.source || 'manual'),
    topTags,
    tagCount: tagFreq.size,
    retention: countBy(memories, (m) => retentionBand(m.updatedAt, now)),
    sensitivity: countBy(memories, (m) => KIND_SENSITIVITY[m.kind] ?? 'general'),
    topics: kh?.topicCount ?? 0,
    coveragePercent: kh?.coveragePercent ?? 0,
    orphanCount: kh?.orphanCount ?? 0,
    avgEntitiesPerMemory: kh?.avgEntitiesPerMemory ?? 0,
    largestTopicSize: kh?.largestTopicSize ?? 0,
  };

  // Relationships (project the Enterprise Relationship graph — no new graph).
  const relationships = rel
    ? {
        nodes: rel.insights.totalNodes,
        edges: rel.insights.totalEdges,
        relationshipHealth: rel.insights.relationshipHealth,
        averageDegree: rel.insights.averageDegree,
        criticalEdges: rel.criticalEdges.length,
        highRiskEdges: rel.highRiskEdges.length,
        disconnected: rel.disconnected.length,
        byKind: Object.entries(rel.counts.byKind).map(([key, count]) => ({ key, count })),
        byType: countBy(rel.edges, (e) => e.type),
        byHealth: Object.entries(rel.counts.byHealth).map(([key, count]) => ({ key, count })),
        topEntities: rel.topEntities.map((n) => ({ kind: n.kind, label: n.label, degree: n.degree, health: n.health })),
        narrative: { grounded: rel.narrative.grounded },
      }
    : {
        nodes: 0, edges: 0, relationshipHealth: 0, averageDegree: 0, criticalEdges: 0, highRiskEdges: 0, disconnected: 0,
        byKind: [], byType: [], byHealth: [], topEntities: [],
        narrative: { grounded: false },
      };

  // Graph summary (from the intelligence report).
  const graph = report
    ? { nodes: report.graph.nodes, edges: report.graph.edges, byDomain: Object.entries(report.graph.byDomain).map(([key, count]) => ({ key, count })), crossDomainEdges: report.graph.crossDomainEdges }
    : { nodes: 0, edges: 0, byDomain: [] as { key: string; count: number }[], crossDomainEdges: 0 };
  const knownDomains = report ? Object.keys(report.graph.byDomain) : [];

  // Explanations (the unified evidence model) + KPIs.
  const kpis = report?.kpis ?? strategy?.kpis ?? [];
  // Defensive: a malformed-but-non-null strategy/twin degrades the explanation set to empty, not a crash.
  const explanations = safe(() => buildExplanationInputs(strategy, twin, kpis)) ?? [];

  // Lineage (filtered timeline windows).
  const windowDays = 90;
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const lineage = buildLineage(deps.queryTimeline, since, nowIso, windowDays);

  // Health — assume-worst when the intelligence report is unavailable (never falsely healthy).
  const health = report ? { overall: report.health.overall, band: report.health.band } : { overall: 0, band: 'critical' as const };

  // Twin domain lookup for the operational source rows.
  const twinDomain = (id: string): { entityCount: number; live: boolean; band: FabricSourceInput['band'] } | null => {
    const d = twin?.domains.domains.find((x) => x.id === id);
    return d ? { entityCount: d.entityCount, live: d.live, band: d.band } : null;
  };
  const cloud = twinDomain('infrastructure');
  const workforce = twinDomain('workforce');

  // Source catalog — every source is an existing system (provenance + production RBAC scope).
  const sources: FabricSourceInput[] = [
    { id: 'graph', name: 'Enterprise Graph', category: 'graph', entityCount: graph.nodes, live: graph.nodes > 0, provenance: 'P7 Enterprise Intelligence (unified graph summary)', permission: 'intelligence:read', note: 'Domain-level entity graph.' },
    { id: 'relationships', name: 'Relationship Graph', category: 'graph', entityCount: relationships.nodes, live: relationships.nodes > 0, provenance: 'Enterprise Relationship graph (ERP FK topology)', permission: 'operations:read', note: 'Typed business-entity relationships.' },
    { id: 'timeline', name: 'Timeline', category: 'signal', entityCount: lineage.totalEvents, live: lineage.totalEvents > 0, provenance: 'Platform event timeline', permission: 'intelligence:read', note: 'Event history + lineage.' },
    { id: 'memory', name: 'AI Memory', category: 'corpus', entityCount: corpus.total, live: corpus.total > 0, provenance: 'AI-Memory corpus (org memory)', permission: 'memory:read', note: 'The knowledge corpus; source of topics/tags.' },
    { id: 'marketplace', name: 'Marketplace', category: 'catalog', entityCount: listings.length, live: listings.length > 0, provenance: 'Enterprise Marketplace catalog', permission: 'marketplace:read', note: 'Published packages + trust.' },
    { id: 'federation', name: 'Federation', category: 'operational', entityCount: fedSummary?.peers ?? 0, live: (fedSummary?.peers ?? 0) > 0, provenance: 'Federation trust runtime', permission: 'federation:read', note: 'Federated peer organizations.' },
    { id: 'connector', name: 'Connector Metadata', category: 'operational', entityCount: cstats?.total ?? 0, live: (cstats?.connected ?? 0) > 0, provenance: 'Connector service', permission: 'connectors:read', note: 'Integration metadata + health.' },
    { id: 'cloud', name: 'Cloud Control Plane', category: 'operational', entityCount: cloud?.entityCount ?? 0, live: cloud?.live ?? false, band: cloud?.band, provenance: 'Cloud Control Plane (via Digital Twin)', permission: 'cloud:read', note: 'Fleet, regions, deployments.' },
    { id: 'workforce', name: 'AI Workforce', category: 'operational', entityCount: workforce?.entityCount ?? 0, live: workforce?.live ?? false, band: workforce?.band, provenance: 'AI Workforce (via Digital Twin)', permission: 'workforce:read', note: 'Workers consume the fabric via the existing AI runtime.' },
    { id: 'strategy', name: 'Strategy Platform', category: 'intelligence', entityCount: (strategy?.goals.goals.length ?? 0) + (strategy?.decisions.decisions.length ?? 0), live: !!strategy, provenance: 'P14 Autonomous Enterprise Intelligence', permission: 'strategy:read', note: 'Goals, decisions, simulations.' },
    { id: 'twin', name: 'Digital Twin', category: 'intelligence', entityCount: twin?.summary.totalEntities ?? 0, live: !!twin, provenance: 'P15 Enterprise Digital Twin', permission: 'twin:read', note: 'Domain twins + health (augmented with knowledge).' },
    { id: 'industry', name: 'Industry Packs', category: 'catalog', entityCount: 0, live: false, provenance: 'P13 Industry Solution Platform', permission: 'industry:read', note: 'Solution-pack catalog — entity counts are not projected here; see the Industry Center.' },
    { id: 'developer', name: 'Developer Platform', category: 'catalog', entityCount: 0, live: false, provenance: 'P12 Developer Platform', permission: 'developer:read', note: 'SDK/API registry — entity counts are not projected here; see the Developer Center.' },
  ];

  return { generatedAt: report ? report.generatedAt : nowIso, sources, corpus, relationships, graph, explanations, lineage, health, kpis, knownDomains };
}

export function initEnterpriseKnowledge(deps: EnterpriseKnowledgeDeps): EnterpriseKnowledgeSubsystem {
  const service = new KnowledgeFabricService({ readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected report/strategy/twin/
  // relationship/timeline sources refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  memoryStore.on('changed', invalidate);
  connectorService.on('event', invalidate);
  marketplaceStore.on('changed', invalidate);
  fedStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.FabricOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.FabricSources, schema: EmptyRequest, handler: () => service.sources() },
    { channel: IpcChannel.FabricRelationships, schema: EmptyRequest, handler: () => service.relationships() },
    { channel: IpcChannel.FabricClassification, schema: EmptyRequest, handler: () => service.classification() },
    { channel: IpcChannel.FabricLineage, schema: EmptyRequest, handler: () => service.lineage() },
    { channel: IpcChannel.FabricEvidence, schema: EmptyRequest, handler: () => service.evidence() },
    { channel: IpcChannel.FabricGovernance, schema: EmptyRequest, handler: () => service.governance() },
    { channel: IpcChannel.FabricAnalytics, schema: EmptyRequest, handler: () => service.analytics() },
  ];
  const handlers = withKnowledgeAuthz(rawHandlers);

  const dispose = (): void => {
    memoryStore.off('changed', invalidate);
    connectorService.off('event', invalidate);
    marketplaceStore.off('changed', invalidate);
    fedStore.off('changed', invalidate);
  };

  log.info('Enterprise Knowledge Fabric ready', { sources: safe(() => service.sources().total) ?? 0 });
  return { handlers, service, dispose };
}

/**
 * Module 1 — Enterprise Knowledge Graph. One unified, tenant-scoped graph of entities
 * (organizations, users, OKRs, tasks, dashboards, connectors, …), their relationships,
 * a timeline, and evidence. It is a DERIVED PROJECTION of real persisted data: the
 * builder ingests real NEMS entities (Wave 1, real Postgres), real connectivity state
 * (Wave 2), and real runtime audit events — so every node points back, via evidence,
 * to a real source row. Nothing is fabricated; entity types with no live source stay
 * empty until a connector (Wave 2, infra-pending live) supplies them.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { NemsPlatform } from '@neuropause/nems';
import type { ConnectivityPlatform } from '@neuropause/connectivity';
import type { Entity, Edge, EntityType, RelationType, TimelineEvent, EvidenceRef } from './types';

export class KnowledgeGraph {
  private readonly entities = new Map<string, Entity>();
  private readonly edges: Edge[] = [];
  private readonly events: TimelineEvent[] = [];

  addEntity(e: Entity): Entity {
    this.entities.set(e.id, e);
    return e;
  }
  addEdge(from: string, to: string, type: RelationType, tenantId: string, metadata?: Record<string, unknown>): Edge {
    const edge: Edge = { id: randomId('edge'), from, to, type, tenantId, ...(metadata ? { metadata } : {}) };
    this.edges.push(edge);
    return edge;
  }
  addTimelineEvent(ev: TimelineEvent): void {
    this.events.push(ev);
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }
  list(tenantId: string, type?: EntityType): Entity[] {
    return [...this.entities.values()].filter((e) => e.tenantId === tenantId && (!type || e.type === type));
  }
  edgesOf(id: string): Edge[] {
    return this.edges.filter((e) => e.from === id || e.to === id);
  }
  relations(tenantId: string, type?: RelationType): Edge[] {
    return this.edges.filter((e) => e.tenantId === tenantId && (!type || e.type === type));
  }
  neighbors(id: string, relation?: RelationType): Entity[] {
    const ids = this.edges.filter((e) => (e.from === id || e.to === id) && (!relation || e.type === relation)).map((e) => (e.from === id ? e.to : e.from));
    return ids.map((i) => this.entities.get(i)).filter((x): x is Entity => x !== undefined);
  }
  timeline(tenantId: string, entityId?: string): TimelineEvent[] {
    return this.events.filter((ev) => ev.tenantId === tenantId && (!entityId || ev.entityId === entityId)).sort((a, b) => a.at - b.at);
  }
  evidence(id: string): EvidenceRef[] {
    return this.entities.get(id)?.evidence ?? [];
  }
  stats(tenantId: string): { entities: number; edges: number; events: number; byType: Record<string, number> } {
    const ents = this.list(tenantId);
    const byType: Record<string, number> = {};
    for (const e of ents) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return { entities: ents.length, edges: this.edges.filter((e) => e.tenantId === tenantId).length, events: this.events.filter((e) => e.tenantId === tenantId).length, byType };
  }
}

export interface GraphSources {
  nems?: NemsPlatform;
  connectivity?: ConnectivityPlatform;
  runtime?: EnterpriseRuntime;
}

/** Build a tenant's knowledge graph from real platform data. */
export async function buildKnowledgeGraph(tenantId: string, sources: GraphSources, clock: Clock): Promise<KnowledgeGraph> {
  const g = new KnowledgeGraph();
  const now = clock.now();
  if (sources.nems) await ingestNems(g, tenantId, sources.nems, now);
  if (sources.connectivity) ingestConnectivity(g, tenantId, sources.connectivity);
  if (sources.runtime) ingestRuntime(g, tenantId, sources.runtime);
  return g;
}

const ev = (kind: string, id: string, source: string): EvidenceRef => ({ kind, id, source });
const node = (id: string, type: EntityType, tenantId: string, label: string, metadata: Record<string, unknown>, evidence: EvidenceRef[], createdAt: number): Entity => ({ id, type, tenantId, label, metadata, evidence, createdAt });

async function ingestNems(g: KnowledgeGraph, tenantId: string, nems: NemsPlatform, now: number): Promise<void> {
  const org = await nems.organizations().get(tenantId);
  if (org) g.addEntity(node(org.id, 'organization', tenantId, org.name, { slug: org.slug, status: org.status }, [ev('nems.organization', org.id, 'nems')], now));

  for (const u of await nems.users().list(tenantId)) {
    g.addEntity(node(u.id, 'user', tenantId, u.displayName, { email: u.email, roles: u.roles, status: u.status }, [ev('nems.user', u.id, 'nems')], now));
    g.addEdge(u.id, tenantId, 'member_of', tenantId);
  }

  for (const o of await nems.okrs().objectives(tenantId)) {
    g.addEntity(node(o.id, 'objective', tenantId, o.title, { period: o.period, level: o.level, status: o.status, progress: o.progress, risk: o.risk }, [ev('nems.objective', o.id, 'nems')], now));
    g.addEdge(o.ownerId ?? tenantId, o.id, 'owns', tenantId);
    for (const kr of await nems.okrs().keyResults(tenantId, o.id)) {
      g.addEntity(node(kr.id, 'key_result', tenantId, kr.title, { progress: kr.progress, status: kr.status }, [ev('nems.key_result', kr.id, 'nems')], now));
      g.addEdge(o.id, kr.id, 'measures', tenantId);
    }
  }

  for (const t of await nems.okrs().tasks(tenantId)) {
    g.addEntity(node(t.id, 'task', tenantId, t.title, { status: t.status }, [ev('nems.task', t.id, 'nems')], now));
  }
  for (const d of await nems.dashboards().list(tenantId)) {
    g.addEntity(node(d.id, 'dashboard', tenantId, d.name, { scope: d.scope }, [ev('nems.dashboard', d.id, 'nems')], now));
  }
}

function ingestConnectivity(g: KnowledgeGraph, tenantId: string, conn: ConnectivityPlatform): void {
  for (const c of conn.connectors().list(tenantId)) {
    const id = `connector:${c.connectorId}`;
    g.addEntity(node(id, 'connector', tenantId, c.connectorId, { state: c.state }, [ev('connectivity.connector', c.connectorId, 'connectivity')], c.installedAt));
    g.addEdge(id, tenantId, 'connected_to', tenantId);
  }
  for (const o of conn.sync().history(tenantId)) {
    g.addTimelineEvent({ at: o.at, type: `sync.${o.mode}.${o.ok ? 'ok' : 'error'}`, entityId: `connector:${o.connectorId}`, detail: `synced ${o.synced}, conflicts ${o.conflicts}`, source: 'connectivity', tenantId });
  }
}

function ingestRuntime(g: KnowledgeGraph, tenantId: string, runtime: EnterpriseRuntime): void {
  for (const e of runtime.audit().list()) {
    if (e.target.startsWith(`${tenantId}:`) || e.actor === tenantId) {
      g.addTimelineEvent({ at: e.at, type: e.action, entityId: e.target, detail: e.action, source: 'audit', tenantId });
    }
  }
}

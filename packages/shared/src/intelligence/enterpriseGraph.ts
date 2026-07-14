/**
 * P7 — the UNIFIED Enterprise Graph model + Dependency Intelligence + Change-Impact Intelligence.
 *
 * P7 does NOT create a new graph. It COMPOSES the two richest existing typed topologies — the P6 Resource Graph
 * (`ResourceGraphModel`: cloud / infra / identity / security resources with 9 typed relations + per-node health)
 * and the ERP Relationship Graph (`RelationshipGraphModel`: customers / invoices / POs / machines with 27 FK
 * relations + per-node/edge risk+health) — into ONE provider-neutral `EnterpriseGraphModel` that every P7 engine
 * reads. Extra domains (collaboration people/projects/docs, knowledge, automation) fold in as loose nodes/edges.
 * This is the intelligence-layer realization of "everything becomes ONE graph"; the persistent Enterprise
 * Knowledge Graph is separately fed the same infra via `resourceGraphBridge` (wired into `projectGraph`).
 *
 * Pure + deterministic + IO-free. Dependency + Change-Impact analytics run on the unified adjacency: cycles
 * (Tarjan SCC), single-points-of-failure + bottlenecks + failure chains (reverse reachability / longest path),
 * and blast-radius change impact grouped by domain. Bounded for large enterprise graphs.
 */
import type { CloudResource, ResourceGraphModel, ResourceRelationshipType } from '../infra/resourceGraph';
import type { RelationshipGraphModel, RelationshipHealth, RelationshipNode } from '../types/enterpriseRelationship';

/** The coarse enterprise domain a node belongs to (drives health/risk grouping + change-impact classification). */
export type EnterpriseDomain =
  | 'infrastructure'
  | 'identity'
  | 'security'
  | 'crm'
  | 'finance'
  | 'sales'
  | 'operations'
  | 'people'
  | 'knowledge'
  | 'automation'
  | 'business'
  | 'unknown';

/** How an edge participates in dependency analysis. */
export type EnterpriseEdgeCategory = 'depends_on' | 'contains' | 'uses' | 'relates';

/** Cap the unified graph for very large enterprises (deterministic, degree-ranked keep). */
export const MAX_ENTERPRISE_NODES = 200_000;
export const MAX_ENTERPRISE_EDGES = 500_000;
/** Cap the failure-chain (longest dependency path) walk. */
export const MAX_CHAIN_DEPTH = 64;

/** A node in the unified Enterprise Graph. `health`/`risk` are 0–100 (null when the domain doesn't score it). */
export interface EnterpriseNode {
  id: string;
  domain: EnterpriseDomain;
  kind: string;
  label: string;
  health: number | null;
  risk: number | null;
  healthState: 'healthy' | 'degraded' | 'critical' | 'unknown';
  status: string | null;
  /** Structural weight (value/activity) — used to rank bottlenecks + SPOFs. */
  weight: number;
  source: 'infrastructure' | 'business' | 'collaboration' | 'external';
  meta: Record<string, string | number | boolean | null>;
}

/** A directed edge in the unified Enterprise Graph. `relation` preserves the precise domain relation. */
export interface EnterpriseEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  category: EnterpriseEdgeCategory;
  risk: number | null;
  weight: number;
}

export interface EnterpriseGraphModel {
  nodes: EnterpriseNode[];
  edges: EnterpriseEdge[];
  byDomain: Record<string, number>;
  /** Edges whose endpoints are in DIFFERENT domains — the cross-domain fabric P7 is about. */
  crossDomainEdges: number;
  truncated: boolean;
  builtAt: string;
}

export interface EnterpriseGraphInput {
  resource?: ResourceGraphModel | null;
  relationship?: RelationshipGraphModel | null;
  /** Optional extra nodes/edges (collaboration, knowledge, automation) already in the EnterpriseNode shape. */
  extraNodes?: EnterpriseNode[];
  extraEdges?: EnterpriseEdge[];
}

/* ── health / risk / domain mapping ─────────────────────────────────────────────── */

const RESOURCE_HEALTH_SCORE: Record<string, number | null> = { healthy: 92, degraded: 55, critical: 16, unknown: null };
const REL_HEALTH_SCORE: Record<RelationshipHealth, number> = { strong: 95, healthy: 85, weak: 55, dormant: 48, broken: 22, critical: 14 };

function resourceHealthState(h: string): EnterpriseNode['healthState'] {
  return h === 'healthy' || h === 'degraded' || h === 'critical' ? h : 'unknown';
}
function relHealthState(h: RelationshipHealth): EnterpriseNode['healthState'] {
  if (h === 'strong' || h === 'healthy') return 'healthy';
  if (h === 'weak' || h === 'dormant') return 'degraded';
  return 'critical';
}
/** Map a P6 infrastructure domain onto the coarse enterprise domain. */
function resourceDomain(d: string): EnterpriseDomain {
  if (d === 'identity') return 'identity';
  if (d === 'security' || d === 'secrets' || d === 'certificates') return 'security';
  return 'infrastructure';
}

/** Map an ERP relationship entity kind onto the coarse enterprise domain. */
function relationshipDomain(kind: string): EnterpriseDomain {
  const k = kind.toLowerCase();
  if (k.includes('customer') || k.includes('lead') || k.includes('contact')) return 'crm';
  if (k.includes('invoice') || k.includes('payment')) return 'finance';
  if (k.includes('order') || k.includes('quote')) return 'sales';
  if (k.includes('supplier') || k.includes('purchase') || k.includes('product') || k.includes('warehouse') || k.includes('machine') || k.includes('work') || k.includes('inventory') || k.includes('receipt') || k.includes('shipment') || k.includes('bom')) return 'operations';
  if (k.includes('user') || k.includes('technician') || k.includes('employee')) return 'people';
  return 'business';
}

/** Map a resource relationship type onto a dependency category. */
function resourceEdgeCategory(t: ResourceRelationshipType): EnterpriseEdgeCategory {
  switch (t) {
    case 'runs_on':
    case 'depends_on':
      return 'depends_on';
    case 'member_of':
    case 'hosted_by':
    case 'attached_to':
      return 'contains';
    case 'uses':
    case 'backed_by':
    case 'protected_by':
      return 'uses';
    default:
      return 'relates';
  }
}

function resourceNode(r: CloudResource): EnterpriseNode {
  const health = RESOURCE_HEALTH_SCORE[r.health] ?? null;
  return {
    id: `res:${r.id}`,
    domain: resourceDomain(r.domain),
    kind: r.resourceType,
    label: r.name,
    health,
    risk: health == null ? null : Math.round(100 - health),
    healthState: resourceHealthState(r.health),
    status: r.status,
    weight: 1,
    source: 'infrastructure',
    meta: { provider: r.provider, platform: r.platformId, account: r.accountId, domain: r.domain, region: r.region },
  };
}

function relationshipNode(n: RelationshipNode): EnterpriseNode {
  const health = REL_HEALTH_SCORE[n.health] ?? null;
  return {
    id: `erp:${n.id}`,
    domain: relationshipDomain(n.kind),
    kind: n.kind,
    label: n.label,
    health,
    risk: typeof n.risk === 'number' ? n.risk : null,
    healthState: relHealthState(n.health),
    status: n.master ? 'master' : null,
    weight: Math.max(1, Math.round((n.value ?? 0) / 1000) + (n.activity ?? 0)),
    source: 'business',
    meta: { key: n.key, degree: n.degree, inDegree: n.inDegree, outDegree: n.outDegree },
  };
}

/* ── build ──────────────────────────────────────────────────────────────────────── */

/** Merge the resource graph + ERP relationship graph (+ extras) into ONE unified Enterprise Graph. */
export function buildEnterpriseGraph(input: EnterpriseGraphInput, nowMs: number): EnterpriseGraphModel {
  const byId = new Map<string, EnterpriseNode>();
  const edges = new Map<string, EnterpriseEdge>();

  if (input.resource) {
    for (const r of input.resource.resources) byId.set(`res:${r.id}`, resourceNode(r));
    for (const e of input.resource.edges) {
      const from = `res:${e.from}`;
      const to = `res:${e.to}`;
      if (!byId.has(from) || !byId.has(to) || from === to) continue;
      const id = `${from}|${e.type}|${to}`;
      if (!edges.has(id)) edges.set(id, { id, from, to, relation: e.type, category: resourceEdgeCategory(e.type), risk: null, weight: 1 });
    }
  }
  if (input.relationship) {
    for (const n of input.relationship.nodes) byId.set(`erp:${n.id}`, relationshipNode(n));
    for (const e of input.relationship.edges) {
      const from = `erp:${e.from}`;
      const to = `erp:${e.to}`;
      if (!byId.has(from) || !byId.has(to) || from === to) continue;
      const id = `${from}|${e.type}|${to}`;
      // ERP relationship edges use the OPPOSITE orientation of the resource graph (master→transaction, where the
      // FK-holder/dependent is `to`, not `from`) AND mix orientations across the 27 relation types, so importing
      // them as directional `depends_on` would invert blast-radius/SPOF for the business domain (a leaf payment
      // ranked above its customer). They are imported as non-directional `relates` — ERP entities still contribute
      // cross-domain connectivity + health/risk aggregation, while directional business dependency stays with the
      // dedicated ERP Relationship Engine (`impactAnalysis`/`dependencyTree`), which owns the correct orientation.
      if (!edges.has(id)) edges.set(id, { id, from, to, relation: e.type, category: 'relates', risk: typeof e.risk === 'number' ? e.risk : null, weight: Math.max(1, e.weight ?? 1) });
    }
  }
  for (const n of input.extraNodes ?? []) if (!byId.has(n.id)) byId.set(n.id, n);
  for (const e of input.extraEdges ?? []) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    if (!edges.has(e.id)) edges.set(e.id, e);
  }

  let nodes = [...byId.values()];
  let edgeList = [...edges.values()].filter((e) => byId.has(e.from) && byId.has(e.to));
  let truncated = false;
  if (nodes.length > MAX_ENTERPRISE_NODES) {
    nodes = [...nodes].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, MAX_ENTERPRISE_NODES);
    const keep = new Set(nodes.map((n) => n.id));
    edgeList = edgeList.filter((e) => keep.has(e.from) && keep.has(e.to));
    truncated = true;
  }
  if (edgeList.length > MAX_ENTERPRISE_EDGES) {
    edgeList = edgeList.slice(0, MAX_ENTERPRISE_EDGES);
    truncated = true;
  }

  const byDomain: Record<string, number> = {};
  const domainOf = new Map(nodes.map((n) => [n.id, n.domain] as const));
  for (const n of nodes) byDomain[n.domain] = (byDomain[n.domain] ?? 0) + 1;
  let crossDomainEdges = 0;
  for (const e of edgeList) if (domainOf.get(e.from) !== domainOf.get(e.to)) crossDomainEdges += 1;

  return { nodes, edges: edgeList, byDomain, crossDomainEdges, truncated, builtAt: new Date(nowMs).toISOString() };
}

/* ── adjacency ────────────────────────────────────────────────────────────────────── */

/** Directed dependency adjacency: an edge `A →(depends_on/uses/contains) B` means "A depends on B". */
export interface EnterpriseAdjacency {
  out: Map<string, string[]>;
  in: Map<string, string[]>;
  nodeById: Map<string, EnterpriseNode>;
}
export function buildAdjacency(model: EnterpriseGraphModel): EnterpriseAdjacency {
  const out = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  for (const e of model.edges) {
    if (e.category === 'relates') continue; // peer links aren't directional dependencies
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (inAdj.get(e.to) ?? inAdj.set(e.to, []).get(e.to)!).push(e.from);
  }
  return { out, in: inAdj, nodeById: new Map(model.nodes.map((n) => [n.id, n] as const)) };
}

/** Distinct-neighbor degree (parallel edges carrying different relations don't inflate the count). */
function dedupeCount(neighbors: string[] | undefined): number {
  return neighbors ? new Set(neighbors).size : 0;
}

/** Count nodes that transitively DEPEND ON `id` (reverse reachability over inbound dependency edges). */
export function blastRadius(id: string, adj: EnterpriseAdjacency): number {
  const seen = new Set<string>([id]);
  const stack = [...(adj.in.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const p of adj.in.get(n) ?? []) if (!seen.has(p)) stack.push(p);
  }
  return seen.size - 1;
}

/* ── Dependency Intelligence ──────────────────────────────────────────────────────── */

export interface DependencyCycle {
  nodes: string[];
  size: number;
  domains: string[];
}
export interface SinglePointOfFailure {
  id: string;
  label: string;
  domain: EnterpriseDomain;
  blastRadius: number;
  dependents: number;
  risk: number | null;
}
export interface Bottleneck {
  id: string;
  label: string;
  domain: EnterpriseDomain;
  throughput: number;
  inDegree: number;
  outDegree: number;
}
export interface FailureChain {
  path: string[];
  length: number;
  domains: string[];
}
export interface DependencyReport {
  cycles: DependencyCycle[];
  spofs: SinglePointOfFailure[];
  bottlenecks: Bottleneck[];
  failureChains: FailureChain[];
  criticalCount: number;
  cyclic: boolean;
  builtAt: string;
}

/** Tarjan strongly-connected components → any SCC with >1 member (or a self-loop) is a dependency cycle. */
function stronglyConnected(model: EnterpriseGraphModel, adj: EnterpriseAdjacency): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  // Iterative Tarjan (recursion would blow the stack on a large enterprise graph).
  for (const start of model.nodes) {
    if (idx.has(start.id)) continue;
    const work: Array<{ v: string; i: number }> = [{ v: start.id, i: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.v;
      if (frame.i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
      }
      const neighbors = adj.out.get(v) ?? [];
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i += 1;
        if (!idx.has(w)) work.push({ v: w, i: 0 });
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      } else {
        if (low.get(v) === idx.get(v)) {
          const comp: string[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
            if (w === v) break;
          }
          sccs.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
      }
    }
  }
  return sccs;
}

/**
 * Longest dependency chain from `start` following outbound dependency edges (bounded, cycle-safe). Returns whether
 * the result is `tainted` — i.e. a back-edge into the current DFS path (or the depth cap) was pruned, making the
 * chain PATH-DEPENDENT. A tainted result is NEVER memoized, so a later root can't reuse a truncated chain.
 */
function longestChainFrom(start: string, adj: EnterpriseAdjacency, memo: Map<string, string[]>, path: Set<string>): { chain: string[]; tainted: boolean } {
  const cached = memo.get(start);
  if (cached) return { chain: cached, tainted: false };
  if (path.size >= MAX_CHAIN_DEPTH) return { chain: [start], tainted: true };
  path.add(start);
  let best: string[] = [];
  let tainted = false;
  for (const next of adj.out.get(start) ?? []) {
    if (path.has(next)) {
      tainted = true; // pruned back-edge — the true longest chain here is context-dependent
      continue;
    }
    const sub = longestChainFrom(next, adj, memo, path);
    if (sub.tainted) tainted = true;
    if (sub.chain.length > best.length) best = sub.chain;
  }
  path.delete(start);
  const chain = [start, ...best];
  if (!tainted) memo.set(start, chain);
  return { chain, tainted };
}

/** Compute cycles, SPOFs, bottlenecks, and failure chains over the unified dependency graph. */
export function analyzeDependencies(model: EnterpriseGraphModel, nowMs: number): DependencyReport {
  const adj = buildAdjacency(model);
  const domainOf = (id: string): EnterpriseDomain => adj.nodeById.get(id)?.domain ?? 'unknown';

  // Cycles. (Self-loops can't exist — `buildEnterpriseGraph` strips every `from === to` edge — so an SCC is a
  // real cycle iff it has >1 member.)
  const sccs = stronglyConnected(model, adj);
  const cycles: DependencyCycle[] = [];
  for (const comp of sccs) {
    if (comp.length > 1) cycles.push({ nodes: comp.slice(0, 32), size: comp.length, domains: [...new Set(comp.map(domainOf))] });
  }
  cycles.sort((a, b) => b.size - a.size);

  // SPOFs — the largest reverse-reach. Scan ONLY nodes that HAVE dependents (inbound dependency edges); a node
  // with no inbound edge has blast radius 0 and is filtered out anyway, so this avoids an O(V²) full-node scan.
  const spofs: SinglePointOfFailure[] = [...adj.in.keys()]
    .map((id) => {
      const n = adj.nodeById.get(id);
      return { id, label: n?.label ?? id, domain: n?.domain ?? 'unknown', blastRadius: blastRadius(id, adj), dependents: dedupeCount(adj.in.get(id)), risk: n?.risk ?? null };
    })
    .filter((s) => s.blastRadius > 0)
    .sort((a, b) => b.blastRadius - a.blastRadius || (b.risk ?? 0) - (a.risk ?? 0))
    .slice(0, 25);

  // Bottlenecks — high fan-in × fan-out throughput. Only nodes touched by an edge can have throughput > 0.
  const touched = new Set<string>([...adj.in.keys(), ...adj.out.keys()]);
  const bottlenecks: Bottleneck[] = [...touched]
    .map((id) => {
      const n = adj.nodeById.get(id);
      const inD = dedupeCount(adj.in.get(id));
      const outD = dedupeCount(adj.out.get(id));
      return { id, label: n?.label ?? id, domain: n?.domain ?? 'unknown', throughput: inD * outD, inDegree: inD, outDegree: outD };
    })
    .filter((b) => b.throughput > 0)
    .sort((a, b) => b.throughput - a.throughput)
    .slice(0, 25);

  // Failure chains — the longest dependency paths (roots = nodes with no inbound dependency edge).
  const memo = new Map<string, string[]>();
  const roots = model.nodes.filter((n) => (adj.in.get(n.id)?.length ?? 0) === 0 && (adj.out.get(n.id)?.length ?? 0) > 0);
  const chains: FailureChain[] = [];
  for (const r of roots) {
    const { chain } = longestChainFrom(r.id, adj, memo, new Set());
    if (chain.length >= 3) chains.push({ path: chain.slice(0, MAX_CHAIN_DEPTH), length: chain.length, domains: [...new Set(chain.map(domainOf))] });
  }
  chains.sort((a, b) => b.length - a.length);

  return {
    cycles: cycles.slice(0, 25),
    spofs,
    bottlenecks,
    failureChains: chains.slice(0, 15),
    criticalCount: cycles.length + spofs.filter((s) => s.blastRadius >= 5).length,
    cyclic: cycles.length > 0,
    builtAt: new Date(nowMs).toISOString(),
  };
}

/* ── Change-Impact Intelligence ───────────────────────────────────────────────────── */

export interface ChangeImpactReport {
  resourceId: string;
  label: string;
  domain: EnterpriseDomain;
  /** All nodes that transitively depend on the target (the blast radius set). */
  affected: string[];
  affectedByDomain: Record<string, number>;
  blastRadius: number;
  directDependents: number;
  /** 0–1 — higher when the impacted subgraph is well-connected + health/risk data is present. */
  confidence: number;
  builtAt: string;
}

/** Predict the blast radius of a change to `nodeId`: everything that transitively depends on it, by domain. */
export function analyzeChangeImpact(model: EnterpriseGraphModel, nodeId: string, nowMs: number): ChangeImpactReport {
  return changeImpactWith(buildAdjacency(model), nodeId, nowMs);
}

/** Change-impact against a PREBUILT adjacency (so a caller running many impacts reuses one adjacency). */
export function changeImpactWith(adj: EnterpriseAdjacency, nodeId: string, nowMs: number): ChangeImpactReport {
  const node = adj.nodeById.get(nodeId);
  const seen = new Set<string>([nodeId]);
  const stack = [...(adj.in.get(nodeId) ?? [])];
  const affected: string[] = [];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    affected.push(n);
    for (const p of adj.in.get(n) ?? []) if (!seen.has(p)) stack.push(p);
  }
  const affectedByDomain: Record<string, number> = {};
  for (const id of affected) {
    const d = adj.nodeById.get(id)?.domain ?? 'unknown';
    affectedByDomain[d] = (affectedByDomain[d] ?? 0) + 1;
  }
  const direct = dedupeCount(adj.in.get(nodeId));
  // Confidence: present target + coverage of the affected set by health/risk-bearing nodes + edge density.
  const scored = affected.filter((id) => adj.nodeById.get(id)?.health != null || adj.nodeById.get(id)?.risk != null).length;
  const coverage = affected.length ? scored / affected.length : (node ? 1 : 0);
  const confidence = node ? Math.round((0.5 + 0.5 * coverage) * 100) / 100 : 0;

  return {
    resourceId: nodeId,
    label: node?.label ?? nodeId,
    domain: node?.domain ?? 'unknown',
    affected: affected.slice(0, 500),
    affectedByDomain,
    blastRadius: affected.length,
    directDependents: direct,
    confidence,
    builtAt: new Date(nowMs).toISOString(),
  };
}

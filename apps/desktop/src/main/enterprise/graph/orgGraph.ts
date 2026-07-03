/**
 * The Organization Graph projector. Weaves the org chart (organization → units →
 * people + AI workers), the connected SaaS connectors, and the business entities
 * they bring in (projects, customers, documents) into one relationship graph.
 *
 * Pure and electron-free: it takes plain inputs and returns an {@link OrgGraph}.
 * The graph is a *projection* — recomputed from the runtime + stores, never a
 * separately persisted source of truth.
 */
import type {
  Organization,
  OrgGraph,
  OrgGraphEdge,
  OrgGraphEdgeKind,
  OrgGraphNeighbor,
  OrgGraphNeighbors,
  OrgGraphNode,
  OrgUnit,
  OrgUser,
} from '@neuropause/shared';

/** A business entity reference, already classified into a graph node kind. */
export interface EntityRef {
  id: string;
  kind: 'project' | 'customer' | 'document';
  title: string;
  connectorId: string | null;
}

export interface ConnectorRef {
  id: string;
  name: string;
}

export interface OrgGraphInput {
  org: Organization;
  units: OrgUnit[];
  users: OrgUser[];
  entities: EntityRef[];
  connectors: ConnectorRef[];
  /** Per-kind cap on business entities so the graph stays bounded. */
  entityCap?: number;
  now?: string;
}

const ENTITY_NODE_KIND = {
  project: 'project',
  customer: 'customer',
  document: 'document',
} as const;

const ENTITY_EDGE_KIND: Record<EntityRef['kind'], OrgGraphEdgeKind> = {
  project: 'owns',
  customer: 'engages',
  document: 'authored',
};

export function buildOrgGraph(input: OrgGraphInput): OrgGraph {
  const now = input.now ?? new Date().toISOString();
  const cap = input.entityCap ?? 40;
  const nodes: OrgGraphNode[] = [];
  const edges: OrgGraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (n: OrgGraphNode): void => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const addEdge = (kind: OrgGraphEdgeKind, from: string, to: string): void => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    edges.push({ id: `${kind}:${from}:${to}`, kind, from, to });
  };

  // Organization root.
  const orgNodeId = `org:${input.org.id}`;
  addNode({ id: orgNodeId, kind: 'organization', label: input.org.name, detail: input.org.description || null, metadata: {} });

  // Units.
  for (const u of input.units) {
    addNode({
      id: `unit:${u.id}`,
      kind: 'unit',
      label: u.name,
      detail: u.kind.replace('_', ' '),
      metadata: { unitKind: u.kind },
    });
  }
  for (const u of input.units) {
    if (u.parentId) addEdge('contains', `unit:${u.parentId}`, `unit:${u.id}`);
    else addEdge('contains', orgNodeId, `unit:${u.id}`);
  }

  // People + AI workers.
  for (const m of input.users) {
    addNode({
      id: `user:${m.id}`,
      kind: m.kind === 'ai_worker' ? 'worker' : 'user',
      label: m.name,
      detail: m.title,
      metadata: { kind: m.kind, status: m.status, workerId: m.workerId },
    });
  }
  for (const m of input.users) {
    if (m.unitId) addEdge('member_of', `user:${m.id}`, `unit:${m.unitId}`);
    if (m.kind === 'ai_worker') addEdge('operates', `user:${m.id}`, orgNodeId);
  }
  for (const u of input.units) {
    if (u.leadUserId) addEdge('leads', `user:${u.leadUserId}`, `unit:${u.id}`);
  }

  // Connectors.
  for (const c of input.connectors) {
    addNode({ id: `connector:${c.id}`, kind: 'connector', label: c.name, detail: 'connector', metadata: {} });
    addEdge('connected', orgNodeId, `connector:${c.id}`);
  }

  // Business entities (capped per kind).
  const perKind: Record<string, number> = { project: 0, customer: 0, document: 0 };
  for (const e of input.entities) {
    if (perKind[e.kind] >= cap) continue;
    perKind[e.kind] += 1;
    const nid = `entity:${e.id}`;
    addNode({
      id: nid,
      kind: ENTITY_NODE_KIND[e.kind],
      label: e.title,
      detail: e.kind,
      metadata: { connectorId: e.connectorId },
    });
    addEdge(ENTITY_EDGE_KIND[e.kind], orgNodeId, nid);
  }

  const byNodeKind: Record<string, number> = {};
  for (const n of nodes) byNodeKind[n.kind] = (byNodeKind[n.kind] ?? 0) + 1;

  return {
    nodes,
    edges,
    counts: { nodes: nodes.length, edges: edges.length, byNodeKind },
    builtAt: now,
  };
}

/** Neighbors of a node in a built graph (computed on the fly — graph is small). */
export function orgGraphNeighbors(graph: OrgGraph, id: string, limit = 100): OrgGraphNeighbors | null {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const neighbors: OrgGraphNeighbor[] = [];
  for (const e of graph.edges) {
    if (e.from === id) {
      const other = byId.get(e.to);
      if (other) neighbors.push({ edge: e, node: other, direction: 'out' });
    } else if (e.to === id) {
      const other = byId.get(e.from);
      if (other) neighbors.push({ edge: e, node: other, direction: 'in' });
    }
    if (neighbors.length >= limit) break;
  }
  return { node, neighbors };
}

/**
 * The graph projector. Turns Unified Data Model entities into Enterprise
 * Knowledge Graph nodes and edges — deterministically, with every edge carrying
 * provenance back to the UDM record that justifies it. Pure (no I/O, no
 * singletons) so it unit-tests directly from synthetic entities.
 *
 * Node mapping: project/task/document/file/event/conversation/message/contact/
 * organization/workspace → their graph types; people are derived from authors
 * and assignees; connectors and installed applications are provenance nodes.
 * Edges come from container/parent relationships and semantic fields (author →
 * created_by / assigned_to, message author → participated_in, …).
 */
import type {
  GraphEdge,
  GraphEdgeType,
  GraphEvidence,
  GraphMeta,
  GraphNode,
  GraphNodeType,
  UnifiedEntity,
} from '@neuropause/shared';

export interface ProjectionInput {
  entities: UnifiedEntity[];
  connectors: Array<{ id: string; name: string }>;
  applications: Array<{ slug: string; name: string }>;
  now: string;
}

export interface Projection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown'
  );
}

function nodeTypeForEntity(e: UnifiedEntity): GraphNodeType | null {
  switch (e.kind) {
    case 'project':
      return 'project';
    case 'task':
      return 'task';
    case 'document':
      return 'document';
    case 'file':
    case 'attachment':
      return 'file';
    case 'calendar_event':
      return toNum(e.metadata.attendees) > 0 ? 'meeting' : 'calendar_event';
    case 'event':
      return 'meeting';
    case 'conversation':
      return 'conversation';
    case 'message':
      return 'message';
    case 'contact':
      return 'person';
    case 'organization':
      return 'organization';
    case 'workspace':
      return 'team';
    case 'account':
      return 'person';
    default:
      return null; // notification, label, activity are timeline signals, not nodes
  }
}

function nodeMeta(e: UnifiedEntity): GraphMeta {
  return { kind: e.kind, status: e.status, url: e.url, connector: e.connectorId };
}

export function projectGraph(input: ProjectionInput): Projection {
  const { entities, connectors, applications, now } = input;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (n: GraphNode): void => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (
    from: string,
    to: string,
    type: GraphEdgeType,
    evidence: GraphEvidence | null,
  ): void => {
    if (from === to) return;
    const id = `${from}|${type}|${to}`;
    if (!edges.has(id)) {
      edges.set(id, { id, type, from, to, label: null, createdAt: now, updatedAt: now, evidence, metadata: {} });
    }
  };

  // Provenance nodes.
  for (const c of connectors) {
    addNode({ id: `connector:${c.id}`, type: 'connector', label: c.name, sourceKind: 'platform', sourceId: null, connectorId: c.id, createdAt: now, updatedAt: now, metadata: {} });
  }
  for (const a of applications) {
    addNode({ id: `app:${a.slug}`, type: 'application', label: a.name, sourceKind: 'platform', sourceId: null, connectorId: null, createdAt: now, updatedAt: now, metadata: {} });
  }

  const ensurePerson = (connectorId: string, handle: string): string => {
    const id = `person:${connectorId}:${slug(handle)}`;
    addNode({ id, type: 'person', label: handle, sourceKind: 'derived', sourceId: null, connectorId, createdAt: now, updatedAt: now, metadata: {} });
    return id;
  };

  // First pass: entity nodes (so container/parent edges can resolve).
  for (const e of entities) {
    const t = nodeTypeForEntity(e);
    if (!t) continue;
    addNode({ id: e.id, type: t, label: e.title, sourceKind: e.kind, sourceId: e.id, connectorId: e.connectorId, createdAt: e.createdAt, updatedAt: e.updatedAt, metadata: nodeMeta(e) });
  }

  // Second pass: edges.
  for (const e of entities) {
    const t = nodeTypeForEntity(e);
    if (!t) continue;
    const ev: GraphEvidence = { kind: e.kind, id: e.id };

    if (e.containerId && nodes.has(e.containerId)) addEdge(e.id, e.containerId, 'belongs_to', ev);
    if (e.parentId && e.parentId !== e.containerId && nodes.has(e.parentId)) addEdge(e.id, e.parentId, 'belongs_to', ev);

    if (e.author) {
      const person = ensurePerson(e.connectorId, e.author);
      if (t === 'task') addEdge(e.id, person, 'assigned_to', ev);
      else addEdge(e.id, person, 'created_by', ev);
      if (t === 'message' && e.containerId && nodes.has(e.containerId)) addEdge(person, e.containerId, 'participated_in', ev);
      if (t === 'meeting') addEdge(person, e.id, 'participated_in', ev);
    }

    const assignee = e.metadata.assignee;
    if (typeof assignee === 'string' && assignee) {
      const person = ensurePerson(e.connectorId, assignee);
      addEdge(e.id, person, 'assigned_to', ev);
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

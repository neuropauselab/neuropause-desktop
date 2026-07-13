/**
 * Bridge the Resource Graph into the ONE Enterprise Knowledge Graph (P6).
 *
 * This is the exact pattern `erpGraphBridge` established for unifying a domain into the single EKG WITHOUT a
 * parallel graph: a pure function that maps the domain model's nodes + typed relationships onto the EKG's
 * `GraphNode` / `GraphEdge` shapes, reusing the existing generic `GraphEdgeType`s and preserving the precise
 * relation in `edge.label` + `metadata.relation`. Ids are namespaced (`resource:`) so they can never alias a
 * UDM unified id or an `erp:` node. The result feeds the graph projector alongside the ERP overlay, so every
 * cloud resource becomes visible to the Timeline, AI Memory, Search, Traces, and Executive Center for free.
 *
 * Pure — no persistence, no fetch.
 */
import type { GraphEdge, GraphEdgeType, GraphNode } from '../types/graph';
import type { CloudResource, ResourceGraphModel, ResourceRelationshipType } from './resourceGraph';

/** Namespace so a resource node id can never collide with a UDM unified id or an `erp:` node id. */
export const RESOURCE_NODE_PREFIX = 'resource:';

/** The output of the bridge — EKG nodes + edges ready to merge into the projection. */
export interface ResourceGraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Map one of the nine infrastructure relations onto the EKG's ten generic `GraphEdgeType`s. Containment /
 * membership relations become `belongs_to`; runtime/dependency relations become `depends_on`; usage /
 * backing / protection become `references`; peer connectivity becomes `linked_to`. The PRECISE relation is
 * never lost — it is carried in the edge label + `metadata.relation` (exactly as the ERP bridge does).
 */
export function edgeTypeForResourceRelation(t: ResourceRelationshipType): GraphEdgeType {
  switch (t) {
    case 'runs_on':
    case 'depends_on':
      return 'depends_on';
    case 'hosted_by':
    case 'member_of':
    case 'attached_to':
      return 'belongs_to';
    case 'uses':
    case 'backed_by':
    case 'protected_by':
      return 'references';
    case 'connected_to':
      return 'linked_to';
    default:
      return 'linked_to';
  }
}

/** A human label for a relation kind (used on the bridged edge). */
export function resourceRelationLabel(t: ResourceRelationshipType): string {
  return t
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The EKG node id for a resource. */
export function resourceNodeId(resourceId: string): string {
  return `${RESOURCE_NODE_PREFIX}${resourceId}`;
}

function nodeForResource(r: CloudResource, now: string): GraphNode {
  return {
    id: resourceNodeId(r.id),
    type: 'cloud_resource',
    label: r.name,
    sourceKind: 'infrastructure',
    sourceId: r.id,
    connectorId: r.platformId,
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || now,
    metadata: {
      provider: r.provider,
      platform: r.platformId,
      account: r.accountId,
      domain: r.domain,
      resourceType: r.resourceType,
      nativeId: r.nativeId,
      region: r.region,
      status: r.status,
      health: r.health,
    },
  };
}

/**
 * Project the Resource Graph model into EKG nodes + edges. Every resource becomes a `cloud_resource` node;
 * every resolved edge becomes a generic EKG edge carrying its precise relation in `label` + `metadata`.
 * Edges whose endpoints aren't both present are skipped (the resource-graph builder already dropped dangling
 * relationships, so this is belt-and-suspenders).
 */
export function resourceGraphBridge(model: ResourceGraphModel, now: string): ResourceGraphProjection {
  const nodes = model.resources.map((r) => nodeForResource(r, now));
  const present = new Set(model.resources.map((r) => resourceNodeId(r.id)));

  const edges: GraphEdge[] = [];
  for (const e of model.edges) {
    const from = resourceNodeId(e.from);
    const to = resourceNodeId(e.to);
    if (!present.has(from) || !present.has(to)) continue;
    const type = edgeTypeForResourceRelation(e.type);
    edges.push({
      // Key the id on the PRECISE relation, not the generic `type`: nine relations map onto four generic
      // edge types, so `A backed_by B` and `A protected_by B` both become `references` — keying on `type`
      // would collapse them to one id and every downstream dedup (projector/graphStore) would silently drop
      // one. The precise relation keeps distinct relationships distinct.
      id: `${from}|${e.type}|${to}`,
      type,
      from,
      to,
      label: e.label ?? resourceRelationLabel(e.type),
      createdAt: now,
      updatedAt: now,
      evidence: { kind: 'cloud_resource', id: e.from },
      metadata: { relation: e.type, overlay: 'infrastructure' },
    });
  }

  return { nodes, edges };
}

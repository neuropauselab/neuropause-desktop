/**
 * The Enterprise Knowledge Graph (EKG) model.
 *
 * The EKG is a typed, directed graph projected deterministically from the Unified
 * Data Model: UDM entities become nodes, their relationships and semantic fields
 * become edges. From here up, the intelligence layer (Timeline, AI Memory,
 * Search, Daily Intelligence, Recommendations, Founder AI, the Traces) reads the
 * graph and the UDM — never a connector. Every edge carries provenance back to
 * the UDM record that justifies it, and the graph maintains a relationship
 * history so you can see how the organization's structure changed over time.
 *
 * Types-only so the main process, renderer, and tests share them.
 */

/** The node kinds the graph represents. */
export type GraphNodeType =
  | 'person'
  | 'organization'
  | 'team'
  | 'department'
  | 'project'
  | 'task'
  | 'document'
  | 'file'
  | 'meeting'
  | 'calendar_event'
  | 'conversation'
  | 'message'
  | 'customer'
  | 'vendor'
  | 'policy'
  | 'ai_worker'
  | 'connector'
  | 'application'
  // P2.5 — ERP business entities unified into the knowledge graph (derived from ERP records; no new store).
  | 'product'
  | 'warehouse'
  | 'machine'
  | 'work_center'
  | 'asset'
  | 'bom'
  | 'production_order'
  | 'production_schedule'
  | 'production_execution'
  | 'quality_inspection'
  | 'sales_order'
  | 'quote'
  | 'invoice'
  | 'payment'
  | 'purchase_order'
  | 'goods_receipt'
  | 'work_order'
  | 'downtime_event'
  | 'decision'
  | 'proposal';

export const GRAPH_NODE_TYPES: readonly GraphNodeType[] = [
  'person', 'organization', 'team', 'department', 'project', 'task', 'document',
  'file', 'meeting', 'calendar_event', 'conversation', 'message', 'customer',
  'vendor', 'policy', 'ai_worker', 'connector', 'application',
  // P2.5 ERP entities
  'product', 'warehouse', 'machine', 'work_center', 'asset', 'bom', 'production_order',
  'production_schedule', 'production_execution', 'quality_inspection', 'sales_order', 'quote',
  'invoice', 'payment', 'purchase_order', 'goods_receipt', 'work_order', 'downtime_event',
  'decision', 'proposal',
] as const;

/** P2.5 — the business node types added on top of the original collaboration set. */
export const ERP_GRAPH_NODE_TYPES: readonly GraphNodeType[] = [
  'product', 'warehouse', 'machine', 'work_center', 'asset', 'bom', 'production_order',
  'production_schedule', 'production_execution', 'quality_inspection', 'sales_order', 'quote',
  'invoice', 'payment', 'purchase_order', 'goods_receipt', 'work_order', 'downtime_event',
  'decision', 'proposal', 'customer', 'vendor',
] as const;

/** The relationship kinds the graph represents. */
export type GraphEdgeType =
  | 'assigned_to'
  | 'created_by'
  | 'depends_on'
  | 'belongs_to'
  | 'references'
  | 'participated_in'
  | 'discussed_in'
  | 'generated_by'
  | 'approved_by'
  | 'linked_to';

export const GRAPH_EDGE_TYPES: readonly GraphEdgeType[] = [
  'assigned_to', 'created_by', 'depends_on', 'belongs_to', 'references',
  'participated_in', 'discussed_in', 'generated_by', 'approved_by', 'linked_to',
] as const;

export type GraphMeta = Record<string, string | number | boolean | null>;

/** A reference back to the UDM record that produced a node or justified an edge. */
export interface GraphEvidence {
  kind: string;
  id: string;
}

export interface GraphNode {
  /** Stable graph id (UDM unified id for entity-derived nodes; synthesized otherwise). */
  id: string;
  type: GraphNodeType;
  label: string;
  /** UDM kind or 'derived' / 'platform'. */
  sourceKind: string | null;
  /** UDM unified id when the node mirrors an entity. */
  sourceId: string | null;
  connectorId: string | null;
  /** When the node first appeared in the graph (ISO). */
  createdAt: string;
  /** When the node was last refreshed (ISO). */
  updatedAt: string;
  metadata: GraphMeta;
}

export interface GraphEdge {
  /** Deterministic id: `${from}|${type}|${to}`. */
  id: string;
  type: GraphEdgeType;
  from: string;
  to: string;
  label: string | null;
  /** When the relationship was first observed (ISO). */
  createdAt: string;
  /** When the relationship was last observed (ISO). */
  updatedAt: string;
  /** The UDM record that justifies this edge. */
  evidence: GraphEvidence | null;
  metadata: GraphMeta;
}

/** One entry in the relationship history — an edge appearing or disappearing. */
export interface GraphEdgeEvent {
  at: string;
  edgeId: string;
  type: GraphEdgeType;
  from: string;
  to: string;
  change: 'added' | 'removed';
}

export interface GraphCounts {
  nodes: number;
  edges: number;
  byNodeType: Record<string, number>;
  byEdgeType: Record<string, number>;
  lastBuiltAt: string | null;
}

/** A node plus one adjacent edge and the node on the other side. */
export interface GraphEdgeToNode {
  edge: GraphEdge;
  node: GraphNode;
  /** 'out' if the edge points away from the anchor node, 'in' otherwise. */
  direction: 'out' | 'in';
}

/** A node with its immediate neighborhood. */
export interface GraphNeighbors {
  node: GraphNode;
  neighbors: GraphEdgeToNode[];
}

/** A connected subgraph (ego network) around an anchor node. */
export interface GraphSubgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
}

/* ──────────────────────────── request shapes ───────────────────────────── */

export interface GraphNeighborsQuery {
  id: string;
  direction?: 'both' | 'out' | 'in';
  edgeTypes?: GraphEdgeType[];
  limit?: number;
}

export interface GraphSubgraphQuery {
  id: string;
  depth?: number;
  limit?: number;
}

export interface GraphNodesQuery {
  type?: GraphNodeType;
  connectorId?: string;
  text?: string;
  limit?: number;
}

export interface GraphPathQuery {
  from: string;
  to: string;
  maxDepth?: number;
}

export interface GraphPathResult {
  /** Ordered node ids from `from` to `to`, or null if unreachable within maxDepth. */
  path: string[] | null;
  /** The nodes on the path, in order. */
  nodes: GraphNode[];
  /** The edges traversed, in order. */
  edges: GraphEdge[];
}

export interface GraphHistoryQuery {
  id: string;
  limit?: number;
}

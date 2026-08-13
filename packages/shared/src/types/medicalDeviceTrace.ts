/**
 * Medical Device Pack — the traceability graph.
 *
 * The chain this exists to answer, in both directions:
 *
 *     Raw Material Lot → Manufacturing Order → Finished Goods Lot
 *                      → Warehouse → Shipment → Customer
 *
 * Every edge is a RECORD of something that happened, written at the moment it
 * happened by the service that performed it. Nothing in this file infers an
 * edge, and nothing derives one from a name that merely looks similar: a trace
 * that guesses is worse than no trace, because it is believed.
 *
 * Traversal is breadth-first with an explicit visited set and a depth cap. A
 * split chain, a rework loop (lot → MO → lot → MO) or a mis-imported cycle must
 * terminate; an unbounded walk over a real factory's history would hang the UI
 * on exactly the day someone needs it most.
 *
 * Pure: the graph is passed in. No I/O, no clock.
 */

export type TraceNodeType =
  | 'lot'
  | 'product'
  | 'manufacturing_order'
  | 'warehouse'
  | 'shipment'
  | 'customer'
  | 'order'
  | 'supplier';

export const TRACE_NODE_TYPES: readonly TraceNodeType[] = [
  'lot',
  'product',
  'manufacturing_order',
  'warehouse',
  'shipment',
  'customer',
  'order',
  'supplier',
];

/**
 * The kinds of edge the pack records. Each is written by exactly one operation,
 * named in the comment — if you cannot name the operation that writes an edge,
 * the edge does not belong here.
 */
export type TraceEdgeKind =
  /** Split: child lot derived from parent lot. Written by `lotService.split`. */
  | 'lot_derived_from'
  /** A manufacturing order consumed a lot. Written by `lotService.consumeForOrder`. */
  | 'mo_consumed_lot'
  /** A manufacturing order produced a lot. Written by `lotService.createFromOrder`. */
  | 'mo_produced_lot'
  /** A lot was placed in a warehouse. Written by `lotService.moveToWarehouse`. */
  | 'lot_stored_in'
  /** A lot went out on a shipment. Written by `lotService.recordShipment`. */
  | 'lot_shipped_in'
  /** A shipment was consigned to a customer. Written by `lotService.recordShipment`. */
  | 'shipment_to_customer'
  /** A shipment fulfilled a sales order. Written by `lotService.recordShipment`. */
  | 'shipment_for_order'
  /** A lot was purchased from a supplier. Written by `lotService.createLot`. */
  | 'lot_supplied_by'
  /** A lot is of a product. Written by `lotService.createLot`. */
  | 'lot_of_product';

export const TRACE_EDGE_KINDS: readonly TraceEdgeKind[] = [
  'lot_derived_from',
  'mo_consumed_lot',
  'mo_produced_lot',
  'lot_stored_in',
  'lot_shipped_in',
  'shipment_to_customer',
  'shipment_for_order',
  'lot_supplied_by',
  'lot_of_product',
];

export const TRACE_EDGE_LABELS: Record<TraceEdgeKind, string> = {
  lot_derived_from: 'split from',
  mo_consumed_lot: 'consumed',
  mo_produced_lot: 'produced',
  lot_stored_in: 'stored in',
  lot_shipped_in: 'shipped on',
  shipment_to_customer: 'delivered to',
  shipment_for_order: 'fulfils',
  lot_supplied_by: 'supplied by',
  lot_of_product: 'is a',
};

export interface TraceNodeRef {
  type: TraceNodeType;
  /** Record id where one exists; otherwise the business code the source gave. */
  id: string;
  /** What to show. Never invented — the code itself when no name is known. */
  label: string;
}

/**
 * Where an edge came from, when it came from an import. Carries the identifiers
 * the Data Plane's provenance store is keyed by, so a user can walk
 * lot → edge → source file → sheet → row → original value.
 */
export interface TraceProvenance {
  /** The Data Plane import run that created this edge. */
  planId: string;
  /** The provenance record id of the row, in the Data Plane's provenance store. */
  provenanceId: string;
}

export interface TraceEdge {
  id: string;
  tenantId: string;
  kind: TraceEdgeKind;
  from: TraceNodeRef;
  to: TraceNodeRef;
  /** Quantity that moved along this edge, where the edge moves material. */
  quantity: number | null;
  unit: string;
  /** When the recorded event happened (ISO-8601). */
  at: string;
  actor: string | null;
  provenance?: TraceProvenance;
}

/** Stable key for an edge, used to make edge writes idempotent. */
export function traceEdgeKey(edge: Pick<TraceEdge, 'tenantId' | 'kind' | 'from' | 'to'>): string {
  return [edge.tenantId, edge.kind, edge.from.type, edge.from.id, edge.to.type, edge.to.id].join('|');
}

/** Node identity within a traversal. */
export function traceNodeKey(ref: Pick<TraceNodeRef, 'type' | 'id'>): string {
  return `${ref.type}:${ref.id}`;
}

/* ── traversal ─────────────────────────────────────────────────────────────── */

/**
 * Edge orientation, stated once so traversal never has to guess:
 *
 *   lot_derived_from     child lot        → parent lot
 *   mo_consumed_lot      manufacturing order → lot it consumed
 *   mo_produced_lot      manufacturing order → lot it produced
 *   lot_stored_in        lot              → warehouse
 *   lot_shipped_in       lot              → shipment
 *   shipment_to_customer shipment         → customer
 *   shipment_for_order   shipment         → sales order
 *   lot_supplied_by      lot              → supplier
 *   lot_of_product       lot              → product
 *
 * Material flows along most of these in the same direction the edge points, so
 * a FORWARD trace ("where did this go?") follows them from `from` to `to`.
 *
 * Two point AGAINST the flow of material, because they are written from the
 * side that owns the fact: a child lot knows its parent, and a manufacturing
 * order knows what it consumed. Following those the same way as the rest is the
 * classic traceability bug — it reports a child's parent as the child's
 * destination, and answers "where did this raw material go?" with the order
 * that ate it and then nothing else.
 */
const REVERSED_EDGES: readonly TraceEdgeKind[] = ['lot_derived_from', 'mo_consumed_lot'];

/**
 * Edges that carry material and are therefore walked.
 *
 * `lot_of_product` and `lot_supplied_by` are CONTEXT, not flow. They are shown
 * on a lot's detail (see `lotContext`) but never traversed: following
 * `lot_of_product` would walk from one lot to its product and then to every
 * other lot of that product — a catalogue listing wearing a trace's clothes.
 */
const TRAVERSABLE_EDGES: readonly TraceEdgeKind[] = [
  'lot_derived_from',
  'mo_consumed_lot',
  'mo_produced_lot',
  'lot_stored_in',
  'lot_shipped_in',
  'shipment_to_customer',
  'shipment_for_order',
];

export const DEFAULT_TRACE_DEPTH = 12;
export const MAX_TRACE_NODES = 5_000;

export interface TraceOptions {
  /** Traversal depth cap. */
  maxDepth?: number;
  /** Node budget; the walk stops and reports truncation rather than hanging. */
  maxNodes?: number;
}

export interface TraceStep {
  edge: TraceEdge;
  /** Hops from the root. 1 = directly attached. */
  depth: number;
}

export interface TraceResult {
  direction: 'forward' | 'backward';
  root: TraceNodeRef;
  /** Every node reached, root first, in the order it was reached. */
  nodes: readonly TraceNodeRef[];
  /** Every edge traversed, with its distance from the root. */
  steps: readonly TraceStep[];
  /** True when the depth or node budget stopped the walk before it completed. */
  truncated: boolean;
  /** Nodes grouped by type — what the UI and the charter's questions ask for. */
  byType: Record<TraceNodeType, readonly TraceNodeRef[]>;
}

interface Adjacency {
  /** Edges leaving a node key. */
  out: Map<string, TraceEdge[]>;
  /** Edges arriving at a node key. */
  in: Map<string, TraceEdge[]>;
}

function index(edges: readonly TraceEdge[]): Adjacency {
  const out = new Map<string, TraceEdge[]>();
  const inn = new Map<string, TraceEdge[]>();
  for (const edge of edges) {
    const fk = traceNodeKey(edge.from);
    const tk = traceNodeKey(edge.to);
    (out.get(fk) ?? out.set(fk, []).get(fk)!).push(edge);
    (inn.get(tk) ?? inn.set(tk, []).get(tk)!).push(edge);
  }
  return { out, in: inn };
}

function emptyByType(): Record<TraceNodeType, TraceNodeRef[]> {
  return {
    lot: [],
    product: [],
    manufacturing_order: [],
    warehouse: [],
    shipment: [],
    customer: [],
    order: [],
    supplier: [],
  };
}

/**
 * Walk the graph from `root`.
 *
 * The direction decides which SIDE of an edge is followed, per edge kind:
 * forward from a lot follows `mo_consumed_lot` out (this lot fed that order)
 * and `lot_derived_from` IN (this lot is the parent of those children).
 */
function walk(
  edges: readonly TraceEdge[],
  root: TraceNodeRef,
  direction: 'forward' | 'backward',
  options: TraceOptions = {},
): TraceResult {
  const maxDepth = options.maxDepth ?? DEFAULT_TRACE_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_TRACE_NODES;
  const allowed = new Set<TraceEdgeKind>(TRAVERSABLE_EDGES);
  const adj = index(edges.filter((e) => allowed.has(e.kind)));

  const nodes: TraceNodeRef[] = [root];
  const steps: TraceStep[] = [];
  const seenNodes = new Set<string>([traceNodeKey(root)]);
  const seenEdges = new Set<string>();
  let truncated = false;

  let frontier: TraceNodeRef[] = [root];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: TraceNodeRef[] = [];
    for (const node of frontier) {
      const key = traceNodeKey(node);
      const candidates: { edge: TraceEdge; other: TraceNodeRef }[] = [];
      for (const edge of adj.out.get(key) ?? []) {
        if (followsOut(edge.kind, direction)) candidates.push({ edge, other: edge.to });
      }
      for (const edge of adj.in.get(key) ?? []) {
        if (followsIn(edge.kind, direction)) candidates.push({ edge, other: edge.from });
      }
      for (const { edge, other } of candidates) {
        if (seenEdges.has(edge.id)) continue;
        seenEdges.add(edge.id);
        steps.push({ edge, depth });
        const otherKey = traceNodeKey(other);
        if (seenNodes.has(otherKey)) continue;
        if (nodes.length >= maxNodes) {
          truncated = true;
          continue;
        }
        seenNodes.add(otherKey);
        nodes.push(other);
        next.push(other);
      }
    }
    if (depth === maxDepth && next.length > 0) truncated = true;
    frontier = next;
  }

  const byType = emptyByType();
  for (const node of nodes) byType[node.type].push(node);
  return { direction, root, nodes, steps, truncated, byType };
}

/**
 * Follow an edge from its `from` side?
 *
 * A forward trace follows material downstream: that is `from → to` for normal
 * edges and `to → from` for the two REVERSED_EDGES. A backward trace is the
 * exact mirror. Expressing it as one xor keeps the two directions provably
 * symmetric — there is no way for one to drift from the other.
 */
function followsOut(kind: TraceEdgeKind, direction: 'forward' | 'backward'): boolean {
  const reversed = REVERSED_EDGES.includes(kind);
  return direction === 'forward' ? !reversed : reversed;
}

function followsIn(kind: TraceEdgeKind, direction: 'forward' | 'backward'): boolean {
  return !followsOut(kind, direction);
}

/**
 * Forward trace — "where did this lot go?"
 *
 * Returns the warehouses it was stored in, the shipments it left on, the
 * customers those shipments were consigned to, the orders they fulfilled, the
 * manufacturing orders that consumed it and the lots those orders produced,
 * recursively.
 */
export function traceForward(
  edges: readonly TraceEdge[],
  root: TraceNodeRef,
  options?: TraceOptions,
): TraceResult {
  return walk(edges, root, 'forward', options);
}

/**
 * Backward trace — "what went into this?"
 *
 * From a finished lot: the manufacturing order that produced it, the lots that
 * order consumed, and their own origins, recursively. From a shipment or a
 * customer: the lots that went out, then their origins.
 */
export function traceBackward(
  edges: readonly TraceEdge[],
  root: TraceNodeRef,
  options?: TraceOptions,
): TraceResult {
  return walk(edges, root, 'backward', options);
}

/* ── the shapes the UI and IPC exchange ────────────────────────────────────── */

/** The immediate, one-hop context of a lot — cheap enough for a detail header. */
export interface LotTraceContext {
  product: TraceNodeRef | null;
  supplier: TraceNodeRef | null;
  warehouses: readonly TraceNodeRef[];
  manufacturingOrders: readonly TraceNodeRef[];
  parentLots: readonly TraceNodeRef[];
  childLots: readonly TraceNodeRef[];
  shipments: readonly TraceNodeRef[];
}

export function lotContext(edges: readonly TraceEdge[], lotId: string): LotTraceContext {
  const key = traceNodeKey({ type: 'lot', id: lotId });
  const out = edges.filter((e) => traceNodeKey(e.from) === key);
  const inn = edges.filter((e) => traceNodeKey(e.to) === key);
  return {
    product: out.find((e) => e.kind === 'lot_of_product')?.to ?? null,
    supplier: out.find((e) => e.kind === 'lot_supplied_by')?.to ?? null,
    warehouses: out.filter((e) => e.kind === 'lot_stored_in').map((e) => e.to),
    // Both manufacturing edges point order → lot, so both arrive at this lot.
    manufacturingOrders: inn
      .filter((e) => e.kind === 'mo_produced_lot' || e.kind === 'mo_consumed_lot')
      .map((e) => e.from),
    parentLots: out.filter((e) => e.kind === 'lot_derived_from').map((e) => e.to),
    childLots: inn.filter((e) => e.kind === 'lot_derived_from').map((e) => e.from),
    shipments: out.filter((e) => e.kind === 'lot_shipped_in').map((e) => e.to),
  };
}

/**
 * A rendered trace line for the UI, e.g.
 *   `← Raw Material LOT-RM-001 · consumed · 40 kg`
 */
export interface TraceLine {
  depth: number;
  kind: TraceEdgeKind;
  verb: string;
  from: TraceNodeRef;
  to: TraceNodeRef;
  quantity: string;
  at: string;
  /** True when the edge came from an import and can be opened in Provenance. */
  hasProvenance: boolean;
}

export function toTraceLines(result: TraceResult): TraceLine[] {
  return result.steps.map((step) => ({
    depth: step.depth,
    kind: step.edge.kind,
    verb: TRACE_EDGE_LABELS[step.edge.kind],
    from: step.edge.from,
    to: step.edge.to,
    quantity:
      step.edge.quantity === null ? '' : `${step.edge.quantity} ${step.edge.unit || 'unit'}`.trim(),
    at: step.edge.at,
    hasProvenance: Boolean(step.edge.provenance),
  }));
}

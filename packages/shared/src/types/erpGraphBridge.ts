/**
 * P2.5 — ERP → Knowledge Graph bridge (pure).
 *
 * Translates the read-only, zero-storage Enterprise Relationship model (business entities + their real
 * foreign-key relationships, derived from ERP module records) into Enterprise Knowledge Graph nodes/edges,
 * so the ONE knowledge graph unifies collaboration entities (emails, meetings, files, people) with business
 * entities (customers, suppliers, invoices, POs, machines, production orders, …). No new storage: this is a
 * deterministic projection of records that already exist, run at graph-rebuild time. Every edge keeps its
 * specific ERP relation name in metadata and cites the source relationship as evidence.
 */
import type { GraphEdge, GraphEdgeType, GraphNode, GraphNodeType } from './graph';
import type {
  RelationshipEntityKind,
  RelationshipGraphModel,
  RelationshipType,
} from './enterpriseRelationship';

/** ERP node ids are namespaced so they never collide with UDM unified ids. */
export const ERP_NODE_PREFIX = 'erp:';

const KIND_TO_NODE_TYPE: Record<RelationshipEntityKind, GraphNodeType> = {
  customer: 'customer',
  supplier: 'vendor',
  product: 'product',
  warehouse: 'warehouse',
  machine: 'machine',
  workCenter: 'work_center',
  technician: 'person',
  asset: 'asset',
  bom: 'bom',
  productionOrder: 'production_order',
  schedule: 'production_schedule',
  execution: 'production_execution',
  quality: 'quality_inspection',
  order: 'sales_order',
  quote: 'quote',
  invoice: 'invoice',
  payment: 'payment',
  purchaseOrder: 'purchase_order',
  goodsReceipt: 'goods_receipt',
  workOrder: 'work_order',
  downtime: 'downtime_event',
  decision: 'decision',
  proposal: 'proposal',
};

/** Map an ERP relation onto the knowledge-graph edge vocabulary; the specific relation is kept in metadata. */
function edgeTypeFor(t: RelationshipType): GraphEdgeType {
  switch (t) {
    case 'has_bom':
    case 'bom_component':
    case 'produces_product':
    case 'runs_on_machine':
    case 'machine_in_workcenter':
    case 'asset_of_machine':
    case 'order_to_schedule':
    case 'order_to_execution':
      return 'depends_on';
    case 'operated_by':
    case 'maintained_by':
    case 'performed_by':
    case 'inspected_by':
      return 'assigned_to';
    case 'stocked_in':
      return 'belongs_to';
    case 'executes_decision':
    case 'decision_affects':
      return 'generated_by';
    default:
      // places_order, order_to_invoice, invoice_to_payment, supplies_po, downtime_on, inspected, …
      return 'references';
  }
}

export interface ErpGraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Translate the relationship model into knowledge-graph nodes + edges. Pure; deterministic. */
export function erpGraphBridge(model: RelationshipGraphModel | null | undefined, now: string): ErpGraphProjection {
  if (!model) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = model.nodes.map((n) => ({
    id: `${ERP_NODE_PREFIX}${n.id}`,
    type: KIND_TO_NODE_TYPE[n.kind] ?? 'organization',
    label: n.label,
    sourceKind: `erp:${n.kind}`,
    sourceId: n.id,
    connectorId: null,
    createdAt: n.lastUpdated || now,
    updatedAt: n.lastUpdated || now,
    metadata: {
      kind: n.kind,
      key: n.key,
      detail: n.detail,
      value: n.value,
      risk: n.risk,
      activity: n.activity,
      degree: n.degree,
      health: n.health,
      master: n.master,
      resolved: n.resolved,
    },
  }));

  const edges: GraphEdge[] = model.edges.map((e) => {
    const from = `${ERP_NODE_PREFIX}${e.from}`;
    const to = `${ERP_NODE_PREFIX}${e.to}`;
    const type = edgeTypeFor(e.type);
    return {
      id: `${from}|${type}|${to}`,
      type,
      from,
      to,
      label: e.type,
      createdAt: e.lastUpdated || now,
      updatedAt: e.lastUpdated || now,
      evidence: { kind: 'enterprise-relationship', id: e.id },
      metadata: { relation: e.type, health: e.health, risk: e.risk, strength: e.strength, count: e.count },
    };
  });

  return { nodes, edges };
}

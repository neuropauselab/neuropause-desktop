/**
 * Enterprise Relationship Intelligence — the deterministic ENTITY relationship graph over the existing
 * ERP records. It EXTENDS (never duplicates) the platform: it owns no store, invents no data, and reads
 * nothing a second way. Every node is a real ERP entity (a specific customer / supplier / product /
 * machine / order / invoice / …) and every edge is a real foreign-key link already materialized on those
 * records — the SAME link conventions the Process Mining engine reads (`order.customer`, `payment.invoiceRef`,
 * `po.supplier`, `bom.product`, `schedule.productionOrder`, `execution.machine`, `downtime.machine`,
 * `proposal.sourceDecisionId`, …). Nothing here is inferred or synthetic.
 *
 * This is NOT the Enterprise Knowledge Graph (that models collaboration entities — people/docs/messages —
 * from the unified/connector layer). This is the disjoint BUSINESS-entity graph the knowledge graph never
 * models. It composes, deterministically: the graph (nodes + typed directed edges), per-edge Direction /
 * Weight / Strength / Confidence / Health / Risk / Activity / Last-Updated, relationship Health
 * (strong / healthy / weak / broken / dormant / critical), eight Executive relationship KPIs, dependency +
 * impact traversal, and a grounded narrative. Pure (no I/O); the clock (`nowMs`) is injected so activity /
 * recency scoring is deterministic. The AI only EXPLAINS this graph; it never adds edges.
 */
import type { ExecutiveKpi } from './executiveCenter';

/* ── minimal structural inputs (satisfied by the real ERP projections) ─────────── */
/* Each interface declares only the fields the engine reads; the provider passes the real
 * projections (customerFromRecord, orderFromRecord, …), which structurally satisfy these. */

interface Timestamped {
  /** The record's store id — used to resolve id-based provenance links (sourceOrder / invoiceRef / …). */
  id?: string;
  updatedAt?: string;
  createdAt?: string;
}
export interface RelCustomer extends Timestamped { name: string; status?: string; }
export interface RelSupplier extends Timestamped { name: string; status?: string; }
export interface RelProduct extends Timestamped { sku: string; name?: string; currentStock?: number; availableStock?: number; reorderLevel?: number; }
export interface RelWarehouse extends Timestamped { name: string; code?: string; }
export interface RelMachine extends Timestamped { name: string; workCenter?: string; status?: string; }
export interface RelWorkCenter extends Timestamped { name: string; status?: string; }
export interface RelTechnician extends Timestamped { name: string; status?: string; }
export interface RelAsset extends Timestamped { assetTag: string; machine?: string; criticality?: string; status?: string; }
export interface RelBomComponent { sku: string; quantity?: number; }
export interface RelBom extends Timestamped { bomNumber: string; product: string; components?: RelBomComponent[]; }
export interface RelProductionOrder extends Timestamped { orderNumber: string; product?: string; bom?: string; warehouse?: string; machine?: string; workCenter?: string; status?: string; }
export interface RelSchedule extends Timestamped { scheduleNumber: string; productionOrder?: string; machine?: string; workCenter?: string; status?: string; }
export interface RelExecution extends Timestamped { executionNumber: string; productionOrder?: string; schedule?: string; machine?: string; operator?: string; product?: string; bom?: string; workCenter?: string; status?: string; }
export interface RelQuality extends Timestamped { inspectionNumber: string; productionOrder?: string; inspector?: string; result?: string; }
export interface RelOrder extends Timestamped { orderNumber: string; customer: string; sourceQuote?: string; product?: string; total?: number; status?: string; }
export interface RelQuote extends Timestamped { quoteNumber: string; customer: string; total?: number; status?: string; }
export interface RelInvoice extends Timestamped { number: string; customer: string; sourceOrder?: string; amount?: number; amountPaid?: number; status?: string; }
export interface RelPayment extends Timestamped { paymentNumber: string; invoiceRef?: string; customer?: string; amount?: number; status?: string; }
export interface RelPurchaseOrder extends Timestamped { poNumber: string; supplier: string; product?: string; total?: number; status?: string; }
export interface RelGoodsReceipt extends Timestamped { grNumber: string; purchaseOrder?: string; supplier?: string; product?: string; status?: string; }
export interface RelWorkOrder extends Timestamped { workOrderNumber: string; machine?: string; asset?: string; technician?: string; type?: string; status?: string; }
export interface RelDowntime extends Timestamped { eventNumber: string; machine?: string; type?: string; durationHours?: number; status?: string; }
export interface RelDecision extends Timestamped { decisionId: string; title?: string; affectedOrders?: string[]; affectedMachines?: string[]; affectedCustomers?: string[]; status?: string; }
export interface RelProposal extends Timestamped { proposalNumber: string; sourceDecisionId?: string; targetModule?: string; status?: string; }
export interface RelMovement extends Timestamped { product?: string; warehouse?: string; type?: string; quantity?: number; status?: string; }

export interface RelationshipGraphInput {
  customers?: RelCustomer[];
  suppliers?: RelSupplier[];
  products?: RelProduct[];
  warehouses?: RelWarehouse[];
  machines?: RelMachine[];
  workCenters?: RelWorkCenter[];
  technicians?: RelTechnician[];
  assets?: RelAsset[];
  boms?: RelBom[];
  productionOrders?: RelProductionOrder[];
  schedules?: RelSchedule[];
  executions?: RelExecution[];
  quality?: RelQuality[];
  orders?: RelOrder[];
  quotes?: RelQuote[];
  invoices?: RelInvoice[];
  payments?: RelPayment[];
  purchaseOrders?: RelPurchaseOrder[];
  goodsReceipts?: RelGoodsReceipt[];
  workOrders?: RelWorkOrder[];
  downtime?: RelDowntime[];
  decisions?: RelDecision[];
  proposals?: RelProposal[];
  movements?: RelMovement[];
}

/* ── output vocabulary ─────────────────────────────────────────────────────────── */

export type RelationshipEntityKind =
  | 'customer' | 'supplier' | 'product' | 'warehouse' | 'machine' | 'workCenter' | 'technician' | 'asset'
  | 'bom' | 'productionOrder' | 'schedule' | 'execution' | 'quality'
  | 'order' | 'quote' | 'invoice' | 'payment' | 'purchaseOrder' | 'goodsReceipt'
  | 'workOrder' | 'downtime' | 'decision' | 'proposal';

export type RelationshipType =
  | 'places_order' | 'requests_quote' | 'billed_invoice' | 'made_payment'
  | 'quote_to_order' | 'order_to_invoice' | 'invoice_to_payment'
  | 'supplies_po' | 'po_to_receipt' | 'delivers_receipt'
  | 'has_bom' | 'bom_component' | 'produces_product'
  | 'order_to_schedule' | 'order_to_execution' | 'runs_on_machine' | 'operated_by'
  | 'machine_in_workcenter' | 'maintained_by' | 'performed_by' | 'downtime_on' | 'asset_of_machine'
  | 'inspected' | 'inspected_by' | 'stocked_in'
  | 'executes_decision' | 'decision_affects';

export type RelationshipHealth = 'strong' | 'healthy' | 'weak' | 'broken' | 'dormant' | 'critical';
export type RelationshipEdgeDirection = 'out' | 'bidirectional';

export interface RelationshipNode {
  id: string;
  kind: RelationshipEntityKind;
  key: string;
  label: string;
  detail: string;
  master: boolean;
  resolved: boolean;
  inDegree: number;
  outDegree: number;
  degree: number;
  value: number;
  activity: number;
  risk: number;
  health: RelationshipHealth;
  lastUpdated: string;
}

export interface RelationshipGraphEdge {
  id: string;
  from: string;
  to: string;
  type: RelationshipType;
  direction: RelationshipEdgeDirection;
  confidence: number;
  weight: number;
  count: number;
  strength: number;
  activity: number;
  risk: number;
  health: RelationshipHealth;
  lastUpdated: string;
}

export interface RelationshipInsights {
  totalNodes: number;
  totalEdges: number;
  relationshipHealth: number;
  strongCount: number;
  healthyCount: number;
  weakCount: number;
  brokenCount: number;
  dormantCount: number;
  criticalCount: number;
  disconnectedAssets: number;
  highRiskDependencies: number;
  supplierDependency: number;
  customerDependency: number;
  machineDependency: number;
  knowledgeConnectivity: number;
  averageDegree: number;
}

export interface RelationshipNarrative {
  summary: string;
  riskExplanation: string;
  dependencyExplanation: string;
  businessImpact: string;
  recommendedActions: string[];
  grounded: boolean;
}

export interface RelationshipGraphModel {
  generatedAtMs: number;
  nodes: RelationshipNode[];
  edges: RelationshipGraphEdge[];
  insights: RelationshipInsights;
  kpis: ExecutiveKpi[];
  counts: { nodes: number; edges: number; byKind: Record<string, number>; byHealth: Record<string, number> };
  criticalEdges: RelationshipGraphEdge[];
  highRiskEdges: RelationshipGraphEdge[];
  disconnected: RelationshipNode[];
  topEntities: RelationshipNode[];
  narrative: RelationshipNarrative;
}

/* ── helpers ───────────────────────────────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const MASTER_KINDS: ReadonlySet<RelationshipEntityKind> = new Set([
  'customer', 'supplier', 'product', 'machine', 'asset', 'warehouse', 'workCenter', 'technician',
]);
/** Risk (0..100) at/above which a dependency is "high risk". */
export const RELATIONSHIP_HIGH_RISK_THRESHOLD = 60;

function parseMs(s: string | undefined): number {
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}
function activityFromMs(ms: number, nowMs: number): number {
  if (ms <= 0) return 0;
  const days = (nowMs - ms) / 86_400_000;
  if (days <= 7) return 100;
  if (days <= 30) return 75;
  if (days <= 90) return 40;
  if (days <= 180) return 20;
  return 10;
}
function edgeStrength(activity: number, risk: number): number {
  return clamp(Math.round(0.6 * activity + 0.4 * (100 - risk)), 0, 100);
}
function edgeHealth(resolved: boolean, risk: number, activity: number, strength: number): RelationshipHealth {
  if (!resolved) return 'broken';
  if (risk >= 70) return 'critical';
  if (activity <= 15) return 'dormant';
  if (strength >= 75) return 'strong';
  if (strength >= 50) return 'healthy';
  return 'weak';
}

const nodeId = (kind: RelationshipEntityKind, key: string): string => `${kind}:${key}`;

interface MutEdge {
  from: string;
  to: string;
  type: RelationshipType;
  direction: RelationshipEdgeDirection;
  confidence: number;
  weight: number;
  count: number;
  riskSeed: number;
  lastMs: number;
}

/* ── the builder ───────────────────────────────────────────────────────────────── */

/** Derive the read-only ERP entity relationship graph from the existing record projections. Pure. */
export function buildRelationshipGraph(input: RelationshipGraphInput, nowMs: number): RelationshipGraphModel {
  const nodes = new Map<string, RelationshipNode>();
  const edges = new Map<string, MutEdge>();
  const idAlias = new Map<string, string>(); // record store id → node id (resolves id-based provenance links)

  function addNode(kind: RelationshipEntityKind, key: string, label: string, detail: string, ts: Timestamped): void {
    if (!key) return;
    const id = nodeId(kind, key);
    if (ts.id) idAlias.set(ts.id, id);
    const existing = nodes.get(id);
    const lastUpdated = ts.updatedAt || ts.createdAt || '';
    if (existing) {
      existing.resolved = true;
      if (label) existing.label = label;
      if (detail) existing.detail = detail;
      if (lastUpdated && lastUpdated > existing.lastUpdated) existing.lastUpdated = lastUpdated;
      return;
    }
    nodes.set(id, {
      id, kind, key, label: label || key, detail, master: MASTER_KINDS.has(kind), resolved: true,
      inDegree: 0, outDegree: 0, degree: 0, value: 0, activity: 0, risk: 0, health: 'healthy', lastUpdated,
    });
  }
  /** Reference a node that may or may not be a real record — creates an unresolved placeholder if missing. */
  function ensureNode(kind: RelationshipEntityKind, key: string): string | null {
    if (!key) return null;
    const id = nodeId(kind, key);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, kind, key, label: key, detail: 'Unresolved reference', master: MASTER_KINDS.has(kind), resolved: false,
        inDegree: 0, outDegree: 0, degree: 0, value: 0, activity: 0, risk: 0, health: 'broken', lastUpdated: '',
      });
    }
    return id;
  }
  function link(
    fromKind: RelationshipEntityKind, fromKey: string,
    toKind: RelationshipEntityKind, toKey: string,
    type: RelationshipType,
    opts: { confidence?: number; weight?: number; riskSeed?: number; ts?: Timestamped; direction?: RelationshipEdgeDirection; fromById?: boolean; toById?: boolean } = {},
  ): void {
    if (!fromKey || !toKey) return;
    const from = opts.fromById && idAlias.has(fromKey) ? idAlias.get(fromKey)! : ensureNode(fromKind, fromKey);
    const to = opts.toById && idAlias.has(toKey) ? idAlias.get(toKey)! : ensureNode(toKind, toKey);
    if (!from || !to || from === to) return;
    const id = `${from}|${to}|${type}`;
    const lastMs = parseMs(opts.ts?.updatedAt || opts.ts?.createdAt);
    const existing = edges.get(id);
    if (existing) {
      existing.count += 1;
      existing.weight += Math.max(0, opts.weight ?? 0);
      existing.riskSeed = Math.max(existing.riskSeed, opts.riskSeed ?? 10);
      if (lastMs > existing.lastMs) existing.lastMs = lastMs;
      return;
    }
    edges.set(id, {
      from, to, type, direction: opts.direction ?? 'out',
      confidence: opts.confidence ?? 95, weight: Math.max(0, opts.weight ?? 0), count: 1,
      riskSeed: opts.riskSeed ?? 10, lastMs,
    });
  }

  /* pass 1 — every real ERP record becomes a resolved node */
  for (const c of input.customers ?? []) addNode('customer', c.name, c.name, `Customer${c.status ? ` · ${c.status}` : ''}`, c);
  for (const s of input.suppliers ?? []) addNode('supplier', s.name, s.name, `Supplier${s.status ? ` · ${s.status}` : ''}`, s);
  for (const p of input.products ?? []) addNode('product', p.sku, p.name || p.sku, `Product · stock ${p.currentStock ?? 0}`, p);
  for (const w of input.warehouses ?? []) addNode('warehouse', w.name, w.name, `Warehouse${w.code ? ` · ${w.code}` : ''}`, w);
  for (const m of input.machines ?? []) addNode('machine', m.name, m.name, `Machine${m.status ? ` · ${m.status}` : ''}`, m);
  for (const wc of input.workCenters ?? []) addNode('workCenter', wc.name, wc.name, 'Work center', wc);
  for (const t of input.technicians ?? []) addNode('technician', t.name, t.name, `Technician${t.status ? ` · ${t.status}` : ''}`, t);
  for (const a of input.assets ?? []) addNode('asset', a.assetTag, a.assetTag, `Asset${a.criticality ? ` · ${a.criticality}` : ''}`, a);
  for (const b of input.boms ?? []) addNode('bom', b.bomNumber, b.bomNumber, `BOM of ${b.product}`, b);
  for (const o of input.productionOrders ?? []) addNode('productionOrder', o.orderNumber, o.orderNumber, `Production · ${o.status ?? ''}`, o);
  for (const s of input.schedules ?? []) addNode('schedule', s.scheduleNumber, s.scheduleNumber, 'Schedule', s);
  for (const e of input.executions ?? []) addNode('execution', e.executionNumber, e.executionNumber, `Execution · ${e.status ?? ''}`, e);
  for (const q of input.quality ?? []) addNode('quality', q.inspectionNumber, q.inspectionNumber, `Inspection · ${q.result ?? ''}`, q);
  for (const o of input.orders ?? []) addNode('order', o.orderNumber, o.orderNumber, `Order · ${o.status ?? ''}`, o);
  for (const q of input.quotes ?? []) addNode('quote', q.quoteNumber, q.quoteNumber, `Quote · ${q.status ?? ''}`, q);
  for (const i of input.invoices ?? []) addNode('invoice', i.number, i.number, `Invoice · ${i.status ?? ''}`, i);
  for (const p of input.payments ?? []) addNode('payment', p.paymentNumber, p.paymentNumber, `Payment · ${p.status ?? ''}`, p);
  for (const po of input.purchaseOrders ?? []) addNode('purchaseOrder', po.poNumber, po.poNumber, `PO · ${po.status ?? ''}`, po);
  for (const gr of input.goodsReceipts ?? []) addNode('goodsReceipt', gr.grNumber, gr.grNumber, `Receipt · ${gr.status ?? ''}`, gr);
  for (const wo of input.workOrders ?? []) addNode('workOrder', wo.workOrderNumber, wo.workOrderNumber, `Work order · ${wo.status ?? ''}`, wo);
  for (const d of input.downtime ?? []) addNode('downtime', d.eventNumber, d.eventNumber, `Downtime · ${d.type ?? ''}`, d);
  for (const d of input.decisions ?? []) addNode('decision', d.decisionId, d.title || d.decisionId, `Decision · ${d.status ?? ''}`, d);
  for (const p of input.proposals ?? []) addNode('proposal', p.proposalNumber, p.proposalNumber, `Proposal · ${p.status ?? ''}`, p);

  /* pass 2 — every foreign-key link becomes a typed directed edge */
  const bad = (status: string | undefined, set: string[]): boolean => !!status && set.includes(status);

  for (const o of input.orders ?? []) {
    const risk = bad(o.status, ['cancelled']) ? 55 : 12;
    link('customer', o.customer, 'order', o.orderNumber, 'places_order', { weight: o.total ?? 0, riskSeed: risk, ts: o });
    if (o.sourceQuote) link('quote', o.sourceQuote, 'order', o.orderNumber, 'quote_to_order', { confidence: 100, ts: o, fromById: true });
    if (o.product) link('product', o.product, 'order', o.orderNumber, 'places_order', { weight: o.total ?? 0, ts: o });
  }
  for (const q of input.quotes ?? []) {
    link('customer', q.customer, 'quote', q.quoteNumber, 'requests_quote', { weight: q.total ?? 0, riskSeed: 12, ts: q });
  }
  for (const i of input.invoices ?? []) {
    const outstanding = Math.max(0, (i.amount ?? 0) - (i.amountPaid ?? 0));
    const risk = bad(i.status, ['overdue']) ? 82 : bad(i.status, ['partially_paid', 'issued']) && outstanding > 0 ? 45 : 12;
    link('customer', i.customer, 'invoice', i.number, 'billed_invoice', { weight: i.amount ?? 0, riskSeed: risk, ts: i });
    if (i.sourceOrder) link('order', i.sourceOrder, 'invoice', i.number, 'order_to_invoice', { confidence: 100, ts: i, fromById: true });
  }
  for (const p of input.payments ?? []) {
    const risk = bad(p.status, ['void']) ? 70 : bad(p.status, ['pending']) ? 35 : 10;
    if (p.customer) link('customer', p.customer, 'payment', p.paymentNumber, 'made_payment', { weight: p.amount ?? 0, riskSeed: risk, ts: p });
    if (p.invoiceRef) link('invoice', p.invoiceRef, 'payment', p.paymentNumber, 'invoice_to_payment', { confidence: 100, weight: p.amount ?? 0, riskSeed: risk, ts: p, fromById: true });
  }
  for (const po of input.purchaseOrders ?? []) {
    const risk = bad(po.status, ['cancelled']) ? 55 : bad(po.status, ['draft']) ? 30 : 12;
    link('supplier', po.supplier, 'purchaseOrder', po.poNumber, 'supplies_po', { weight: po.total ?? 0, riskSeed: risk, ts: po });
    if (po.product) link('purchaseOrder', po.poNumber, 'product', po.product, 'supplies_po', { weight: po.total ?? 0, ts: po });
  }
  for (const gr of input.goodsReceipts ?? []) {
    const risk = bad(gr.status, ['rejected']) ? 65 : bad(gr.status, ['pending']) ? 30 : 12;
    if (gr.supplier) link('supplier', gr.supplier, 'goodsReceipt', gr.grNumber, 'delivers_receipt', { riskSeed: risk, ts: gr });
    if (gr.purchaseOrder) link('purchaseOrder', gr.purchaseOrder, 'goodsReceipt', gr.grNumber, 'po_to_receipt', { confidence: 100, riskSeed: risk, ts: gr, fromById: true });
  }
  for (const b of input.boms ?? []) {
    link('product', b.product, 'bom', b.bomNumber, 'has_bom', { confidence: 100, ts: b });
    for (const comp of b.components ?? []) if (comp.sku) link('bom', b.bomNumber, 'product', comp.sku, 'bom_component', { weight: comp.quantity ?? 0, ts: b });
  }
  for (const o of input.productionOrders ?? []) {
    const risk = bad(o.status, ['cancelled']) ? 45 : 12;
    if (o.product) link('productionOrder', o.orderNumber, 'product', o.product, 'produces_product', { riskSeed: risk, ts: o });
    if (o.bom) link('productionOrder', o.orderNumber, 'bom', o.bom, 'produces_product', { ts: o });
    if (o.machine) link('productionOrder', o.orderNumber, 'machine', o.machine, 'runs_on_machine', { riskSeed: risk, ts: o });
    if (o.warehouse) link('productionOrder', o.orderNumber, 'warehouse', o.warehouse, 'stocked_in', { ts: o });
  }
  for (const s of input.schedules ?? []) {
    if (s.productionOrder) link('productionOrder', s.productionOrder, 'schedule', s.scheduleNumber, 'order_to_schedule', { ts: s });
    if (s.machine) link('schedule', s.scheduleNumber, 'machine', s.machine, 'runs_on_machine', { ts: s });
    if (s.workCenter) link('schedule', s.scheduleNumber, 'workCenter', s.workCenter, 'runs_on_machine', { ts: s });
  }
  for (const e of input.executions ?? []) {
    const risk = bad(e.status, ['blocked']) ? 72 : bad(e.status, ['cancelled']) ? 45 : bad(e.status, ['paused']) ? 30 : 12;
    if (e.productionOrder) link('productionOrder', e.productionOrder, 'execution', e.executionNumber, 'order_to_execution', { riskSeed: risk, ts: e });
    if (e.schedule) link('schedule', e.schedule, 'execution', e.executionNumber, 'order_to_execution', { ts: e });
    if (e.machine) link('execution', e.executionNumber, 'machine', e.machine, 'runs_on_machine', { riskSeed: risk, ts: e });
    if (e.operator) link('execution', e.executionNumber, 'technician', e.operator, 'operated_by', { ts: e });
    if (e.product) link('execution', e.executionNumber, 'product', e.product, 'produces_product', { ts: e });
  }
  for (const q of input.quality ?? []) {
    const risk = bad(q.result, ['fail', 'reject']) ? 68 : bad(q.result, ['rework']) ? 45 : 12;
    if (q.productionOrder) link('productionOrder', q.productionOrder, 'quality', q.inspectionNumber, 'inspected', { riskSeed: risk, ts: q });
    if (q.inspector) link('quality', q.inspectionNumber, 'technician', q.inspector, 'inspected_by', { ts: q });
  }
  for (const m of input.machines ?? []) {
    const risk = bad(m.status, ['down', 'breakdown', 'offline']) ? 75 : bad(m.status, ['maintenance']) ? 45 : 12;
    if (m.workCenter) link('machine', m.name, 'workCenter', m.workCenter, 'machine_in_workcenter', { riskSeed: risk, direction: 'bidirectional', ts: m });
  }
  for (const a of input.assets ?? []) {
    const risk = bad(a.status, ['retired']) ? 40 : bad(a.status, ['maintenance']) ? 45 : 12;
    if (a.machine) link('asset', a.assetTag, 'machine', a.machine, 'asset_of_machine', { riskSeed: risk, direction: 'bidirectional', ts: a });
  }
  for (const wo of input.workOrders ?? []) {
    const risk = bad(wo.status, ['open', 'in_progress']) && wo.type === 'corrective' ? 55 : 15;
    if (wo.machine) link('machine', wo.machine, 'workOrder', wo.workOrderNumber, 'maintained_by', { riskSeed: risk, ts: wo });
    if (wo.asset) link('asset', wo.asset, 'workOrder', wo.workOrderNumber, 'maintained_by', { ts: wo });
    if (wo.technician) link('workOrder', wo.workOrderNumber, 'technician', wo.technician, 'performed_by', { ts: wo });
  }
  for (const d of input.downtime ?? []) {
    const risk = bad(d.type, ['unplanned']) ? 68 : 35;
    if (d.machine) link('machine', d.machine, 'downtime', d.eventNumber, 'downtime_on', { weight: d.durationHours ?? 0, riskSeed: risk, ts: d });
  }
  for (const p of input.proposals ?? []) {
    if (p.sourceDecisionId) link('decision', p.sourceDecisionId, 'proposal', p.proposalNumber, 'executes_decision', { confidence: 100, ts: p });
  }
  for (const d of input.decisions ?? []) {
    for (const ord of d.affectedOrders ?? []) if (ord) link('decision', d.decisionId, 'productionOrder', ord, 'decision_affects', { riskSeed: 40, ts: d });
    for (const mac of d.affectedMachines ?? []) if (mac) link('decision', d.decisionId, 'machine', mac, 'decision_affects', { riskSeed: 40, ts: d });
    for (const cus of d.affectedCustomers ?? []) if (cus) link('decision', d.decisionId, 'customer', cus, 'decision_affects', { riskSeed: 40, ts: d });
  }
  // Inventory ledger → product ↔ warehouse stock relationships (aggregated; movements are NOT node-ified).
  for (const mv of input.movements ?? []) {
    if (mv.product && mv.warehouse) link('product', mv.product, 'warehouse', mv.warehouse, 'stocked_in', { confidence: 90, weight: Math.abs(mv.quantity ?? 0), ts: mv, direction: 'bidirectional' });
  }

  /* score edges */
  const outEdges: RelationshipGraphEdge[] = [];
  for (const [id, e] of edges) {
    const activity = activityFromMs(e.lastMs, nowMs);
    const risk = clamp(e.riskSeed, 0, 100);
    const strength = edgeStrength(activity, risk);
    const toResolved = nodes.get(e.to)?.resolved ?? false;
    const fromResolved = nodes.get(e.from)?.resolved ?? false;
    const health = edgeHealth(fromResolved && toResolved, risk, activity, strength);
    outEdges.push({
      id, from: e.from, to: e.to, type: e.type, direction: e.direction,
      confidence: e.confidence, weight: Math.round(e.weight), count: e.count,
      strength, activity, risk, health,
      lastUpdated: e.lastMs > 0 ? new Date(e.lastMs).toISOString() : '',
    });
  }

  /* roll edges up into node metrics */
  const incident = new Map<string, RelationshipGraphEdge[]>();
  for (const e of outEdges) {
    const fn = nodes.get(e.from); if (fn) fn.outDegree += 1;
    const tn = nodes.get(e.to); if (tn) tn.inDegree += 1;
    (incident.get(e.from) ?? incident.set(e.from, []).get(e.from)!).push(e);
    (incident.get(e.to) ?? incident.set(e.to, []).get(e.to)!).push(e);
  }
  for (const n of nodes.values()) {
    const inc = incident.get(n.id) ?? [];
    n.degree = n.inDegree + n.outDegree;
    n.value = Math.round(inc.reduce((s, e) => s + e.weight, 0));
    n.activity = inc.length === 0 ? 0 : Math.max(...inc.map((e) => e.activity));
    n.risk = inc.length === 0 ? 0 : Math.max(...inc.map((e) => e.risk));
    const last = inc.map((e) => e.lastUpdated).filter((s) => s !== '').sort();
    if (last.length > 0 && (!n.lastUpdated || last[last.length - 1] > n.lastUpdated)) n.lastUpdated = last[last.length - 1];
    if (n.degree === 0) n.health = 'dormant';
    else if (inc.some((e) => e.health === 'critical')) n.health = 'critical';
    else if (inc.some((e) => e.health === 'broken')) n.health = 'broken';
    else {
      const avg = Math.round(inc.reduce((s, e) => s + e.strength, 0) / inc.length);
      n.health = inc.every((e) => e.activity <= 15) ? 'dormant' : avg >= 75 ? 'strong' : avg >= 50 ? 'healthy' : 'weak';
    }
  }

  const outNodes = [...nodes.values()];
  const insights = deriveRelationshipInsights(outNodes, outEdges);
  const kpis = relationshipInsightsToKpis(insights);

  const byKind: Record<string, number> = {};
  for (const n of outNodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byHealth: Record<string, number> = {};
  for (const e of outEdges) byHealth[e.health] = (byHealth[e.health] ?? 0) + 1;

  const criticalEdges = outEdges.filter((e) => e.health === 'critical').sort((a, b) => b.risk - a.risk).slice(0, 50);
  const highRiskEdges = outEdges.filter((e) => e.risk >= RELATIONSHIP_HIGH_RISK_THRESHOLD).sort((a, b) => b.risk - a.risk).slice(0, 100);
  const disconnected = outNodes.filter((n) => n.master && n.resolved && n.degree === 0).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  const topEntities = [...outNodes].filter((n) => n.resolved).sort((a, b) => b.degree - a.degree || b.value - a.value).slice(0, 25);
  const narrative = buildRelationshipNarrative(insights, outNodes, criticalEdges);

  return {
    generatedAtMs: nowMs,
    nodes: outNodes,
    edges: outEdges,
    insights,
    kpis,
    counts: { nodes: outNodes.length, edges: outEdges.length, byKind, byHealth },
    criticalEdges,
    highRiskEdges,
    disconnected,
    topEntities,
    narrative,
  };
}

/* ── insights + KPIs ───────────────────────────────────────────────────────────── */

/** Roll the derived graph into the deterministic relationship insights. Pure. */
export function deriveRelationshipInsights(nodes: RelationshipNode[], edges: RelationshipGraphEdge[]): RelationshipInsights {
  const totalEdges = edges.length;
  const count = (h: RelationshipHealth): number => edges.filter((e) => e.health === h).length;
  const strongCount = count('strong');
  const healthyCount = count('healthy');
  const weakCount = count('weak');
  const brokenCount = count('broken');
  const dormantCount = count('dormant');
  const criticalCount = count('critical');
  const relationshipHealth = totalEdges === 0 ? 100 : clamp(Math.round(((strongCount + healthyCount) / totalEdges) * 100), 0, 100);
  const highRiskDependencies = edges.filter((e) => e.risk >= RELATIONSHIP_HIGH_RISK_THRESHOLD).length;
  const disconnectedAssets = nodes.filter((n) => n.master && n.resolved && n.degree === 0).length;

  const concentration = (kind: RelationshipEntityKind, weighted: boolean): number => {
    const totals = new Map<string, number>();
    for (const n of nodes) {
      if (n.kind !== kind || !n.resolved) continue;
      totals.set(n.id, weighted ? Math.max(n.value, n.degree) : n.degree);
    }
    const values = [...totals.values()];
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0) return 0;
    return clamp(Math.round((Math.max(...values) / sum) * 100), 0, 100);
  };
  const supplierDependency = concentration('supplier', false);
  const customerDependency = concentration('customer', true);
  const machineDependency = concentration('machine', false);

  const connected = nodes.filter((n) => n.degree > 0).length;
  const knowledgeConnectivity = nodes.length === 0 ? 100 : clamp(Math.round((connected / nodes.length) * 100), 0, 100);
  const averageDegree = nodes.length === 0 ? 0 : Math.round((edges.length * 2 * 10) / nodes.length) / 10;

  return {
    totalNodes: nodes.length, totalEdges, relationshipHealth,
    strongCount, healthyCount, weakCount, brokenCount, dormantCount, criticalCount,
    disconnectedAssets, highRiskDependencies, supplierDependency, customerDependency, machineDependency,
    knowledgeConnectivity, averageDegree,
  };
}

/** Map relationship insights to the eight Executive Center KPI tiles. Pure. */
export function relationshipInsightsToKpis(insights: RelationshipInsights): ExecutiveKpi[] {
  const dl = 'enterprise/relationship';
  const pctBand = (v: number): ExecutiveKpi['band'] => (v >= 90 ? 'healthy' : v >= 75 ? 'watch' : 'at-risk');
  const countBand = (n: number): ExecutiveKpi['band'] => (n === 0 ? 'healthy' : n <= 3 ? 'watch' : 'at-risk');
  const concBand = (v: number): ExecutiveKpi['band'] => (v <= 40 ? 'healthy' : v <= 65 ? 'watch' : 'at-risk');
  return [
    { key: 'rel-health', label: 'Relationship Health', value: insights.relationshipHealth, display: `${insights.relationshipHealth}%`, band: pctBand(insights.relationshipHealth), deepLink: dl },
    { key: 'rel-critical', label: 'Critical Relationships', value: insights.criticalCount, display: `${insights.criticalCount}`, band: countBand(insights.criticalCount), deepLink: dl },
    { key: 'rel-disconnected', label: 'Disconnected Assets', value: insights.disconnectedAssets, display: `${insights.disconnectedAssets}`, band: countBand(insights.disconnectedAssets), deepLink: dl },
    { key: 'rel-high-risk', label: 'High-Risk Dependencies', value: insights.highRiskDependencies, display: `${insights.highRiskDependencies}`, band: countBand(insights.highRiskDependencies), deepLink: dl },
    { key: 'rel-supplier-dep', label: 'Supplier Dependency', value: insights.supplierDependency, display: `${insights.supplierDependency}%`, band: concBand(insights.supplierDependency), deepLink: dl },
    { key: 'rel-customer-dep', label: 'Customer Dependency', value: insights.customerDependency, display: `${insights.customerDependency}%`, band: concBand(insights.customerDependency), deepLink: dl },
    { key: 'rel-machine-dep', label: 'Machine Dependency', value: insights.machineDependency, display: `${insights.machineDependency}%`, band: concBand(insights.machineDependency), deepLink: dl },
    { key: 'rel-connectivity', label: 'Knowledge Connectivity', value: insights.knowledgeConnectivity, display: `${insights.knowledgeConnectivity}%`, band: pctBand(insights.knowledgeConnectivity), deepLink: dl },
  ];
}

/* ── narrative (explains the graph; invents nothing) ──────────────────────────────── */

function buildRelationshipNarrative(insights: RelationshipInsights, nodes: RelationshipNode[], criticalEdges: RelationshipGraphEdge[]): RelationshipNarrative {
  const summary =
    insights.totalNodes === 0
      ? 'No enterprise records are present yet, so there is no relationship graph to analyze.'
      : `${insights.totalNodes} entities are connected by ${insights.totalEdges} derived relationship(s) — ${insights.relationshipHealth}% healthy. ` +
        `${insights.strongCount} strong, ${insights.healthyCount} healthy, ${insights.weakCount} weak, ${insights.dormantCount} dormant, ${insights.brokenCount} broken, ${insights.criticalCount} critical.`;

  const riskExplanation =
    insights.criticalCount === 0 && insights.brokenCount === 0
      ? 'No critical or broken relationships — every derived link resolves to a real record and none is high-risk.'
      : `${insights.criticalCount} critical + ${insights.brokenCount} broken relationship(s). Broken links point at a referenced record that does not exist; critical links carry a high-risk state (overdue invoice, machine downtime, blocked execution, rejected receipt).`;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const label = (id: string): string => nodeById.get(id)?.label ?? id;
  const dependencyExplanation =
    `Concentration: the top supplier holds ${insights.supplierDependency}% of supplier links, the top customer ${insights.customerDependency}% of customer value, and the busiest machine ${insights.machineDependency}% of machine links. ` +
    `${insights.disconnectedAssets} master asset(s) are disconnected (no relationships), and ${insights.knowledgeConnectivity}% of all entities are connected.`;

  const businessImpact =
    insights.criticalCount > 0
      ? `The highest-impact exposures are ${criticalEdges.slice(0, 4).map((e) => `${label(e.from)} → ${label(e.to)} (risk ${e.risk})`).join(', ')}. A failure in any high-concentration dependency cascades to everything downstream of it.`
      : insights.highRiskDependencies > 0
        ? `${insights.highRiskDependencies} dependency(ies) sit above the high-risk threshold; watch them before they become critical.`
        : 'No relationship currently threatens downstream operations.';

  const recommendedActions: string[] = [];
  if (insights.brokenCount > 0) recommendedActions.push(`Repair ${insights.brokenCount} broken link(s): the referenced customer / product / machine / order record is missing.`);
  if (insights.criticalCount > 0) recommendedActions.push(`Resolve ${insights.criticalCount} critical relationship(s) — clear the overdue / down / blocked state driving the risk.`);
  if (insights.supplierDependency >= 65) recommendedActions.push(`Supplier concentration is ${insights.supplierDependency}% — qualify a second source to de-risk single-supplier dependency.`);
  if (insights.customerDependency >= 65) recommendedActions.push(`Customer concentration is ${insights.customerDependency}% — revenue is exposed to one account; diversify.`);
  if (insights.disconnectedAssets > 0) recommendedActions.push(`${insights.disconnectedAssets} disconnected asset(s) — connect or retire idle machines / products / customers.`);
  if (recommendedActions.length === 0) recommendedActions.push('The relationship graph is healthy and well-connected — no action required.');

  return { summary, riskExplanation, dependencyExplanation, businessImpact, recommendedActions, grounded: true };
}

/* ── read-only traversal (entity 360 · dependency tree · impact analysis) ─────────── */

export interface RelationshipNeighbor {
  edge: RelationshipGraphEdge;
  node: RelationshipNode;
  direction: 'out' | 'in';
}
export interface EntityNeighborhood {
  node: RelationshipNode;
  neighbors: RelationshipNeighbor[];
}

/** All edges + immediately-connected entities for one node (the entity-360 view). Pure. */
export function relationshipNeighbors(model: RelationshipGraphModel, nodeId: string): EntityNeighborhood | null {
  const node = model.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const neighbors: RelationshipNeighbor[] = [];
  for (const e of model.edges) {
    if (e.from === nodeId) {
      const n = byId.get(e.to);
      if (n) neighbors.push({ edge: e, node: n, direction: 'out' });
    } else if (e.to === nodeId) {
      const n = byId.get(e.from);
      if (n) neighbors.push({ edge: e, node: n, direction: 'in' });
    }
  }
  neighbors.sort((a, b) => b.edge.strength - a.edge.strength);
  return { node, neighbors };
}

export interface DependencyLevel { depth: number; nodes: RelationshipNode[]; }
export interface DependencyTree { root: RelationshipNode; levels: DependencyLevel[]; totalDependencies: number; }

/** Outward dependency tree (follows out-edges): what this entity's relationships fan out to. Pure. */
export function dependencyTree(model: RelationshipGraphModel, nodeId: string, maxDepth = 3): DependencyTree | null {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const root = byId.get(nodeId);
  if (!root) return null;
  const adj = new Map<string, string[]>();
  for (const e of model.edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const seen = new Set<string>([nodeId]);
  const levels: DependencyLevel[] = [];
  let frontier = [nodeId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) for (const to of adj.get(id) ?? []) if (!seen.has(to)) { seen.add(to); next.push(to); }
    if (next.length === 0) break;
    levels.push({ depth, nodes: next.map((id) => byId.get(id)!).filter(Boolean) });
    frontier = next;
  }
  return { root, levels, totalDependencies: seen.size - 1 };
}

export interface ImpactAnalysis {
  root: RelationshipNode;
  affected: RelationshipNode[];
  byKind: Record<string, number>;
  atRisk: number;
  reach: number;
}

/** Impact analysis: every entity reachable from this node (undirected), i.e. what a failure here touches. Pure. */
export function impactAnalysis(model: RelationshipGraphModel, nodeId: string, maxDepth = 3): ImpactAnalysis | null {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const root = byId.get(nodeId);
  if (!root) return null;
  const adj = new Map<string, string[]>();
  const push = (a: string, b: string): void => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); };
  for (const e of model.edges) { push(e.from, e.to); push(e.to, e.from); }
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
    frontier = next;
  }
  seen.delete(nodeId);
  const affected = [...seen].map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => b.risk - a.risk || b.degree - a.degree);
  const byKind: Record<string, number> = {};
  for (const n of affected) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const atRisk = affected.filter((n) => n.risk >= RELATIONSHIP_HIGH_RISK_THRESHOLD).length;
  return { root, affected, byKind, atRisk, reach: affected.length };
}

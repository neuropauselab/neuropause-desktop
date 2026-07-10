import { describe, expect, it } from 'vitest';
import {
  buildRelationshipGraph,
  deriveRelationshipInsights,
  relationshipInsightsToKpis,
  relationshipNeighbors,
  dependencyTree,
  impactAnalysis,
  type RelationshipGraphInput,
  type RelationshipGraphModel,
} from '@neuropause/shared';

const NOW = Date.parse('2026-07-08T00:00:00.000Z');
const RECENT = '2026-07-05T00:00:00.000Z'; // 3 days → activity 100
const STALE = '2026-01-01T00:00:00.000Z'; // >180 days → activity 10 → dormant

/** A deterministic cross-domain fixture that exercises every derivation + scoring path. */
function fixture(): RelationshipGraphInput {
  return {
    customers: [
      { id: 'c1', name: 'Acme', updatedAt: RECENT },
      { id: 'c2', name: 'Globex', updatedAt: RECENT },
      { id: 'c3', name: 'Lonely', updatedAt: RECENT }, // master, no edges → disconnected
    ],
    suppliers: [{ id: 's1', name: 'SupA', updatedAt: RECENT }],
    products: [
      { id: 'p1', sku: 'P1', updatedAt: RECENT },
      { id: 'p2', sku: 'RAW1', updatedAt: RECENT },
    ],
    warehouses: [{ id: 'w1', name: 'WH1', updatedAt: RECENT }],
    machines: [
      { id: 'm1', name: 'M1', status: 'running', workCenter: 'WC1', updatedAt: RECENT },
      { id: 'm2', name: 'M2', status: 'down', workCenter: 'WC1', updatedAt: RECENT }, // down → critical
    ],
    workCenters: [{ id: 'wc1', name: 'WC1', updatedAt: RECENT }],
    technicians: [{ id: 't1', name: 'Tech1', updatedAt: RECENT }],
    boms: [{ id: 'b1', bomNumber: 'BOM-1', product: 'P1', components: [{ sku: 'RAW1', quantity: 2 }], updatedAt: RECENT }],
    productionOrders: [{ id: 'mo1', orderNumber: 'MO-1', product: 'P1', bom: 'BOM-1', machine: 'M1', warehouse: 'WH1', status: 'running', updatedAt: RECENT }],
    schedules: [{ id: 'sc1', scheduleNumber: 'SCH-1', productionOrder: 'MO-1', machine: 'M1', workCenter: 'WC1', updatedAt: RECENT }],
    executions: [{ id: 'ex1', executionNumber: 'EX-1', productionOrder: 'MO-1', schedule: 'SCH-1', machine: 'M1', operator: 'Tech1', product: 'P1', status: 'blocked', updatedAt: RECENT }], // blocked → critical
    quality: [{ id: 'q1', inspectionNumber: 'QI-1', productionOrder: 'MO-1', inspector: 'Tech1', result: 'pass', updatedAt: RECENT }],
    orders: [
      { id: 'o1', orderNumber: 'SO-1', customer: 'Acme', product: 'P1', total: 1000, status: 'shipped', updatedAt: RECENT },
      { id: 'o2', orderNumber: 'SO-2', customer: 'Acme', total: 500, status: 'shipped', updatedAt: RECENT },
      { id: 'o3', orderNumber: 'SO-3', customer: 'Globex', total: 300, status: 'shipped', updatedAt: RECENT },
      { id: 'o4', orderNumber: 'SO-4', customer: 'Ghost', total: 200, status: 'shipped', updatedAt: RECENT }, // Ghost missing → broken
      { id: 'o5', orderNumber: 'SO-5', customer: 'Globex', total: 100, status: 'shipped', updatedAt: STALE }, // stale → dormant
    ],
    invoices: [
      { id: 'i1', number: 'INV-1', customer: 'Acme', sourceOrder: 'o1', amount: 1000, amountPaid: 1000, status: 'paid', updatedAt: RECENT }, // sourceOrder = order id
      { id: 'i2', number: 'INV-2', customer: 'Acme', amount: 800, amountPaid: 0, status: 'overdue', updatedAt: RECENT }, // overdue → critical
    ],
    payments: [{ id: 'pay1', paymentNumber: 'PAY-1', invoiceRef: 'i1', customer: 'Acme', amount: 1000, status: 'cleared', updatedAt: RECENT }], // invoiceRef = invoice id
    purchaseOrders: [{ id: 'po1', poNumber: 'PO-1', supplier: 'SupA', product: 'P1', total: 400, status: 'approved', updatedAt: RECENT }],
    goodsReceipts: [{ id: 'gr1', grNumber: 'GR-1', purchaseOrder: 'po1', supplier: 'SupA', status: 'received', updatedAt: RECENT }], // purchaseOrder = po id
    workOrders: [{ id: 'wo1', workOrderNumber: 'WO-1', machine: 'M2', technician: 'Tech1', type: 'corrective', status: 'open', updatedAt: RECENT }],
    downtime: [{ id: 'd1', eventNumber: 'DT-1', machine: 'M2', type: 'unplanned', durationHours: 4, status: 'open', updatedAt: RECENT }], // unplanned → high risk
    decisions: [{ id: 'dec1', decisionId: 'DEC-1', title: 'Recover', affectedOrders: ['MO-1'], affectedMachines: ['M2'], affectedCustomers: ['Acme'], status: 'pending', updatedAt: RECENT }],
    proposals: [{ id: 'prop1', proposalNumber: 'PROP-1', sourceDecisionId: 'DEC-1', targetModule: 'manufacturing-schedules', status: 'pending_confirmation', updatedAt: RECENT }],
    movements: [{ product: 'P1', warehouse: 'WH1', type: 'production_output', quantity: 10, updatedAt: RECENT }],
  };
}

function getEdge(model: RelationshipGraphModel, from: string, to: string, type: string) {
  return model.edges.find((e) => e.from === from && e.to === to && e.type === type);
}

describe('Relationship engine — derivation + graph integrity', () => {
  it('derives typed edges from real FK links and every edge endpoint is a real node (integrity)', () => {
    const model = buildRelationshipGraph(fixture(), NOW);
    const ids = new Set(model.nodes.map((n) => n.id));
    for (const e of model.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    expect(model.counts.nodes).toBe(model.nodes.length);
    expect(model.counts.edges).toBe(model.edges.length);
    // Core cross-domain edges exist.
    expect(getEdge(model, 'customer:Acme', 'order:SO-1', 'places_order')).toBeDefined();
    expect(getEdge(model, 'supplier:SupA', 'purchaseOrder:PO-1', 'supplies_po')).toBeDefined();
    expect(getEdge(model, 'product:P1', 'bom:BOM-1', 'has_bom')).toBeDefined();
    expect(getEdge(model, 'bom:BOM-1', 'product:RAW1', 'bom_component')).toBeDefined();
    expect(getEdge(model, 'machine:M2', 'downtime:DT-1', 'downtime_on')).toBeDefined();
    expect(getEdge(model, 'decision:DEC-1', 'proposal:PROP-1', 'executes_decision')).toBeDefined();
  });

  it('resolves id-based provenance links through the id alias (not falsely broken)', () => {
    const model = buildRelationshipGraph(fixture(), NOW);
    const oi = getEdge(model, 'order:SO-1', 'invoice:INV-1', 'order_to_invoice');
    const ip = getEdge(model, 'invoice:INV-1', 'payment:PAY-1', 'invoice_to_payment');
    const pg = getEdge(model, 'purchaseOrder:PO-1', 'goodsReceipt:GR-1', 'po_to_receipt');
    expect(oi).toBeDefined();
    expect(ip).toBeDefined();
    expect(pg).toBeDefined();
    // These provenance chains resolve — they are NOT broken.
    expect(oi!.health).not.toBe('broken');
    expect(ip!.health).not.toBe('broken');
    expect(pg!.health).not.toBe('broken');
  });
});

describe('Relationship engine — health + risk scoring (deterministic)', () => {
  it('scores strong / dormant / critical / broken from the underlying record state', () => {
    const model = buildRelationshipGraph(fixture(), NOW);
    // strong: recent, low-risk order.
    expect(getEdge(model, 'customer:Acme', 'order:SO-1', 'places_order')!.health).toBe('strong');
    // dormant: stale order (activity floor).
    expect(getEdge(model, 'customer:Globex', 'order:SO-5', 'places_order')!.health).toBe('dormant');
    // critical: overdue invoice, blocked execution, down machine.
    expect(getEdge(model, 'customer:Acme', 'invoice:INV-2', 'billed_invoice')!.health).toBe('critical');
    expect(getEdge(model, 'execution:EX-1', 'machine:M1', 'runs_on_machine')!.risk).toBeGreaterThanOrEqual(70);
    expect(getEdge(model, 'machine:M2', 'workCenter:WC1', 'machine_in_workcenter')!.health).toBe('critical');
    // broken: an order referencing a customer that does not exist.
    const ghost = model.nodes.find((n) => n.id === 'customer:Ghost');
    expect(ghost?.resolved).toBe(false);
    expect(getEdge(model, 'customer:Ghost', 'order:SO-4', 'places_order')!.health).toBe('broken');
  });
});

describe('Relationship engine — insights, disconnected assets, concentration, KPIs', () => {
  it('rolls the graph into the eight relationship KPIs + deterministic insights', () => {
    const model = buildRelationshipGraph(fixture(), NOW);
    const insights = deriveRelationshipInsights(model.nodes, model.edges);

    expect(insights.brokenCount).toBeGreaterThanOrEqual(1);
    expect(insights.dormantCount).toBeGreaterThanOrEqual(1);
    expect(insights.criticalCount).toBeGreaterThanOrEqual(1);
    expect(insights.highRiskDependencies).toBeGreaterThanOrEqual(3); // overdue invoice + blocked exec + down machine + unplanned downtime

    // Disconnected master asset: the lonely customer with no relationships.
    expect(insights.disconnectedAssets).toBeGreaterThanOrEqual(1);
    expect(model.disconnected.some((n) => n.label === 'Lonely')).toBe(true);

    // Concentration: one supplier holds 100% of supplier links; one customer dominates value.
    expect(insights.supplierDependency).toBe(100);
    expect(insights.customerDependency).toBeGreaterThan(60);
    expect(insights.machineDependency).toBeGreaterThanOrEqual(40);
    expect(insights.knowledgeConnectivity).toBeGreaterThan(50);

    const kpis = relationshipInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'rel-health', 'rel-critical', 'rel-disconnected', 'rel-high-risk',
      'rel-supplier-dep', 'rel-customer-dep', 'rel-machine-dep', 'rel-connectivity',
    ]);
    expect(model.kpis.map((k) => k.key)).toEqual(kpis.map((k) => k.key));
    expect(model.narrative.grounded).toBe(true);
    expect(model.narrative.recommendedActions.length).toBeGreaterThan(0);
  });

  it('is safe and grounded on an empty enterprise', () => {
    const model = buildRelationshipGraph({}, NOW);
    expect(model.counts.nodes).toBe(0);
    expect(model.counts.edges).toBe(0);
    expect(model.kpis).toHaveLength(8);
    expect(model.insights.relationshipHealth).toBe(100);
    expect(model.narrative.grounded).toBe(true);
  });
});

describe('Relationship engine — traversal (entity 360 · dependency tree · impact)', () => {
  it('returns the entity-360 neighbourhood, an outward dependency tree, and an impact set', () => {
    const model = buildRelationshipGraph(fixture(), NOW);

    const ego = relationshipNeighbors(model, 'customer:Acme');
    expect(ego).not.toBeNull();
    expect(ego!.neighbors.length).toBeGreaterThanOrEqual(4); // 2 orders + 2 invoices + payment (+ decision)
    // sorted strongest-first
    expect(ego!.neighbors[0].edge.strength).toBeGreaterThanOrEqual(ego!.neighbors[ego!.neighbors.length - 1].edge.strength);

    const dep = dependencyTree(model, 'customer:Acme', 3);
    expect(dep).not.toBeNull();
    expect(dep!.totalDependencies).toBeGreaterThanOrEqual(3);

    const impact = impactAnalysis(model, 'machine:M1', 3);
    expect(impact).not.toBeNull();
    expect(impact!.reach).toBeGreaterThan(0);
    expect(Object.keys(impact!.byKind).length).toBeGreaterThan(0);

    // Unknown node → null (no throw).
    expect(relationshipNeighbors(model, 'customer:DoesNotExist')).toBeNull();
    expect(dependencyTree(model, 'nope', 3)).toBeNull();
    expect(impactAnalysis(model, 'nope', 3)).toBeNull();
  });
});

describe('Relationship engine — scales deterministically with integrity held', () => {
  it('builds a larger graph and preserves node/edge integrity', () => {
    const input: RelationshipGraphInput = { customers: [], orders: [] };
    for (let i = 0; i < 20; i += 1) input.customers!.push({ id: `c${i}`, name: `Cust-${i}`, updatedAt: RECENT });
    for (let i = 0; i < 300; i += 1) input.orders!.push({ id: `o${i}`, orderNumber: `SO-${i}`, customer: `Cust-${i % 20}`, total: 100 + i, status: 'shipped', updatedAt: RECENT });
    const model = buildRelationshipGraph(input, NOW);
    expect(model.nodes.length).toBe(320); // 20 customers + 300 orders
    expect(model.edges.length).toBe(300); // one places_order edge per order
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(model.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    // No broken links (every customer resolves) and connectivity is complete.
    expect(model.insights.brokenCount).toBe(0);
    expect(model.insights.knowledgeConnectivity).toBe(100);
  });
});

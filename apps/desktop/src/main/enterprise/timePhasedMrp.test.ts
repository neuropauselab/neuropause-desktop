import { describe, expect, it } from 'vitest';
import {
  calculateLeadTimeDays,
  computeTimePhasedMrp,
  deriveTimePhasedInsights,
  timePhasedInsightsToKpis,
  timePhasedRecommendations,
  type BillOfMaterials,
  type BomComponent,
  type Machine,
  type PlanningInput,
  type Product,
  type SalesOrder,
  type Supplier,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse(T0);

function product(p: Partial<Product> = {}): Product {
  return { id: `p-${p.sku ?? 'X'}`, sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 100, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-08-01', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(product: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${product}`, bomNumber: `BOM-${product}`, product, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: 'mc1', name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
function tpInput(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-08-01' })],
    quotes: [],
    shipments: [],
    productionOrders: [],
    purchaseOrders: [],
    suppliers: [supplier({ leadTime: 10 })],
    boms: [bom('FG-1', [comp('RAW-1', 2)])],
    machines: [],
    invoices: [],
    ...over,
  };
}

describe('deterministic lead time', () => {
  it('purchased = supplier lead + transport + safety; produced = setup + qty/rate + queue + safety', () => {
    expect(calculateLeadTimeDays({ isManufactured: false, netRequirement: 20, supplierLeadDays: 10, capacityConstrained: false })).toBe(15); // 10 + 3 + 2
    expect(calculateLeadTimeDays({ isManufactured: true, netRequirement: 100, supplierLeadDays: 0, capacityConstrained: false })).toBe(5); // 1 + ceil(100/50) + 0 + 2
    expect(calculateLeadTimeDays({ isManufactured: true, netRequirement: 100, supplierLeadDays: 0, capacityConstrained: true })).toBe(7); // + queue 2
  });
});

describe('backward scheduling — required → release dates down the BOM', () => {
  it('release = required − lead time, and a component is required at its parent’s release date', () => {
    const plan = computeTimePhasedMrp(tpInput(), NOW);
    const fg = plan.lines.find((l) => l.sku === 'FG-1');
    const raw = plan.lines.find((l) => l.sku === 'RAW-1');
    // FG-1: produce lead = 1 + ceil(10/50) + 2 = 4 → release 2026-08-01 − 4 = 2026-07-28
    expect(fg).toMatchObject({ leadTimeDays: 4, requiredDate: '2026-08-01', releaseDate: '2026-07-28', completionDate: '2026-08-01', late: false });
    // RAW-1: required = FG-1 release; purchase lead = 10 + 3 + 2 = 15 → release 2026-07-28 − 15 = 2026-07-13
    expect(raw).toMatchObject({ leadTimeDays: 15, requiredDate: '2026-07-28', releaseDate: '2026-07-13', late: false });
    expect(fg?.slackDays).toBe(20); // 07-08 → 07-28
    expect(raw?.slackDays).toBe(5); // 07-08 → 07-13
  });

  it('detects a late release when the required date is too soon for the lead time', () => {
    const plan = computeTimePhasedMrp(tpInput({ salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-07-10' })] }), NOW);
    const fg = plan.lines.find((l) => l.sku === 'FG-1');
    // release = 2026-07-10 − 4 = 2026-07-06, before now 2026-07-08 → slack −2, late
    expect(fg).toMatchObject({ releaseDate: '2026-07-06', slackDays: -2, late: true });
  });

  it('builds planned orders sorted by release date (soonest first)', () => {
    const plan = computeTimePhasedMrp(tpInput(), NOW);
    expect(plan.plannedOrders.map((o) => o.sku)).toEqual(['RAW-1', 'FG-1']); // RAW release 07-13 before FG 07-28
    expect(plan.plannedOrders.find((o) => o.sku === 'RAW-1')).toMatchObject({ type: 'purchase', quantity: 20, supplier: 'Acme' });
    expect(plan.plannedOrders.find((o) => o.sku === 'FG-1')).toMatchObject({ type: 'production', quantity: 10 });
  });
});

describe('critical path', () => {
  it('is the longest cumulative lead-time chain', () => {
    const plan = computeTimePhasedMrp(tpInput(), NOW);
    expect(plan.criticalPath).toEqual(['FG-1', 'RAW-1']);
    expect(plan.criticalPathLeadDays).toBe(19); // 4 + 15
    expect(plan.lines.find((l) => l.sku === 'RAW-1')?.onCriticalPath).toBe(true);
  });

  it('is cycle-safe (a cyclic BOM still terminates)', () => {
    const cyclic = tpInput({
      products: [product({ sku: 'A' }), product({ sku: 'B' })],
      salesOrders: [order({ product: 'A', orderedQty: 5, expectedDeliveryDate: '2026-08-01' })],
      boms: [bom('A', [comp('B', 1)]), bom('B', [comp('A', 1)])],
    });
    const plan = computeTimePhasedMrp(cyclic, NOW); // must not hang
    expect(plan.cycles.length).toBeGreaterThanOrEqual(1);
    expect(plan.plannedOrders.length).toBeGreaterThan(0);
  });
});

describe('deriveTimePhasedInsights + KPIs', () => {
  it('rolls the schedule into the ten scheduling KPIs', () => {
    const insights = deriveTimePhasedInsights(tpInput(), NOW);
    expect(insights.lateOrderRisk).toBe(0); // all on time in the base scenario
    expect(insights.planningScheduleAccuracy).toBe(100);
    expect(timePhasedInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'tp-schedule-accuracy',
      'tp-late-risk',
      'tp-capacity-ready',
      'tp-supplier-ready',
      'tp-production-ready',
      'tp-material-ready',
      'tp-ontime-prob',
      'tp-confidence',
      'tp-efficiency',
      'tp-overall',
    ]);
  });
});

describe('time-phased recommendations (deterministic, date-backed)', () => {
  it('raises a late-delivery recommendation carrying the release date + slack', () => {
    const recs = timePhasedRecommendations(tpInput({ salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-07-10' })] }), NOW);
    const late = recs.find((r) => r.id === 'tp:late:FG-1');
    expect(late?.priority).toBe('critical'); // on the critical path
    expect(late?.recommendedAction).toMatch(/production order for 10 of FG-1 today/);
    expect(late?.evidence).toEqual(expect.arrayContaining(['release=2026-07-06', 'slack=-2d']));
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });

  it('raises a machine-bottleneck recommendation when capacity is constrained', () => {
    const recs = timePhasedRecommendations(tpInput({ machines: [machine({ name: 'CNC-1', runtime: 95, downtime: 5 })] }), NOW);
    expect(recs.some((r) => r.metric === 'capacity' && /bottleneck/i.test(r.problem))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assessDecisionEngine,
  decisionInsightsToKpis,
  type BillOfMaterials,
  type BomComponent,
  type Machine,
  type PlanningInput,
  type Product,
  type RecoveryPlan,
  type SalesOrder,
  type Supplier,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse(T0);

function product(p: Partial<Product> = {}): Product {
  return { id: `p-${p.sku ?? 'X'}`, sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 1000, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-08-01', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(productSku: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${productSku}`, bomNumber: `BOM-${productSku}`, product: productSku, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'SupplierCo', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: `mc-${p.name ?? 'M'}`, name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
function base(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, total: 1000, customer: 'Acme' })],
    quotes: [],
    shipments: [],
    productionOrders: [],
    purchaseOrders: [],
    suppliers: [supplier({ leadTime: 10 })],
    boms: [bom('FG-1', [comp('RAW-1', 2)])],
    machines: [machine({ name: 'CNC-1', status: 'running' })],
    invoices: [],
    ...over,
  };
}
/** Capacity-constrained variant — a huge order overloads the single machine (late in baseline). */
function tight(): PlanningInput {
  return base({ salesOrders: [order({ product: 'FG-1', orderedQty: 2500, total: 50000, customer: 'Acme' })] });
}
function planOf(plans: RecoveryPlan[], type: RecoveryPlan['decisionType']): RecoveryPlan | undefined {
  return plans.find((p) => p.decisionType === type);
}

describe('Decision Engine is READ-ONLY (never changes production)', () => {
  it('leaves the inputs byte-identical after building recovery plans', () => {
    const input = base();
    const before = JSON.stringify(input);
    assessDecisionEngine(input, [], NOW);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('recovery plans derive from Digital Twin predictions', () => {
  it('produces a PENDING machine-failure recovery plan with affected orders/customers/revenue', () => {
    const { plans } = assessDecisionEngine(base(), [], NOW);
    const plan = planOf(plans, 'machine_failure_recovery');
    expect(plan).toBeDefined();
    expect(plan!).toMatchObject({ status: 'pending', affectedRevenue: 1000, affectedMachines: ['CNC-1'], affectedCustomers: ['Acme'] });
    expect(plan!.recoverySteps.length).toBeGreaterThan(0);
    expect(plan!.expectedImprovementPct).toBeGreaterThan(0);
    expect(plan!.recoverySteps.every((s) => s.evidence.length > 0)).toBe(true);
  });

  it('recommends expediting the supplier for a supplier-delay recovery', () => {
    const plan = planOf(assessDecisionEngine(base(), [], NOW).plans, 'supplier_delay_recovery');
    expect(plan).toBeDefined();
    expect(plan!.recoverySteps[0].action).toBe('expedite_supplier');
    expect(plan!.tradeoffs.length).toBeGreaterThan(0);
  });

  it('raises an inventory-buffer recovery when stock cannot cover demand', () => {
    const plan = planOf(assessDecisionEngine(base(), [], NOW).plans, 'inventory_buffer_recovery');
    expect(plan).toBeDefined();
    expect(plan!.recoverySteps[0].action).toBe('increase_procurement');
    expect(plan!.evidence.some((e) => e.startsWith('inventoryBuffer='))).toBe(true);
  });

  it('raises late-order and demand-spike recovery when capacity is constrained', () => {
    const { plans } = assessDecisionEngine(tight(), [], NOW);
    expect(planOf(plans, 'late_order_recovery')).toBeDefined(); // huge order is late in the baseline
    expect(planOf(plans, 'demand_spike_recovery')).toBeDefined(); // more demand pushes it later
  });

  it('every plan is pending, evidence-backed, and ranked by score', () => {
    const { plans } = assessDecisionEngine(tight(), [], NOW);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((p) => p.status === 'pending' && p.evidence.length > 0 && p.confidence > 0)).toBe(true);
    const scores = plans.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // descending
    expect(plans.every((p) => p.expectedImprovementPct >= 0 && p.expectedImprovementPct <= 100 && p.estimatedRecoveryDays >= 0)).toBe(true);
  });
});

describe('executive decision scores + recommendations', () => {
  it('rolls up the six executive scores and reuses Twin resilience', () => {
    const twinlessInput = base();
    const { insights } = assessDecisionEngine(twinlessInput, [], NOW);
    expect(decisionInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'dec-recovery-readiness',
      'dec-operational-resilience',
      'dec-decision-confidence',
      'dec-business-continuity',
      'dec-production-stability',
      'dec-manufacturing-agility',
    ]);
    expect(insights.recoveryReadiness).toBeGreaterThanOrEqual(0);
    expect(insights.businessContinuity).toBeGreaterThanOrEqual(0);
  });

  it('surfaces recovery plans as PENDING, approval-gated executive recommendations', () => {
    const { recommendations } = assessDecisionEngine(base(), [], NOW);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
    expect(recommendations.every((r) => /human approval/.test(r.recommendedAction))).toBe(true);
    expect(recommendations.some((r) => /PENDING/.test(r.expectedOutcome))).toBe(true);
  });
});

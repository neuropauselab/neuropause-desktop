import { describe, expect, it } from 'vitest';
import {
  assessDigitalTwin,
  resilienceInsightsToKpis,
  runSimulation,
  type BillOfMaterials,
  type BomComponent,
  type Machine,
  type PlanningInput,
  type Product,
  type Routing,
  type RoutingOperation,
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
function op(p: Partial<RoutingOperation> = {}): RoutingOperation {
  return { sequence: 10, operation: 'Cutting', workCenter: 'WC-CUT', eligibleMachines: [], setupTime: 2, runTimePerUnit: 0.1, queueTime: 0, inspectionTime: 0, transferTime: 0, ...p };
}

function base(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, total: 1000, customer: 'Acme', expectedDeliveryDate: '2026-08-01' })],
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

describe('Digital Twin is READ-ONLY (never mutates production)', () => {
  it('leaves the inputs byte-identical after simulating', () => {
    const input = base();
    const routings: Routing[] = [];
    const beforeIn = JSON.stringify(input);
    const beforeR = JSON.stringify(routings);
    runSimulation(input, routings, { type: 'machine_failure' }, NOW);
    runSimulation(input, routings, { type: 'demand_increase', magnitude: 50 }, NOW);
    runSimulation(input, routings, { type: 'supplier_delay', magnitude: 14 }, NOW);
    expect(JSON.stringify(input)).toBe(beforeIn);
    expect(JSON.stringify(routings)).toBe(beforeR);
  });
});

describe('scenario predictions derive from baseline vs perturbed schedules', () => {
  it('machine failure removes capacity and slips the order (with revenue + customers)', () => {
    const r = runSimulation(base(), [], { type: 'machine_failure' }, NOW);
    expect(r.scenario).toMatchObject({ type: 'machine_failure', target: 'CNC-1' });
    expect(r.predictions.addedDowntimeHours).toBe(240); // one 240h machine lost
    expect(r.predictions.lateDeliveries).toBe(1);
    expect(r.predictions.maxOrderDelayDays).toBeGreaterThan(0);
    expect(r.analysis).toMatchObject({ affectedRevenue: 1000, affectedMachines: ['CNC-1'], affectedWorkCenters: ['WC-1'] });
    expect(r.analysis.affectedCustomers).toEqual(['Acme']);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.every((x) => x.evidence.length > 0 && x.confidence > 0)).toBe(true);
  });

  it('supplier delay raises material risk and recommends inventory action', () => {
    const r = runSimulation(base(), [], { type: 'supplier_delay', magnitude: 14 }, NOW);
    expect(r.scenario.target).toBe('SupplierCo');
    expect(r.predictions.materialRisk).toBe(100); // the purchase order goes late
    expect(r.recommendations.some((x) => x.id === 'twin:supplier_delay:inventory')).toBe(true);
  });

  it('material shortage increases net requirement (inventory impact)', () => {
    const input = base({ products: [product({ sku: 'FG-1', availableStock: 8, currentStock: 8 }), product({ sku: 'RAW-1', name: 'Raw' })] });
    const r = runSimulation(input, [], { type: 'material_shortage', target: 'FG-1', magnitude: 50 }, NOW);
    expect(r.predictions.inventoryImpactUnits).toBeGreaterThan(0);
  });

  it('demand increase and scrap increase both raise required output', () => {
    expect(runSimulation(base(), [], { type: 'demand_increase', magnitude: 50 }, NOW).predictions.inventoryImpactUnits).toBeGreaterThan(0);
    expect(runSimulation(base(), [], { type: 'scrap_increase', target: 'FG-1', magnitude: 10 }, NOW).predictions.inventoryImpactUnits).toBeGreaterThan(0);
  });

  it('extra shift adds capacity and never worsens the schedule', () => {
    const r = runSimulation(base(), [], { type: 'extra_shift' }, NOW);
    expect(r.predictions.lateDeliveries).toBe(0);
    expect(r.predictions.completionDelayDays).toBe(0);
    expect(r.predictions.machineUtilizationDelta).toBeLessThanOrEqual(0);
  });

  it('routing change is applied deterministically and leaves routings untouched', () => {
    const routings: Routing[] = [
      { id: 'r1', routingNumber: 'ROUTE-1', product: 'FG-1', status: 'active', notes: '', operations: [op({ sequence: 10, workCenter: 'WC-1', eligibleMachines: ['CNC-1'] })] },
    ];
    const before = JSON.stringify(routings);
    const r = runSimulation(base(), routings, { type: 'routing_change', target: 'FG-1', magnitude: 25 }, NOW);
    expect(r.scenario).toMatchObject({ type: 'routing_change', target: 'FG-1', magnitude: 25 });
    expect(JSON.stringify(routings)).toBe(before); // read-only
  });
});

describe('digital-twin resilience assessment + KPIs', () => {
  it('runs the stress battery once and rolls up the seven resilience KPIs', () => {
    const twin = assessDigitalTwin(base(), [], NOW);
    expect(twin.resilience.simulationRisk).toBe(100 - twin.resilience.manufacturingResilience);
    expect(twin.resilience.recoveryTimeDays).toBeGreaterThanOrEqual(0);
    expect(twin.resilience.capacityReserve).toBeGreaterThan(0); // baseline has idle capacity
    expect(resilienceInsightsToKpis(twin.resilience).map((k) => k.key)).toEqual([
      'dt-simulation-risk',
      'dt-manufacturing-resilience',
      'dt-capacity-reserve',
      'dt-delivery-confidence',
      'dt-schedule-robustness',
      'dt-inventory-buffer',
      'dt-recovery-time',
    ]);
  });

  it('surfaces the machine-failure stress as a what-if recommendation with evidence', () => {
    const twin = assessDigitalTwin(base(), [], NOW);
    expect(twin.recommendations.some((r) => r.id === 'twin:whatif:machine_failure')).toBe(true);
    expect(twin.recommendations.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });
});

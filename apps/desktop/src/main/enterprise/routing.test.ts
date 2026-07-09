import { describe, expect, it } from 'vitest';
import {
  computeRoutingOperationTiming,
  computeRoutingSchedule,
  deriveRoutingInsights,
  parseRoutingOperations,
  routingInsightsToKpis,
  routingRecommendations,
  scheduleProductionOrderRouting,
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
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 100, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-08-01', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(productSku: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${productSku}`, bomNumber: `BOM-${productSku}`, product: productSku, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: `mc-${p.name ?? 'M'}`, name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
function op(p: Partial<RoutingOperation> = {}): RoutingOperation {
  return { sequence: 10, operation: 'Cutting', workCenter: 'WC-CUT', eligibleMachines: [], setupTime: 2, runTimePerUnit: 0.1, queueTime: 0, inspectionTime: 0, transferTime: 0, ...p };
}
function routing(p: Partial<Routing> = {}): Routing {
  return { id: 'r-FG-1', routingNumber: 'ROUTE-FG-1', product: 'FG-1', operations: [], status: 'active', notes: '', ...p };
}

/** Base: FG-1 (qty 10) with a two-operation routing (Cut → Assemble) on two qualified machines. */
function capInput(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [product({ sku: 'FG-1' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-08-01' })],
    quotes: [],
    shipments: [],
    productionOrders: [],
    purchaseOrders: [],
    suppliers: [supplier({ leadTime: 10 })],
    boms: [bom('FG-1', [comp('RAW-1', 2)])],
    machines: [
      machine({ name: 'CNC-1', workCenter: 'WC-CUT', status: 'running' }),
      machine({ name: 'ASM-1', workCenter: 'WC-ASM', status: 'running' }),
    ],
    invoices: [],
    ...over,
  };
}
const FG1_ROUTING = routing({
  operations: [
    op({ sequence: 10, operation: 'Cutting', workCenter: 'WC-CUT', eligibleMachines: ['CNC-1'], setupTime: 2, runTimePerUnit: 0.1, transferTime: 1 }),
    op({ sequence: 20, operation: 'Assembly', workCenter: 'WC-ASM', eligibleMachines: ['ASM-1'], setupTime: 1, runTimePerUnit: 0.2, inspectionTime: 1, transferTime: 0 }),
  ],
});

describe('parseRoutingOperations — tolerant, sorted, capability-bearing', () => {
  it('drops rows without an operation or work center, sorts by sequence, parses eligible machines', () => {
    const parsed = parseRoutingOperations(
      '[{"sequence":20,"operation":"Assembly","workCenter":"WC-ASM"},{"sequence":10,"operation":"Cutting","workCenter":"WC-CUT","eligibleMachines":["CNC-1","CNC-2"]},{"operation":"","workCenter":"WC-X"},{"operation":"Paint","workCenter":""}]',
    );
    expect(parsed.map((o) => o.operation)).toEqual(['Cutting', 'Assembly']); // sorted by sequence, invalids dropped
    expect(parsed[0].eligibleMachines).toEqual(['CNC-1', 'CNC-2']);
    expect(parseRoutingOperations('[{"operation":"Cut","workCenter":"WC","eligibleMachines":"M1, M2"}]')[0].eligibleMachines).toEqual(['M1', 'M2']);
    expect(parseRoutingOperations('not json')).toEqual([]);
  });
});

describe('computeRoutingOperationTiming — deterministic op timing', () => {
  it('starts at max(machine-free, ready); machine-busy wait is queue', () => {
    expect(computeRoutingOperationTiming({ workHours: 3, needFromHour: 160, machineFreeHour: 0, maintenanceStartHour: null })).toMatchObject({ startHour: 160, finishHour: 163, machineWaitHours: 0 });
    expect(computeRoutingOperationTiming({ workHours: 4, needFromHour: 0, machineFreeHour: 20, maintenanceStartHour: null })).toMatchObject({ startHour: 20, machineWaitHours: 20, finishHour: 24 });
  });
  it('pushes past an overlapping maintenance window', () => {
    expect(computeRoutingOperationTiming({ workHours: 3, needFromHour: 0, machineFreeHour: 0, maintenanceStartHour: 2 })).toMatchObject({ maintenanceConflict: true, startHour: 10, finishHour: 13 });
  });
});

describe('computeRoutingSchedule — operation-level routing onto qualified machines', () => {
  it('routes each operation to its qualified machine and chains completion → next start', () => {
    const schedule = computeRoutingSchedule(capInput(), [FG1_ROUTING], NOW);
    expect(schedule.schedules).toHaveLength(1);
    const plan = schedule.schedules[0];
    expect(plan).toMatchObject({ product: 'FG-1', routingNumber: 'ROUTE-FG-1', status: 'planned', onCriticalPath: true, late: false });
    const [cut, asm] = plan.operations;
    // Op 10 Cutting on CNC-1: release hour 160 (2026-07-28); work = setup2 + run⌈10×0.1⌉=1 = 3h.
    expect(cut).toMatchObject({ operation: 'Cutting', workCenter: 'WC-CUT', machine: 'CNC-1', runHours: 1, setupHours: 2, durationHours: 3, startHour: 160, finishHour: 163, startDate: '2026-07-28', finishDate: '2026-07-29', scheduled: true });
    // Op 20 Assembly on ASM-1: earliest start = cut finish 163 + transfer 1 = 164; work = 1 + ⌈10×0.2⌉=2 + insp 1 = 4h.
    expect(asm).toMatchObject({ operation: 'Assembly', workCenter: 'WC-ASM', machine: 'ASM-1', runHours: 2, inspectionHours: 1, durationHours: 4, startHour: 164, finishHour: 168, scheduled: true });
    expect(asm.startHour).toBe(cut.finishHour + 1); // operation dependency + transfer time
    expect(plan.plannedFinish).toBe('2026-07-29');
  });

  it('blocks an operation with no qualified machine in its work center (capability mismatch)', () => {
    // Only an ASM machine exists; the WC-CUT cutting op has no qualified machine.
    const schedule = computeRoutingSchedule(
      capInput({ machines: [machine({ name: 'ASM-1', workCenter: 'WC-ASM', status: 'running' })] }),
      [FG1_ROUTING],
      NOW,
    );
    const cut = schedule.schedules[0].operations.find((o) => o.operation === 'Cutting')!;
    expect(cut).toMatchObject({ scheduled: false, qualifiedMachineCount: 0, machine: '' });
    expect(cut.blockedReason).toMatch(/No machine in WC-CUT is qualified/);
    expect(schedule.schedules[0].status).toBe('blocked');
    expect(routingRecommendations(schedule).some((r) => r.id === 'rt:capability:FG-1:10')).toBe(true);
  });

  it('blocks an operation whose only qualified machine is unavailable (maintenance)', () => {
    const schedule = computeRoutingSchedule(
      capInput({
        machines: [
          machine({ name: 'CNC-1', workCenter: 'WC-CUT', status: 'maintenance' }),
          machine({ name: 'ASM-1', workCenter: 'WC-ASM', status: 'running' }),
        ],
      }),
      [FG1_ROUTING],
      NOW,
    );
    const cut = schedule.schedules[0].operations.find((o) => o.operation === 'Cutting')!;
    expect(cut).toMatchObject({ scheduled: false, qualifiedMachineCount: 1, eligibleMachineCount: 0 });
    expect(cut.blockedReason).toMatch(/unavailable/);
    expect(routingRecommendations(schedule).some((r) => r.id === 'rt:maint:FG-1:10')).toBe(true);
  });

  it('marks an order with no routing as unrouted and raises a routing-conflict recommendation', () => {
    const schedule = computeRoutingSchedule(capInput(), [], NOW);
    expect(schedule.schedules[0].status).toBe('unrouted');
    expect(schedule.schedules[0].operations).toHaveLength(0);
    expect(routingRecommendations(schedule).some((r) => r.id === 'rt:routing:FG-1')).toBe(true);
  });
});

describe('scheduleProductionOrderRouting — the single-order primitive the Commit action reuses', () => {
  it('schedules one order fresh from now when no release date is given', () => {
    const plan = scheduleProductionOrderRouting({ ref: 'MO-1', product: 'FG-1', quantity: 10, releaseDate: '', requiredDate: '', onCriticalPath: false }, FG1_ROUTING, capInput().machines, NOW);
    expect(plan.operations.map((o) => o.machine)).toEqual(['CNC-1', 'ASM-1']);
    // Op 10 starts now (hour 0), work 3h; Op 20 starts at 3 + transfer 1 = 4, work 4h → finish 8.
    expect(plan.operations[0]).toMatchObject({ startHour: 0, finishHour: 3 });
    expect(plan.operations[1]).toMatchObject({ startHour: 4, finishHour: 8 });
    expect(plan.status).toBe('planned');
  });
});

describe('deriveRoutingInsights + KPIs', () => {
  it('rolls the routing schedule into the ten routing KPIs', () => {
    const insights = deriveRoutingInsights(computeRoutingSchedule(capInput(), [FG1_ROUTING], NOW));
    expect(insights).toMatchObject({
      routingReadiness: 100,
      machineQualification: 100,
      operationReadiness: 100,
      scheduleStability: 100,
      productionConfidence: 100,
      manufacturingReadiness: 100,
      scheduleCompletion: 100,
      criticalOperationRisk: 0,
      overallApsScore: 100,
    });
    expect(routingInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'rt-routing-readiness',
      'rt-machine-qual',
      'rt-operation-readiness',
      'rt-schedule-stability',
      'rt-capacity-util',
      'rt-production-confidence',
      'rt-mfg-readiness',
      'rt-schedule-completion',
      'rt-critical-risk',
      'rt-overall',
    ]);
  });

  it('drops operation readiness and confidence when an operation is unschedulable', () => {
    const insights = deriveRoutingInsights(
      computeRoutingSchedule(capInput({ machines: [machine({ name: 'ASM-1', workCenter: 'WC-ASM', status: 'running' })] }), [FG1_ROUTING], NOW),
    );
    expect(insights.operationReadiness).toBe(50); // 1 of 2 operations scheduled
    expect(insights.manufacturingReadiness).toBe(0); // the order is blocked
    expect(insights.machineQualification).toBe(50); // cutting has no qualified machine
  });
});

describe('routing recommendations — deterministic + evidence-backed', () => {
  it('every recommendation carries evidence and a positive confidence', () => {
    const recs = routingRecommendations(
      computeRoutingSchedule(capInput({ machines: [machine({ name: 'ASM-1', workCenter: 'WC-ASM', status: 'running' })] }), [FG1_ROUTING], NOW),
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });
});

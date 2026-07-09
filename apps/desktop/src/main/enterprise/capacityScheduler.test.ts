import { describe, expect, it } from 'vitest';
import {
  capacityInsightsToKpis,
  capacityRecommendations,
  computeCapacitySchedule,
  computeOperationTiming,
  deriveCapacityInsights,
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
function bom(productSku: string, components: BomComponent[]): BillOfMaterials {
  return { id: `b-${productSku}`, bomNumber: `BOM-${productSku}`, product: productSku, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '' };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: `mc-${p.name ?? 'CNC-1'}`, name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}

/** Base single-FG scenario: FG-1 (qty 10) with one RAW-1 component, one running machine. */
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
    machines: [machine({ name: 'CNC-1' })],
    invoices: [],
    ...over,
  };
}

describe('computeOperationTiming — deterministic setup/run/changeover/queue/maintenance', () => {
  it('duration = setup(2) + run(⌈qty/10⌉) with no changeover', () => {
    const t = computeOperationTiming({ quantity: 100, releaseHour: 0, machineFreeHour: 0, changeover: false, maintenanceStartHour: null });
    expect(t).toMatchObject({ setupHours: 2, changeoverHours: 0, runHours: 10, durationHours: 12, startHour: 0, finishHour: 12, queueHours: 0, maintenanceConflict: false });
  });

  it('adds a changeover hour when the machine switches SKU', () => {
    const t = computeOperationTiming({ quantity: 100, releaseHour: 0, machineFreeHour: 0, changeover: true, maintenanceStartHour: null });
    expect(t).toMatchObject({ changeoverHours: 1, durationHours: 13, finishHour: 13 });
  });

  it('queues behind a busy machine (machine free after release)', () => {
    const t = computeOperationTiming({ quantity: 100, releaseHour: 0, machineFreeHour: 20, changeover: false, maintenanceStartHour: null });
    expect(t).toMatchObject({ startHour: 20, queueHours: 20, finishHour: 32 });
  });

  it('does not queue when the machine waits for material (release after free)', () => {
    const t = computeOperationTiming({ quantity: 100, releaseHour: 16, machineFreeHour: 0, changeover: false, maintenanceStartHour: null });
    expect(t).toMatchObject({ startHour: 16, queueHours: 0, finishHour: 28 });
  });

  it('pushes the operation past an overlapping maintenance window', () => {
    const t = computeOperationTiming({ quantity: 100, releaseHour: 0, machineFreeHour: 0, changeover: false, maintenanceStartHour: 4 });
    // op [0,12) overlaps window [4,12) → run after the window at hour 12, finish 12+12=24
    expect(t).toMatchObject({ maintenanceConflict: true, startHour: 12, finishHour: 24 });
  });

  it('ignores a maintenance window it does not overlap; run time is at least 1h', () => {
    const t = computeOperationTiming({ quantity: 0, releaseHour: 0, machineFreeHour: 0, changeover: false, maintenanceStartHour: 100 });
    expect(t).toMatchObject({ maintenanceConflict: false, runHours: 1, durationHours: 3, finishHour: 3 });
  });
});

describe('computeCapacitySchedule — loads the time-phased production plan onto real machines', () => {
  it('schedules the production planned order (not the purchase one) onto the running machine', () => {
    const schedule = computeCapacitySchedule(capInput(), NOW);
    // Only FG-1 (production) is loaded; RAW-1 is a purchase order, never a machine operation.
    expect(schedule.operations.map((o) => o.sku)).toEqual(['FG-1']);
    const op = schedule.operations[0];
    // FG-1 releases 2026-07-28 (op hour 160); qty 10 → run 1h, setup 2h, duration 3h.
    expect(op).toMatchObject({
      machine: 'CNC-1',
      workCenter: 'WC-1',
      setupHours: 2,
      runHours: 1,
      changeoverHours: 0,
      durationHours: 3,
      queueHours: 0,
      startDate: '2026-07-28',
      finishDate: '2026-07-29',
      late: false,
      onCriticalPath: true,
      maintenanceConflict: false,
    });
    expect(schedule.unscheduled).toEqual([]);
    const load = schedule.machineLoads.find((l) => l.machine === 'CNC-1');
    expect(load).toMatchObject({ available: true, assignedOperations: 1, loadHours: 3, capacityHours: 240, utilization: 1, idleHours: 237, overloaded: false, bottleneck: false });
  });

  it('uses only machines in a working state; a down machine leaves work unscheduled', () => {
    const schedule = computeCapacitySchedule(capInput({ machines: [machine({ name: 'DOWN-1', status: 'down' })] }), NOW);
    expect(schedule.operations).toHaveLength(0);
    expect(schedule.unscheduled.map((o) => o.sku)).toEqual(['FG-1']);
    expect(schedule.machineLoads[0]).toMatchObject({ available: false, capacityHours: 0, assignedOperations: 0 });
  });

  it('skips a maintenance machine and picks the available one', () => {
    const schedule = computeCapacitySchedule(
      capInput({ machines: [machine({ name: 'CNC-A', status: 'running' }), machine({ name: 'CNC-B', status: 'maintenance' })] }),
      NOW,
    );
    expect(schedule.operations.map((o) => o.machine)).toEqual(['CNC-A']);
    expect(schedule.machineLoads.find((l) => l.machine === 'CNC-B')).toMatchObject({ available: false, assignedOperations: 0 });
  });

  it('routes production around a machine maintenance window (Maintenance is the downtime authority)', () => {
    // Due today → release now (late order); maintenance window [0,8) collides and pushes the op.
    const schedule = computeCapacitySchedule(
      capInput({
        salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-07-10' })],
        machines: [machine({ name: 'CNC-1', maintenanceDue: '2026-07-08' })],
      }),
      NOW,
    );
    const op = schedule.operations[0];
    expect(op.maintenanceConflict).toBe(true);
    expect(op.startDate).toBe('2026-07-09'); // pushed to after the window (op hour 8 → day 1)
    expect(schedule.machineLoads[0].maintenanceWindow).toBe('2026-07-08');
  });
});

describe('bottleneck + overload detection', () => {
  it('flags an overloaded machine and recommends a second shift when nothing else is free', () => {
    // qty 2500 → run 250h + setup 2h = 252h load on one machine vs 240h capacity.
    const input = capInput({ salesOrders: [order({ product: 'FG-1', orderedQty: 2500, expectedDeliveryDate: '2026-08-01' })] });
    const schedule = computeCapacitySchedule(input, NOW);
    const load = schedule.machineLoads.find((l) => l.machine === 'CNC-1');
    expect(load).toMatchObject({ loadHours: 252, capacityHours: 240, overloaded: true, bottleneck: true, utilization: 100 });

    const recs = capacityRecommendations(schedule);
    const overload = recs.find((r) => r.id === 'cap:overload:CNC-1');
    expect(overload?.priority).toBe('critical'); // +12h over ≥ one shift
    expect(overload?.evidence).toEqual(expect.arrayContaining(['load=252h', 'capacity=240h', 'over=+12h']));
    expect(recs.some((r) => r.id === 'cap:second-shift:CNC-1')).toBe(true);
    expect(recs.some((r) => r.id.startsWith('cap:move:'))).toBe(false); // no idle machine to move to
  });

  it('recommends moving + splitting work when a second machine is idle', () => {
    const input = capInput({
      salesOrders: [order({ product: 'FG-1', orderedQty: 2500, expectedDeliveryDate: '2026-08-01' })],
      machines: [machine({ name: 'CNC-1' }), machine({ name: 'CNC-2' })],
    });
    const schedule = computeCapacitySchedule(input, NOW);
    // The whole job lands on one machine (tiebreak by name); the other stays idle.
    expect(schedule.machineLoads.find((l) => l.machine === 'CNC-2')).toMatchObject({ assignedOperations: 0, idleHours: 240 });
    const recs = capacityRecommendations(schedule);
    expect(recs.some((r) => r.id === 'cap:overload:CNC-1')).toBe(true);
    expect(recs.some((r) => r.id === 'cap:move:CNC-1->CNC-2')).toBe(true);
    expect(recs.some((r) => r.id.startsWith('cap:split:'))).toBe(true); // duration > one machine's capacity
  });
});

describe('deriveCapacityInsights + KPIs', () => {
  it('rolls the schedule into the ten capacity KPIs', () => {
    const insights = deriveCapacityInsights(computeCapacitySchedule(capInput(), NOW));
    expect(insights).toMatchObject({
      machineUtilization: 1,
      capacityUsage: 1,
      idleCapacity: 99,
      productionQueue: 0,
      maintenanceImpact: 0,
      lateProductionRisk: 0,
      scheduleAccuracy: 100,
      workCenterHealth: 100,
      manufacturingReadiness: 100,
      overallCapacityScore: 100,
    });
    expect(capacityInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'cap-machine-util',
      'cap-capacity-usage',
      'cap-idle',
      'cap-queue',
      'cap-maint-impact',
      'cap-late-risk',
      'cap-schedule-accuracy',
      'cap-workcenter-health',
      'cap-mfg-ready',
      'cap-overall',
    ]);
  });

  it('reports zero manufacturing readiness and full late risk when no machine can build the plan', () => {
    const insights = deriveCapacityInsights(
      computeCapacitySchedule(capInput({ machines: [machine({ name: 'DOWN-1', status: 'down' })] }), NOW),
    );
    expect(insights).toMatchObject({ manufacturingReadiness: 0, lateProductionRisk: 100, scheduleAccuracy: 0, workCenterHealth: 0 });
  });

  it('counts maintenance impact when a running machine has a due window in the horizon', () => {
    const insights = deriveCapacityInsights(
      computeCapacitySchedule(capInput({ machines: [machine({ name: 'CNC-1', maintenanceDue: '2026-07-12' })] }), NOW),
    );
    expect(insights.maintenanceImpact).toBeGreaterThan(0);
  });
});

describe('capacity recommendations (deterministic, evidence-backed)', () => {
  it('every recommendation carries evidence and a positive confidence', () => {
    const recs = capacityRecommendations(
      computeCapacitySchedule(capInput({ salesOrders: [order({ product: 'FG-1', orderedQty: 2500, expectedDeliveryDate: '2026-08-01' })] }), NOW),
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });

  it('surfaces available capacity when work is late but a machine sits idle', () => {
    // Due today → the FG finishes late; a second machine stays idle → capacity-available.
    const schedule = computeCapacitySchedule(
      capInput({
        salesOrders: [order({ product: 'FG-1', orderedQty: 10, expectedDeliveryDate: '2026-07-08' })],
        machines: [machine({ name: 'CNC-1' }), machine({ name: 'CNC-2' })],
      }),
      NOW,
    );
    expect(schedule.operations[0].late).toBe(true);
    const recs = capacityRecommendations(schedule);
    expect(recs.some((r) => r.id.startsWith('cap:available:'))).toBe(true);
  });

  it('recommends resequencing a machine queue and counts queued operations', () => {
    // Three FGs, all releasing at the same hour onto one machine → jobs 2 and 3 queue.
    const skus = ['FG-A', 'FG-B', 'FG-C'];
    const input: PlanningInput = {
      products: [
        ...skus.map((s) => product({ sku: s, name: s })),
        ...skus.map((s) => product({ sku: `R-${s}`, name: `R-${s}` })),
      ],
      salesOrders: skus.map((s) =>
        order({ id: `o-${s}`, orderNumber: `SO-${s}`, product: s, orderedQty: 10, expectedDeliveryDate: '2026-07-20', createdAt: T0, updatedAt: T0 }),
      ),
      quotes: [],
      shipments: [],
      productionOrders: [],
      purchaseOrders: [],
      suppliers: [supplier({ leadTime: 10 })],
      boms: skus.map((s) => bom(s, [comp(`R-${s}`, 1)])),
      machines: [machine({ name: 'CNC-1' })],
      invoices: [],
    };
    const schedule = computeCapacitySchedule(input, NOW);
    expect(schedule.operations).toHaveLength(3);
    expect(schedule.operations[0].onCriticalPath).toBe(true); // critical-path job dispatched first
    expect(deriveCapacityInsights(schedule).productionQueue).toBe(2);
    expect(capacityRecommendations(schedule).some((r) => r.id === 'cap:queue:CNC-1')).toBe(true);
  });
});

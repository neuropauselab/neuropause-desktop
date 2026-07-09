import { describe, expect, it } from 'vitest';
import {
  buildBomMap,
  computeBomLowLevelCodes,
  criticalMaterialAlerts,
  deriveMrpInsights,
  materialShortages,
  missingComponents,
  mrpInsightsToKpis,
  mrpRecommendations,
  productionSequence,
  runMultiLevelMrp,
  selectSupplier,
  type BillOfMaterials,
  type BomComponent,
  type Machine,
  type PlanningInput,
  type Product,
  type SalesOrder,
  type Supplier,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';

function product(p: Partial<Product> = {}): Product {
  return { id: `p-${p.sku ?? 'X'}`, sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 100, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function comp(sku: string, quantity: number): BomComponent {
  return { sku, quantity, waste: 0, alternative: '' };
}
function bom(product: string, components: BomComponent[], over: Partial<BillOfMaterials> = {}): BillOfMaterials {
  return { id: `b-${product}`, bomNumber: `BOM-${product}`, product, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components, status: 'active', notes: '', ...over };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 20, vendorRating: 4, status: 'active', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: 'mc1', name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 50, downtime: 50, maintenanceDue: '', status: 'running', ...p };
}
function mrpInput(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [],
    salesOrders: [],
    quotes: [],
    shipments: [],
    productionOrders: [],
    purchaseOrders: [],
    suppliers: [],
    boms: [],
    machines: [],
    invoices: [],
    ...over,
  };
}

/* ── BOM explosion: low-level codes, nesting, shared, cycles ── */

describe('BOM explosion — low-level codes, nesting, shared components, cycles', () => {
  it('assigns low-level codes by deepest occurrence (nested subassemblies)', () => {
    const { levels, cycles } = computeBomLowLevelCodes([bom('FG', [comp('SUB', 2)]), bom('SUB', [comp('RAW', 3)])]);
    expect(levels.get('FG')).toBe(0);
    expect(levels.get('SUB')).toBe(1);
    expect(levels.get('RAW')).toBe(2);
    expect(cycles).toEqual([]);
  });
  it('a shared component takes its deepest level across parents', () => {
    // C is a direct component of FG1 (level 1) and a sub-component under SUB of FG2 (level 2).
    const { levels } = computeBomLowLevelCodes([bom('FG1', [comp('C', 1)]), bom('FG2', [comp('SUB', 1)]), bom('SUB', [comp('C', 1)])]);
    expect(levels.get('C')).toBe(2);
  });
  it('detects a BOM cycle and terminates (drops the back-edge)', () => {
    const { cycles } = computeBomLowLevelCodes([bom('A', [comp('B', 1)]), bom('B', [comp('A', 1)])]);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0]).toContain('A');
    expect(cycles[0]).toContain('B');
  });
  it('buildBomMap resolves one active BOM per manufactured product', () => {
    const map = buildBomMap([bom('FG', [comp('RAW', 1)]), bom('RAW', [], { status: 'active' })]);
    expect(map.has('FG')).toBe(true);
    expect(map.has('RAW')).toBe(false); // empty components → not manufactured
  });
});

/* ── multi-level netting ── */

describe('Multi-level MRP netting', () => {
  const input = mrpInput({
    products: [product({ sku: 'FG-1', name: 'Finished' }), product({ sku: 'SUB-1', name: 'Subassembly' }), product({ sku: 'RAW-1', name: 'Raw' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10 })],
    boms: [bom('FG-1', [comp('SUB-1', 2)]), bom('SUB-1', [comp('RAW-1', 3)])],
  });

  it('explodes net requirements top-down: FG → subassembly → raw material', () => {
    const result = runMultiLevelMrp(input);
    const fg = result.lines.find((l) => l.sku === 'FG-1');
    const sub = result.lines.find((l) => l.sku === 'SUB-1');
    const raw = result.lines.find((l) => l.sku === 'RAW-1');
    expect(fg).toMatchObject({ level: 0, netRequirement: 10, isManufactured: true, recommendation: 'produce', independentDemand: 10, dependentDemand: 0 });
    expect(sub).toMatchObject({ level: 1, dependentDemand: 20, netRequirement: 20, isManufactured: true, recommendation: 'produce' }); // 2 × 10
    expect(raw).toMatchObject({ level: 2, dependentDemand: 60, netRequirement: 60, isManufactured: false, recommendation: 'purchase', critical: true }); // 3 × 20
  });

  it('on-hand and incoming reduce the net that gets exploded', () => {
    const withStock = mrpInput({
      products: [product({ sku: 'FG-1', availableStock: 4 }), product({ sku: 'SUB-1' }), product({ sku: 'RAW-1' })],
      salesOrders: [order({ product: 'FG-1', orderedQty: 10 })],
      boms: [bom('FG-1', [comp('SUB-1', 2)]), bom('SUB-1', [comp('RAW-1', 3)])],
    });
    const result = runMultiLevelMrp(withStock);
    expect(result.lines.find((l) => l.sku === 'FG-1')?.netRequirement).toBe(6); // 10 − 4
    expect(result.lines.find((l) => l.sku === 'SUB-1')?.dependentDemand).toBe(12); // 2 × 6
  });

  it('shared component demand accumulates across every parent', () => {
    const shared = mrpInput({
      products: [product({ sku: 'FG-1' }), product({ sku: 'FG-2' }), product({ sku: 'C' })],
      salesOrders: [order({ id: 'o1', product: 'FG-1', orderedQty: 10 }), order({ id: 'o2', orderNumber: 'SO-2', product: 'FG-2', orderedQty: 5 })],
      boms: [bom('FG-1', [comp('C', 2)]), bom('FG-2', [comp('C', 3)])],
    });
    const c = runMultiLevelMrp(shared).lines.find((l) => l.sku === 'C');
    expect(c).toMatchObject({ dependentDemand: 35, netRequirement: 35, recommendation: 'purchase' }); // 2×10 + 3×5
  });

  it('a cyclic BOM terminates and surfaces the cycle', () => {
    const cyclic = mrpInput({
      products: [product({ sku: 'A' }), product({ sku: 'B' })],
      salesOrders: [order({ product: 'A', orderedQty: 5 })],
      boms: [bom('A', [comp('B', 1)]), bom('B', [comp('A', 1)])],
    });
    const result = runMultiLevelMrp(cyclic); // must not hang
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    expect(materialShortages(result).length).toBeGreaterThan(0);
  });
});

/* ── alerts, supplier selection, recommendations, KPIs ── */

describe('Critical alerts, supplier selection, and recommendations', () => {
  const input = mrpInput({
    products: [product({ sku: 'FG-1' }), product({ sku: 'SUB-1' }), product({ sku: 'RAW-1' })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 10 })],
    boms: [bom('FG-1', [comp('SUB-1', 2)]), bom('SUB-1', [comp('RAW-1', 3)])],
    suppliers: [supplier({ name: 'Best', vendorRating: 5, leadTime: 10 }), supplier({ id: 's2', name: 'Slow', vendorRating: 3, leadTime: 40 })],
    machines: [machine({ name: 'CNC-1', runtime: 95, downtime: 5 })], // constrained
  });

  it('flags raw-material shortages as critical and picks the best supplier', () => {
    const result = runMultiLevelMrp(input);
    expect(criticalMaterialAlerts(result).map((l) => l.sku)).toContain('RAW-1');
    expect(selectSupplier(input.suppliers)?.name).toBe('Best'); // rating 5, lead 10
    expect(productionSequence(result).map((l) => l.sku)).toEqual(['SUB-1', 'FG-1']); // deepest first
  });

  it('recommendations carry the deterministic calculations that produced them', () => {
    const recs = mrpRecommendations(input);
    const raw = recs.find((r) => r.id === 'mrp:purchase:RAW-1');
    const sub = recs.find((r) => r.id === 'mrp:produce:SUB-1');
    expect(raw?.recommendedAction).toMatch(/purchase request for 60 of RAW-1 via Best/);
    expect(raw?.evidence).toEqual(expect.arrayContaining(['net=60', 'dependent=60', 'level=2']));
    expect(sub?.metric).toBe('production');
    // every recommendation is backed by evidence + confidence (never fabricated)
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
  });

  it('surfaces a BOM cycle as a data-integrity recommendation', () => {
    const cyclic = mrpInput({
      products: [product({ sku: 'A' }), product({ sku: 'B' })],
      salesOrders: [order({ product: 'A', orderedQty: 5 })],
      boms: [bom('A', [comp('B', 1)]), bom('B', [comp('A', 1)])],
    });
    expect(mrpRecommendations(cyclic).some((r) => r.metric === 'bom' && /cycle/i.test(r.problem))).toBe(true);
  });

  it('reports components missing from the product master', () => {
    const input2 = mrpInput({ products: [product({ sku: 'FG-1' })], boms: [bom('FG-1', [comp('MISSING-RAW', 1)])] });
    expect(missingComponents(input2)).toEqual(['MISSING-RAW']);
  });
});

describe('deriveMrpInsights + KPIs', () => {
  it('rolls the multi-level MRP into the ten MRP KPIs', () => {
    const input = mrpInput({
      products: [product({ sku: 'FG-1' }), product({ sku: 'SUB-1' }), product({ sku: 'RAW-1' })],
      salesOrders: [order({ product: 'FG-1', orderedQty: 10 })],
      boms: [bom('FG-1', [comp('SUB-1', 2)]), bom('SUB-1', [comp('RAW-1', 3)])],
      suppliers: [supplier()],
    });
    const insights = deriveMrpInsights(input);
    expect(insights.bomHealth).toBe(100); // no cycles, no missing components
    expect(insights.criticalMaterialCount).toBeGreaterThanOrEqual(1);
    expect(mrpInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'mrp-material-coverage',
      'mrp-component-avail',
      'mrp-bom-health',
      'mrp-coverage',
      'mrp-supply-ready',
      'mrp-prod-ready',
      'mrp-proc-ready',
      'mrp-critical',
      'mrp-confidence',
      'mrp-overall',
    ]);
  });
});

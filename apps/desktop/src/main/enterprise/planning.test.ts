import { describe, expect, it } from 'vitest';
import {
  calculateCapacityBottlenecks,
  calculateCapacityPlan,
  calculateCashForecast,
  calculateCashRisk,
  calculateFirmDemand,
  calculateForecastDemand,
  calculateFulfillmentRisk,
  calculateIncomingSupply,
  calculateInventoryRisk,
  calculateMaterialShortages,
  calculateNetRequirement,
  calculateProductionRisk,
  calculateReplenishment,
  calculateSafetyStockAlerts,
  calculateSalesForecast,
  calculateSupplierRisk,
  calculateWarehouseRisk,
  derivePlanningInsights,
  deriveSupplyChainHealth,
  planningInsightsToKpis,
  planningRecommendations,
  runMrp,
  type BillOfMaterials,
  type FinanceInvoice,
  type Machine,
  type PlanningInput,
  type Product,
  type ProductionOrder,
  type PurchaseOrder,
  type SalesOrder,
  type SalesQuote,
  type Shipping,
  type Supplier,
} from '@neuropause/shared';

const T0 = '2026-07-08T00:00:00.000Z';

function product(p: Partial<Product> = {}): Product {
  return { id: 'p1', sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 20, reservedStock: 0, availableStock: 20, status: 'active', ...p };
}
function order(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 1000, orderedQty: 20, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function shipment(p: Partial<Shipping> = {}): Shipping {
  return { id: 'h1', shipmentNumber: 'SHIP-1', pickList: '', salesOrder: '', product: 'FG-1', warehouse: 'WH-1', quantity: 10, carrier: '', trackingNumber: '', shippedDate: '2026-07-06', status: 'shipped', issueMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function prodOrder(p: Partial<ProductionOrder> = {}): ProductionOrder {
  return { id: 'm1', orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 8, actualQuantity: 0, scrapQuantity: 0, workCenter: '', machine: '', operator: '', productionTime: 0, status: 'released', consumptionMovements: '', outputMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function po(p: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return { id: 'po1', poNumber: 'PO-1', supplier: 'Acme', product: 'RAW-1', warehouse: 'WH-1', quantity: 50, unitCost: 2, subtotal: 100, discount: 0, tax: 0, total: 100, budget: 0, currency: 'USD', expectedDelivery: '', status: 'sent', approvedBy: '', sourceRequest: '', createdAt: T0, updatedAt: T0, ...p };
}
function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 40, vendorRating: 2, status: 'active', ...p };
}
function bom(p: Partial<BillOfMaterials> = {}): BillOfMaterials {
  return { id: 'b1', bomNumber: 'BOM-1', product: 'FG-1', outputQuantity: 1, yield: 100, waste: 0, revision: 'A', components: [{ sku: 'RAW-1', quantity: 2, waste: 0, alternative: '' }], status: 'active', notes: '', ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: 'mc1', name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 90, downtime: 10, maintenanceDue: '', status: 'running', ...p };
}
function invoice(status: FinanceInvoice['status'], amount: number, amountPaid: number): FinanceInvoice {
  return { id: `i-${status}-${amount}`, number: 'INV-1', customer: 'Acme', amount, taxRate: 0, amountPaid, currency: 'USD', status, paymentTerms: 'net30', issueDate: null, dueDate: null, sourceOrder: '', notes: null };
}
function quote(status: SalesQuote['status'], total: number): SalesQuote {
  return { id: `q-${status}-${total}`, quoteNumber: 'Q-1', customer: 'Acme', contact: '', opportunity: '', status, issueDate: '', expiryDate: '', currency: 'USD', subtotal: total, discount: 0, tax: 0, cost: 0, total, salesRep: '', paymentTerms: '', validUntil: '', notes: '', createdAt: T0, updatedAt: T0 } as unknown as SalesQuote;
}

function planningInput(over: Partial<PlanningInput> = {}): PlanningInput {
  return {
    products: [product({ sku: 'FG-1', availableStock: 5, currentStock: 5, safetyStock: 10, reorderLevel: 10 }), product({ id: 'p2', sku: 'RAW-1', name: 'Raw', availableStock: 0, currentStock: 0, safetyStock: 5, reorderLevel: 10 })],
    salesOrders: [order({ product: 'FG-1', orderedQty: 20 }), order({ id: 'o2', orderNumber: 'SO-2', product: 'RAW-1', orderedQty: 30 })],
    quotes: [quote('sent', 2000)],
    shipments: [shipment({ product: 'FG-1', quantity: 10 })],
    productionOrders: [prodOrder({ product: 'FG-1', productionQuantity: 8, status: 'released' })],
    purchaseOrders: [],
    suppliers: [supplier()],
    boms: [bom({ product: 'FG-1' })],
    machines: [machine({ name: 'CNC-1', runtime: 90, downtime: 10 }), machine({ id: 'mc2', name: 'CNC-2', runtime: 50, downtime: 50, status: 'down' })],
    invoices: [invoice('overdue', 100, 0), invoice('issued', 100, 0)],
    ...over,
  };
}

describe('Demand Planning', () => {
  it('firm demand + forecast baseline from shipments', () => {
    const orders = [order({ product: 'FG-1', orderedQty: 20 }), order({ id: 'o2', product: 'FG-1', orderedQty: 5, status: 'shipped' })];
    expect(calculateFirmDemand('FG-1', orders)).toBe(20); // only pending
    // forecast = firm 20 + round(10 shipped * 0.5) = 25
    expect(calculateForecastDemand('FG-1', orders, [shipment({ product: 'FG-1', quantity: 10 })])).toBe(25);
  });
});

describe('MRP', () => {
  it('incoming supply, net requirement, and purchase vs produce recommendations', () => {
    expect(calculateIncomingSupply('FG-1', [], [prodOrder({ product: 'FG-1', productionQuantity: 8, status: 'released' })])).toBe(8);
    expect(calculateNetRequirement(25, 5, 8)).toBe(12);

    const mrp = runMrp(planningInput());
    const fg = mrp.find((l) => l.sku === 'FG-1');
    const raw = mrp.find((l) => l.sku === 'RAW-1');
    expect(fg).toMatchObject({ demand: 25, available: 5, incoming: 8, netRequirement: 12, isManufactured: true, recommendation: 'produce' });
    expect(raw).toMatchObject({ demand: 30, netRequirement: 30, isManufactured: false, recommendation: 'purchase' });
    expect(calculateMaterialShortages(mrp)).toHaveLength(2);
  });
  it('safety-stock alerts + replenishment (reuses reorder rule)', () => {
    expect(calculateSafetyStockAlerts([product({ availableStock: 5, safetyStock: 10 }), product({ id: 'p2', availableStock: 50, safetyStock: 10 })]).map((p) => p.id)).toEqual(['p1']);
    const repl = calculateReplenishment([product({ availableStock: 3, reorderLevel: 10, safetyStock: 5, maximumStock: 50 })]);
    expect(repl).toHaveLength(1);
    expect(repl[0].requirement).toBe(47);
  });
});

describe('Capacity Planning', () => {
  it('per-machine utilization + bottlenecks', () => {
    const plan = calculateCapacityPlan([machine({ name: 'CNC-1', runtime: 90, downtime: 10 }), machine({ id: 'mc2', name: 'CNC-2', runtime: 50, downtime: 50 })]);
    expect(plan).toEqual([
      { machine: 'CNC-1', utilization: 90, constrained: true },
      { machine: 'CNC-2', utilization: 50, constrained: false },
    ]);
    expect(calculateCapacityBottlenecks([machine({ name: 'CNC-1', runtime: 90, downtime: 10 }), machine({ id: 'mc2', name: 'CNC-2', runtime: 50, downtime: 50 })])).toEqual(['CNC-1']);
  });
});

describe('Supply-Chain Health (6 risks)', () => {
  it('supplier, production, inventory, warehouse, fulfillment, cash risk', () => {
    expect(calculateSupplierRisk([supplier({ vendorRating: 2, leadTime: 40 })])).toBe(56); // (5-2)*12 + 20
    expect(calculateProductionRisk([machine({ status: 'running' }), machine({ id: 'm2', status: 'down' })])).toBe(50);
    expect(calculateInventoryRisk([product({ currentStock: 0, availableStock: 0 }), product({ id: 'p2', currentStock: 5, availableStock: 5, safetyStock: 10 })])).toBe(75); // out(100) + low(50) / 2
    expect(calculateWarehouseRisk([product({ currentStock: 100, reservedStock: 50 })])).toBe(50);
    expect(calculateFulfillmentRisk([order({ product: 'FG-1', orderedQty: 20 })], [product({ sku: 'FG-1', availableStock: 5 })])).toBe(100);
    expect(calculateCashRisk([invoice('overdue', 100, 0), invoice('issued', 100, 0)])).toBe(50);
    const health = deriveSupplyChainHealth(planningInput());
    expect(health.supplierRisk).toBe(56);
    expect(health.fulfillmentRisk).toBe(100);
  });
});

describe('Forecasts', () => {
  it('sales (orders + weighted pipeline) and cash (receivables − payables)', () => {
    expect(calculateSalesForecast([order({ total: 1000 })], [quote('sent', 2000), quote('draft', 500)])).toBe(2000); // 1000 + 2000*0.5
    expect(calculateCashForecast([invoice('issued', 500, 100), invoice('paid', 300, 300)], [po({ total: 100, status: 'sent' })])).toBe(300); // 400 receivable − 100 payable
  });
});

describe('derivePlanningInsights + KPIs', () => {
  it('rolls the enterprise into the ten planning KPIs', () => {
    const insights = derivePlanningInsights(planningInput());
    expect(insights.demandForecast).toBe(55); // FG-1 25 + RAW-1 30
    expect(insights.mrpHealth).toBe(0); // both products short
    expect(insights.capacityUtilization).toBe(70); // mean(90, 50)
    expect(planningInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'plan-accuracy',
      'plan-demand',
      'plan-supply',
      'plan-mrp',
      'plan-capacity',
      'plan-inv-coverage',
      'plan-proc-ready',
      'plan-prod-ready',
      'plan-enterprise',
      'plan-overall',
    ]);
  });
});

describe('planning recommendations (deterministic, backed by MRP)', () => {
  it('emits produce/purchase recommendations for shortages and safety-stock alerts', () => {
    const recs = planningRecommendations(planningInput());
    const fg = recs.find((r) => r.id === 'plan:mrp:FG-1');
    const raw = recs.find((r) => r.id === 'plan:mrp:RAW-1');
    expect(fg?.metric).toBe('production');
    expect(fg?.recommendedAction).toMatch(/production order for 12 of FG-1/);
    expect(raw?.metric).toBe('procurement');
    expect(raw?.recommendedAction).toMatch(/purchase request for 30 of RAW-1/);
    // every recommendation is backed by calculated evidence (never fabricated)
    expect(recs.every((r) => r.evidence.length > 0 && r.confidence > 0)).toBe(true);
    // safety-stock alert for FG-1 (available 5 <= safety 10)
    expect(recs.some((r) => r.id === 'plan:safety:FG-1')).toBe(true);
  });
});

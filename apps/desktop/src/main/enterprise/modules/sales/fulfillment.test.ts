import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateOrderDeliveryPerformance,
  calculateFinishedGoodsAvailability,
  calculateFulfillableOrders,
  calculateFulfillmentRate,
  calculateOrderCompletionRate,
  calculateProductionToShipmentLeadTime,
  calculateReservationEfficiency,
  calculateShipmentReadiness,
  calculateWarehouseAvailability,
  calculateWarehouseThroughput,
  deriveFulfillmentInsights,
  fulfillmentInsightsToKpis,
  movementFromRecord,
  productFromRecord,
  type EnterprisePermission,
  type EnterpriseEntity,
  type PickList,
  type Product,
  type ProductionOrder,
  type SalesOrder,
  type Shipping,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createBomModule } from '../manufacturing/bomModule';
import { createProductionOrderModule } from '../manufacturing/productionOrderModule';
import { createOrderModule } from './orderModule';
import { createPickListModule } from '../warehouse/pickListModule';
import { createPackingModule } from '../warehouse/packingModule';
import { createShippingModule } from '../warehouse/shippingModule';

const T0 = '2026-07-08T00:00:00.000Z';

function product(p: Partial<Product> = {}): Product {
  return { id: 'p1', sku: 'FG-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 5, safetyStock: 2, maximumStock: 200, currentStock: 20, reservedStock: 0, availableStock: 20, status: 'active', ...p };
}
function salesOrder(p: Partial<SalesOrder> = {}): SalesOrder {
  return { id: 'o1', orderNumber: 'SO-1', sourceQuote: '', customer: 'Acme', contact: '', status: 'pending', currency: 'USD', total: 100, orderedQty: 10, fulfilledQty: 0, product: 'FG-1', warehouse: 'WH-1', orderDate: '', expectedDeliveryDate: '2026-07-10', shippedDate: '', deliveredDate: '', carrier: '', trackingNumber: '', salesRep: '', createdAt: T0, updatedAt: T0, ...p };
}
function productionOrder(p: Partial<ProductionOrder> = {}): ProductionOrder {
  return { id: 'm1', orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, actualQuantity: 10, scrapQuantity: 0, workCenter: '', machine: '', operator: '', productionTime: 0, status: 'completed', consumptionMovements: '', outputMovement: '', createdAt: T0, updatedAt: '2026-07-01T00:00:00.000Z', ...p };
}
function pick(p: Partial<PickList> = {}): PickList {
  return { id: 'k1', pickNumber: 'PICK-1', salesOrder: 'o1', product: 'FG-1', warehouse: 'WH-1', quantity: 10, assignee: '', status: 'picked', reservationMovement: '', convertedPacking: '', createdAt: T0, updatedAt: T0, ...p };
}
function shipping(p: Partial<Shipping> = {}): Shipping {
  return { id: 'h1', shipmentNumber: 'SHIP-1', pickList: 'k1', salesOrder: 'o1', product: 'FG-1', warehouse: 'WH-1', quantity: 10, carrier: '', trackingNumber: '', shippedDate: '2026-07-06', status: 'shipped', issueMovement: '', createdAt: T0, updatedAt: T0, ...p };
}

/* ── deterministic business logic ── */

describe('deterministic fulfillment functions', () => {
  it('availability, finished goods, fulfillable, throughput', () => {
    expect(calculateWarehouseAvailability([product({ availableStock: 50 }), product({ availableStock: 30 })])).toBe(80);
    expect(calculateFinishedGoodsAvailability([product({ sku: 'FG-1', availableStock: 20 }), product({ sku: 'RAW', availableStock: 50 })], [productionOrder()])).toBe(20);
    expect(calculateFulfillableOrders([salesOrder({ orderedQty: 10 })], [product({ availableStock: 15 })])).toBe(1);
    expect(calculateFulfillableOrders([salesOrder({ orderedQty: 10 })], [product({ availableStock: 5 })])).toBe(0);
    expect(calculateWarehouseThroughput([shipping({ quantity: 10 }), shipping({ id: 'h2', status: 'delivered', quantity: 5 }), shipping({ id: 'h3', status: 'pending', quantity: 3 })])).toBe(15);
  });
  it('lead time, reservation, rates, delivery', () => {
    expect(calculateProductionToShipmentLeadTime([productionOrder({ updatedAt: '2026-07-01T00:00:00.000Z' })], [shipping({ shippedDate: '2026-07-06' })])).toBe(5);
    expect(calculateReservationEfficiency([pick({ status: 'reserved' }), pick({ status: 'picked' }), pick({ status: 'pending' }), pick({ status: 'cancelled' })])).toBe(50);
    expect(calculateShipmentReadiness([salesOrder({ orderedQty: 10 })], [product({ availableStock: 20 })])).toBe(100);
    expect(calculateFulfillmentRate([salesOrder({ status: 'shipped' }), salesOrder({ status: 'pending' }), salesOrder({ status: 'cancelled' })])).toBe(50);
    expect(calculateOrderCompletionRate([salesOrder({ status: 'fulfilled' }), salesOrder({ status: 'pending' })])).toBe(50);
    expect(calculateOrderDeliveryPerformance([
      salesOrder({ status: 'fulfilled', expectedDeliveryDate: '2026-07-10', deliveredDate: '2026-07-09' }),
      salesOrder({ status: 'closed', expectedDeliveryDate: '2026-07-10', deliveredDate: '2026-07-12' }),
    ])).toBe(50);
  });
});

describe('deriveFulfillmentInsights + KPIs', () => {
  it('rolls the make → move → sell records into the ten KPIs', () => {
    const insights = deriveFulfillmentInsights({
      products: [product({ sku: 'FG-1', currentStock: 20, reservedStock: 10, availableStock: 10 })],
      productionOrders: [productionOrder()],
      orders: [salesOrder({ status: 'pending', orderedQty: 5 })],
      pickLists: [pick({ status: 'picked' })],
      shipments: [shipping({ quantity: 10 })],
    });
    expect(insights).toMatchObject({
      finishedGoodsAvailable: 10,
      ordersReadyToShip: 1, // pending order for 5, 10 available
      warehouseThroughput: 10,
      warehouseUtilization: 50, // 10 reserved of 20 on-hand
    });
    expect(fulfillmentInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'ful-fg-available',
      'ful-ready',
      'ful-throughput',
      'ful-reservation',
      'ful-shipment',
      'ful-rate',
      'ful-leadtime',
      'ful-utilization',
      'ful-velocity',
      'ful-completion',
    ]);
  });
});

/* ── the real end-to-end make → move → sell loop (one SKU, one ledger) ── */

interface Recorded {
  authorized: EnterprisePermission[];
}
const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let products: ReturnType<typeof createProductModule>;
let movements: ReturnType<typeof createStockMovementModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: () => undefined,
    publish: () => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}
function tmp(tag: string): string {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

beforeEach(() => {
  rec = { authorized: [] };
  products = createProductModule(tmp('prod'));
  movements = createStockMovementModule(tmp('mv'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(movements);
  registry.register(createBomModule(tmp('bom')));
  registry.register(createProductionOrderModule(tmp('mo')));
  registry.register(createOrderModule(tmp('so')));
  registry.register(createPickListModule(tmp('pick')));
  registry.register(createPackingModule(tmp('pack')));
  registry.register(createShippingModule(tmp('ship')));
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}
async function createIn(moduleId: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity };
}
function act(moduleId: string, id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
}
function getRec(moduleId: string, id: string) {
  return handler(IpcChannel.EnterpriseModuleGet)({ moduleId, id }) as Promise<EnterpriseEntity>;
}
async function listOf(moduleId: string): Promise<EnterpriseEntity[]> {
  return (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];
}
function stockOf(id: string): Product {
  return productFromRecord(products.store.get(id) as EnterpriseEntity);
}
function findByTitle(list: EnterpriseEntity[], title: string): EnterpriseEntity {
  const r = list.find((x) => x.title === title);
  if (!r) throw new Error(`no record titled ${title}`);
  return r;
}

describe('Finished Goods Handoff — production output becomes sellable, fulfilled inventory', () => {
  it('manufactures FG, then a sales order fulfils it through the warehouse on the same ledger', async () => {
    // Seed a raw component and produce finished goods FG-1 into WH-1.
    await createIn('inventory-products', { sku: 'COMP', name: 'Component' });
    const fg = await createIn('inventory-products', { sku: 'FG-1', name: 'Widget', standardCost: 5 });
    const fgId = fg.record?.id as string;
    await createIn('inventory-movements', { movementNumber: 'SEED', type: 'receive', product: 'COMP', warehouse: 'WH-1', quantity: 100, status: 'posted' });
    await createIn('manufacturing-bom', { bomNumber: 'BOM-1', product: 'FG-1', yield: 100, status: 'active', components: JSON.stringify([{ sku: 'COMP', quantity: 1 }]) });

    const mo = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
    const moId = mo.record?.id as string;
    await act('manufacturing-orders', moId, 'plan');
    await act('manufacturing-orders', moId, 'allocate');
    await act('manufacturing-orders', moId, 'start');
    await act('manufacturing-orders', moId, 'complete');

    // Manufacturing output IS warehouse inventory now (via production_output → ledger).
    expect(stockOf(fgId)).toMatchObject({ currentStock: 10, availableStock: 10 });

    // A sales order for the finished good, dispatched to the warehouse.
    const so = await createIn('sales-orders', { orderNumber: 'SO-1', customer: 'Acme', product: 'FG-1', warehouse: 'WH-1', orderedQty: 10, expectedDeliveryDate: '2026-07-10' });
    const soId = so.record?.id as string;
    expect((await act('sales-orders', soId, 'createPickList')).ok).toBe(true);
    expect(String((await getRec('sales-orders', soId)).fields.pickList)).toMatch(/^rec_/);

    // Warehouse fulfils: reserve → pick → pack → ship (all on the same FG-1 ledger).
    const pickRec = findByTitle(await listOf('warehouse-picks'), 'PICK-SO-1');
    expect(pickRec.fields).toMatchObject({ product: 'FG-1', warehouse: 'WH-1', quantity: 10, salesOrder: soId });
    expect((await act('warehouse-picks', pickRec.id, 'reserve')).ok).toBe(true);
    expect(stockOf(fgId)).toMatchObject({ currentStock: 10, reservedStock: 10, availableStock: 0 });
    await act('warehouse-picks', pickRec.id, 'pick');
    await act('warehouse-picks', pickRec.id, 'createPacking');
    const packRec = findByTitle(await listOf('warehouse-packing'), 'PACK-PICK-SO-1');
    await act('warehouse-packing', packRec.id, 'pack');
    await act('warehouse-packing', packRec.id, 'createShipment');
    const shipRec = findByTitle(await listOf('warehouse-shipping'), 'SHIP-PACK-PICK-SO-1');
    expect((await act('warehouse-shipping', shipRec.id, 'ship')).ok).toBe(true);

    // Finished goods shipped: on-hand back to 0, reservation settled — one ledger, no duplicate stock.
    expect(stockOf(fgId)).toMatchObject({ currentStock: 0, reservedStock: 0 });
    // Exactly one issue movement for FG-1 (the shipment) — the order did not double-issue.
    const fgIssues = movements.store.list().map(movementFromRecord).filter((m) => m.product === 'FG-1' && m.type === 'issue');
    expect(fgIssues).toHaveLength(1);
    // The loop is closed: the sales order is fulfilled.
    expect((await getRec('sales-orders', soId)).fields.status).toBe('fulfilled');
  });

  it('creating a pick list is idempotent', async () => {
    const so = await createIn('sales-orders', { orderNumber: 'SO-2', customer: 'Beta', product: 'FG-1', warehouse: 'WH-1', orderedQty: 3 });
    const soId = so.record?.id as string;
    expect((await act('sales-orders', soId, 'createPickList')).ok).toBe(true);
    const again = await act('sales-orders', soId, 'createPickList');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already exists/i);
  });

  it('createPickList authorizes warehouse:manage (reuses the pick list module, no new scope)', async () => {
    const so = await createIn('sales-orders', { orderNumber: 'SO-3', customer: 'Gamma', product: 'FG-1', warehouse: 'WH-1', orderedQty: 2 });
    rec.authorized.length = 0;
    await act('sales-orders', so.record?.id as string, 'createPickList');
    expect(rec.authorized).toContain('warehouse:manage');
  });
});

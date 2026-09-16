import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateAvailableStock,
  calculateCurrentStock,
  calculateInventoryValue,
  calculateReorderRequirement,
  calculateReservedStock,
  calculateStockHealth,
  calculateStockTurnover,
  calculateWarehouseUtilization,
  deriveInventoryInsights,
  deriveStockLedger,
  identifyNegativeInventory,
  inventoryInsightsToKpis,
  movementOnHandDelta,
  productFromRecord,
  type EnterprisePermission,
  type EnterpriseEntity,
  type Product,
  type StockMovement,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, INTERNAL_ACTION_ORIGIN, buildModuleHandlers } from '../../framework';
import { createProductModule } from './productModule';
import { createWarehouseModule } from './warehouseModule';
import { createStockMovementModule } from './stockMovementModule';
import { createOrderModule } from '../sales/orderModule';

const T0 = '2026-07-08T00:00:00.000Z';

function product(partial: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'SKU-1',
    barcode: '',
    name: 'Widget',
    category: 'General',
    unit: 'unit',
    purchaseCost: 4,
    standardCost: 5,
    sellingPrice: 10,
    reorderLevel: 10,
    safetyStock: 5,
    maximumStock: 50,
    currentStock: 0,
    reservedStock: 0,
    availableStock: 0,
    status: 'active',
    ...partial,
  };
}

function movement(partial: Partial<StockMovement> = {}): StockMovement {
  return {
    id: 'm1',
    movementNumber: 'MV-1',
    type: 'receive',
    product: 'SKU-1',
    warehouse: 'WH-1',
    fromWarehouse: '',
    quantity: 10,
    unitCost: 5,
    referenceModule: '',
    referenceRecord: '',
    reason: '',
    status: 'posted',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

/* ── deterministic stock logic (AI never sets these) ── */

describe('movement effects + current/reserved/available', () => {
  it('signs on-hand by type; sums the ledger', () => {
    expect(movementOnHandDelta(movement({ type: 'receive', quantity: 10 }))).toBe(10);
    expect(movementOnHandDelta(movement({ type: 'issue', quantity: 10 }))).toBe(-10);
    expect(movementOnHandDelta(movement({ type: 'adjustment', quantity: -3 }))).toBe(-3);
    expect(movementOnHandDelta(movement({ type: 'reservation', quantity: 10 }))).toBe(0);
    expect(movementOnHandDelta(movement({ type: 'receive', quantity: 10, status: 'void' }))).toBe(0);

    const ms = [movement({ type: 'receive', quantity: 100 }), movement({ type: 'issue', quantity: 30 })];
    expect(calculateCurrentStock(ms)).toBe(70);
    const res = [movement({ type: 'reservation', quantity: 20 }), movement({ type: 'reservation_release', quantity: 5 })];
    expect(calculateReservedStock(res)).toBe(15);
    expect(calculateAvailableStock([...ms, ...res])).toBe(55); // 70 on hand − 15 reserved
  });
});

describe('value / reorder / health / negative / utilization / turnover', () => {
  it('inventory value at cost', () => {
    expect(calculateInventoryValue([product({ currentStock: 10, standardCost: 5 })])).toBe(50);
  });
  it('reorder requirement returns to target', () => {
    expect(calculateReorderRequirement(product({ availableStock: 3, reorderLevel: 10, safetyStock: 5, maximumStock: 50 }))).toBe(47);
    expect(calculateReorderRequirement(product({ availableStock: 40, reorderLevel: 10 }))).toBe(0);
  });
  it('stock health bands', () => {
    expect(calculateStockHealth(product({ currentStock: 0 })).status).toBe('out_of_stock');
    expect(calculateStockHealth(product({ currentStock: 8, availableStock: 4, safetyStock: 5 })).status).toBe('low');
    expect(calculateStockHealth(product({ currentStock: 100, availableStock: 100, maximumStock: 50 })).status).toBe('overstock');
    expect(calculateStockHealth(product({ currentStock: 30, availableStock: 30, reorderLevel: 10, safetyStock: 5, maximumStock: 50 })).status).toBe('healthy');
  });
  it('identifies negative inventory', () => {
    expect(identifyNegativeInventory([product({ id: 'a', currentStock: -2 }), product({ id: 'b', currentStock: 5 })]).map((p) => p.id)).toEqual(['a']);
  });
  it('warehouse utilization + turnover', () => {
    expect(calculateWarehouseUtilization(100, 75)).toBe(75);
    expect(calculateWarehouseUtilization(0, 75)).toBe(0);
    expect(calculateStockTurnover(100, 50)).toBe(2);
  });
});

describe('deriveStockLedger', () => {
  it('projects per (product, warehouse) balances from movements', () => {
    const ms = [
      movement({ product: 'SKU-1', warehouse: 'WH-1', type: 'receive', quantity: 100 }),
      movement({ product: 'SKU-1', warehouse: 'WH-1', type: 'issue', quantity: 30 }),
      movement({ product: 'SKU-1', warehouse: 'WH-2', type: 'receive', quantity: 50 }),
    ];
    const ledger = deriveStockLedger(ms);
    expect(ledger.find((b) => b.warehouse === 'WH-1')?.onHand).toBe(70);
    expect(ledger.find((b) => b.warehouse === 'WH-2')?.onHand).toBe(50);
  });
});

describe('deriveInventoryInsights + KPIs', () => {
  it('rolls products + warehouses into KPIs', () => {
    const products = [
      product({ id: 'a', currentStock: 100, availableStock: 100, reservedStock: 0, standardCost: 5, maximumStock: 200 }),
      product({ id: 'b', currentStock: 0, availableStock: 0, standardCost: 5 }), // out of stock
      product({ id: 'c', currentStock: 8, availableStock: 4, safetyStock: 5, standardCost: 5, maximumStock: 200 }), // low
    ];
    const warehouses = [{ id: 'w', name: 'Main', code: 'WH-1', location: '', zone: '', bin: '', capacity: 1000, manager: '', status: 'active' as const }];
    const insights = deriveInventoryInsights(products, warehouses);
    expect(insights).toMatchObject({
      totalProducts: 3,
      inventoryValue: 540, // (100 + 0 + 8) * 5
      outOfStockCount: 1,
      lowStockCount: 1,
      negativeStockCount: 0,
    });
    expect(inventoryInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'stk-value',
      'stk-health',
      'stk-available',
      'stk-reserved',
      'stk-low',
      'stk-out',
      'stk-util',
    ]);
  });
});

/* ── modules + reconciliation through the framework's handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let products: ReturnType<typeof createProductModule>;
let warehouses: ReturnType<typeof createWarehouseModule>;
let movements: ReturnType<typeof createStockMovementModule>;
let orders: ReturnType<typeof createOrderModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
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
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  products = createProductModule(tmp('prod'));
  warehouses = createWarehouseModule(tmp('wh'));
  movements = createStockMovementModule(tmp('mv'));
  orders = createOrderModule(tmp('ord'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(warehouses);
  registry.register(movements);
  registry.register(orders);
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
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as {
    ok: boolean;
    record?: EnterpriseEntity;
    errors?: Record<string, string>;
  };
}

function move(fields: Record<string, unknown>) {
  return createIn('inventory-movements', fields);
}

async function makeProduct() {
  const res = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5, reorderLevel: 10, safetyStock: 5, maximumStock: 200 });
  return res.record?.id as string;
}

describe('RBAC', () => {
  it('reads authorize inventory:read, writes inventory:manage', async () => {
    await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget' });
    expect(rec.authorized).toContain('inventory:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'inventory-products' });
    expect(rec.authorized).toEqual(['inventory:read']);
  });
});

describe('movement → product reconciliation (stock derives from movements)', () => {
  it('receive / issue / reserve / void drive the product stock + timeline', async () => {
    const productId = await makeProduct();

    await move({ movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    let p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ currentStock: 100, availableStock: 100, reservedStock: 0 });
    // stock value derived from cost
    expect(products.store.get(productId)?.fields.stockValue).toBe(500);
    // movement recorded + product reconciled on the timeline
    expect(rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:inventory-movements')).toBe(true);
    expect(rec.publish.some((e) => e.type === 'enterprise.record.updated' && e.source === 'enterprise:inventory-products')).toBe(true);

    await move({ movementNumber: 'MV-2', type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ currentStock: 70, availableStock: 70 });

    const reservation = await move({ movementNumber: 'MV-3', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 20 });
    p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ currentStock: 70, reservedStock: 20, availableStock: 50 });

    // voiding a movement re-derives the product (reservation released)
    await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'inventory-movements', id: reservation.record?.id, fields: { status: 'void' } });
    p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ reservedStock: 0, availableStock: 70 });
  });

  it('requires movement number, type, product, warehouse, quantity', async () => {
    expect((await move({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 })).ok).toBe(false); // no movementNumber
  });
});

describe('AI summary', () => {
  it('products + movements expose aiSummary=true; warehouses do not', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{ id: string; aiSummary: boolean }>;
    expect(summaries.find((s) => s.id === 'inventory-products')?.aiSummary).toBe(true);
    expect(summaries.find((s) => s.id === 'inventory-movements')?.aiSummary).toBe(true);
    expect(summaries.find((s) => s.id === 'inventory-warehouses')?.aiSummary).toBe(false);
  });

  it('product summary is deterministic (out of stock → high)', async () => {
    const productId = await makeProduct();
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({ moduleId: 'inventory-products', id: productId })) as { risk: string; grounded: boolean };
    expect(summary.risk).toBe('high'); // 0 on hand
    expect(summary.grounded).toBe(false);
  });
});

describe('Sales integration (orders reserve + ship stock via movements)', () => {
  it('reserve then ship posts real movements and drives product stock', async () => {
    const productId = await makeProduct();
    await move({ movementNumber: 'MV-R', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });

    const order = await createIn('sales-orders', {
      orderNumber: 'SO-1',
      customer: 'Acme',
      status: 'pending',
      product: 'SKU-1',
      warehouse: 'WH-1',
      orderedQty: 10,
    });
    const orderId = order.record?.id as string;

    // Reserve
    const reserved = (await handler(IpcChannel.EnterpriseModuleAction)({ moduleId: 'sales-orders', id: orderId, action: 'reserveStock' })) as { ok: boolean };
    expect(reserved.ok).toBe(true);
    let p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ currentStock: 100, reservedStock: 10, availableStock: 90 });

    // Ship → issue 10 + release the reservation
    const shipped = (await handler(IpcChannel.EnterpriseModuleAction)({ moduleId: 'sales-orders', id: orderId, action: 'ship', origin: INTERNAL_ACTION_ORIGIN })) as { ok: boolean };
    expect(shipped.ok).toBe(true);
    p = productFromRecord(products.store.get(productId) as EnterpriseEntity);
    expect(p).toMatchObject({ currentStock: 90, reservedStock: 0, availableStock: 90 });
  });

  it('reserve requires the Finance/inventory write scope and is idempotent', async () => {
    const productId = await makeProduct();
    await move({ movementNumber: 'MV-R', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const order = await createIn('sales-orders', { orderNumber: 'SO-2', customer: 'Acme', product: 'SKU-1', warehouse: 'WH-1', orderedQty: 5 });
    const orderId = order.record?.id as string;
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleAction)({ moduleId: 'sales-orders', id: orderId, action: 'reserveStock' });
    expect(rec.authorized).toContain('inventory:manage');
    const again = (await handler(IpcChannel.EnterpriseModuleAction)({ moduleId: 'sales-orders', id: orderId, action: 'reserveStock' })) as { ok: boolean; message?: string };
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already reserved/i);
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity).reservedStock).toBe(5);
  });
});

// Master-data module (generic CRUD only) — explicit per-module CRUD/validation smoke (certification).
describe('Inventory warehouses CRUD smoke (certification)', () => {
  it('create persists a warehouse; a missing required name is rejected without persisting', async () => {
    const ok = await createIn('inventory-warehouses', { name: 'Central DC', code: 'WH-1' });
    expect(ok.ok).toBe(true);
    expect(ok.record?.fields.name).toBe('Central DC');
    const bad = await createIn('inventory-warehouses', { code: 'WH-2' });
    expect(bad.ok).toBe(false);
    expect(bad.errors?.name).toBeDefined();
    // the rejected create did not persist — only the valid warehouse is stored
    const list = (await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'inventory-warehouses' })) as EnterpriseEntity[];
    expect(list).toHaveLength(1);
  });
});

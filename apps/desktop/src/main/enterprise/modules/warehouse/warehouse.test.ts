import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateAdjustmentImpact,
  calculateBinUtilization,
  calculateCycleCountVariance,
  calculatePackingEfficiency,
  calculatePickingEfficiency,
  calculateShippingPerformance,
  calculateTransferPerformance,
  calculateWarehouseAccuracy,
  calculateWarehouseCapacity,
  calculateWarehouseHealth,
  deriveStockLedger,
  deriveWarehouseInsights,
  movementFromRecord,
  productFromRecord,
  warehouseInsightsToKpis,
  type Bin,
  type CycleCount,
  type EnterprisePermission,
  type EnterpriseEntity,
  type PickList,
  type PlatformEventInput,
  type Product,
  type Shipping,
  type StockAdjustment,
  type TransferOrder,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createZoneModule } from './zoneModule';
import { createBinModule } from './binModule';
import { createTransferOrderModule } from './transferOrderModule';
import { createPickListModule } from './pickListModule';
import { createPackingModule } from './packingModule';
import { createShippingModule } from './shippingModule';
import { createCycleCountModule } from './cycleCountModule';
import { createStockAdjustmentModule } from './stockAdjustmentModule';

const T0 = '2026-07-08T00:00:00.000Z';

function bin(p: Partial<Bin> = {}): Bin {
  return { id: 'b1', code: 'A-01', zone: 'Z-1', warehouse: 'WH-1', capacity: 100, occupied: 40, status: 'occupied', ...p };
}
function transfer(p: Partial<TransferOrder> = {}): TransferOrder {
  return { id: 't1', transferNumber: 'TRN-1', product: 'SKU-1', quantity: 10, fromWarehouse: 'WH-1', toWarehouse: 'WH-2', reason: '', status: 'completed', requestedDate: '', completedDate: '', reservationMovement: '', outMovement: '', inMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function pick(p: Partial<PickList> = {}): PickList {
  return { id: 'k1', pickNumber: 'PICK-1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5, assignee: '', status: 'picked', reservationMovement: '', convertedPacking: '', createdAt: T0, updatedAt: T0, ...p };
}
function shipping(p: Partial<Shipping> = {}): Shipping {
  return { id: 'h1', shipmentNumber: 'SHIP-1', pickList: 'k1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5, carrier: '', trackingNumber: '', shippedDate: '', status: 'shipped', issueMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function cycleCount(p: Partial<CycleCount> = {}): CycleCount {
  return { id: 'c1', countNumber: 'CC-1', product: 'SKU-1', warehouse: 'WH-1', systemQuantity: 50, countedQuantity: 50, countDate: '', counter: '', status: 'reconciled', adjustmentMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function adjustment(p: Partial<StockAdjustment> = {}): StockAdjustment {
  return { id: 'a1', adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: -5, reason: 'damage', unitCost: 4, notes: '', status: 'posted', adjustmentMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function product(p: Partial<Product> = {}): Product {
  return { id: 'p1', sku: 'SKU-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 200, currentStock: 100, reservedStock: 0, availableStock: 100, status: 'active', ...p };
}

/* ── deterministic business logic ── */

describe('deterministic warehouse functions', () => {
  it('accuracy, bin utilization, cycle-count variance, adjustment impact', () => {
    expect(calculateWarehouseAccuracy([cycleCount({ systemQuantity: 100, countedQuantity: 90 })])).toBe(90);
    expect(calculateWarehouseAccuracy([])).toBe(100);
    expect(calculateBinUtilization(100, 40)).toBe(40);
    expect(calculateBinUtilization(0, 10)).toBe(0);
    expect(calculateCycleCountVariance(50, 45)).toBe(-5);
    expect(calculateCycleCountVariance(50, 58)).toBe(8);
    expect(calculateAdjustmentImpact([adjustment({ quantity: -5, unitCost: 4 }), adjustment({ quantity: 3, unitCost: 10 })])).toBe(10); // -20 + 30
  });
  it('picking / packing / shipping / transfer efficiency', () => {
    expect(calculatePickingEfficiency([pick({ status: 'picked' }), pick({ status: 'pending' }), pick({ status: 'cancelled' })])).toBe(50); // 1 of 2 active
    expect(calculatePackingEfficiency([{ status: 'packed' }, { status: 'pending' }])).toBe(50);
    expect(calculateShippingPerformance([{ status: 'shipped' }, { status: 'delivered' }, { status: 'pending' }])).toBe(67);
    expect(calculateTransferPerformance([transfer({ status: 'completed' }), transfer({ status: 'in_transit' }), transfer({ status: 'draft' })])).toBe(50); // 1 of 2 in-flight
  });
  it('warehouse capacity + health', () => {
    const cap = calculateWarehouseCapacity([bin({ capacity: 100, occupied: 40 }), bin({ id: 'b2', capacity: 100, occupied: 60 })]);
    expect(cap).toMatchObject({ capacity: 200, used: 100, available: 100, utilization: 50 });
    expect(calculateWarehouseHealth({ inventoryAccuracy: 70, shippingPerformance: 100, transferSuccess: 100, adjustmentFrequency: 0 }).level).toBe('high');
    expect(calculateWarehouseHealth({ inventoryAccuracy: 95, shippingPerformance: 95, transferSuccess: 95, adjustmentFrequency: 2 }).level).toBe('low');
  });
});

describe('deriveWarehouseInsights + KPIs', () => {
  it('rolls warehouse records into the ten KPIs', () => {
    const insights = deriveWarehouseInsights({
      bins: [bin({ capacity: 100, occupied: 50 })],
      transfers: [transfer({ status: 'completed' }), transfer({ id: 't2', status: 'in_transit' })],
      picks: [pick({ status: 'picked' })],
      packings: [{ status: 'packed' } as Packing],
      shippings: [shipping({ status: 'shipped' })],
      cycleCounts: [cycleCount({ systemQuantity: 100, countedQuantity: 100 })],
      adjustments: [adjustment({ status: 'posted' })],
      products: [product({ currentStock: 100 })],
    });
    expect(insights).toMatchObject({
      warehouseUtilization: 50,
      transferSuccess: 50, // 1 completed of 2 in-flight
      adjustmentFrequency: 1,
      openTransfers: 1, // in_transit
    });
    expect(warehouseInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'wh-accuracy',
      'wh-picking',
      'wh-packing',
      'wh-shipping',
      'wh-transfer',
      'wh-pick-time',
      'wh-cycle-accuracy',
      'wh-utilization',
      'wh-turnover',
      'wh-adjustments',
    ]);
  });
});

/* ── modules + the critical warehouse → inventory ledger integrations ── */

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
let movements: ReturnType<typeof createStockMovementModule>;

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
  movements = createStockMovementModule(tmp('mv'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(movements);
  registry.register(createZoneModule(tmp('zone')));
  registry.register(createBinModule(tmp('bin')));
  registry.register(createTransferOrderModule(tmp('trn')));
  registry.register(createPickListModule(tmp('pick')));
  registry.register(createPackingModule(tmp('pack')));
  registry.register(createShippingModule(tmp('ship')));
  registry.register(createCycleCountModule(tmp('cc')));
  registry.register(createStockAdjustmentModule(tmp('adj')));
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
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
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
function ledger() {
  return deriveStockLedger(movements.store.list().map(movementFromRecord));
}
function cell(prod: string, wh: string) {
  return ledger().find((b) => b.product === prod && b.warehouse === wh);
}

describe('Transfer Order → paired ledger movements (Inventory is the source of truth)', () => {
  it('approve reserves, dispatch posts transfer-out, receive posts transfer-in; stock relocates net-zero', async () => {
    const prod = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const productId = prod.record?.id as string;
    // seed 100 on hand at WH-1 via a found adjustment
    const seed = await createIn('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 100, reason: 'found' });
    await act('warehouse-adjustments', seed.record?.id as string, 'post');
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity).currentStock).toBe(100);

    const tr = await createIn('warehouse-transfers', { transferNumber: 'TRN-1', product: 'SKU-1', quantity: 30, fromWarehouse: 'WH-1', toWarehouse: 'WH-2' });
    const trId = tr.record?.id as string;

    rec.authorized.length = 0;
    expect((await act('warehouse-transfers', trId, 'approve')).ok).toBe(true); // reservation
    // defense in depth: the action needs warehouse:manage AND the movement needs inventory:manage
    expect(rec.authorized).toContain('warehouse:manage');
    expect(rec.authorized).toContain('inventory:manage');

    expect((await act('warehouse-transfers', trId, 'dispatch')).ok).toBe(true); // transfer-out + release
    expect((await act('warehouse-transfers', trId, 'receive')).ok).toBe(true); // transfer-in

    // product total on-hand is UNCHANGED (transfer is net-zero); reservation released
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity)).toMatchObject({ currentStock: 100, reservedStock: 0 });

    // exactly two paired transfer movements were posted
    const trMoves = movements.store.list().map(movementFromRecord).filter((m) => m.referenceModule === 'warehouse-transfers' && m.type === 'transfer');
    expect(trMoves).toHaveLength(2);

    // per-location ledger: WH-1 down 30, WH-2 up 30, IN-TRANSIT settled to zero
    expect(cell('SKU-1', 'WH-1')?.onHand).toBe(70);
    expect(cell('SKU-1', 'WH-2')?.onHand).toBe(30);
    expect(cell('SKU-1', 'IN-TRANSIT')?.onHand ?? 0).toBe(0);

    const trRec = await getRec('warehouse-transfers', trId);
    expect(trRec.fields.status).toBe('completed');
    expect(String(trRec.fields.outMovement)).toMatch(/^rec_/);
    expect(String(trRec.fields.inMovement)).toMatch(/^rec_/);
  });

  it('rejects a transfer whose destination equals its source', async () => {
    const res = await createIn('warehouse-transfers', { transferNumber: 'TRN-X', product: 'SKU-1', quantity: 5, fromWarehouse: 'WH-1', toWarehouse: 'WH-1' });
    expect(res.ok).toBe(false);
    expect(res.errors?.toWarehouse).toMatch(/differ/i);
  });
});

describe('Cycle Count → adjustment movement (never overwrites stock)', () => {
  it('a variance posts a signed adjustment movement and reconciles', async () => {
    const prod = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const productId = prod.record?.id as string;
    const seed = await createIn('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 50, reason: 'found' });
    await act('warehouse-adjustments', seed.record?.id as string, 'post');

    const cc = await createIn('warehouse-cycle-counts', { countNumber: 'CC-1', product: 'SKU-1', warehouse: 'WH-1', systemQuantity: 50, countedQuantity: 45 });
    const ccId = cc.record?.id as string;
    expect((await act('warehouse-cycle-counts', ccId, 'reconcile')).ok).toBe(true);

    // variance −5 posted as a real adjustment → product settles to 45
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity).currentStock).toBe(45);
    const ccRec = await getRec('warehouse-cycle-counts', ccId);
    expect(ccRec.fields.status).toBe('reconciled');
    expect(String(ccRec.fields.adjustmentMovement)).toMatch(/^rec_/);
    // reconciling again is idempotent
    const again = await act('warehouse-cycle-counts', ccId, 'reconcile');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been reconciled/i);
  });

  it('a zero-variance count reconciles with no movement', async () => {
    await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget' });
    const cc = await createIn('warehouse-cycle-counts', { countNumber: 'CC-2', product: 'SKU-1', warehouse: 'WH-1', systemQuantity: 20, countedQuantity: 20 });
    const ccId = cc.record?.id as string;
    expect((await act('warehouse-cycle-counts', ccId, 'reconcile')).ok).toBe(true);
    expect(movements.store.list()).toHaveLength(0);
    expect(String((await getRec('warehouse-cycle-counts', ccId)).fields.adjustmentMovement)).toBe('');
  });
});

describe('Stock Adjustment → adjustment movement (reason drives the sign)', () => {
  it('damage stores a negative quantity and posts a signed adjustment', async () => {
    const prod = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget' });
    const productId = prod.record?.id as string;
    const seed = await createIn('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 30, reason: 'found' });
    await act('warehouse-adjustments', seed.record?.id as string, 'post');

    const adj = await createIn('warehouse-adjustments', { adjustmentNumber: 'ADJ-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 12, reason: 'damage' });
    expect(adj.record?.fields.quantity).toBe(-12); // reason normalized the sign
    const adjId = adj.record?.id as string;
    expect((await act('warehouse-adjustments', adjId, 'post')).ok).toBe(true);
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity).currentStock).toBe(18); // 30 − 12
    expect(String((await getRec('warehouse-adjustments', adjId)).fields.adjustmentMovement)).toMatch(/^rec_/);

    const again = await act('warehouse-adjustments', adjId, 'post');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been posted/i);
  });
});

describe('Pick → Pack → Ship (all stages through the ledger)', () => {
  it('reserve holds stock, ship issues it and releases the reservation', async () => {
    const prod = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget' });
    const productId = prod.record?.id as string;
    const seed = await createIn('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 20, reason: 'found' });
    await act('warehouse-adjustments', seed.record?.id as string, 'post');

    const p = await createIn('warehouse-picks', { pickNumber: 'PICK-1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5 });
    const pickId = p.record?.id as string;
    expect((await act('warehouse-picks', pickId, 'reserve')).ok).toBe(true);
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity)).toMatchObject({ currentStock: 20, reservedStock: 5, availableStock: 15 });
    expect((await act('warehouse-picks', pickId, 'pick')).ok).toBe(true);

    expect((await act('warehouse-picks', pickId, 'createPacking')).ok).toBe(true);
    const packRec = (await listOf('warehouse-packing')).find((r) => r.title === 'PACK-PICK-1') as EnterpriseEntity;
    expect((await act('warehouse-packing', packRec.id, 'pack')).ok).toBe(true);
    expect((await act('warehouse-packing', packRec.id, 'createShipment')).ok).toBe(true);

    const shipRec = (await listOf('warehouse-shipping')).find((r) => r.title === 'SHIP-PACK-PICK-1') as EnterpriseEntity;
    expect(shipRec.fields).toMatchObject({ product: 'SKU-1', warehouse: 'WH-1', quantity: 5 });
    expect((await act('warehouse-shipping', shipRec.id, 'ship')).ok).toBe(true);

    // issue removes 5 on hand; the pick's reservation is released
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity)).toMatchObject({ currentStock: 15, reservedStock: 0, availableStock: 15 });
    expect(String((await getRec('warehouse-shipping', shipRec.id)).fields.issueMovement)).toMatch(/^rec_/);
  });
});

describe('RBAC + AI summary surfaces', () => {
  it('reads authorize warehouse:read; writes authorize warehouse:manage', async () => {
    rec.authorized.length = 0;
    await listOf('warehouse-zones');
    expect(rec.authorized).toEqual(['warehouse:read']);
    rec.authorized.length = 0;
    await createIn('warehouse-zones', { name: 'Cold A', warehouse: 'WH-1' });
    expect(rec.authorized).toContain('warehouse:manage');
  });

  it('transfers / cycle counts / adjustments expose aiSummary; masters + pick/pack/ship do not', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{ id: string; aiSummary: boolean }>;
    const ai = (id: string) => summaries.find((s) => s.id === id)?.aiSummary;
    expect(ai('warehouse-transfers')).toBe(true);
    expect(ai('warehouse-cycle-counts')).toBe(true);
    expect(ai('warehouse-adjustments')).toBe(true);
    expect(ai('warehouse-zones')).toBe(false);
    expect(ai('warehouse-bins')).toBe(false);
    expect(ai('warehouse-picks')).toBe(false);
  });
});

// Master-data module (generic CRUD only) — explicit per-module CRUD/validation smoke (certification).
describe('Warehouse bins CRUD smoke (certification)', () => {
  it('create persists a bin; a missing required warehouse is rejected without persisting', async () => {
    const ok = await createIn('warehouse-bins', { code: 'BIN-A1', warehouse: 'WH-1' });
    expect(ok.ok).toBe(true);
    expect(ok.record?.fields).toMatchObject({ code: 'BIN-A1', warehouse: 'WH-1' });
    const bad = await createIn('warehouse-bins', { code: 'BIN-A2' });
    expect(bad.ok).toBe(false);
    expect(bad.errors?.warehouse).toBeDefined();
    expect(await listOf('warehouse-bins')).toHaveLength(1);
  });
});

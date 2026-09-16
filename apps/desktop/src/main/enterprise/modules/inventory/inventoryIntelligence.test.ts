/**
 * S81 — Inventory Aging + ATP intelligence. Focused tests at two layers:
 *   1. the PURE model (deterministic aging/ATP math, bucket boundaries, FIFO, reconciliation);
 *   2. the GOVERNED snapshot modules through the REAL buildModuleHandlers path (RBAC, tenant
 *      isolation, empty state, immutability, and the read-only guarantee that generating a
 *      snapshot never mutates the stock ledger).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  IpcChannel,
  calculateCurrentStock,
  movementFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type StockMovement,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createInventoryAgingModule } from './inventoryAgingModule';
import { createAtpModule } from './atpModule';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from '../../../tenancy/testScope';
import type { TenantScope } from '@neuropause/shared';
import {
  AGING_BUCKET_KEYS,
  assembleAtpInputs,
  bucketForAgeDays,
  deriveAgingSnapshot,
  deriveAtpSnapshot,
  fifoLayersFor,
  incomingFromOpenOrders,
  warehouseOnHand,
  warehouseReserved,
} from './inventoryIntelligenceModel';

const DAY = 24 * 60 * 60 * 1000;

/** Build a StockMovement fixture with a chosen createdAt (age control for the pure tests). */
function mv(p: Partial<StockMovement> & { type: StockMovement['type']; product: string; warehouse: string; quantity: number }, createdAt: string): StockMovement {
  return {
    id: randomUUID(),
    movementNumber: p.movementNumber ?? 'MV',
    type: p.type,
    product: p.product,
    warehouse: p.warehouse,
    fromWarehouse: p.fromWarehouse ?? '',
    quantity: p.quantity,
    unitCost: p.unitCost ?? 0,
    referenceModule: '',
    referenceRecord: '',
    reason: '',
    status: p.status ?? 'posted',
    createdAt,
    updatedAt: createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL
// ─────────────────────────────────────────────────────────────────────────────
describe('S81 pure model — aging buckets', () => {
  it('bucket boundaries are deterministic (30/31, 60/61, 90/91 inclusive)', () => {
    expect(bucketForAgeDays(0)).toBe('days0to30');
    expect(bucketForAgeDays(30)).toBe('days0to30');
    expect(bucketForAgeDays(31)).toBe('days31to60');
    expect(bucketForAgeDays(60)).toBe('days31to60');
    expect(bucketForAgeDays(61)).toBe('days61to90');
    expect(bucketForAgeDays(90)).toBe('days61to90');
    expect(bucketForAgeDays(91)).toBe('days90plus');
    expect(bucketForAgeDays(400)).toBe('days90plus');
    // a future-dated (negative age) movement clamps to the freshest bucket, never invented
    expect(bucketForAgeDays(-5)).toBe('days0to30');
    expect(AGING_BUCKET_KEYS).toHaveLength(4);
  });

  it('ages a single receipt into the correct bucket by as-of', () => {
    const receivedAt = new Date('2026-01-01T00:00:00.000Z').getTime();
    const movements = [mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, new Date(receivedAt).toISOString())];
    const asOf = receivedAt + 95 * DAY; // 95 days old → 90+
    const snap = deriveAgingSnapshot(movements, asOf, '2026-04-06');
    expect(snap.totalOnHand).toBe(100);
    expect(snap.days90plus).toBe(100);
    expect(snap.days0to30).toBe(0);
    expect(snap.over90Count).toBe(1);
    expect(snap.rows[0]).toMatchObject({ sku: 'SKU-1', warehouse: 'WH-1', onHand: 100, oldestAgeDays: 95 });
  });

  it('FIFO consumes the OLDEST layer first — remaining stock is the newest', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, new Date(t0).toISOString()), // old
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 40 }, new Date(t0 + 80 * DAY).toISOString()), // newer
      mv({ type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, new Date(t0 + 85 * DAY).toISOString()), // consumes all 100 old
    ];
    const asOf = t0 + 100 * DAY;
    const snap = deriveAgingSnapshot(movements, asOf, '2026-04-11');
    // 40 remain, all from the NEWER layer (20 days old at as-of) → days0to30
    expect(snap.totalOnHand).toBe(40);
    expect(snap.days0to30).toBe(40);
    expect(snap.days90plus).toBe(0);
  });

  it('a transfer moves aged stock BETWEEN warehouses (age preserved at the source date)', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 50 }, new Date(t0).toISOString()),
      mv({ type: 'transfer', product: 'SKU-1', warehouse: 'WH-2', fromWarehouse: 'WH-1', quantity: 30 }, new Date(t0 + 10 * DAY).toISOString()),
    ];
    const asOf = t0 + 20 * DAY;
    const snap = deriveAgingSnapshot(movements, asOf, '2026-01-21');
    const wh1 = snap.rows.find((r) => r.warehouse === 'WH-1')!;
    const wh2 = snap.rows.find((r) => r.warehouse === 'WH-2')!;
    expect(wh1.onHand).toBe(20); // 50 − 30 transferred out
    expect(wh2.onHand).toBe(30); // arrived at WH-2
    expect(snap.totalOnHand).toBe(50); // net across warehouses conserved
  });

  it('empty ledger → honestly empty snapshot', () => {
    const snap = deriveAgingSnapshot([], Date.now(), '2026-01-01');
    expect(snap).toMatchObject({ totalOnHand: 0, skuWarehouseCount: 0, over90Count: 0, rows: [] });
  });

  it('RECONCILIATION invariant — sum of per-warehouse on-hand == authoritative product total', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, new Date(t0).toISOString()),
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-2', quantity: 60 }, new Date(t0 + DAY).toISOString()),
      mv({ type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 }, new Date(t0 + 2 * DAY).toISOString()),
      mv({ type: 'transfer', product: 'SKU-1', warehouse: 'WH-2', fromWarehouse: 'WH-1', quantity: 20 }, new Date(t0 + 3 * DAY).toISOString()),
    ];
    const snap = deriveAgingSnapshot(movements, t0 + 10 * DAY, '2026-01-11');
    const authoritativeTotal = calculateCurrentStock(movements); // the product master's own definition
    expect(snap.totalOnHand).toBe(authoritativeTotal);
    expect(warehouseOnHand(movements, 'SKU-1', 'WH-1') + warehouseOnHand(movements, 'SKU-1', 'WH-2')).toBe(authoritativeTotal);
  });
});

describe('S81 pure model — ATP', () => {
  const t0 = new Date('2026-01-01T00:00:00.000Z').toISOString();

  it('available = on-hand − reserved; ATP = available + incoming; no double count', () => {
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }, t0),
      mv({ type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 }, t0),
    ];
    const incoming = incomingFromOpenOrders([
      { status: 'approved', product: 'SKU-1', warehouse: 'WH-1', quantity: 50 },
    ]);
    const snap = deriveAtpSnapshot(assembleAtpInputs(movements, incoming), '2026-01-01');
    const row = snap.rows.find((r) => r.sku === 'SKU-1' && r.warehouse === 'WH-1')!;
    expect(row).toMatchObject({ onHand: 100, reserved: 30, available: 70, incoming: 50, atp: 120 });
    expect(warehouseReserved(movements, 'SKU-1', 'WH-1')).toBe(30);
  });

  it('open-PO statuses: approved/sent are incoming; draft/received/cancelled are NOT (no double count)', () => {
    const incoming = incomingFromOpenOrders([
      { status: 'approved', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 },
      { status: 'sent', product: 'SKU-1', warehouse: 'WH-1', quantity: 5 },
      { status: 'draft', product: 'SKU-1', warehouse: 'WH-1', quantity: 999 },
      { status: 'received', product: 'SKU-1', warehouse: 'WH-1', quantity: 999 },
      { status: 'cancelled', product: 'SKU-1', warehouse: 'WH-1', quantity: 999 },
    ]);
    expect(incoming).toEqual([{ sku: 'SKU-1', warehouse: 'WH-1', quantity: 15 }]);
  });

  it('multi-line PO uses its lines; cross-warehouse ATP stays separate', () => {
    const incoming = incomingFromOpenOrders([
      { status: 'sent', product: 'IGNORED', warehouse: 'WH-2', quantity: 1, linesRaw: JSON.stringify([{ sku: 'SKU-1', quantity: 8, unitPrice: 1 }, { sku: 'SKU-2', quantity: 3, unitPrice: 1 }]) },
    ]);
    const movements = [mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 }, t0)];
    const snap = deriveAtpSnapshot(assembleAtpInputs(movements, incoming), '2026-01-01');
    // WH-1 has 10 on-hand, no incoming; WH-2 has SKU-1(8)+SKU-2(3) incoming, no on-hand
    expect(snap.rows.find((r) => r.sku === 'SKU-1' && r.warehouse === 'WH-1')!.atp).toBe(10);
    expect(snap.rows.find((r) => r.sku === 'SKU-1' && r.warehouse === 'WH-2')!.atp).toBe(8);
    expect(snap.rows.find((r) => r.sku === 'SKU-2' && r.warehouse === 'WH-2')!.atp).toBe(3);
  });

  it('shortfall: reserved exceeds available at a location', () => {
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 20 }, t0),
      mv({ type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 20 }, t0),
    ];
    // reserve 20 of 20 → available 0; a *further* reservation cannot exceed stock in reality,
    // but the signal we test is reserved > available, so add incoming to make it promisable.
    const incoming = incomingFromOpenOrders([{ status: 'sent', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }]);
    const snap = deriveAtpSnapshot(assembleAtpInputs(movements, incoming), '2026-01-01');
    const row = snap.rows[0]!;
    expect(row).toMatchObject({ onHand: 20, reserved: 20, available: 0, incoming: 100, atp: 100 });
    // reserved (20) exceeds available (0): a genuine shortfall — promising leans on incoming.
    expect(snap.shortfallCount).toBe(1);
  });

  it('fifoLayersFor returns nothing when net on-hand is zero', () => {
    const movements = [
      mv({ type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 }, t0),
      mv({ type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 }, t0),
    ];
    expect(fifoLayersFor(movements, 'SKU-1', 'WH-1')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED SNAPSHOT MODULES (through buildModuleHandlers — RBAC + tenancy + immutability)
// ─────────────────────────────────────────────────────────────────────────────
describe('S81 governed snapshot modules', () => {
  const T0 = '2026-01-01T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let movements: ReturnType<typeof createStockMovementModule>;
  let scope: TenantScope;

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s81-${tag}-${randomUUID()}.json`);
    paths.push(p);
    return p;
  }
  function spyCtx() {
    return {
      authorize: (p: EnterprisePermission) => rec.authorized.push(p),
      audit: () => undefined,
      publish: (i: PlatformEventInput) => rec.publish.push(i),
      broadcast: () => undefined,
      notify: () => undefined,
      actor: () => 'tester@np.dev',
      now: () => T0,
    };
  }

  beforeEach(() => {
    rec = { authorized: [], publish: [] };
    const products = createProductModule(tmp('prod'));
    movements = createStockMovementModule(tmp('mv'));
    const pos = createPurchaseOrderModule(tmp('po'));
    const aging = createInventoryAgingModule(tmp('aging'), movements.store);
    const atp = createAtpModule(tmp('atp'), movements.store, pos.store);
    registry = new EnterpriseModuleRegistry();
    for (const m of [products, movements, pos, aging, atp]) registry.register(m);
    scope = TEST_TENANT_SCOPE;
    registry.bindScope(() => scope); // one binding across all stores; switch `scope` to change tenant
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
  async function create(moduleId: string, fields: Record<string, unknown>) {
    return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as {
      ok: boolean;
      record?: EnterpriseEntity;
      errors?: Record<string, string>;
    };
  }
  async function list(moduleId: string) {
    return (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];
  }

  it('RBAC — generating a snapshot authorizes inventory:manage; listing authorizes inventory:read', async () => {
    await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    rec.authorized.length = 0;
    await create('inventory-aging', { asOfDate: '2026-06-01' });
    expect(rec.authorized).toContain('inventory:manage');
    rec.authorized.length = 0;
    await list('inventory-aging');
    expect(rec.authorized).toEqual(['inventory:read']);
  });

  it('empty inventory → an honest empty snapshot (not fabricated)', async () => {
    const res = await create('inventory-aging', { asOfDate: '2026-06-01' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.totalOnHand)).toBe(0);
    expect(Number(res.record?.fields.skuWarehouseCount)).toBe(0);
    expect(String(res.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('aging snapshot buckets on-hand by as-of, and does NOT mutate the ledger', async () => {
    await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const ledgerBefore = JSON.stringify(movements.store.list().map(movementFromRecord));
    // movements created "at" T0; as-of 200 days later → 90+
    const res = await create('inventory-aging', { asOfDate: '2026-07-20' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.totalOnHand)).toBe(100);
    expect(Number(res.record?.fields.days90plus)).toBe(100);
    expect(Number(res.record?.fields.over90Count)).toBe(1);
    // READ-ONLY: the authoritative ledger is byte-identical after the snapshot
    expect(JSON.stringify(movements.store.list().map(movementFromRecord))).toBe(ledgerBefore);
  });

  it('ATP snapshot derives on-hand/reserved/available/incoming/ATP through the governed path', async () => {
    await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    await create('inventory-movements', { movementNumber: 'MV-2', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    await create('procurement-orders', { poNumber: 'PO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 50, status: 'approved' });
    const res = await create('inventory-atp', { asOfDate: '2026-06-01' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.totalOnHand)).toBe(100);
    expect(Number(res.record?.fields.totalReserved)).toBe(30);
    expect(Number(res.record?.fields.totalAvailable)).toBe(70);
    expect(Number(res.record?.fields.totalIncoming)).toBe(50);
    expect(Number(res.record?.fields.totalAtp)).toBe(120);
  });

  it('a draft PO is NOT counted as incoming (merely-created ≠ available)', async () => {
    await create('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 });
    await create('procurement-orders', { poNumber: 'PO-DRAFT', product: 'SKU-1', warehouse: 'WH-1', quantity: 999, status: 'draft' });
    const res = await create('inventory-atp', { asOfDate: '2026-06-01' });
    expect(Number(res.record?.fields.totalIncoming)).toBe(0);
    expect(Number(res.record?.fields.totalAtp)).toBe(10);
  });

  it('snapshots are immutable — a generated report cannot be regenerated in place', async () => {
    const res = await create('inventory-aging', { asOfDate: '2026-06-01' });
    const update = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'inventory-aging',
      id: res.record?.id,
      fields: { totalOnHand: 9999 },
    })) as { ok: boolean; errors?: Record<string, string> };
    expect(update.ok).toBe(false);
  });

  it('TENANT ISOLATION — a snapshot sees only the acting tenant’s ledger', async () => {
    // Tenant A: 100 on hand → aging sees 100.
    scope = TEST_TENANT_SCOPE;
    await create('inventory-movements', { movementNumber: 'MV-A', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const aSnap = await create('inventory-aging', { asOfDate: '2026-06-01' });
    expect(Number(aSnap.record?.fields.totalOnHand)).toBe(100);

    // Tenant B: the SAME injected stores scope to B, which has no movements, so B's snapshot
    // is empty and B cannot see A's report — the isolation is in the store, not a filter.
    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create('inventory-aging', { asOfDate: '2026-06-01' });
    expect(Number(bSnap.record?.fields.totalOnHand)).toBe(0);
    const bReports = await list('inventory-aging');
    expect(bReports.every((r) => r.id !== aSnap.record?.id)).toBe(true);

    // Back in A: A still sees its own report, not any of B's.
    scope = TEST_TENANT_SCOPE;
    const aReports = await list('inventory-aging');
    expect(aReports.some((r) => r.id === aSnap.record?.id)).toBe(true);
  });
});

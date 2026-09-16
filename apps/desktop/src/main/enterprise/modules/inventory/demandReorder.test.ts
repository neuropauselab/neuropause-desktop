/**
 * S85 — Demand→Reorder / Safety-Stock RECOMMENDATION Intelligence. Two layers:
 *   1. the PURE model (assessReorder consumption, safety-stock/ATP/incoming/demand consumption,
 *      attention state, recommended quantity ONLY from the engine, insufficient-data, empty,
 *      determinism);
 *   2. the GOVERNED snapshot module through the REAL buildModuleHandlers path — RBAC, tenant
 *      isolation, immutability, deterministic regeneration, source read-only, NO_TENANT
 *      fail-closed, and the CRITICAL negatives: generating a recommendation drafts NO purchase
 *      request, creates NO PO, mutates NO product/inventory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  IpcChannel,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type Product,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from './productModule';
import { createPurchaseRequestModule } from '../procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createShippingModule } from '../warehouse/shippingModule';
import { createReorderRecommendationModule } from './demandReorderModule';
import { deriveReorderRecommendations } from './demandReorderModel';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from '../../../tenancy/testScope';

const product = (o: Partial<Product> & { sku: string }): Product => ({
  id: o.id ?? o.sku,
  sku: o.sku,
  name: o.name ?? o.sku,
  category: o.category ?? '',
  unit: o.unit ?? 'unit',
  purchaseCost: o.purchaseCost ?? 0,
  standardCost: o.standardCost ?? 0,
  sellingPrice: o.sellingPrice ?? 0,
  reorderLevel: o.reorderLevel ?? 0,
  safetyStock: o.safetyStock ?? 0,
  maximumStock: o.maximumStock ?? 0,
  currentStock: o.currentStock ?? 0,
  reservedStock: o.reservedStock ?? 0,
  availableStock: o.availableStock ?? 0,
  status: o.status ?? 'active',
  autoReorder: o.autoReorder ?? 'off',
  createdAt: o.createdAt ?? '2026-07-01T00:00:00.000Z',
  updatedAt: o.updatedAt ?? '2026-07-01T00:00:00.000Z',
} as Product);

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL
// ─────────────────────────────────────────────────────────────────────────────
describe('S85 pure model — reorder recommendation (reuses assessReorder)', () => {
  it('triggers reorder below level with the engine’s suggested quantity; demand is context only', () => {
    const snap = deriveReorderRecommendations({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 20, safetyStock: 10, maximumStock: 50 })],
      purchaseRequests: [],
      purchaseOrders: [],
      shipments: [],
    }, '2026-07-31');
    const row = snap.rows[0]!;
    expect(row.attention).toBe('reorder');
    expect(row.recommendedQuantity).toBeGreaterThan(0); // from assessReorder.suggestedQuantity (targetLevel − position)
    expect(row).toMatchObject({ availableStock: 5, reorderLevel: 20, openSupply: 0, position: 5 });
    expect(row.demandDirection).toBe('insufficient-data'); // no shipments — context only, did not force the trigger
    expect(snap).toMatchObject({ skuCount: 1, reorderCount: 1, okCount: 0 });
  });

  it('open supply (incoming PRs/POs) lifts position above reorder level → OK, no quantity', () => {
    const snap = deriveReorderRecommendations({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 20 })],
      purchaseRequests: [{ id: 'pr1', status: 'active', fields: { product: 'SKU-1', quantity: 100, status: 'pending' } } as unknown as EnterpriseEntity],
      purchaseOrders: [],
      shipments: [],
    }, '2026-07-31');
    const row = snap.rows[0]!;
    expect(row.openSupply).toBe(100);
    expect(row).toMatchObject({ position: 105, attention: 'ok', recommendedQuantity: 0 });
  });

  it('a product with no reorder level does not trigger (no invented policy)', () => {
    const snap = deriveReorderRecommendations({
      products: [product({ sku: 'SKU-1', availableStock: 0, reorderLevel: 0 })],
      purchaseRequests: [], purchaseOrders: [], shipments: [],
    }, '2026-07-31');
    expect(snap.rows[0]).toMatchObject({ attention: 'ok', recommendedQuantity: 0 });
  });

  it('inactive products are excluded; empty in → empty out', () => {
    const snap = deriveReorderRecommendations({
      products: [product({ sku: 'X', status: 'inactive', reorderLevel: 10 })],
      purchaseRequests: [], purchaseOrders: [], shipments: [],
    }, '2026-07-31');
    expect(snap).toMatchObject({ skuCount: 0, rows: [] });
    expect(deriveReorderRecommendations({ products: [], purchaseRequests: [], purchaseOrders: [], shipments: [] }, '2026-07-31').skuCount).toBe(0);
  });

  it('demand direction is attached from S84 shipments as context (does not change attention)', () => {
    const shipments = [
      { id: 's1', shipmentNumber: 'S1', pickList: '', salesOrder: '', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, carrier: '', trackingNumber: '', issueMovement: '', shippedDate: '2026-05-01', status: 'shipped' as const, createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 's2', shipmentNumber: 'S2', pickList: '', salesOrder: '', product: 'SKU-1', warehouse: 'WH-1', quantity: 40, carrier: '', trackingNumber: '', issueMovement: '', shippedDate: '2026-06-01', status: 'shipped' as const, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const snap = deriveReorderRecommendations({
      products: [product({ sku: 'SKU-1', availableStock: 100, reorderLevel: 20 })], // well-stocked → ok
      purchaseRequests: [], purchaseOrders: [], shipments,
    }, '2026-06-30');
    expect(snap.rows[0]).toMatchObject({ attention: 'ok', demandDirection: 'up', demandLatestPeriod: '2026-06', demandLatestDemand: 40 });
  });

  it('deterministic ordering + regeneration is byte-identical', () => {
    const products = [product({ sku: 'Z', reorderLevel: 5 }), product({ sku: 'A', reorderLevel: 5 })];
    const a = JSON.stringify(deriveReorderRecommendations({ products, purchaseRequests: [], purchaseOrders: [], shipments: [] }, '2026-07-31').rows);
    const b = JSON.stringify(deriveReorderRecommendations({ products: [...products].reverse(), purchaseRequests: [], purchaseOrders: [], shipments: [] }, '2026-07-31').rows);
    expect(a).toBe(b);
    expect(JSON.parse(a).map((r: { sku: string }) => r.sku)).toEqual(['A', 'Z']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED SNAPSHOT MODULE + the CRITICAL no-execution negatives
// ─────────────────────────────────────────────────────────────────────────────
describe('S85 governed reorder-recommendation snapshot', () => {
  const T0 = '2026-07-01T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let prStore: { list: () => EnterpriseEntity[] };
  let poStore: { list: () => EnterpriseEntity[] };
  let productStore: { list: () => EnterpriseEntity[] };
  let scope: TenantScope;

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s85-${tag}-${randomUUID()}.json`);
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
    const pr = createPurchaseRequestModule(tmp('pr'));
    const po = createPurchaseOrderModule(tmp('po'));
    const shipping = createShippingModule(tmp('ship'));
    const reorder = createReorderRecommendationModule(tmp('reorder'), products.store, pr.store, po.store, shipping.store);
    productStore = products.store as unknown as typeof productStore;
    prStore = pr.store as unknown as typeof prStore;
    poStore = po.store as unknown as typeof poStore;
    registry = new EnterpriseModuleRegistry();
    for (const m of [products, pr, po, shipping, reorder]) registry.register(m);
    scope = TEST_TENANT_SCOPE;
    registry.bindScope(() => scope);
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
  const create = async (moduleId: string, fields: Record<string, unknown>) =>
    (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity };
  const list = async (moduleId: string) => (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];

  it('RBAC — generating authorizes inventory:manage; listing authorizes inventory:read', async () => {
    rec.authorized.length = 0;
    await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    expect(rec.authorized).toContain('inventory:manage');
    rec.authorized.length = 0;
    await list('inventory-reorder-recommendation');
    expect(rec.authorized).toEqual(['inventory:read']);
  });

  it('recommends reorder for a below-level product (freshly created → availableStock 0)', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
    const res = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    const row = (JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ sku: 'SKU-1', attention: 'reorder', reorderLevel: 20 });
    expect(Number(row.recommendedQuantity)).toBeGreaterThan(0);
    expect(Number(res.record?.fields.reorderCount)).toBe(1);
  });

  it('CRITICAL — generating a recommendation drafts NO purchase request and creates NO PO', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, safetyStock: 10 });
    expect((await list('procurement-requests')).length).toBe(0);
    const prBefore = JSON.stringify(prStore.list());
    const poBefore = JSON.stringify(poStore.list());
    const productBefore = JSON.stringify(productStore.list());
    await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    await create('inventory-reorder-recommendation', { asOfDate: '2026-08-31' });
    // NO purchase request drafted, NO PO created, product store untouched (no inventory mutation)
    expect((await list('procurement-requests')).length).toBe(0);
    expect((await list('procurement-orders')).length).toBe(0);
    expect(JSON.stringify(prStore.list())).toBe(prBefore);
    expect(JSON.stringify(poStore.list())).toBe(poBefore);
    expect(JSON.stringify(productStore.list())).toBe(productBefore);
  });

  it('empty (no active products) → an honest empty snapshot', async () => {
    const res = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.skuCount)).toBe(0);
    expect(String(res.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('deterministic regeneration — same state + same as-of ⇒ byte-identical rows', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20 });
    const a = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    const b = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    expect(String(b.record?.fields.rows)).toBe(String(a.record?.fields.rows));
  });

  it('snapshots are immutable — a generated report cannot be regenerated in place', async () => {
    const res = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    const upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'inventory-reorder-recommendation', id: res.record?.id, fields: { reorderCount: 9999 } })) as { ok: boolean };
    expect(upd.ok).toBe(false);
  });

  it('NO_TENANT fail-closed — generation denies when no scope is bound', async () => {
    scope = null as unknown as TenantScope;
    const res = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' }).catch(() => ({ ok: false }));
    expect(res.ok).toBe(false);
  });

  it('TENANT ISOLATION — a snapshot sees only the acting tenant’s products', async () => {
    scope = TEST_TENANT_SCOPE;
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20 });
    const aSnap = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    expect(Number(aSnap.record?.fields.skuCount)).toBe(1);

    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    expect(Number(bSnap.record?.fields.skuCount)).toBe(0);
    expect((await list('inventory-reorder-recommendation')).every((r) => r.id !== aSnap.record?.id)).toBe(true);

    scope = TEST_TENANT_SCOPE;
    expect((await list('inventory-reorder-recommendation')).some((r) => r.id === aSnap.record?.id)).toBe(true);
  });
});

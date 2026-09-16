/**
 * S84 — Demand-Trend Intelligence. Two layers:
 *   1. the PURE model (aggregation, period boundaries, status inclusion/exclusion, threshold-free
 *      direction, insufficient-data, zero/empty, deterministic ordering);
 *   2. the GOVERNED snapshot module through the REAL buildModuleHandlers path over a REAL shipping
 *      store — RBAC, tenant isolation, immutability, deterministic regeneration, source read-only,
 *      NO_TENANT fail-closed. Demand semantics reuse the planning definition (shipped/delivered).
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
  type Shipping,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createShippingModule } from '../warehouse/shippingModule';
import { createDemandTrendModule } from './demandTrendModule';
import { deriveDemandTrendSnapshot } from './demandTrendModel';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from '../../../tenancy/testScope';

const ship = (o: Partial<Shipping> & { product: string; quantity: number; status: Shipping['status']; shippedDate: string }): Shipping => ({
  id: randomUUID(),
  shipmentNumber: o.shipmentNumber ?? 'SHIP',
  pickList: o.pickList ?? '',
  salesOrder: o.salesOrder ?? '',
  product: o.product,
  warehouse: o.warehouse ?? 'WH-1',
  quantity: o.quantity,
  carrier: o.carrier ?? '',
  trackingNumber: o.trackingNumber ?? '',
  issueMovement: o.issueMovement ?? '',
  shippedDate: o.shippedDate,
  status: o.status,
  createdAt: o.createdAt ?? `${o.shippedDate}T00:00:00.000Z`,
  updatedAt: o.updatedAt ?? `${o.shippedDate}T00:00:00.000Z`,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL
// ─────────────────────────────────────────────────────────────────────────────
describe('S84 pure model — demand aggregation + direction', () => {
  it('aggregates shipped+delivered by month per SKU; excludes pending/cancelled', () => {
    const snap = deriveDemandTrendSnapshot([
      ship({ product: 'SKU-1', quantity: 10, status: 'shipped', shippedDate: '2026-06-05' }),
      ship({ product: 'SKU-1', quantity: 5, status: 'delivered', shippedDate: '2026-06-20' }), // same month → +15
      ship({ product: 'SKU-1', quantity: 30, status: 'shipped', shippedDate: '2026-07-10' }),
      ship({ product: 'SKU-1', quantity: 999, status: 'pending', shippedDate: '2026-07-11' }), // excluded
      ship({ product: 'SKU-1', quantity: 999, status: 'cancelled', shippedDate: '2026-07-12' }), // excluded
    ], '2026-07-31');
    const row = snap.rows[0]!;
    expect(row.sku).toBe('SKU-1');
    expect(row.periods).toEqual([{ periodKey: '2026-06', demand: 15 }, { periodKey: '2026-07', demand: 30 }]);
    expect(row.totalDemand).toBe(45);
    expect(row).toMatchObject({ latestPeriod: '2026-07', latestDemand: 30, priorAverage: 15, delta: 15, deltaPercent: 100, direction: 'up' });
    expect(snap).toMatchObject({ skuCount: 1, totalDemand: 45, upCount: 1 });
  });

  it('direction: down when latest < prior average, flat when equal', () => {
    const down = deriveDemandTrendSnapshot([
      ship({ product: 'A', quantity: 100, status: 'shipped', shippedDate: '2026-05-01' }),
      ship({ product: 'A', quantity: 40, status: 'shipped', shippedDate: '2026-06-01' }),
    ], '2026-06-30').rows[0]!;
    expect(down).toMatchObject({ latestDemand: 40, priorAverage: 100, delta: -60, direction: 'down' });
    const flat = deriveDemandTrendSnapshot([
      ship({ product: 'B', quantity: 50, status: 'shipped', shippedDate: '2026-05-01' }),
      ship({ product: 'B', quantity: 50, status: 'shipped', shippedDate: '2026-06-01' }),
    ], '2026-06-30').rows[0]!;
    expect(flat).toMatchObject({ latestDemand: 50, priorAverage: 50, delta: 0, direction: 'flat', deltaPercent: 0 });
  });

  it('insufficient-data with a single period; zero-budget-style deltaPercent stays 0', () => {
    const snap = deriveDemandTrendSnapshot([
      ship({ product: 'C', quantity: 20, status: 'shipped', shippedDate: '2026-06-01' }),
    ], '2026-06-30');
    expect(snap.rows[0]).toMatchObject({ periodsCovered: 1, direction: 'insufficient-data', priorAverage: 0, deltaPercent: 0 });
    expect(snap.insufficientCount).toBe(1);
  });

  it('empty in → honestly empty out; a shipment with no valid month is not a data point', () => {
    expect(deriveDemandTrendSnapshot([], '2026-06-30')).toMatchObject({ skuCount: 0, totalDemand: 0, rows: [] });
    const noDate = deriveDemandTrendSnapshot([{ ...ship({ product: 'D', quantity: 9, status: 'shipped', shippedDate: '' }), createdAt: '' }], '2026-06-30');
    expect(noDate.skuCount).toBe(0);
  });

  it('falls back to createdAt month when shippedDate is empty', () => {
    const s = ship({ product: 'E', quantity: 7, status: 'delivered', shippedDate: '' });
    s.createdAt = '2026-04-09T00:00:00.000Z';
    const snap = deriveDemandTrendSnapshot([s], '2026-04-30');
    expect(snap.rows[0]!.periods).toEqual([{ periodKey: '2026-04', demand: 7 }]);
  });

  it('deterministic ordering + regeneration is byte-identical', () => {
    const set = [
      ship({ product: 'Z', quantity: 1, status: 'shipped', shippedDate: '2026-06-01' }),
      ship({ product: 'A', quantity: 2, status: 'shipped', shippedDate: '2026-05-01' }),
      ship({ product: 'A', quantity: 3, status: 'shipped', shippedDate: '2026-06-01' }),
    ];
    const a = JSON.stringify(deriveDemandTrendSnapshot(set, '2026-06-30').rows);
    const b = JSON.stringify(deriveDemandTrendSnapshot([...set].reverse(), '2026-06-30').rows);
    expect(a).toBe(b);
    expect(deriveDemandTrendSnapshot(set, '2026-06-30').rows.map((r) => r.sku)).toEqual(['A', 'Z']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED SNAPSHOT MODULE
// ─────────────────────────────────────────────────────────────────────────────
describe('S84 governed demand-trend snapshot', () => {
  const T0 = '2026-07-01T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let shippingStore: { list: () => EnterpriseEntity[]; create: (r: { title: string; fields: Record<string, unknown>; actor: string; now: string }) => EnterpriseEntity };
  let scope: TenantScope;

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s84-${tag}-${randomUUID()}.json`);
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
    const shipping = createShippingModule(tmp('ship'));
    const demand = createDemandTrendModule(tmp('demand'), shipping.store);
    shippingStore = shipping.store as unknown as typeof shippingStore;
    registry = new EnterpriseModuleRegistry();
    for (const m of [shipping, demand]) registry.register(m);
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

  /** Seed shipped demand directly into the source shipping store (fixture data). */
  function seedShipment(product: string, quantity: number, shippedDate: string, status: Shipping['status'] = 'shipped') {
    shippingStore.create({
      title: `SHIP-${product}-${shippedDate}`,
      fields: { shipmentNumber: `SHIP-${product}-${shippedDate}`, product, warehouse: 'WH-1', quantity, status, shippedDate },
      actor: 'tester@np.dev',
      now: T0,
    });
  }

  it('RBAC — generating authorizes operations:manage; listing authorizes operations:read', async () => {
    rec.authorized.length = 0;
    await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    expect(rec.authorized).toContain('operations:manage');
    rec.authorized.length = 0;
    await list('sales-demand-trend');
    expect(rec.authorized).toEqual(['operations:read']);
  });

  it('empty (no shipments) → an honest empty snapshot', async () => {
    const res = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.skuCount)).toBe(0);
    expect(String(res.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('generates a demand-trend register from the shipping store (multi-period direction up)', async () => {
    seedShipment('SKU-1', 20, '2026-06-05');
    seedShipment('SKU-1', 50, '2026-07-05');
    const res = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    const row = (JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ sku: 'SKU-1', latestPeriod: '2026-07', latestDemand: 50, priorAverage: 20, direction: 'up' });
    expect(Number(res.record?.fields.totalDemand)).toBe(70);
    expect(Number(res.record?.fields.upCount)).toBe(1);
  });

  it('deterministic regeneration — same shipments + same as-of ⇒ byte-identical rows', async () => {
    seedShipment('SKU-1', 20, '2026-06-05');
    seedShipment('SKU-1', 50, '2026-07-05');
    const a = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    const b = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    expect(String(b.record?.fields.rows)).toBe(String(a.record?.fields.rows));
  });

  it('snapshots are immutable — a generated report cannot be regenerated in place', async () => {
    const res = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    const upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'sales-demand-trend', id: res.record?.id, fields: { totalDemand: 9999 } })) as { ok: boolean };
    expect(upd.ok).toBe(false);
  });

  it('READ-ONLY — the shipping source store is byte-identical after generation', async () => {
    seedShipment('SKU-1', 20, '2026-06-05');
    seedShipment('SKU-1', 50, '2026-07-05');
    const before = JSON.stringify(shippingStore.list());
    await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    await create('sales-demand-trend', { asOfDate: '2026-08-31' });
    expect(JSON.stringify(shippingStore.list())).toBe(before);
  });

  it('NO_TENANT fail-closed — generation denies when no scope is bound', async () => {
    scope = null as unknown as TenantScope;
    const res = await create('sales-demand-trend', { asOfDate: '2026-07-31' }).catch(() => ({ ok: false }));
    expect(res.ok).toBe(false);
  });

  it('TENANT ISOLATION — a snapshot sees only the acting tenant’s shipments', async () => {
    scope = TEST_TENANT_SCOPE;
    seedShipment('SKU-1', 20, '2026-06-05');
    seedShipment('SKU-1', 50, '2026-07-05');
    const aSnap = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    expect(Number(aSnap.record?.fields.skuCount)).toBe(1);

    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create('sales-demand-trend', { asOfDate: '2026-07-31' });
    expect(Number(bSnap.record?.fields.skuCount)).toBe(0);
    expect((await list('sales-demand-trend')).every((r) => r.id !== aSnap.record?.id)).toBe(true);

    scope = TEST_TENANT_SCOPE;
    expect((await list('sales-demand-trend')).some((r) => r.id === aSnap.record?.id)).toBe(true);
  });
});

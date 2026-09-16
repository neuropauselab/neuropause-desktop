/**
 * S86 — Governed Reorder DECISION-READINESS Intelligence. Two layers:
 *   1. the PURE model (reuses S85 recommendation + the EXISTING spend policy; derives estimated
 *      order value, required approval steps, blockers, a source-driven readiness status, and a
 *      fail-closed execution-readiness flag — inventing no policy; supplier/cost gaps surfaced as
 *      blockers, not guessed);
 *   2. the GOVERNED snapshot module through the REAL buildModuleHandlers path — RBAC, tenant
 *      isolation, immutability, deterministic regeneration, source read-only, NO_TENANT
 *      fail-closed, and the CRITICAL negatives: generating a decision report drafts NO purchase
 *      request, creates NO PO, mutates NO product/inventory, and NEVER executes (execution stays
 *      blocked on every row).
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
import { createReorderDecisionModule } from './reorderDecisionModule';
import { deriveReorderDecisionReadiness, EXECUTION_READINESS } from './reorderDecisionModel';
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

const empty = { purchaseRequests: [], purchaseOrders: [], shipments: [] } as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE MODEL
// ─────────────────────────────────────────────────────────────────────────────
describe('S86 pure model — reorder decision readiness (reuses S85 + the existing spend policy)', () => {
  it('a triggered SKU with a purchase cost is READY_FOR_OPERATOR_REVIEW with a valued order + manager approval', () => {
    // availableStock 5, reorderLevel 200, safety 50, max 500 → target 500, position 5 → suggested 495
    const snap = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 200, safetyStock: 50, maximumStock: 500, purchaseCost: 4 })],
      ...empty,
    }, '2026-07-31');
    const row = snap.rows[0]!;
    expect(row.readinessStatus).toBe('READY_FOR_OPERATOR_REVIEW');
    expect(row.suggestedQuantity).toBe(495);
    expect(row.unitCost).toBe(4);
    expect(row.estimatedOrderValue).toBe(1980); // 495 × 4, from assessReorder qty × canonical purchaseCost — never invented
    // 1980 < 10000 → only the always-on manager step applies (from DEFAULT_SPEND_POLICY, not invented)
    expect(row.requiredApprovalSteps).toEqual(['Manager approval']);
    expect(snap).toMatchObject({ skuCount: 1, reorderRequiredCount: 1, readyForReviewCount: 1, supplierDataMissingCount: 0, notRequiredCount: 0 });
  });

  it('order value crossing policy thresholds pulls in finance / executive steps (from the existing policy)', () => {
    // suggested 495 × 25 = 12375 → manager + finance (≥10000)
    const mid = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 200, maximumStock: 500, purchaseCost: 25 })],
      ...empty,
    }, '2026-07-31').rows[0]!;
    expect(mid.estimatedOrderValue).toBe(12375);
    expect(mid.requiredApprovalSteps).toEqual(['Manager approval', 'Finance approval']);
    // suggested 495 × 250 = 123750 → manager + finance + executive (≥100000)
    const high = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-2', availableStock: 5, reorderLevel: 200, maximumStock: 500, purchaseCost: 250 })],
      ...empty,
    }, '2026-07-31').rows[0]!;
    expect(high.requiredApprovalSteps).toEqual(['Manager approval', 'Finance approval', 'Executive approval']);
  });

  it('a triggered SKU with NO purchase cost is SUPPLIER_DATA_MISSING — order value undeterminable, not guessed', () => {
    const row = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 200, maximumStock: 500, purchaseCost: 0 })],
      ...empty,
    }, '2026-07-31').rows[0]!;
    expect(row.readinessStatus).toBe('SUPPLIER_DATA_MISSING');
    expect(row.estimatedOrderValue).toBeNull();
    expect(row.requiredApprovalSteps).toEqual([]);
    expect(row.blockers.some((b) => /purchase cost/i.test(b))).toBe(true);
  });

  it('every triggered row carries the missing-supplier + undefined-execution blockers (never invented)', () => {
    const row = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 200, maximumStock: 500, purchaseCost: 4 })],
      ...empty,
    }, '2026-07-31').rows[0]!;
    expect(row.blockers.some((b) => /preferred supplier/i.test(b))).toBe(true);
    expect(row.blockers.some((b) => /policy-undefined/i.test(b))).toBe(true);
  });

  it('a well-stocked SKU is REORDER_NOT_REQUIRED with no blockers and no approval steps', () => {
    const row = deriveReorderDecisionReadiness({
      products: [product({ sku: 'SKU-1', availableStock: 400, reorderLevel: 200, purchaseCost: 4 })],
      ...empty,
    }, '2026-07-31').rows[0]!;
    expect(row.readinessStatus).toBe('REORDER_NOT_REQUIRED');
    expect(row.estimatedOrderValue).toBeNull();
    expect(row.requiredApprovalSteps).toEqual([]);
    expect(row.blockers).toEqual([]);
  });

  it('execution readiness is fail-closed on EVERY row, and the snapshot marks execution blocked', () => {
    const snap = deriveReorderDecisionReadiness({
      products: [
        product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 200, maximumStock: 500, purchaseCost: 4 }),
        product({ sku: 'SKU-2', availableStock: 400, reorderLevel: 200, purchaseCost: 4 }),
      ],
      ...empty,
    }, '2026-07-31');
    expect(snap.executionBlocked).toBe(true);
    expect(snap.rows.every((r) => r.executionReadiness === EXECUTION_READINESS)).toBe(true);
    expect(EXECUTION_READINESS).toBe('BLOCKED_UNDEFINED_POLICY');
  });

  it('inactive products excluded; empty in → empty out; deterministic ordering + byte-identical regeneration', () => {
    expect(deriveReorderDecisionReadiness({ products: [product({ sku: 'X', status: 'inactive', reorderLevel: 10 })], ...empty }, '2026-07-31')).toMatchObject({ skuCount: 0, rows: [] });
    expect(deriveReorderDecisionReadiness({ products: [], ...empty }, '2026-07-31').skuCount).toBe(0);
    const products = [product({ sku: 'Z', availableStock: 1, reorderLevel: 5, purchaseCost: 2 }), product({ sku: 'A', availableStock: 1, reorderLevel: 5, purchaseCost: 2 })];
    const a = JSON.stringify(deriveReorderDecisionReadiness({ products, ...empty }, '2026-07-31').rows);
    const b = JSON.stringify(deriveReorderDecisionReadiness({ products: [...products].reverse(), ...empty }, '2026-07-31').rows);
    expect(a).toBe(b);
    expect(JSON.parse(a).map((r: { sku: string }) => r.sku)).toEqual(['A', 'Z']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED SNAPSHOT MODULE + the CRITICAL no-execution negatives
// ─────────────────────────────────────────────────────────────────────────────
describe('S86 governed reorder-decision snapshot', () => {
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
    const p = join(tmpdir(), `np-s86-${tag}-${randomUUID()}.json`);
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
    const decision = createReorderDecisionModule(tmp('decision'), products.store, pr.store, po.store, shipping.store);
    productStore = products.store as unknown as typeof productStore;
    prStore = pr.store as unknown as typeof prStore;
    poStore = po.store as unknown as typeof poStore;
    registry = new EnterpriseModuleRegistry();
    for (const m of [products, pr, po, shipping, decision]) registry.register(m);
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
    await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect(rec.authorized).toContain('inventory:manage');
    rec.authorized.length = 0;
    await list('inventory-reorder-decision');
    expect(rec.authorized).toEqual(['inventory:read']);
  });

  it('produces a decision-readiness row for a below-level product with a purchase cost', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, safetyStock: 10, maximumStock: 50, purchaseCost: 4 });
    const res = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    const row = (JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>)[0];
    expect(row).toMatchObject({ sku: 'SKU-1', readinessStatus: 'READY_FOR_OPERATOR_REVIEW', executionReadiness: 'BLOCKED_UNDEFINED_POLICY' });
    expect(Number(row.estimatedOrderValue)).toBeGreaterThan(0);
    expect(Array.isArray(row.requiredApprovalSteps) && (row.requiredApprovalSteps as string[]).includes('Manager approval')).toBe(true);
    expect(Number(res.record?.fields.reorderRequiredCount)).toBe(1);
    expect(String(res.record?.fields.executionBlocked)).toMatch(/policy-undefined/);
  });

  it('CRITICAL — generating a decision report drafts NO purchase request, creates NO PO, moves NO inventory', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, safetyStock: 10, purchaseCost: 4 });
    expect((await list('procurement-requests')).length).toBe(0);
    const prBefore = JSON.stringify(prStore.list());
    const poBefore = JSON.stringify(poStore.list());
    const productBefore = JSON.stringify(productStore.list());
    await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    await create('inventory-reorder-decision', { asOfDate: '2026-08-31' });
    expect((await list('procurement-requests')).length).toBe(0);
    expect((await list('procurement-orders')).length).toBe(0);
    expect(JSON.stringify(prStore.list())).toBe(prBefore);
    expect(JSON.stringify(poStore.list())).toBe(poBefore);
    expect(JSON.stringify(productStore.list())).toBe(productBefore);
  });

  it('CRITICAL — execution stays blocked on every generated row (no automatic execution)', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, purchaseCost: 4 });
    await create('inventory-products', { sku: 'SKU-2', name: 'Gadget', reorderLevel: 20, purchaseCost: 4 });
    const res = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    const rows = JSON.parse(String(res.record?.fields.rows)) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.executionReadiness === 'BLOCKED_UNDEFINED_POLICY')).toBe(true);
  });

  it('empty (no active products) → an honest empty snapshot', async () => {
    const res = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect(res.ok).toBe(true);
    expect(Number(res.record?.fields.skuCount)).toBe(0);
    expect(String(res.record?.fields.note)).toMatch(/empty, not fabricated/);
  });

  it('deterministic regeneration — same state + same as-of ⇒ byte-identical rows', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, purchaseCost: 4 });
    const a = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    const b = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect(String(b.record?.fields.rows)).toBe(String(a.record?.fields.rows));
  });

  it('snapshots are immutable — a generated report cannot be regenerated in place', async () => {
    const res = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    const upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'inventory-reorder-decision', id: res.record?.id, fields: { reorderRequiredCount: 9999 } })) as { ok: boolean };
    expect(upd.ok).toBe(false);
  });

  it('NO_TENANT fail-closed — generation denies when no scope is bound', async () => {
    scope = null as unknown as TenantScope;
    const res = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' }).catch(() => ({ ok: false }));
    expect(res.ok).toBe(false);
  });

  it('TENANT ISOLATION — a snapshot sees only the acting tenant’s products', async () => {
    scope = TEST_TENANT_SCOPE;
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 20, purchaseCost: 4 });
    const aSnap = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect(Number(aSnap.record?.fields.skuCount)).toBe(1);

    scope = OTHER_TENANT_SCOPE;
    const bSnap = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect(Number(bSnap.record?.fields.skuCount)).toBe(0);
    expect((await list('inventory-reorder-decision')).every((r) => r.id !== aSnap.record?.id)).toBe(true);

    scope = TEST_TENANT_SCOPE;
    expect((await list('inventory-reorder-decision')).some((r) => r.id === aSnap.record?.id)).toBe(true);
  });
});

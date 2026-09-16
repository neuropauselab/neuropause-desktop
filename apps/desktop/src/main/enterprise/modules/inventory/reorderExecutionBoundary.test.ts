/**
 * S87 — Governed Reorder EXECUTION boundary. This gate's determination is STOP at
 * decision-readiness: a reorder-recommendation-driven execution command is NOT policy-complete
 * (recommendation identity, recommendation-scoped idempotency, and stale-recommendation policy are
 * undefined — see DECISION-MEMO-S87), so nothing new is built and the execution path must remain
 * blocked. These tests PROVE that blocked state through the REAL buildModuleHandlers path, and
 * document the existing governed primitives (source-wins) without invoking them to create procurement.
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
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule, PRODUCT_DESCRIPTOR } from './productModule';
import { REORDER_CHECK_ACTION } from './autoReorderSeam';
import { createPurchaseRequestModule } from '../procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createShippingModule } from '../warehouse/shippingModule';
import { createReorderRecommendationModule, REORDER_RECOMMENDATION_DESCRIPTOR } from './demandReorderModule';
import { createReorderDecisionModule, REORDER_DECISION_DESCRIPTOR } from './reorderDecisionModule';
import { PERMISSION_FOR_COMMAND, EVENT_FOR_COMMAND } from '../../../platform/command/domainCommand';
import { TEST_TENANT_SCOPE } from '../../../tenancy/testScope';

// ─────────────────────────────────────────────────────────────────────────────
// 1. STRUCTURAL — the intelligence modules are non-executing by construction
// ─────────────────────────────────────────────────────────────────────────────
describe('S87 structural boundary — S85/S86 modules carry no execution', () => {
  it('the reorder DECISION descriptor declares no actions', () => {
    expect(REORDER_DECISION_DESCRIPTOR.actions ?? []).toEqual([]);
  });
  it('the reorder RECOMMENDATION descriptor declares no actions', () => {
    expect(REORDER_RECOMMENDATION_DESCRIPTOR.actions ?? []).toEqual([]);
  });
  it('the existing governed execution primitive is the PRODUCT reorderCheck action — separate from the intelligence modules', () => {
    // Source-wins documentation: execution lives on the product module (governed: inventory:manage),
    // NOT on the recommendation/decision modules. S87 does not move or invoke it.
    expect((PRODUCT_DESCRIPTOR.actions ?? []).some((a) => a.key === REORDER_CHECK_ACTION)).toBe(true);
    expect(PRODUCT_DESCRIPTOR.permissions.write).toBe('inventory:manage');
  });
  it('the governed PR-draft command primitive exists in the spine and is procurement-authorized', () => {
    // Documents that IF a reorder execution were ever ruled policy-complete, it would reuse this
    // exact governed command — no second command bus. Asserted, not dispatched.
    expect(PERMISSION_FOR_COMMAND.CreatePurchaseRequest).toBe('procurement:manage');
    expect(EVENT_FOR_COMMAND.CreatePurchaseRequest).toBe('PurchaseRequestCreated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOVERNED PATH — no action on a decision/recommendation report executes anything
// ─────────────────────────────────────────────────────────────────────────────
describe('S87 governed boundary — the execution path is blocked end-to-end', () => {
  const T0 = '2026-07-01T00:00:00.000Z';
  const paths: string[] = [];
  let rec: { authorized: EnterprisePermission[]; publish: PlatformEventInput[] };
  let registry: EnterpriseModuleRegistry;
  let handlers: ReturnType<typeof buildModuleHandlers>;
  let scope: TenantScope;

  function tmp(tag: string): string {
    const p = join(tmpdir(), `np-s87-${tag}-${randomUUID()}.json`);
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
    const reorderRec = createReorderRecommendationModule(tmp('rec'), products.store, pr.store, po.store, shipping.store);
    const decision = createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store);
    registry = new EnterpriseModuleRegistry();
    for (const m of [products, pr, po, shipping, reorderRec, decision]) registry.register(m);
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
  const act = async (moduleId: string, id: string | undefined, action: string) =>
    (await handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action })) as { ok: boolean; error?: string };

  async function seedTriggeredProductAndReports() {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 200, safetyStock: 50, maximumStock: 500, purchaseCost: 4 });
    const decRep = await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    const row = (JSON.parse(String(decRep.record?.fields.rows)) as Array<Record<string, unknown>>)[0];
    // Confirm the report says a reorder IS required — so the "no execution" proof is meaningful.
    expect(row).toMatchObject({ sku: 'SKU-1', readinessStatus: 'READY_FOR_OPERATOR_REVIEW', executionReadiness: 'BLOCKED_UNDEFINED_POLICY' });
    return decRep.record?.id;
  }

  it('a READY_FOR_OPERATOR_REVIEW decision report drafts NO purchase request (no automatic execution)', async () => {
    await seedTriggeredProductAndReports();
    expect((await list('procurement-requests')).length).toBe(0);
    expect((await list('procurement-orders')).length).toBe(0);
  });

  it('no action on the DECISION module executes — every plausible execution verb is refused', async () => {
    const id = await seedTriggeredProductAndReports();
    for (const verb of ['execute', 'createPurchaseRequest', 'reorder', 'approve', REORDER_CHECK_ACTION, 'confirm']) {
      const r = await act('inventory-reorder-decision', id, verb);
      expect(r.ok).toBe(false);
      expect(r.error ?? '').toMatch(/Unknown action/i);
    }
    // …and still no procurement was created by any of those attempts.
    expect((await list('procurement-requests')).length).toBe(0);
    expect((await list('procurement-orders')).length).toBe(0);
  });

  it('no action on the RECOMMENDATION module executes either', async () => {
    await create('inventory-products', { sku: 'SKU-2', name: 'Gadget', reorderLevel: 200, maximumStock: 500, purchaseCost: 4 });
    const rep = await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    for (const verb of ['execute', 'createPurchaseRequest', REORDER_CHECK_ACTION]) {
      const r = await act('inventory-reorder-recommendation', rep.record?.id, verb);
      expect(r.ok).toBe(false);
      expect(r.error ?? '').toMatch(/Unknown action/i);
    }
    expect((await list('procurement-requests')).length).toBe(0);
  });

  it('generating decision + recommendation reports mutates no procurement/inventory records', async () => {
    await create('inventory-products', { sku: 'SKU-1', name: 'Widget', reorderLevel: 200, maximumStock: 500, purchaseCost: 4 });
    const productsBefore = JSON.stringify(await list('inventory-products'));
    await create('inventory-reorder-recommendation', { asOfDate: '2026-07-31' });
    await create('inventory-reorder-decision', { asOfDate: '2026-07-31' });
    expect((await list('procurement-requests')).length).toBe(0);
    expect((await list('procurement-orders')).length).toBe(0);
    expect(JSON.stringify(await list('inventory-products'))).toBe(productsBefore);
  });
});

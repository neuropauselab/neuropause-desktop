/**
 * ERP Session 49 — procurement status-machine edit guards (the buy-side S45 pattern).
 *
 * PR: the AUTHORITY boundary (approved/ordered) is action-owned — an EDIT can never cross it in
 * either direction; edits AMONG draft/pending/rejected stay free (the defined resubmit path).
 * GR: the ECONOMIC boundary (`received`) is action-owned — hand-set `received` posts no stock and
 * flipping back would let `post` double the movements; pending ↔ rejected stays free.
 * The lifecycle actions themselves never re-enter validate and are pinned untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  type EnterpriseEntity,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s49-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let audit: { action: string; target: string; summary: string }[];

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  registry = new EnterpriseModuleRegistry();
  for (const m of [createPurchaseRequestModule(tmp('pr')), createGoodsReceiptModule(tmp('gr')), createPurchaseOrderModule(tmp('po'))])
    registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const pr = (id: string) => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.get(id)!;
const gr = (id: string) => registry.get(GOODS_RECEIPTS_MODULE_ID)!.store.get(id)!;

const LINES = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);

describe('S49 · PR edit door cannot cross the approved/ordered authority boundary', () => {
  it('draft → approved via UPDATE is refused (approval is action-owned)', async () => {
    const r = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-1', lines: LINES });
    expect(r.ok).toBe(true);
    const upd = await updateIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, { ...r.record!.fields, status: 'approved' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.status ?? '')).toMatch(/Approve and Create Purchase Order actions/i);
    expect(String(pr(r.record!.id).fields.status)).toBe('draft');
  });

  it('approved → draft via UPDATE is refused (an approval cannot be silently reversed)', async () => {
    const r = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-2', lines: LINES });
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'approve')).ok).toBe(true);
    const upd = await updateIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, { ...pr(r.record!.id).fields, status: 'draft' });
    expect(upd.ok).toBe(false);
    expect(String(pr(r.record!.id).fields.status)).toBe('approved');
  });

  it('rejected → draft via UPDATE still SAVES — the defined resubmit path is preserved', async () => {
    const r = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-3', lines: LINES });
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'submit')).ok).toBe(true);
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'reject')).ok).toBe(true);
    const upd = await updateIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, { ...pr(r.record!.id).fields, status: 'draft' });
    expect(upd.ok).toBe(true);
    expect(String(pr(r.record!.id).fields.status)).toBe('draft');
  });

  it('the lifecycle ACTIONS are untouched by the guard (submit → approve → convert)', async () => {
    const r = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-4', lines: LINES });
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'submit')).ok).toBe(true);
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'approve')).ok).toBe(true);
    expect((await actIn(PURCHASE_REQUESTS_MODULE_ID, r.record!.id, 'createPurchaseOrder')).ok).toBe(true);
    expect(String(pr(r.record!.id).fields.status)).toBe('ordered');
    expect(String(pr(r.record!.id).fields.convertedOrder)).toBeTruthy();
  });
});

describe('S49 · GR edit door cannot cross the received economic boundary', () => {
  const receipt = () =>
    createIn(GOODS_RECEIPTS_MODULE_ID, { grNumber: 'GR-1', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10 });

  it('pending → received via UPDATE is refused (receiving books real stock — action-owned)', async () => {
    const r = await receipt();
    expect(r.ok).toBe(true);
    const upd = await updateIn(GOODS_RECEIPTS_MODULE_ID, r.record!.id, { ...r.record!.fields, status: 'received' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.status ?? '')).toMatch(/Post Receipt action/i);
    expect(String(gr(r.record!.id).fields.status)).toBe('pending');
  });

  it('pending → rejected via UPDATE still SAVES (no reject action exists — edit is the defined path)', async () => {
    const r = await receipt();
    const upd = await updateIn(GOODS_RECEIPTS_MODULE_ID, r.record!.id, { ...r.record!.fields, status: 'rejected' });
    expect(upd.ok).toBe(true);
    expect(String(gr(r.record!.id).fields.status)).toBe('rejected');
  });

  it('received → pending via UPDATE is refused (re-posting would double the movements)', async () => {
    const r = await receipt();
    const raw = registry.get(GOODS_RECEIPTS_MODULE_ID)!.store;
    raw.update(r.record!.id, { fields: { ...r.record!.fields, status: 'received' }, actor: 'post', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updateIn(GOODS_RECEIPTS_MODULE_ID, r.record!.id, { ...gr(r.record!.id).fields, status: 'pending' });
    expect(upd.ok).toBe(false);
    expect(String(gr(r.record!.id).fields.status)).toBe('received');
  });

  it('vendor payment: pending → cleared via UPDATE is refused (the S46 fence, buy side)', async () => {
    const { createVendorBillModule } = await import('../../enterprise/modules/finance/vendorBillModule');
    const { createVendorPaymentModule } = await import('../../enterprise/modules/finance/vendorPaymentModule');
    const reg2 = new EnterpriseModuleRegistry();
    const bills = createVendorBillModule(tmp('vb'));
    for (const m of [bills, createVendorPaymentModule(tmp('vp'), bills.store)]) reg2.register(m);
    reg2.bindScope(() => resolveTenantScope(() => scope));
    const h2 = buildModuleHandlers(reg2, moduleCtx());
    const H2 = (c: string) => h2.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
    const bill = (await H2(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'finance-vendor-bills', fields: { billNumber: 'VB-1', vendor: 'Acme Supply', amount: 100 } })) as { ok: boolean; record?: EnterpriseEntity };
    expect(bill.ok).toBe(true);
    // Fixture privilege: mark the bill approved via the RAW store (the approve action's own
    // three-way-match path is certified elsewhere; this test targets only the payment fence).
    bills.store.update(bill.record!.id, { fields: { ...bill.record!.fields, status: 'approved', approvedAt: '2026-09-02T12:00:00.000Z' }, actor: 'fixture', now: '2026-09-02T12:00:00.000Z' });
    const pay = (await H2(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'finance-vendor-payments', fields: { paymentNumber: 'VPAY-1', billRef: 'VB-1', amount: 50, status: 'pending', method: 'bank_transfer' } })) as { ok: boolean; record?: EnterpriseEntity };
    expect(pay.ok).toBe(true);
    const upd = (await H2(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'finance-vendor-payments', id: pay.record!.id, fields: { ...pay.record!.fields, status: 'cleared' } })) as { ok: boolean; errors?: Record<string, string> };
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.status ?? '')).toMatch(/governed cleared payment/i);
  });

  it('a STATUS-LESS stored row (importer shape) is still editable — no lockout', async () => {
    const r = await receipt();
    const raw = registry.get(GOODS_RECEIPTS_MODULE_ID)!.store;
    raw.update(r.record!.id, { fields: { ...r.record!.fields, status: '' }, actor: 'importer', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updateIn(GOODS_RECEIPTS_MODULE_ID, r.record!.id, { grNumber: 'GR-1', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 8 });
    expect(upd.ok).toBe(true);
  });
});

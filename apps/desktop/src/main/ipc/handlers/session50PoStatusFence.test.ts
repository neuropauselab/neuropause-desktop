/**
 * ERP Session 50 — Purchase Order status-machine fence (the census-closed edit-door holes).
 *
 * MEASURED before fencing (see certification/SESSION50-PROCUREMENT-SURFACE-HARDENING.md):
 * entering approved/sent via UPDATE is already gated by the document-adapter approval engine
 * (moduleRegistry canEnterStatus + spend policy) — deliberately NOT duplicated in the module.
 * What was open, and is now fenced at module validate:
 *   - `received` in EITHER direction (conversion-stamped state; the Receive Goods raw store
 *     write never re-enters validate, pinned here),
 *   - approved/sent → draft (silent approval reversal; Cancel + recreate is the defined path).
 * Deliberately FREE (refusing them would invent policy):
 *   - cancelled → draft (the only recovery path — no un-cancel action exists),
 *   - draft → cancelled (identical semantics to the ungated `cancel` action),
 *   - status-less stored rows (importer shape — the S45 lockout lesson).
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
  PURCHASE_ORDERS_MODULE_ID,
  type EnterpriseEntity,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s50-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  for (const m of [createPurchaseOrderModule(tmp('po')), createGoodsReceiptModule(tmp('gr'))]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createPo = (fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId: PURCHASE_ORDERS_MODULE_ID, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const updatePo = (id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId: PURCHASE_ORDERS_MODULE_ID, id, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actPo = (id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId: PURCHASE_ORDERS_MODULE_ID, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const po = (id: string) => registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.get(id)!;
const rawPo = () => registry.get(PURCHASE_ORDERS_MODULE_ID)!.store;

const BASE = { poNumber: 'PO-1', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5 };

describe('S50 · PO edit door cannot cross the received boundary', () => {
  it('sent → received via UPDATE is refused (only Receive Goods stamps a receipt)', async () => {
    const r = await createPo(BASE);
    expect(r.ok).toBe(true);
    rawPo().update(r.record!.id, { fields: { status: 'sent' }, actor: 'fixture', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'received' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.status ?? '')).toMatch(/Receive Goods action/i);
    expect(String(po(r.record!.id).fields.status)).toBe('sent');
  });

  it('received → sent via UPDATE is refused (a physical receipt cannot be un-set)', async () => {
    const r = await createPo(BASE);
    rawPo().update(r.record!.id, { fields: { status: 'received', convertedReceipt: 'gr_x' }, actor: 'fixture', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'sent' });
    expect(upd.ok).toBe(false);
    expect(String(po(r.record!.id).fields.status)).toBe('received');
  });

  it('received → cancelled via UPDATE is refused (the cancel ACTION refuses received too)', async () => {
    const r = await createPo(BASE);
    rawPo().update(r.record!.id, { fields: { status: 'received', convertedReceipt: 'gr_x' }, actor: 'fixture', now: '2026-09-02T12:00:00.000Z' });
    // control: the action itself refuses — the edit door may not be softer than the action
    const act = await actPo(r.record!.id, 'cancel');
    expect(act.ok).toBe(false);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'cancelled' });
    expect(upd.ok).toBe(false);
    expect(String(po(r.record!.id).fields.status)).toBe('received');
  });
});

describe('S50 · the Receive-Goods idempotency token cannot be edited', () => {
  it('CLEARING convertedReceipt on a received PO via UPDATE is refused (it would re-arm Receive Goods)', async () => {
    const r = await createPo(BASE);
    rawPo().update(r.record!.id, { fields: { status: 'received', convertedReceipt: 'gr_real' }, actor: 'fixture', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, convertedReceipt: '' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.convertedReceipt ?? upd.errors?._ ?? '')).toMatch(/Receive Goods action/i);
    expect(String(po(r.record!.id).fields.convertedReceipt)).toBe('gr_real');
    // and the conversion still refuses a second receipt — the token survived
    const again = await actPo(r.record!.id, 'receiveGoods');
    expect(again.ok).toBe(false);
  });

  it('SETTING convertedReceipt on a fresh PO via UPDATE is refused (fake receipt linkage)', async () => {
    const r = await createPo(BASE);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, convertedReceipt: 'gr_fake' });
    expect(upd.ok).toBe(false);
    expect(String(po(r.record!.id).fields.convertedReceipt ?? '')).toBe('');
  });
});

describe('S50 · PO edit door cannot silently reverse an approval', () => {
  it('approved → draft via UPDATE is refused (Cancel + recreate is the defined path)', async () => {
    const r = await createPo(BASE);
    expect((await actPo(r.record!.id, 'approve')).ok).toBe(true);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'draft' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?.status ?? '')).toMatch(/cannot be silently reverted/i);
    expect(String(po(r.record!.id).fields.status)).toBe('approved');
  });

  it('sent → draft via UPDATE is refused', async () => {
    const r = await createPo(BASE);
    expect((await actPo(r.record!.id, 'approve')).ok).toBe(true);
    expect((await actPo(r.record!.id, 'send')).ok).toBe(true);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'draft' });
    expect(upd.ok).toBe(false);
    expect(String(po(r.record!.id).fields.status)).toBe('sent');
  });
});

describe('S50 · defined paths stay open — no invented policy', () => {
  it('cancelled → draft via UPDATE still SAVES (the only recovery path — no un-cancel action)', async () => {
    const r = await createPo(BASE);
    expect((await actPo(r.record!.id, 'cancel')).ok).toBe(true);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'draft' });
    expect(upd.ok).toBe(true);
    expect(String(po(r.record!.id).fields.status)).toBe('draft');
  });

  it('draft → cancelled via UPDATE still SAVES (identical semantics to the ungated cancel action)', async () => {
    const r = await createPo(BASE);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'cancelled' });
    expect(upd.ok).toBe(true);
  });

  it('a non-status edit on an approved PO still SAVES (the fence only fires on a crossing)', async () => {
    const r = await createPo(BASE);
    expect((await actPo(r.record!.id, 'approve')).ok).toBe(true);
    const upd = await updatePo(r.record!.id, { ...po(r.record!.id).fields, status: 'approved', supplier: 'Acme Industrial' });
    expect(upd.ok).toBe(true);
    expect(String(po(r.record!.id).fields.supplier)).toBe('Acme Industrial');
  });

  it('the lifecycle ACTIONS + Receive Goods conversion are untouched (approve → send → receiveGoods → received)', async () => {
    const r = await createPo(BASE);
    expect((await actPo(r.record!.id, 'approve')).ok).toBe(true);
    expect((await actPo(r.record!.id, 'send')).ok).toBe(true);
    const rec = await actPo(r.record!.id, 'receiveGoods');
    expect(rec.ok).toBe(true);
    expect(String(po(r.record!.id).fields.status)).toBe('received');
    expect(String(po(r.record!.id).fields.convertedReceipt)).toBeTruthy();
    // and the raised GR is real
    const grStore = registry.get(GOODS_RECEIPTS_MODULE_ID)!.store;
    expect(grStore.get(String(po(r.record!.id).fields.convertedReceipt))).toBeTruthy();
  });

  it('a STATUS-LESS stored row (importer shape) is still editable — no lockout', async () => {
    const r = await createPo(BASE);
    rawPo().update(r.record!.id, { fields: { ...r.record!.fields, status: '' }, actor: 'importer', now: '2026-09-02T12:00:00.000Z' });
    const upd = await updatePo(r.record!.id, { ...BASE, quantity: 8 });
    expect(upd.ok).toBe(true);
  });
});

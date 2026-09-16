/**
 * ERP Session 26 — PaySupplierInvoice through the LIVE platform:command.dispatch path.
 * Reuses the existing vendor-payment engine (create a cleared payment → onChange books Dr AP / Cr Cash
 * + settles the bill; partials accumulate; overpayment/duplicate/draft-bill refused; void un-pays).
 * No new AP/payment store, no invented settlement/discount/tax policy.
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
  VENDOR_PAYMENTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s26-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'inventory:read', 'inventory:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;
let payNo = 0;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal(); payNo = 0;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  const bills = createVendorBillModule(tmp('bill'), pos.store);
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    bills,
    createVendorPaymentModule(tmp('vpay'), bills.store),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: (e) => audit.push(e), resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean }>;
const num = (v: unknown) => Number(v ?? 0);
const billRec = (id: string) => registry.get(VENDOR_BILLS_MODULE_ID)!.store.get(id)!;
const clearedPayments = () => registry.get(VENDOR_PAYMENTS_MODULE_ID)!.store.list().filter((p) => String(p.fields.status) === 'cleared' && p.status !== 'deleted');
const journalLines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()
  .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

interface DispatchResult { ok: boolean; data?: { id?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function pay(billRef: string, amount: number, idem: string, opts: { claimedTenantId?: string; transactionRef?: string } = {}): Promise<DispatchResult> {
  payNo += 1;
  return (await runSecureHandler(
    def,
    {
      operation: 'PaySupplierInvoice',
      payload: { paymentNumber: `VPAY-${idem}-${payNo}`, billRef, vendor: 'Acme', amount, currency: 'USD', ...(opts.transactionRef ? { transactionRef: opts.transactionRef } : {}) },
      idempotencyKey: idem,
      ...(opts.claimedTenantId ? { claimedTenantId: opts.claimedTenantId } : {}),
    },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

// Seed an APPROVED bill of `billTotal` (PO received + three-way-matched + approved).
async function approvedBill(billTotal: number, poNumber = 'PO-26'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  const qty = billTotal / 5;
  const po = await createIn(PURCHASE_ORDERS_MODULE_ID, {
    poNumber, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD',
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, unitPrice: 5 }]),
  });
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
  const gr = await createIn(GOODS_RECEIPTS_MODULE_ID, {
    grNumber: `GR-${poNumber}`, purchaseOrder: po.record!.id, supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1',
    quantityReceived: qty, lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, poLine: 1 }]),
  });
  await actIn(GOODS_RECEIPTS_MODULE_ID, gr.record!.id, 'post');
  const bill = await createIn(VENDOR_BILLS_MODULE_ID, {
    billNumber: `BILL-${poNumber}`, vendor: 'Acme', currency: 'USD', amount: billTotal, sourcePurchaseOrder: po.record!.id,
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, unitPrice: 5 }]),
  });
  expect((await actIn(VENDOR_BILLS_MODULE_ID, bill.record!.id, 'approve')).ok).toBe(true);
  return bill.record!.id;
}

// ===========================================================================
// Governed payment on the live path
// ===========================================================================

describe('S26 · PaySupplierInvoice — governed AP settlement on the live path', () => {
  it('full payment settles the bill + books Dr AP / Cr Cash + event/journal/audit', async () => {
    const b = await approvedBill(100);
    const r = await pay(b, 100, 'p1');
    expect(r.ok).toBe(true);
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('SupplierInvoicePaid');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    expect(audit.length).toBeGreaterThan(0);
    expect(clearedPayments()).toHaveLength(1);
    // onChange settles the bill (amountPaid + paidDate) and books the payment.
    await flushUntil(() => num(billRec(b).fields.amountPaid) >= 100 && journalLines().length > 0);
    expect(num(billRec(b).fields.amountPaid)).toBe(100);
    expect(String(billRec(b).fields.paidDate || '')).not.toBe('');
    expect(journalLines().length).toBeGreaterThan(0); // Dr AP / Cr Cash
  });

  it('partial payments accumulate until the bill settles (40 then 60)', async () => {
    const b = await approvedBill(100);
    expect((await pay(b, 40, 'pa')).ok).toBe(true);
    await flushUntil(() => num(billRec(b).fields.amountPaid) >= 40);
    expect(num(billRec(b).fields.amountPaid)).toBe(40);
    expect(String(billRec(b).fields.paidDate || '')).toBe(''); // not settled yet
    expect((await pay(b, 60, 'pb')).ok).toBe(true);
    await flushUntil(() => num(billRec(b).fields.amountPaid) >= 100);
    expect(num(billRec(b).fields.amountPaid)).toBe(100);
    expect(String(billRec(b).fields.paidDate || '')).not.toBe('');
  });

  it('OVERPAYMENT is refused (existing remaining-balance guard)', async () => {
    const b = await approvedBill(100);
    expect((await pay(b, 60, 'ov1')).ok).toBe(true);
    await flushUntil(() => num(billRec(b).fields.amountPaid) >= 60);
    const over = await pay(b, 60, 'ov2'); // 60 + 60 > 100
    expect(over.ok).toBe(false);
    expect(over.error!.code).toBe('VALIDATION_ERROR');
    expect(clearedPayments()).toHaveLength(1); // no second economic effect
  });

  it('cannot pay a DRAFT bill (must be approved first)', async () => {
    await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-d', supplier: 'Acme', currency: 'USD', lines: JSON.stringify([{ sku: 'SKU-A', quantity: 20, unitPrice: 5 }]) });
    const draft = await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: 'BILL-draft', vendor: 'Acme', currency: 'USD', amount: 100, sourcePurchaseOrder: po.record!.id, lines: JSON.stringify([{ sku: 'SKU-A', quantity: 20, unitPrice: 5 }]) });
    const r = await pay(draft.record!.id, 100, 'd1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
    expect(clearedPayments()).toHaveLength(0);
  });

  it('UNAUTHORIZED without operations:manage — no payment', async () => {
    const b = await approvedBill(100);
    currentPrincipal = fullPrincipal({ permissions: ['operations:read'] });
    const r = await pay(b, 100, 'z1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(clearedPayments()).toHaveLength(0);
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const b = await approvedBill(100);
    const r = await pay(b, 100, 't1', { claimedTenantId: 'tenant-EVIL' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(clearedPayments()).toHaveLength(0);
  });

  it("a foreign-tenant bill is invisible → payment refused", async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreignBill = await approvedBill(100, 'PO-B');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    const r = await pay(foreignBill, 100, 'f1');
    expect(r.ok).toBe(false); // bill not found in tenant-A scope
    expect(r.error!.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Idempotency + concurrency (reproduce-first)
// ===========================================================================

describe('S26 · idempotency + concurrency invariant', () => {
  it('100 concurrent SAME-key payments → ONE economic effect', async () => {
    const b = await approvedBill(100);
    const results = await Promise.all(Array.from({ length: 100 }, () => pay(b, 100, 'once')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(clearedPayments()).toHaveLength(1); // single-flight → one payment
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    const after = await pay(b, 100, 'once');
    expect(after.replayed).toBe(true);
    expect(clearedPayments()).toHaveLength(1);
  });

  it('two DIFFERENT-key full-balance payments against one bill → only ONE succeeds (no overpayment)', async () => {
    const b = await approvedBill(100);
    const [r1, r2] = await Promise.all([pay(b, 100, 'c1'), pay(b, 100, 'c2')]);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    expect(okCount).toBe(1); // the second would exceed the remaining balance
    expect(clearedPayments()).toHaveLength(1);
    await flushUntil(() => num(billRec(b).fields.amountPaid) >= 100);
    expect(num(billRec(b).fields.amountPaid)).toBe(100); // never 200
  });

  it('survives restart: durable journal reloads and the key replays (no second payment)', async () => {
    const b = await approvedBill(100);
    const first = await pay(b, 100, 'durable');
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
    const replay = await pay(b, 100, 'durable');
    expect(replay.replayed).toBe(true);
    expect(replay.data!.id).toBe(first.data!.id);
    expect(clearedPayments()).toHaveLength(1);
  });
});

/**
 * ERP Session 55 — governance-closure fences (the census-found classes).
 *
 * CLASS 1 · store-anchored token guards: the input-anchored guards (journal postedAt,
 * period closedAt, payment bankReconciledAt) read the MERGED payload, so a crafted update
 * supplying '' cleared the token and the guard passed — un-posting GL, reopening closed
 * periods, erasing bank evidence. The STORED stamp is now the authority.
 * CLASS 2 · marker/token immutability: bill lifecycle markers, order conversion tokens,
 * quote conversion state, received-GR invariant inputs.
 * CLASS 3 · posting re-arm fences: shipping / multi-line dispatch / multi-line receipt
 * status crossings, and the stock ledger's own declared immutability contract.
 * CLASS 4 · one delete door: SetStatus-'deleted' refused (it skipped the dependency
 * assessment + decision record of the governed Delete door).
 * Every fence: update-door only, status-less importer rows exempt, actions/conversions
 * write via the raw store and never re-enter validate (pinned by controls below).
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
  type EnterpriseEntity,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { EnterpriseRecordStore } from '../../enterprise/framework';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createAccountingPeriodModule } from '../../enterprise/modules/finance/accountingPeriodModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createQuoteModule } from '../../enterprise/modules/sales/quoteModule';
import { createMultiLineDispatchModule } from '../../enterprise/modules/sales/multiLineDispatchModule';
import { createMultiLineReceiptModule } from '../../enterprise/modules/procurement/multiLineReceiptModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s55-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-03T12:00:00.000Z',
  };
}

const NOW = '2026-09-03T12:00:00.000Z';
let mods: Record<string, ReturnType<typeof createOrderModule>>;

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accountStore = new EnterpriseRecordStore(tmp('acct'), 'finance-gl-accounts', 'gl-account');
  const invoiceStore = new EnterpriseRecordStore(tmp('inv'), 'finance', 'invoice');
  mods = {
    journal: createJournalEntryModule(tmp('je'), accountStore),
    period: createAccountingPeriodModule(tmp('pd')),
    payment: createPaymentModule(tmp('pay'), invoiceStore),
    bill: createVendorBillModule(tmp('vb')),
    order: createOrderModule(tmp('so')),
    quote: createQuoteModule(tmp('qt')),
    dispatch: createMultiLineDispatchModule(tmp('md')),
    mlreceipt: createMultiLineReceiptModule(tmp('mr')),
    gr: createGoodsReceiptModule(tmp('gr')),
    po: createPurchaseOrderModule(tmp('po')),
    shipping: createShippingModule(tmp('sh')),
    movement: createStockMovementModule(tmp('mv')),
  };
  for (const m of Object.values(mods)) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
type Mut = { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<Mut>;
const act = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
/** Raw-store fixture (the S49 pattern): mint the stored shape directly, hooks untouched. */
function seed(m: keyof typeof mods, fields: Record<string, unknown>): EnterpriseEntity {
  return mods[m].store.create({ title: String(fields.__title ?? 'fixture'), fields, actor: 'fixture', now: NOW });
}
const stored = (m: keyof typeof mods, id: string) => mods[m].store.get(id)!;

describe('S55 · CLASS 1 — store-anchored token guards (the forged-clear class)', () => {
  it('journal: a crafted update clearing postedAt on a POSTED entry is refused (un-posting GL blocked)', async () => {
    const r = seed('journal', { entryNumber: 'JE-1', memo: 'posted', lines: '[]', status: 'posted', postedAt: NOW });
    const upd = await update('finance-journal-entries', r.id, { entryNumber: 'JE-1', memo: 'rewritten', lines: '[]', postedAt: '' });
    expect(upd.ok).toBe(false);
    expect(String(upd.errors?._ ?? '')).toMatch(/immutable/i);
    expect(String(stored('journal', r.id).fields.postedAt)).toBe(NOW);
  });

  it('period: a crafted update clearing closedAt on a CLOSED period is refused (edit-door reopen blocked); the reopen ACTION still works', async () => {
    const r = seed('period', { periodKey: '2026-08', status: 'closed', closedAt: NOW, closedBy: 'op@np.dev' });
    const upd = await update('finance-periods', r.id, { periodKey: '2026-08', closedAt: '' });
    expect(upd.ok).toBe(false);
    expect(String(stored('period', r.id).fields.closedAt)).toBe(NOW);
    const reopen = await act('finance-periods', r.id, 'reopen');
    expect(reopen.ok).toBe(true);
  });

  it('payment: blanking bankReconciledAt on a bank-reconciled payment is refused (bank evidence immutable)', async () => {
    const r = seed('payment', { paymentNumber: 'PAY-1', invoiceRef: 'INV-1', amount: 50, status: 'cleared', method: 'bank_transfer', bankReconciledAt: NOW });
    const upd = await update('finance-payments', r.id, { paymentNumber: 'PAY-1', invoiceRef: 'INV-1', amount: 50, status: 'cleared', method: 'bank_transfer', bankReconciledAt: '' });
    expect(upd.ok).toBe(false);
    expect(String(stored('payment', r.id).fields.bankReconciledAt)).toBe(NOW);
  });
});

describe('S55 · CLASS 2 — marker/token immutability', () => {
  it('vendor bill: clearing approvedAt (silent approval reversal, orphaned GL) is refused; setting paidDate (fake settlement) is refused', async () => {
    const r = seed('bill', { billNumber: 'VB-1', vendor: 'Acme', amount: 100, status: 'approved', approvedAt: NOW });
    const clear = await update('finance-vendor-bills', r.id, { billNumber: 'VB-1', vendor: 'Acme', amount: 100, approvedAt: '' });
    expect(clear.ok).toBe(false);
    const fake = await update('finance-vendor-bills', r.id, { billNumber: 'VB-1', vendor: 'Acme', amount: 100, approvedAt: NOW, paidDate: '2026-09-03' });
    expect(fake.ok).toBe(false);
    expect(String(stored('bill', r.id).fields.status)).toBe('approved');
  });

  it('vendor bill: a normal draft edit still saves (no lockout)', async () => {
    const r = seed('bill', { billNumber: 'VB-2', vendor: 'Acme', amount: 100, status: 'draft' });
    const upd = await update('finance-vendor-bills', r.id, { billNumber: 'VB-2', vendor: 'Acme Industrial', amount: 120 });
    expect(upd.ok).toBe(true);
  });

  it('order: clearing convertedInvoice (duplicate-invoice re-arm) and setting pickList are refused; normal edits save', async () => {
    const r = seed('order', { orderNumber: 'SO-1', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, status: 'shipped', convertedInvoice: 'inv_x' });
    const clear = await update('sales-orders', r.id, { orderNumber: 'SO-1', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, status: 'shipped', convertedInvoice: '' });
    expect(clear.ok).toBe(false);
    const fake = await update('sales-orders', r.id, { orderNumber: 'SO-1', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, status: 'shipped', convertedInvoice: 'inv_x', pickList: 'pl_fake' });
    expect(fake.ok).toBe(false);
    const fine = await update('sales-orders', r.id, { orderNumber: 'SO-1', customer: 'C renamed', product: 'SKU-A', quantity: 1, unitPrice: 5, status: 'shipped', convertedInvoice: 'inv_x' });
    expect(fine.ok).toBe(true);
  });

  it('quote: converted→accepted (duplicate-order re-arm) and convertedOrder clearing are refused; draft→sent stays free', async () => {
    const r = seed('quote', { quoteNumber: 'Q-1', customer: 'C', subtotal: 100, status: 'converted', convertedOrder: 'so_x' });
    const back = await update('sales-quotes', r.id, { quoteNumber: 'Q-1', customer: 'C', subtotal: 100, status: 'accepted', convertedOrder: 'so_x' });
    expect(back.ok).toBe(false);
    const clear = await update('sales-quotes', r.id, { quoteNumber: 'Q-1', customer: 'C', subtotal: 100, status: 'converted', convertedOrder: '' });
    expect(clear.ok).toBe(false);
    const free = seed('quote', { quoteNumber: 'Q-2', customer: 'C', subtotal: 100, status: 'draft' });
    const send = await update('sales-quotes', free.id, { quoteNumber: 'Q-2', customer: 'C', subtotal: 100, status: 'sent' });
    expect(send.ok).toBe(true);
  });

  it('GR: purchaseOrder / lines / supplier are frozen on a RECEIVED receipt (invariant inputs + scorecard key); pending rows stay editable', async () => {
    const rec = seed('gr', { grNumber: 'GR-1', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10, status: 'received', purchaseOrder: 'po_x' });
    for (const [k, v] of [['purchaseOrder', 'po_other'], ['lines', '[{"sku":"SKU-B","quantity":99}]'], ['supplier', 'Someone Else']] as const) {
      const upd = await update('procurement-receipts', rec.id, { grNumber: 'GR-1', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10, status: 'received', purchaseOrder: 'po_x', [k]: v });
      expect(upd.ok, `${k} must be frozen`).toBe(false);
    }
    const pending = seed('gr', { grNumber: 'GR-2', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10, status: 'pending' });
    const upd = await update('procurement-receipts', pending.id, { grNumber: 'GR-2', supplier: 'Acme Industrial', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 8, status: 'pending' });
    expect(upd.ok).toBe(true);
  });
});

describe('S55 · CLASS 3 — posting re-arm fences', () => {
  it('GR post against a CANCELLED purchase order is refused; a PO-less receipt still posts (defined flow preserved)', async () => {
    const po = seed('po', { poNumber: 'PO-1', supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, status: 'cancelled' });
    const gr = seed('gr', { grNumber: 'GR-3', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10, status: 'pending', purchaseOrder: po.id });
    const refused = await act('procurement-receipts', gr.id, 'post');
    expect(refused.ok).toBe(false);
    expect(String(refused.message ?? '')).toMatch(/cancelled/i);
    const free = seed('gr', { grNumber: 'GR-4', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 5, quantityReceived: 5, status: 'pending' });
    const posted = await act('procurement-receipts', free.id, 'post');
    expect(posted.ok).toBe(true);
  });

  it('shipping: crossings involving shipped/delivered are refused; pending→cancelled stays free', async () => {
    const base = { shipmentNumber: 'SH-1', orderRef: '', product: 'SKU-A', warehouse: 'WH-1', quantity: 1 };
    const s = seed('shipping', { ...base, status: 'pending' });
    expect((await update('warehouse-shipping', s.id, { ...base, status: 'shipped' })).ok).toBe(false);
    const shipped = seed('shipping', { ...base, shipmentNumber: 'SH-2', status: 'shipped' });
    expect((await update('warehouse-shipping', shipped.id, { ...base, shipmentNumber: 'SH-2', status: 'pending' })).ok).toBe(false);
    expect((await update('warehouse-shipping', s.id, { ...base, status: 'cancelled' })).ok).toBe(true);
  });

  it('multi-line dispatch: dispatched→draft (duplicate-COGS re-arm) refused; multi-line receipt: received→draft (duplicate-GRNI re-arm) refused; draft→failed free', async () => {
    const d = seed('dispatch', { dispatchNumber: 'MD-1', warehouse: 'WH-1', lines: '[{"sku":"A","quantity":1}]', status: 'dispatched' });
    expect((await update('sales-multiline-dispatches', d.id, { dispatchNumber: 'MD-1', warehouse: 'WH-1', lines: '[{"sku":"A","quantity":1}]', status: 'draft' })).ok).toBe(false);
    const r = seed('mlreceipt', { receiptNumber: 'MR-1', warehouse: 'WH-1', lines: '[{"sku":"A","quantity":1}]', status: 'received' });
    expect((await update('procurement-multiline-receipts', r.id, { receiptNumber: 'MR-1', warehouse: 'WH-1', lines: '[{"sku":"A","quantity":1}]', status: 'draft' })).ok).toBe(false);
    const fresh = seed('mlreceipt', { receiptNumber: 'MR-2', warehouse: 'WH-1', lines: '[]', status: 'draft' });
    expect((await update('procurement-multiline-receipts', fresh.id, { receiptNumber: 'MR-2', warehouse: 'WH-1', lines: '[]', status: 'failed' })).ok).toBe(true);
  });

  it('stock ledger: a POSTED movement cannot be rewritten (quantity/product/type frozen); posted→void allowed; void is terminal', async () => {
    const base = { movementNumber: 'MV-1', type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: 10, unitCost: 5 };
    const m = seed('movement', { ...base, status: 'posted' });
    expect((await update('inventory-movements', m.id, { ...base, quantity: 99, status: 'posted' })).ok).toBe(false);
    expect((await update('inventory-movements', m.id, { ...base, product: 'SKU-B', status: 'posted' })).ok).toBe(false);
    const voided = await update('inventory-movements', m.id, { ...base, status: 'void' });
    expect(voided.ok).toBe(true);
    expect((await update('inventory-movements', m.id, { ...base, status: 'posted' })).ok).toBe(false);
  });
});

describe('S55 · CLASS 4 — one delete door', () => {
  it("SetStatus-'deleted' is refused (it skipped the Delete door's assessment + decision record); 'archived' still works", async () => {
    const r = seed('order', { orderNumber: 'SO-9', customer: 'C', product: 'SKU-A', quantity: 1, unitPrice: 5, status: 'pending' });
    const del = (await H(IpcChannel.EnterpriseModuleSetStatus)({ moduleId: 'sales-orders', id: r.id, status: 'deleted' })) as Mut;
    expect(del.ok).toBe(false);
    expect(String(del.errors?._ ?? '')).toMatch(/Delete door/i);
    expect(stored('order', r.id).status).toBe('active');
    const arch = (await H(IpcChannel.EnterpriseModuleSetStatus)({ moduleId: 'sales-orders', id: r.id, status: 'archived' })) as Mut;
    expect(arch.ok).toBe(true);
  });
});

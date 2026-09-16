/**
 * ERP Session 11 — vendor-bill line items → line-level three-way match → live
 * GRNI relief + PPV, proven through the REAL modules (product, stock movement,
 * ledger, journal, purchase order, goods receipt, vendor bill, vendor payment)
 * driven via the generic IPC handlers exactly as the composition root wires them.
 *
 * The gate: a PO-sourced (goods) bill relieves GRNI only when the existing
 * `threeWayMatch` engine returns MATCHED; a mismatch fails closed (no posting);
 * a service bill keeps the Operating Expense path; standard costing and the
 * single journal/CST seam are untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  GL_CONTROL_ACCOUNTS,
  GL_PAYABLE_CONTROL_ACCOUNTS,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { createVendorBillModule } from './vendorBillModule';
import { createVendorPaymentModule } from './vendorPaymentModule';
import { STOCK_ACCOUNTS, deriveGoodsBillPosting } from '../../../erp/postingRules';

const T0 = '2026-09-01T12:00:00.000Z';
const GST_INPUT = '1200';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s11-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let bills: ReturnType<typeof createVendorBillModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => T0,
  };
}

beforeEach(async () => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  bills = createVendorBillModule(tmp('bill'), pos.store);
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
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
  createLifecycleEmitter(registry, spyCtx()); // wires the shared action context
  // Seed the finance control chart on the empty chart, as the app does at boot.
  // (Stock accounts are lazily ensured by the movement bridge; the control
  // accounts — Cash, AP, Operating Expenses, GST — are seeded only while the
  // chart is empty, so they must be created before any stock posting makes it
  // non-empty. This mirrors production boot ordering.)
  await seedControlChart();
});

async function seedControlChart(): Promise<void> {
  for (const a of [...Object.values(GL_CONTROL_ACCOUNTS), ...Object.values(GL_PAYABLE_CONTROL_ACCOUNTS)]) {
    await createIn(LEDGER_ACCOUNTS_MODULE_ID, { code: a.code, name: a.name, class: a.accountClass, currency: 'USD' });
  }
}
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;

function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
/** credit − debit: positive for a credit balance (GRNI accrued, AP owed). */
const net = (account: string): number => bal(account, 'credit') - bal(account, 'debit');
const jeCount = (prefix: string): number =>
  registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber ?? e.title ?? '').startsWith(prefix)).length;

/**
 * The framework fires `onChange` fire-and-forget (`actionCtx.emit` → `void
 * emitLifecycle`), so a bill's GL posting completes AFTER the action returns.
 * Wait deterministically for the posting to land before asserting the ledger.
 */
async function flushUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}
const settle = () => new Promise((r) => setTimeout(r, 60));

const seedProduct = (sku: string, standardCost: number) => createIn('inventory-products', { sku, name: sku, standardCost });

/** Create a PO, receive it (→ GRNI accrual), return { poId }. */
async function poAndReceipt(opts: { sku: string; qty: number; unitCost: number; supplier?: string }): Promise<string> {
  const supplier = opts.supplier ?? 'Acme';
  const po = await createIn('procurement-orders', {
    poNumber: `PO-${opts.sku}`,
    supplier,
    product: opts.sku,
    warehouse: 'WH-1',
    quantity: opts.qty,
    unitCost: opts.unitCost,
    currency: 'USD',
  });
  if (!po.ok || !po.record) throw new Error(`PO create failed: ${JSON.stringify(po.errors)}`);
  const gr = await createIn('procurement-receipts', {
    grNumber: `GR-${opts.sku}`,
    purchaseOrder: po.record.id,
    supplier,
    product: opts.sku,
    warehouse: 'WH-1',
    quantityOrdered: opts.qty,
    quantityReceived: opts.qty,
  });
  if (!gr.ok || !gr.record) throw new Error(`GR create failed: ${JSON.stringify(gr.errors)}`);
  const posted = await act('procurement-receipts', gr.record.id, 'post');
  expect(posted.ok).toBe(true);
  await flushUntil(() => net(STOCK_ACCOUNTS.grni) !== 0); // GRNI accrual landed
  return po.record.id;
}

// ---------------------------------------------------------------------------
// deriveGoodsBillPosting — pure derivation
// ---------------------------------------------------------------------------

describe('deriveGoodsBillPosting (pure)', () => {
  it('relieves GRNI and credits AP, balanced, when billed equals received (no PPV)', () => {
    const d = deriveGoodsBillPosting({ billId: 'B1', receivedValue: 1000, billedExTax: 1000, taxAmount: 0, taxAccount: GST_INPUT });
    expect(d.ok).toBe(true);
    expect(d.lines.find((l) => l.debit > 0)?.account).toBe(STOCK_ACCOUNTS.grni);
    expect(d.lines.find((l) => l.credit > 0)?.account).toBe(STOCK_ACCOUNTS.accountsPayable);
    expect(d.lines.some((l) => l.account === STOCK_ACCOUNTS.purchasePriceVariance)).toBe(false);
    const dr = d.lines.reduce((n, l) => n + l.debit, 0);
    const cr = d.lines.reduce((n, l) => n + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('unfavourable PPV: billed > received debits 5920', () => {
    const d = deriveGoodsBillPosting({ billId: 'B2', receivedValue: 1000, billedExTax: 1005, taxAmount: 0, taxAccount: GST_INPUT });
    const ppv = d.lines.find((l) => l.account === STOCK_ACCOUNTS.purchasePriceVariance);
    expect(ppv?.debit).toBe(5);
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.accountsPayable)?.credit).toBe(1005);
    expect(d.lines.reduce((n, l) => n + l.debit, 0)).toBe(d.lines.reduce((n, l) => n + l.credit, 0));
  });

  it('favourable PPV: billed < received credits 5920', () => {
    const d = deriveGoodsBillPosting({ billId: 'B3', receivedValue: 1000, billedExTax: 995, taxAmount: 0, taxAccount: GST_INPUT });
    const ppv = d.lines.find((l) => l.account === STOCK_ACCOUNTS.purchasePriceVariance);
    expect(ppv?.credit).toBe(5);
    expect(d.lines.reduce((n, l) => n + l.debit, 0)).toBe(d.lines.reduce((n, l) => n + l.credit, 0));
  });

  it('books recoverable tax to the input-tax account', () => {
    const d = deriveGoodsBillPosting({ billId: 'B4', receivedValue: 1000, billedExTax: 1000, taxAmount: 180, taxAccount: GST_INPUT });
    expect(d.lines.find((l) => l.account === GST_INPUT)?.debit).toBe(180);
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.accountsPayable)?.credit).toBe(1180);
    expect(d.lines.reduce((n, l) => n + l.debit, 0)).toBe(d.lines.reduce((n, l) => n + l.credit, 0));
  });

  it('refuses when nothing was received (no GRNI to relieve)', () => {
    const d = deriveGoodsBillPosting({ billId: 'B5', receivedValue: 0, billedExTax: 1000, taxAmount: 0, taxAccount: GST_INPUT });
    expect(d.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reproduce-first + live gate
// ---------------------------------------------------------------------------

describe('Session 11 — goods bill three-way match gate (live path)', () => {
  it('REPRODUCTION: a goods bill with no line items cannot pass the match — held, GRNI stranded', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    expect(net(STOCK_ACCOUNTS.grni)).toBe(1000); // GRNI accrued (credit 1000)

    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-NL', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      // no `lines` — the header-only bill Session 10 proved cannot be matched
    });
    expect(bill.ok).toBe(true);
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(false); // FAIL CLOSED
    expect(approve.message).toContain('held');
    expect(bills.store.get(bill.record!.id)!.fields.status).toBe('draft'); // never approved
    await settle();
    // No relief posted → GRNI still stranded, no payable booked.
    expect(bal(STOCK_ACCOUNTS.grni, 'debit')).toBe(0);
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(0);
  });

  it('MATCHED goods bill relieves GRNI to zero and books AP', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-1', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10 }]),
    });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-1') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // credit 1000 (receipt) − debit 1000 (relief)
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(1000);
    expect(bal(STOCK_ACCOUNTS.purchasePriceVariance, 'debit')).toBe(0);
    // No Operating Expense hit — a goods bill relieves GRNI, it does not expense.
    expect(bal('5000', 'debit')).toBe(0);
  });

  it('within-tolerance overprice posts an unfavourable PPV; GRNI still nets to zero', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-PPVU', vendor: 'Acme', amount: 1005, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10.05 }]),
    });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-PPVU') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    expect(bal(STOCK_ACCOUNTS.purchasePriceVariance, 'debit')).toBe(5);
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(1005);
  });

  it('within-tolerance underprice posts a favourable PPV', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-PPVF', vendor: 'Acme', amount: 995, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 9.95 }]),
    });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-PPVF') > 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    expect(bal(STOCK_ACCOUNTS.purchasePriceVariance, 'credit')).toBe(5);
  });

  it('MISMATCH (billed qty exceeds received) fails closed — no posting', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-OVER', vendor: 'Acme', amount: 1200, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 120, unitPrice: 10 }]),
    });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(false);
    expect(bills.store.get(bill.record!.id)!.fields.status).toBe('draft');
    await settle();
    expect(bal(STOCK_ACCOUNTS.grni, 'debit')).toBe(0); // GRNI untouched
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(0);
  });

  it('MISMATCH (billed price beyond tolerance) fails closed — no posting', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-PX', vendor: 'Acme', amount: 1200, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 12 }]),
    });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(false);
    await settle();
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Service bill (no PO) — unchanged Operating Expense path
// ---------------------------------------------------------------------------

describe('Session 11 — service bill keeps the Operating Expense path', () => {
  it('a bill with no source PO books Dr Operating Expense 5000 / Cr AP 2000', async () => {
    const bill = await createIn('finance-vendor-bills', { billNumber: 'VB-SVC', vendor: 'Cloud Co', amount: 500, currency: 'USD' });
    const approve = await act('finance-vendor-bills', bill.record!.id, 'approve');
    expect(approve.ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-SVC') > 0);
    expect(bal('5000', 'debit')).toBe(500);
    expect(bal(STOCK_ACCOUNTS.accountsPayable, 'credit')).toBe(500);
    expect(bal(STOCK_ACCOUNTS.grni, 'debit')).toBe(0); // no GRNI on a service bill
  });
});

// ---------------------------------------------------------------------------
// Idempotency, reversal, end-to-end settlement, tenancy
// ---------------------------------------------------------------------------

describe('Session 11 — idempotency, reversal, settlement, tenancy', () => {
  it('repeated approval cannot double-post (one JE-BILL entry)', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-IDEM', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10 }]),
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => jeCount('JE-BILL-VB-IDEM') > 0);
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(false); // not draft
    await settle();
    expect(jeCount('JE-BILL-VB-IDEM')).toBe(1);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
  });

  it('cancelling a matched goods bill reverses the GRNI relief (GRNI returns to accrued)', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-REV', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10 }]),
    });
    await act('finance-vendor-bills', bill.record!.id, 'approve');
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    const cancelled = await act('finance-vendor-bills', bill.record!.id, 'cancel');
    expect(cancelled.ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.accountsPayable) === 0 && net(STOCK_ACCOUNTS.grni) === 1000);
    // Relief undone: GRNI back to the receipt accrual (net credit 1000); AP flat.
    expect(net(STOCK_ACCOUNTS.grni)).toBe(1000);
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(0);
  });

  it('E2E: receipt → matched bill → payment leaves GRNI = 0 and AP = 0', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 });
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-E2E', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10 }]),
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    const pay = await createIn('finance-vendor-payments', { paymentNumber: 'VPAY-E2E', billRef: 'VB-E2E', vendor: 'Acme', amount: 1000, currency: 'USD' });
    expect(pay.ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.accountsPayable) === 0 && bal('1000', 'credit') === 1000);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0); // received then invoiced
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(0); // billed then paid
    expect(bal('1000', 'credit')).toBe(1000); // cash out
  });

  it('cross-tenant: a goods bill cannot reference another tenant’s PO', async () => {
    await seedProduct('SKU-1', 10);
    const poId = await poAndReceipt({ sku: 'SKU-1', qty: 100, unitCost: 10 }); // tenant-A
    // Switch to tenant B: A's PO is invisible, so the bill's source-PO cannot resolve.
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-XT', vendor: 'Acme', amount: 1000, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-1', quantity: 100, unitPrice: 10 }]),
    });
    expect(bill.ok).toBe(false); // validate refuses a PO it cannot see
    expect(JSON.stringify(bill.errors ?? {})).toContain('purchase order');
  });
});

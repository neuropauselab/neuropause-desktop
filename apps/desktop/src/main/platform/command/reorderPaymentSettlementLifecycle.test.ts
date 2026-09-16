/**
 * ERP Session 93 — the S92 payment-ready Accounts-Payable liability (an APPROVED, three-way-matched
 * reorder supplier invoice) continues into the EXISTING governed supplier-payment path, reusing the
 * EXISTING commands/modules (no new payment engine, no second GL, no invented payment authority /
 * bank-reconciliation / reversal semantics):
 *
 *   approved goods bill (AP liability)
 *     → explicit operator PaySupplierInvoice command
 *     → exactly ONE cleared Vendor Payment (Dr Accounts Payable / Cr Cash, JE-VPAY-*)
 *     → the bill reconciles from the cleared ledger → paidDate stamped → AP SETTLED
 *
 * Eligibility (validate, source-of-truth): the bill must be APPROVED (a draft/held/cancelled bill is
 * refused — "approve it first"), the amount must be > 0, cumulative cleared may not exceed the bill
 * total (no overpay / no re-pay of a settled bill), and a duplicate transaction ref is refused.
 * Idempotency is DOUBLE-GUARDED: the durable journal dedups same-key replays (incl. across restart)
 * and the overpay guard refuses a distinct-key second full payment. The edit door cannot flip a
 * payment to cleared (S49) and a cleared payment cannot be deleted (S61 D6 / S64) — the ONLY unwind
 * is the governed ReverseVendorPayment, which creates an immutable reversal, leaves the original
 * untouched, re-opens the bill, and is itself fail-closed for a bank-reconciled payment (S55/S61).
 * Nothing is auto-paid; each step is an explicit governed action. AI stays advisory (§13).
 * ZERO production change — this is a certification/verification gate. S93 performs NO reversal in the
 * happy path; it only CERTIFIES the existing reversal/delete boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  PAYMENT_KIND,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { EnterpriseRecordStore } from '../../enterprise/framework';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { createPaymentReversalModule } from '../../enterprise/modules/finance/paymentReversalModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const paths: string[] = [];
const tmp = (t: string): string => { const p = join(tmpdir(), `np-s93-${t}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let authorized: EnterprisePermission[];
let ctx: EnterpriseModuleContext;
let handlers: ReturnType<typeof buildModuleHandlers>;

function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  registry = new EnterpriseModuleRegistry();
  const products = createProductModule(tmp('prod'));
  const pr = createPurchaseRequestModule(tmp('pr'));
  const po = createPurchaseOrderModule(tmp('po'));
  const gr = createGoodsReceiptModule(tmp('gr'));
  const shipping = createShippingModule(tmp('ship'));
  const accounts = createLedgerAccountModule(tmp('acct'));
  const bills = createVendorBillModule(tmp('bill'), po.store);
  const vendorPayments = createVendorPaymentModule(tmp('vpay'), bills.store);
  // A standalone customer-payments store handle for the reversal module's constructor (the customer
  // path is never exercised by these vendor-payment tests).
  const customerPaymentsStore = new EnterpriseRecordStore(tmp('cpay'), PAYMENTS_MODULE_ID, PAYMENT_KIND);
  const reversals = createPaymentReversalModule(tmp('rev'), customerPaymentsStore, vendorPayments.store);
  for (const m of [
    products, pr, po, gr, shipping, accounts, bills, vendorPayments, reversals,
    createStockMovementModule(tmp('mv')),
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handler = (channel: string) => {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
const deleteIn = (moduleId: string, id: string) =>
  handler(IpcChannel.EnterpriseModuleDelete)({ moduleId, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (moduleId: string) => registry.get(moduleId)!.store.list();
const rec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id);

function deps(ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps {
  return { registry, ctx: ctxOverride ?? ctx, resolveScope: () => scope, journal };
}
let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(seq += 1)}`, type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: 'corr_s93', idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z', source: 'test',
  };
}

const STANDARD_COST = 5;
const journalCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).length;
const clearedPayments = () => listIn(VENDOR_PAYMENTS_MODULE_ID).filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'cleared');
const reversalCount = () => listIn('finance-payment-reversals').filter((r) => r.status !== 'deleted').length;

/** Drive the reorder chain to an APPROVED, matched goods bill (a payment-ready AP liability). */
async function approvedBill(): Promise<{ billId: string; billNumber: string; vendor: string; total: number; qty: number }> {
  const vendor = 'Acme Supplies';
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
  const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
  const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder-exec:seed' }), deps());
  const prId = String(confirm.data!.id);
  const qty = Number(confirm.data!.quantity);
  await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub' }), deps());
  await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app' }), deps());
  await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv' }), deps());
  const po = listIn(PURCHASE_ORDERS_MODULE_ID).find((r) => String(r.fields.sourceRequest) === prId)!;
  await updateIn(PURCHASE_ORDERS_MODULE_ID, po.id, { warehouse: 'WH-1', supplier: vendor, unitCost: STANDARD_COST });
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'approve');
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'send');
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'receiveGoods');
  const gr = listIn(GOODS_RECEIPTS_MODULE_ID).find((r) => String(r.fields.purchaseOrder) === po.id)!;
  await dispatchCommand(cmd('PostGoodsReceipt', { target: gr.id, idem: `post:${gr.id}` }), deps());
  const total = qty * STANDARD_COST;
  const billNumber = `BILL-${randomUUID().slice(0, 8)}`;
  const bill = await createIn(VENDOR_BILLS_MODULE_ID, {
    billNumber, vendor, currency: 'USD', amount: total, sourcePurchaseOrder: String(po.fields.poNumber), status: 'draft',
    lines: JSON.stringify([{ sku: 'SKU-1', quantity: qty, unitPrice: STANDARD_COST }]),
  });
  const billId = bill.record!.id;
  expect((await dispatchCommand(cmd('ApproveSupplierInvoice', { target: billId, idem: `inv:${billId}` }), deps())).ok).toBe(true);
  expect(String(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.status)).toBe('approved');
  return { billId, billNumber, vendor, total, qty };
}

const pay = (billNumber: string, vendor: string, amount: number, idem: string, txnRef = idem) =>
  dispatchCommand(cmd('PaySupplierInvoice', {
    payload: { paymentNumber: `VPAY-${idem}`, billRef: billNumber, vendor, amount, transactionRef: txnRef },
    idem: `pay:${idem}`,
  }), deps());

// ─────────────────────── HAPPY PATH — pay the approved invoice → AP settled, exactly one payment ───────────────────────
describe('S93 payment — approved reorder invoice → PaySupplierInvoice → exactly one payment → AP settled', () => {
  it('pays the invoice through the governed command: one cleared payment, Dr AP / Cr Cash, bill settled', async () => {
    const { billId, billNumber, vendor, total } = await approvedBill();
    const journalBefore = journalCount();
    const paymentsBefore = clearedPayments().length;

    const paid = await pay(billNumber, vendor, total, 'one');
    expect(paid.ok).toBe(true);
    // exactly one cleared vendor payment
    expect(clearedPayments().length).toBe(paymentsBefore + 1);
    // canonical payment GL booked (Dr Accounts Payable / Cr Cash, JE-VPAY-*)
    expect(journalCount()).toBeGreaterThan(journalBefore);
    // AP SETTLED: the bill reconciled from the cleared ledger → paid
    const bill = rec(VENDOR_BILLS_MODULE_ID, billId)!;
    expect(String(bill.fields.status)).toBe('paid');
    expect(String(bill.fields.paidDate ?? '')).not.toBe('');
    expect(Number(bill.fields.amountPaid ?? 0)).toBe(total);
    expect(authorized).toContain('operations:manage');
  });
});

// ─────────────────────── IDEMPOTENCY / DUPLICATE / RESTART ───────────────────────
describe('S93 idempotency — one payment; no double-pay on replay, restart, or a second full payment', () => {
  it('same-key replay does not create a second payment or journal', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total, 'k')).ok).toBe(true);
    const oneJournal = journalCount();
    const onePayment = clearedPayments().length;
    const replay = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-k', billRef: billNumber, vendor, amount: total, transactionRef: 'pay:k' }, idem: 'pay:k' }), deps());
    expect(replay.replayed).toBe(true);
    expect(clearedPayments().length).toBe(onePayment);
    expect(journalCount()).toBe(oneJournal);
  });

  it('a distinct-key SECOND full payment is refused (overpay guard — already settled)', async () => {
    const { billId, billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total, 'a')).ok).toBe(true);
    const onePayment = clearedPayments().length;
    const second = await pay(billNumber, vendor, total, 'b');
    expect(second.ok).toBe(false); // exceeds the bill's remaining balance (0)
    expect(clearedPayments().length).toBe(onePayment);
    expect(Number(rec(VENDOR_BILLS_MODULE_ID, billId)!.fields.amountPaid ?? 0)).toBe(total);
  });

  it('replay across a durable-journal RESTART does not double-pay', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    const file = tmp('journal-restart');
    const j1 = new DurableCommandJournal(file);
    await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-r', billRef: billNumber, vendor, amount: total, transactionRef: 'pay:r' }, idem: 'pay:r' }), { registry, ctx, resolveScope: () => scope, journal: j1 });
    const onePayment = clearedPayments().length;
    const oneJournal = journalCount();
    const j2 = new DurableCommandJournal(file); // process restart
    const again = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-r', billRef: billNumber, vendor, amount: total, transactionRef: 'pay:r' }, idem: 'pay:r' }), { registry, ctx, resolveScope: () => scope, journal: j2 });
    expect(again.replayed).toBe(true);
    expect(clearedPayments().length).toBe(onePayment);
    expect(journalCount()).toBe(oneJournal);
  });

  it('a duplicate transaction reference is refused', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total / 2, 'p1', 'TXN-DUP')).ok).toBe(true);
    const dup = await pay(billNumber, vendor, total / 2, 'p2', 'TXN-DUP');
    expect(dup.ok).toBe(false);
  });
});

// ─────────────────────── ELIGIBILITY — an ineligible invoice cannot be paid ───────────────────────
describe('S93 eligibility — a draft/held/unmatched invoice cannot become paid', () => {
  it('a DRAFT (unapproved) bill cannot be paid — approve it first', async () => {
    // Build a receipt-backed but UNAPPROVED bill.
    const { billNumber, vendor, total } = await approvedBill();
    const draftNumber = `BILL-DRAFT-${randomUUID().slice(0, 6)}`;
    // Reference the same (real) PO number via the approved bill's source, but leave the bill draft.
    const src = String(rec(VENDOR_BILLS_MODULE_ID, (listIn(VENDOR_BILLS_MODULE_ID)[0]).id)!.fields.sourcePurchaseOrder);
    await createIn(VENDOR_BILLS_MODULE_ID, { billNumber: draftNumber, vendor, currency: 'USD', amount: total, sourcePurchaseOrder: src, status: 'draft' });
    const paymentsBefore = clearedPayments().length;
    const r = await pay(draftNumber, vendor, total, 'draftpay');
    expect(r.ok).toBe(false); // "Cannot pay a draft bill — approve it first."
    expect(clearedPayments().length).toBe(paymentsBefore);
    void billNumber;
  });

  it('paying more than the bill total is refused (overpay guard)', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    const r = await pay(billNumber, vendor, total + 100, 'over');
    expect(r.ok).toBe(false);
    expect(clearedPayments().length).toBe(0);
  });
});

// ─────────────────────── EDIT-DOOR + DELETE BOUNDARY — no forged/settled payment via a side door ───────────────────────
describe('S93 boundaries — clearing and deletion go only through the governed path', () => {
  it('a generic EDIT cannot flip a pending payment to cleared (S49 fence — no back-door AP settlement)', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    const pending = await createIn(VENDOR_PAYMENTS_MODULE_ID, { paymentNumber: 'VPAY-PEND', billRef: billNumber, vendor, amount: total, status: 'pending', transactionRef: 'TXN-PEND' });
    expect(pending.ok).toBe(true);
    const journalBefore = journalCount();
    const edit = await updateIn(VENDOR_PAYMENTS_MODULE_ID, pending.record!.id, { status: 'cleared' });
    expect(edit.ok).toBe(false); // clearing books the ledger — only the governed command may
    expect(String(rec(VENDOR_PAYMENTS_MODULE_ID, pending.record!.id)!.fields.status)).toBe('pending');
    expect(journalCount()).toBe(journalBefore);
  });

  it('a cleared payment cannot be DELETED — it must be reversed (S61 D6 economic delete guard)', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total, 'del')).ok).toBe(true);
    const payment = clearedPayments()[0];
    const del = await deleteIn(VENDOR_PAYMENTS_MODULE_ID, payment.id);
    expect(del.ok).toBe(false);
    expect(clearedPayments().some((p) => p.id === payment.id)).toBe(true); // still there, still cleared
  });
});

// ─────────────────────── REVERSAL BOUNDARY — the only unwind; original immutable; bank-recon fail-closed ───────────────────────
describe('S93 reversal boundary — cleared payment reverses only through the governed reversal', () => {
  it('ReverseVendorPayment creates an immutable reversal, leaves the original untouched, and re-opens the bill', async () => {
    const { billId, billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total, 'rv')).ok).toBe(true);
    const payment = clearedPayments()[0];
    const priorFields = JSON.stringify(payment.fields);
    const journalBefore = journalCount();

    const reverse = await dispatchCommand(cmd('ReverseVendorPayment', { target: payment.id, payload: { reason: 'wrong supplier' }, idem: 'rev1' }), deps());
    expect(reverse.ok).toBe(true);
    expect(reversalCount()).toBe(1);
    // the ORIGINAL payment is immutable — still cleared, fields unchanged
    const after = rec(VENDOR_PAYMENTS_MODULE_ID, payment.id)!;
    expect(String(after.fields.status)).toBe('cleared');
    expect(JSON.stringify(after.fields)).toBe(priorFields);
    // compensating -REV GL booked; the bill re-opened (paid amount excludes the reversed payment)
    expect(journalCount()).toBeGreaterThan(journalBefore);
    const bill = rec(VENDOR_BILLS_MODULE_ID, billId)!;
    expect(Number(bill.fields.amountPaid ?? 0)).toBe(0);
    expect(String(bill.fields.paidDate ?? '')).toBe('');

    // at-most-one reversal per payment
    const again = await dispatchCommand(cmd('ReverseVendorPayment', { target: payment.id, payload: { reason: 'again' }, idem: 'rev2' }), deps());
    expect(again.ok).toBe(false);
    expect(reversalCount()).toBe(1);
  });

  it('a BANK-RECONCILED payment cannot be reversed here (fail-closed — S55/S61 boundary preserved)', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    expect((await pay(billNumber, vendor, total, 'br')).ok).toBe(true);
    const payment = clearedPayments()[0];
    // Simulate the bank-statement write-back (FW-8) that stamps the payment as reconciled.
    registry.get(VENDOR_PAYMENTS_MODULE_ID)!.store.update(payment.id, { fields: { bankReconciledAt: '2026-09-02T00:00:00.000Z', bankStatementRef: 'BS-1' }, actor: 'system', now: '2026-09-02T00:00:00.000Z' });
    const reverse = await dispatchCommand(cmd('ReverseVendorPayment', { target: payment.id, payload: { reason: 'oops' }, idem: 'revbr' }), deps());
    expect(reverse.ok).toBe(false); // bank-reconciled → refused
    expect(reversalCount()).toBe(0);
  });
});

// ─────────────────────── SECURITY / TENANT ───────────────────────
describe('S93 security — payment authority + tenancy fail closed', () => {
  it('PaySupplierInvoice requires operations:manage — a denied actor cannot pay', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    const denied = await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-D', billRef: billNumber, vendor, amount: total, transactionRef: 'TXN-D' }, idem: 'payd' }), deps(makeCtx('operations:manage')));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('UNAUTHORIZED');
    expect(clearedPayments().length).toBe(0);
  });

  it('NO_TENANT / forged tenant / cross-tenant payment fail closed', async () => {
    const { billNumber, vendor, total } = await approvedBill();
    scope = null;
    expect((await pay(billNumber, vendor, total, 't1')).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('PaySupplierInvoice', { payload: { paymentNumber: 'VPAY-T', billRef: billNumber, vendor, amount: total, transactionRef: 'TXN-T' }, idem: 't2', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' }; // a foreign tenant cannot see the bill
    const foreign = await pay(billNumber, vendor, total, 't3');
    expect(foreign.ok).toBe(false);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(clearedPayments().length).toBe(0);
  });
});

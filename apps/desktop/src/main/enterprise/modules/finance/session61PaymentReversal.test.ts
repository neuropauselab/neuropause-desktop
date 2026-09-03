/**
 * ERP Session 61 — GOVERNED PAYMENT REVERSAL (D4) accounting core.
 *
 * These pins exercise the payment-reversal MODULE + its GL handler + the shared
 * reconciler directly (the command-bus/IPC governance is proven separately),
 * against real ledger/journal/invoice/bill stores. They certify the operator's
 * D4 constraints on the accounting itself:
 *   • the ORIGINAL payment record and its ORIGINAL journal entry are immutable —
 *     never flipped to pending/void/deleted, never overwritten;
 *   • reversing books a COMPENSATING mirror that NETS the cash/AR (or cash/AP)
 *     effect to zero, at the original amounts, with no fabricated accounts;
 *   • the referenced invoice/bill RE-OPENS (paid amount drops, status reverts);
 *   • at most ONE effective reversal per payment (deterministic replay);
 *   • a non-cleared, bank-reconciled, or nonexistent payment is refused.
 *
 * Reproduce-first: BEFORE S61, the ONLY way to reverse a cleared payment's GL was
 * to mutate the original (status void / soft-delete), which the operator forbids.
 * The first pin demonstrates that the original stays byte-identical under the new
 * governed reversal — the property the old void/delete path could not provide.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  glAccountFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createPaymentModule } from './paymentModule';
import { createVendorBillModule } from './vendorBillModule';
import { createVendorPaymentModule } from './vendorPaymentModule';
import { createPaymentReversalModule, PAYMENT_REVERSAL_DESCRIPTOR } from './paymentReversalModule';
import { PAYMENT_REVERSALS_MODULE_ID } from './paymentReconcile';

const T0 = '2026-09-03T00:00:00.000Z';

describe('S61 · D4 governed payment reversal — the accounting core', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let payments: EnterpriseModule;
  let vendorBills: EnterpriseModule;
  let vendorPayments: EnterpriseModule;
  let reversals: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-s61-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    payments = createPaymentModule(join(dir, 'pay.json'), invoices.store);
    vendorBills = createVendorBillModule(join(dir, 'bills.json'));
    vendorPayments = createVendorPaymentModule(join(dir, 'vpay.json'), vendorBills.store);
    reversals = createPaymentReversalModule(join(dir, 'rev.json'), payments.store, vendorPayments.store);
    await Promise.all([accounts, journal, invoices, payments, vendorBills, vendorPayments, reversals].map((m) => m.store.load()));
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === FINANCE_MODULE_ID ? invoices
        : id === PAYMENTS_MODULE_ID ? payments
        : id === VENDOR_BILLS_MODULE_ID ? vendorBills
        : id === VENDOR_PAYMENTS_MODULE_ID ? vendorPayments
        : id === PAYMENT_REVERSALS_MODULE_ID ? reversals
        : null,
      emit: () => undefined,
    };
  });
  afterEach(async () => {
    await Promise.all([accounts, journal, invoices, payments, vendorBills, vendorPayments, reversals].map((m) => m.store.flush()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };
  const seedIssuedInvoice = (number: string, amount: number): EnterpriseEntity =>
    invoices.store.create({ title: number, fields: { number, customer: 'Acme', currency: 'USD', status: 'issued', amount, taxRate: 0, amountPaid: 0 } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
  const seedApprovedBill = (number: string, amount: number): EnterpriseEntity =>
    vendorBills.store.create({ title: number, fields: { billNumber: number, vendor: 'Globex', currency: 'USD', status: 'approved', approvedAt: T0, amount, taxRate: 0, total: amount, amountPaid: 0 } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });

  // create a CLEARED customer payment and fire its onChange (books Dr Cash / Cr AR + reconciles).
  const clearedCustomerPayment = async (num: string, invoiceRef: string, amount: number, extra: Record<string, unknown> = {}): Promise<EnterpriseEntity> => {
    const rec = payments.store.create({ title: num, fields: { paymentNumber: num, invoiceRef, amount, status: 'cleared', currency: 'USD', ...extra } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
    await payments.hooks.onChange!({ record: rec }, ctx);
    return payments.store.get(rec.id)!;
  };
  const clearedVendorPayment = async (num: string, billRef: string, amount: number): Promise<EnterpriseEntity> => {
    const rec = vendorPayments.store.create({ title: num, fields: { paymentNumber: num, billRef, amount, status: 'cleared', currency: 'USD' } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
    await vendorPayments.hooks.onChange!({ record: rec }, ctx);
    return vendorPayments.store.get(rec.id)!;
  };
  // create + fire a reversal record the way the governed command does (validate → create → onChange).
  const reverse = async (kind: 'customer' | 'vendor', originalId: string, reason = 'bounced'): Promise<{ ok: boolean; error?: string; record?: EnterpriseEntity }> => {
    const v = reversals.hooks.validate!({ fields: { originalKind: kind, originalPaymentId: originalId, reason } });
    if (!v.ok) return { ok: false, error: JSON.stringify('errors' in v ? v.errors : {}) };
    const rec = reversals.store.create({ title: String(v.values.reversalNumber), fields: v.values, actor: 't@np', now: T0 });
    await reversals.hooks.onChange!({ record: rec }, ctx);
    return { ok: true, record: rec };
  };

  // ── reproduce-first + positive: customer reversal nets to zero, original immutable ──
  it('customer · a governed reversal unwinds the cash/AR effect, RE-OPENS the invoice, and leaves the original payment + its journal byte-identical', async () => {
    seedIssuedInvoice('INV-1', 100);
    const pay = await clearedCustomerPayment('PAY-1', 'INV-1', 100);
    expect(balanceOf('1000')).toBe(100); // Cash debited
    expect(balanceOf('1100')).toBe(-100); // AR credited (settled)
    expect(String(invoices.store.list().find((r) => r.fields.number === 'INV-1')!.fields.status)).toBe('paid');
    const journalBefore = journal.store.list().map((r) => ({ n: String(r.fields.entryNumber), lines: JSON.stringify(r.fields.lines) }));
    const paySnapshot = JSON.stringify(pay.fields);

    const r = await reverse('customer', pay.id);
    expect(r.ok, r.error).toBe(true);

    // compensating GL nets both control accounts to zero
    expect(balanceOf('1000')).toBe(0);
    expect(balanceOf('1100')).toBe(0);
    // the invoice re-opens (paid → issued, amountPaid 0)
    const inv = invoices.store.list().find((r2) => r2.fields.number === 'INV-1')!;
    expect(Number(inv.fields.amountPaid)).toBe(0);
    expect(String(inv.fields.status)).toBe('issued');
    // the ORIGINAL payment is byte-identical (immutable historical truth)
    expect(JSON.stringify(payments.store.get(pay.id)!.fields)).toBe(paySnapshot);
    expect(String(payments.store.get(pay.id)!.fields.status)).toBe('cleared');
    // the ORIGINAL journal entry is preserved untouched; a NEW -REV entry was added
    const after = journal.store.list().map((r2) => ({ n: String(r2.fields.entryNumber), lines: JSON.stringify(r2.fields.lines) }));
    for (const before of journalBefore) {
      expect(after.find((a) => a.n === before.n)!.lines).toBe(before.lines); // original entry unchanged
    }
    expect(after.some((a) => a.n.endsWith('-REV'))).toBe(true);
    expect(after.length).toBe(journalBefore.length + 1);
  });

  // ── positive: vendor reversal nets to zero, bill re-opens ──
  it('vendor · a governed reversal unwinds the cash/AP effect and re-opens the bill', async () => {
    seedApprovedBill('BILL-1', 80);
    const vp = await clearedVendorPayment('VPAY-1', 'BILL-1', 80);
    expect(balanceOf('1000')).toBe(-80); // Cash credited (paid out)
    const apAfterPay = balanceOf('2000'); // AP debited by the payment (reduces the payable)
    expect(apAfterPay).not.toBe(0);
    const billPaid = vendorBills.store.list().find((r) => r.fields.billNumber === 'BILL-1')!;
    expect(String(billPaid.fields.status)).toBe('paid');

    const r = await reverse('vendor', vp.id);
    expect(r.ok, r.error).toBe(true);
    expect(balanceOf('1000')).toBe(0); // cash restored
    expect(balanceOf('2000')).toBe(0); // AP restored to pre-payment (base + reversal net to zero)
    const bill = vendorBills.store.list().find((r2) => r2.fields.billNumber === 'BILL-1')!;
    expect(Number(bill.fields.amountPaid)).toBe(0);
    expect(String(bill.fields.status)).toBe('approved'); // re-opened
    expect(String(vendorPayments.store.get(vp.id)!.fields.status)).toBe('cleared'); // original immutable
  });

  // ── idempotency / at-most-one ──
  it('a payment cannot be reversed twice — the second reversal is refused and books no second -REV', async () => {
    seedIssuedInvoice('INV-2', 50);
    const pay = await clearedCustomerPayment('PAY-2', 'INV-2', 50);
    expect((await reverse('customer', pay.id)).ok).toBe(true);
    const journalAfterFirst = journal.store.list().length;
    const second = await reverse('customer', pay.id);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been reversed/i);
    expect(journal.store.list().length).toBe(journalAfterFirst); // no duplicate GL
  });

  // ── the -REV GL itself is idempotent even if the handler re-fires on the same record ──
  it('re-firing the reversal onChange books no second -REV (deterministic entry number)', async () => {
    seedIssuedInvoice('INV-3', 50);
    const pay = await clearedCustomerPayment('PAY-3', 'INV-3', 50);
    const r = await reverse('customer', pay.id);
    expect(r.ok).toBe(true);
    const count = journal.store.list().length;
    await reversals.hooks.onChange!({ record: r.record! }, ctx); // replay
    expect(journal.store.list().length).toBe(count);
    expect(balanceOf('1000')).toBe(0);
    expect(balanceOf('1100')).toBe(0);
  });

  // ── guards ──
  it('refuses reversing a non-cleared (pending) payment', async () => {
    seedIssuedInvoice('INV-4', 50);
    const pending = payments.store.create({ title: 'PAY-4', fields: { paymentNumber: 'PAY-4', invoiceRef: 'INV-4', amount: 50, status: 'pending', currency: 'USD' } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
    const r = await reverse('customer', pending.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only a cleared payment/i);
  });

  it('refuses reversing a BANK-RECONCILED payment (S55 — do not erase bank evidence)', async () => {
    seedIssuedInvoice('INV-5', 50);
    const pay = await clearedCustomerPayment('PAY-5', 'INV-5', 50, { bankReconciledAt: '2026-09-01T00:00:00Z', bankStatementRef: 'BS-1' });
    const r = await reverse('customer', pay.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bank-reconciled/i);
    // the original stays paid + untouched
    expect(String(payments.store.get(pay.id)!.fields.status)).toBe('cleared');
  });

  it('refuses reversing a nonexistent payment', async () => {
    const r = await reverse('customer', 'does-not-exist');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no matching payment/i);
  });

  it('refuses editing an existing reversal record (immutable evidence)', async () => {
    seedIssuedInvoice('INV-6', 50);
    const pay = await clearedCustomerPayment('PAY-6', 'INV-6', 50);
    const r = await reverse('customer', pay.id);
    expect(r.ok).toBe(true);
    const edit = reversals.hooks.validate!({ fields: { ...r.record!.fields, reason: 'changed' } as EnterpriseEntity['fields'], recordId: r.record!.id } as never);
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toMatch(/immutable/i);
  });

  // ── re-open consistency: a later payment on a re-opened invoice sums WITHOUT the reversed one ──
  it('after a reversal, a NEW payment on the same invoice does not re-count the reversed one', async () => {
    seedIssuedInvoice('INV-7', 100);
    const pay = await clearedCustomerPayment('PAY-7A', 'INV-7', 100);
    expect((await reverse('customer', pay.id)).ok).toBe(true);
    // invoice re-opened to 0; a fresh 60 payment must leave amountPaid = 60, not 160
    await clearedCustomerPayment('PAY-7B', 'INV-7', 60);
    const inv = invoices.store.list().find((r) => r.fields.number === 'INV-7')!;
    expect(Number(inv.fields.amountPaid)).toBe(60);
    expect(String(inv.fields.status)).toBe('partially_paid');
  });

  it('the reversal descriptor carries no user-forgeable authority fields (evidence is stamped from the original)', () => {
    // originalPaymentNumber / documentRef / amount / currency are readOnly — proof they are
    // derived from the original payment, not accepted from the caller.
    const ro = PAYMENT_REVERSAL_DESCRIPTOR.fields.filter((f) => f.readOnly).map((f) => f.key);
    expect(ro).toEqual(expect.arrayContaining(['originalPaymentNumber', 'documentRef', 'amount', 'currency']));
  });
});

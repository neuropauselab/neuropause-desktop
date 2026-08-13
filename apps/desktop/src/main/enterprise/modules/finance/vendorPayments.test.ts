import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  glAccountFromRecord,
  isDuplicateVendorTransaction,
  sumClearedVendorPayments,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createVendorBillModule } from './vendorBillModule';
import { createVendorPaymentModule } from './vendorPaymentModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('vendor-payment domain rules (pure)', () => {
  const pay = (over: Record<string, unknown>) =>
    vendorPaymentFromRecord({
      id: 'p', moduleId: VENDOR_PAYMENTS_MODULE_ID, kind: 'vendorPayment', title: '', status: 'active',
      fields: { paymentNumber: 'VPAY-1', billRef: 'BILL-1', amount: 50, status: 'cleared', transactionRef: 'T1', ...over } as EnterpriseEntity['fields'],
      tags: [], rev: 1, createdAt: T0, updatedAt: T0, createdBy: null, updatedBy: null, metadata: {},
    });
  it('sums only cleared payments for the referenced bill, by id or number', () => {
    const ledger = [pay({}), pay({ paymentNumber: 'VPAY-2', amount: 30, status: 'void' }), pay({ paymentNumber: 'VPAY-3', billRef: 'OTHER', amount: 99 })];
    expect(sumClearedVendorPayments(['BILL-1', 'rec_id'], ledger)).toBe(50);
  });
  it('flags duplicate transaction references from OTHER payments only', () => {
    const ledger = [pay({})];
    expect(isDuplicateVendorTransaction(ledger, 'T1', 'VPAY-9')).toBe(true);
    expect(isDuplicateVendorTransaction(ledger, 'T1', 'VPAY-1')).toBe(false);
    expect(isDuplicateVendorTransaction(ledger, '', 'VPAY-9')).toBe(false);
  });
});

describe('Vendor Payments over real stores — partials, guards, reconciliation, void', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let bills: EnterpriseModule;
  let payments: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-vpay-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    bills = createVendorBillModule(join(dir, 'bills.json'));
    payments = createVendorPaymentModule(join(dir, 'vpay.json'), bills.store);
    await Promise.all([accounts.store.load(), journal.store.load(), bills.store.load(), payments.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === VENDOR_BILLS_MODULE_ID ? bills
        : id === VENDOR_PAYMENTS_MODULE_ID ? payments
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), bills.store.flush(), payments.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };

  const approvedBill = async (billNumber: string, amount: number, taxRate: number): Promise<EnterpriseEntity> => {
    const v = bills.hooks.validate({ fields: { billNumber, vendor: 'Supplies Co', amount, taxRate, currency: 'USD', status: 'draft' } });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = bills.store.create({ title: billNumber, fields: v.values, actor: 't@np', now: T0 });
    await bills.hooks.runAction!('approve', rec, ctx);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx);
    return bills.store.get(rec.id)!;
  };

  const clearedPayment = async (paymentNumber: string, billRef: string, amount: number, transactionRef = ''): Promise<EnterpriseEntity> => {
    const v = payments.hooks.validate({ fields: { paymentNumber, billRef, amount, currency: 'USD', method: 'bank_transfer', status: 'cleared', transactionRef } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = payments.store.create({ title: paymentNumber, fields: v.values, actor: 't@np', now: T0 });
    await payments.hooks.onChange!({ action: 'created', record: rec }, ctx);
    return rec;
  };

  it('partial payments accumulate; the bill flips to paid exactly at full coverage', async () => {
    const bill = await approvedBill('BILL-1', 100, 18); // total 118
    await clearedPayment('VPAY-1', 'BILL-1', 60, 'TXN-A');
    let view = vendorBillFromRecord(bills.store.get(bill.id)!);
    expect(view.amountPaid).toBe(60);
    expect(view.outstanding).toBe(58);
    expect(view.status).toBe('approved'); // partially paid stays open
    expect(balanceOf('2000')).toBe(58); // AP reduced by the partial
    expect(balanceOf('1000')).toBe(-60);
    await clearedPayment('VPAY-2', 'BILL-1', 58, 'TXN-B');
    view = vendorBillFromRecord(bills.store.get(bill.id)!);
    expect(view.status).toBe('paid');
    expect(view.outstanding).toBe(0);
    expect(balanceOf('2000')).toBe(0);
    expect(balanceOf('1000')).toBe(-118);
  });

  it('refuses overpayment (stating the remainder), duplicate references, and unpayable bills', async () => {
    await approvedBill('BILL-2', 100, 0); // total 100
    await clearedPayment('VPAY-3', 'BILL-2', 70, 'TXN-C');
    const over = payments.hooks.validate({ fields: { paymentNumber: 'VPAY-4', billRef: 'BILL-2', amount: 31, currency: 'USD', method: 'bank_transfer', status: 'cleared' } });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(JSON.stringify(over.errors)).toContain('remaining balance (30)');
    const dup = payments.hooks.validate({ fields: { paymentNumber: 'VPAY-5', billRef: 'BILL-2', amount: 10, currency: 'USD', method: 'bank_transfer', status: 'cleared', transactionRef: 'TXN-C' } });
    expect(dup.ok).toBe(false);
    // Draft bills cannot be paid; unknown refs are refused.
    const dv = bills.hooks.validate({ fields: { billNumber: 'BILL-3', vendor: 'V', amount: 10, taxRate: 0, currency: 'USD', status: 'draft' } });
    if (dv.ok) bills.store.create({ title: 'BILL-3', fields: dv.values, actor: 't@np', now: T0 });
    expect(payments.hooks.validate({ fields: { paymentNumber: 'VPAY-6', billRef: 'BILL-3', amount: 5, currency: 'USD', method: 'bank_transfer', status: 'cleared' } }).ok).toBe(false);
    expect(payments.hooks.validate({ fields: { paymentNumber: 'VPAY-7', billRef: 'NOPE', amount: 5, currency: 'USD', method: 'bank_transfer', status: 'cleared' } }).ok).toBe(false);
  });

  it('voiding a payment reverses its booking and un-pays the bill', async () => {
    const bill = await approvedBill('BILL-4', 50, 0);
    const pay = await clearedPayment('VPAY-8', 'BILL-4', 50, 'TXN-D');
    expect(vendorBillFromRecord(bills.store.get(bill.id)!).status).toBe('paid');
    payments.store.update(pay.id, { fields: { status: 'void' }, actor: 't@np', now: T0 });
    await payments.hooks.onChange!({ action: 'updated', record: payments.store.get(pay.id)! }, ctx);
    const view = vendorBillFromRecord(bills.store.get(bill.id)!);
    expect(view.status).toBe('approved'); // un-paid, back to open
    expect(view.amountPaid).toBe(0);
    expect(balanceOf('2000')).toBe(50); // AP restored
    expect(balanceOf('1000')).toBe(0); // cash restored
  });
});

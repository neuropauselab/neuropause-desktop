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
  vendorBillFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createVendorBillModule } from './vendorBillModule';
import { createVendorPaymentModule } from './vendorPaymentModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('AP multi-currency — functional booking + realized FX on settlement', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let bills: EnterpriseModule;
  let payments: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-apfx-${randomUUID()}`);
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
        id === LEDGER_ACCOUNTS_MODULE_ID
          ? accounts
          : id === JOURNAL_ENTRIES_MODULE_ID
            ? journal
            : id === VENDOR_BILLS_MODULE_ID
              ? bills
              : id === VENDOR_PAYMENTS_MODULE_ID
                ? payments
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

  const approvedBill = async (
    billNumber: string,
    amount: number,
    taxRate: number,
    currency = 'USD',
    exchangeRate = 1,
  ): Promise<EnterpriseEntity> => {
    const v = bills.hooks.validate({ fields: { billNumber, vendor: 'Supplies Co', amount, taxRate, currency, exchangeRate, status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = bills.store.create({ title: billNumber, fields: v.values, actor: 't@np', now: T0 });
    await bills.hooks.runAction!('approve', rec, ctx);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx);
    return bills.store.get(rec.id)!;
  };

  const clearedPayment = async (
    paymentNumber: string,
    billRef: string,
    amount: number,
    currency = 'USD',
    exchangeRate = 1,
  ): Promise<EnterpriseEntity> => {
    const v = payments.hooks.validate({ fields: { paymentNumber, billRef, amount, currency, exchangeRate, method: 'bank_transfer', status: 'cleared' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = payments.store.create({ title: paymentNumber, fields: v.values, actor: 't@np', now: T0 });
    await payments.hooks.onChange!({ action: 'created', record: rec }, ctx);
    return rec;
  };

  it('single-currency AP is byte-identical — functional equals original, no FX line', async () => {
    const bill = await approvedBill('BILL-1', 100, 0); // USD, rate 1
    expect(Number(bills.store.get(bill.id)!.fields.functionalTotal)).toBe(100);
    expect(balanceOf('2000')).toBe(100); // Cr AP 100
    expect(balanceOf('5000')).toBe(100); // Dr Operating Expense 100
    await clearedPayment('VPAY-1', 'BILL-1', 100);
    expect(balanceOf('2000')).toBe(0); // AP cleared
    expect(balanceOf('1000')).toBe(-100); // Cash paid
    expect(balanceOf('7810')).toBe(0); // no realized FX — 7810 never created
  });

  it('books a foreign bill at the FUNCTIONAL amount and stamps functionalTotal', async () => {
    const bill = await approvedBill('BILL-EUR', 1000, 0, 'EUR', 1.2);
    expect(vendorBillFromRecord(bills.store.get(bill.id)!).exchangeRate).toBe(1.2);
    expect(Number(bills.store.get(bill.id)!.fields.functionalTotal)).toBe(1200); // 1000 × 1.2
    expect(balanceOf('2000')).toBe(1200); // AP booked in functional currency
    expect(balanceOf('5000')).toBe(1200); // Operating Expense in functional currency
  });

  it('books a realized FX LOSS when the payable settles at a higher rate; AP reconciles to zero', async () => {
    await approvedBill('BILL-EUR', 1000, 0, 'EUR', 1.2); // AP booked at 1200 functional
    await clearedPayment('VPAY-EUR', 'BILL-EUR', 1000, 'EUR', 1.3); // settle at 1.3
    expect(balanceOf('2000')).toBe(0); // AP cleared at the BOOKING rate (Dr 1200)
    expect(balanceOf('1000')).toBe(-1300); // Cash out at the SETTLEMENT rate (Cr 1300)
    expect(balanceOf('7810')).toBe(100); // paid 100 more functional than booked → realized loss (Dr)
  });

  it('books a realized FX GAIN when the payable settles at a lower rate', async () => {
    await approvedBill('BILL-EUR2', 1000, 0, 'EUR', 1.2); // AP booked at 1200 functional
    await clearedPayment('VPAY-EUR2', 'BILL-EUR2', 1000, 'EUR', 1.1); // settle at 1.1
    expect(balanceOf('2000')).toBe(0); // AP cleared (Dr 1200)
    expect(balanceOf('1000')).toBe(-1100); // Cash out at settlement (Cr 1100)
    expect(balanceOf('7810')).toBe(-100); // paid 100 less → realized gain (Cr → negative expense)
  });
});

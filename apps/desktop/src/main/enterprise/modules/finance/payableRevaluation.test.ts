import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FX_UNREALIZED_ACCOUNT,
  GL_CONTROL_ACCOUNTS,
  GL_PAYABLE_CONTROL_ACCOUNTS,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  derivePayableRevaluation,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  unrealizedRevaluationLines,
} from '@neuropause/shared';
import type { ExchangeRate, GlJournalLine, VendorBill, EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createExchangeRateModule } from './exchangeRateModule';
import { createAccountingPeriodModule } from './accountingPeriodModule';
import { createVendorBillModule } from './vendorBillModule';
import { createFxRevaluationModule } from './fxRevaluationModule';

const T0 = '2026-08-06T00:00:00.000Z';
const AP = GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code; // 2000
const AR = GL_CONTROL_ACCOUNTS.accountsReceivable.code; // 1100
const FX = FX_UNREALIZED_ACCOUNT.code; // 7811

const mkBill = (over: Partial<VendorBill>): VendorBill => ({
  id: 'b',
  billNumber: 'BILL',
  vendor: 'Supplies Co',
  vendorGstin: '',
  amount: 0,
  taxRate: 0,
  taxAmount: 0,
  total: 0,
  currency: 'USD',
  exchangeRate: 1,
  status: 'approved',
  billDate: '2026-01-01',
  dueDate: '',
  paidDate: '',
  paymentReference: '',
  sourcePurchaseOrder: '',
  amountPaid: 0,
  outstanding: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});
const mkRate = (fromCurrency: string, toCurrency: string, rate: number, effectiveFrom: string): ExchangeRate => ({
  id: `${fromCurrency}-${toCurrency}-${effectiveFrom}`,
  fromCurrency,
  toCurrency,
  rate,
  effectiveFrom,
  source: 'test',
  lockedAt: null,
  createdAt: T0,
  updatedAt: T0,
});
const shape = (lines: readonly GlJournalLine[]): Array<{ account: string; debit: number; credit: number }> =>
  lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));

describe('Unrealized payable revaluation engine (pure)', () => {
  it('books a LOSS when the period-end rate rises (liability grows)', () => {
    const res = derivePayableRevaluation({
      bills: [mkBill({ billNumber: 'BILL-1', currency: 'EUR', outstanding: 1000, exchangeRate: 1.2, status: 'approved' })],
      rates: [mkRate('EUR', 'USD', 1.3, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(1);
    expect(res.payableDelta).toBe(100); // 1000×1.3 − 1000×1.2 (AP carrying value up)
    expect(res.unrealizedGainLoss).toBe(-100); // liability up = LOSS
    expect(res.skippedNoRate).toBe(0);
  });

  it('books a GAIN when the period-end rate falls (liability shrinks)', () => {
    const res = derivePayableRevaluation({
      bills: [mkBill({ billNumber: 'BILL-2', currency: 'EUR', outstanding: 1000, exchangeRate: 1.2, status: 'approved' })],
      rates: [mkRate('EUR', 'USD', 1.1, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.payableDelta).toBe(-100);
    expect(res.unrealizedGainLoss).toBe(100); // liability down = GAIN
  });

  it('excludes functional-currency, non-approved, and settled bills; counts no-rate skips', () => {
    const res = derivePayableRevaluation({
      bills: [
        mkBill({ billNumber: 'USD-1', currency: 'USD', outstanding: 1000, exchangeRate: 1, status: 'approved' }), // functional
        mkBill({ billNumber: 'DRAFT', currency: 'EUR', outstanding: 1000, exchangeRate: 1.2, status: 'draft' }),
        mkBill({ billNumber: 'PAID', currency: 'EUR', outstanding: 0, exchangeRate: 1.2, status: 'paid' }),
        mkBill({ billNumber: 'GBP-1', currency: 'GBP', outstanding: 500, exchangeRate: 1.25, status: 'approved' }), // no rate
      ],
      rates: [mkRate('EUR', 'USD', 1.3, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(0);
    expect(res.payableDelta).toBe(0);
    expect(res.skippedNoRate).toBe(1); // the GBP bill
  });

  it('builds a balanced combined AR+AP revaluation entry (net gain to 7811)', () => {
    // Receivable up 50 (Dr AR), payable down 25 (Dr AP), net 75 credit to FX.
    const lines = unrealizedRevaluationLines({ receivableDelta: 50, payableDelta: -25, receivableCode: AR, payableCode: AP, fxCode: FX });
    expect(shape(lines)).toEqual([
      { account: AR, debit: 50, credit: 0 },
      { account: AP, debit: 25, credit: 0 },
      { account: FX, debit: 0, credit: 75 },
    ]);
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });
});

describe('FX revaluation module — payables side over a real ledger', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let rates: EnterpriseModule;
  let periods: EnterpriseModule;
  let bills: EnterpriseModule;
  let fxreval: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-apreval-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    rates = createExchangeRateModule(join(dir, 'rates.json'));
    periods = createAccountingPeriodModule(join(dir, 'periods.json'));
    bills = createVendorBillModule(join(dir, 'bills.json'));
    fxreval = createFxRevaluationModule(join(dir, 'fxreval.json'), invoices.store, rates.store, periods.store, bills.store);
    await Promise.all([accounts, journal, invoices, rates, periods, bills, fxreval].map((m) => m.store.load()));
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
              : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts, journal, invoices, rates, periods, bills, fxreval].map((m) => m.store.flush()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };
  const addRate = (from: string, to: string, rate: number, effectiveFrom: string): void => {
    const v = rates.hooks.validate({ fields: { fromCurrency: from, toCurrency: to, rate, effectiveFrom } });
    if (v.ok) rates.store.create({ title: `${from}-${to}`, fields: v.values, actor: 't@np', now: T0 });
  };
  const approvedBill = async (billNumber: string, amount: number, currency: string, exchangeRate: number): Promise<EnterpriseEntity> => {
    const v = bills.hooks.validate({ fields: { billNumber, vendor: 'Supplies Co', amount, taxRate: 0, currency, exchangeRate, status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = bills.store.create({ title: billNumber, fields: v.values, actor: 't@np', now: T0 });
    await bills.hooks.runAction!('approve', rec, ctx);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx); // books AP functional
    return bills.store.get(rec.id)!;
  };
  const generate = async (period: string) => {
    const v = fxreval.hooks.validate({ fields: { period } });
    if (v.ok) {
      const rec = fxreval.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
      await fxreval.hooks.onChange!({ action: 'created', record: rec }, ctx);
    }
    return v;
  };

  it('revalues an open foreign payable, posts Cr AP / Dr 7811, and reverses to zero next period', async () => {
    await approvedBill('BILL-EUR', 1000, 'EUR', 1.2); // AP booked at 1200 functional
    expect(balanceOf(AP)).toBe(1200);
    addRate('EUR', 'USD', 1.3, '2026-08-15'); // period-end rate up → payable grew

    const v = await generate('2026-08');
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.payableDelta).toBe(100); // 1000 × (1.3 − 1.2)
    expect(v.values.receivableDelta).toBe(0);
    expect(v.values.unrealizedGainLoss).toBe(-100); // liability grew → loss
    expect(v.values.revaluedCount).toBe(1);

    const entries = journal.store.list().map(glJournalEntryFromRecord);
    const reval = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08');
    const reversal = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08-REV');
    if (!reval || !reversal) throw new Error('entries not posted');
    expect(reval.entryDate).toBe('2026-08-31');
    expect(shape(reval.lines)).toEqual([
      { account: AP, debit: 0, credit: 100 }, // AP carrying value raised
      { account: FX, debit: 100, credit: 0 }, // unrealized loss
    ]);
    expect(reversal.entryDate).toBe('2026-09-01');
    expect(shape(reversal.lines)).toEqual([
      { account: AP, debit: 100, credit: 0 },
      { account: FX, debit: 0, credit: 100 },
    ]);

    // Across the boundary the unrealized entry nets to zero: AP back to booked, 7811 flat.
    expect(balanceOf(AP)).toBe(1200);
    expect(balanceOf(FX)).toBe(0);
  });
});

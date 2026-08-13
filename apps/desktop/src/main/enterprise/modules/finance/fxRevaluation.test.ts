import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTING_PERIODS_MODULE_ID,
  EXCHANGE_RATES_MODULE_ID,
  FINANCE_MODULE_ID,
  FX_UNREALIZED_ACCOUNT,
  GL_CONTROL_ACCOUNTS,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveCashFlowStatement,
  deriveReceivableRevaluation,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  glNextPeriodKey,
  glStatement,
  reverseFxLines,
  unrealizedRevaluationLines,
} from '@neuropause/shared';
import type { CashFlowCategory, ExchangeRate, FinanceInvoice, GlJournalLine } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createExchangeRateModule } from './exchangeRateModule';
import { createAccountingPeriodModule } from './accountingPeriodModule';
import { createFxRevaluationModule } from './fxRevaluationModule';

const T0 = '2026-08-06T00:00:00.000Z';
const AR = GL_CONTROL_ACCOUNTS.accountsReceivable.code; // 1100
const FX = FX_UNREALIZED_ACCOUNT.code; // 7811

const mkInvoice = (over: Partial<FinanceInvoice>): FinanceInvoice => ({
  id: 'inv',
  number: 'INV',
  customer: 'c',
  amount: 0,
  taxRate: 0,
  amountPaid: 0,
  currency: 'USD',
  exchangeRate: 1,
  status: 'issued',
  paymentTerms: 'net30',
  issueDate: null,
  dueDate: null,
  sourceOrder: '',
  notes: null,
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

describe('Unrealized FX revaluation engine (pure)', () => {
  it('revalues an open foreign receivable at the period-end rate (IAS 21 asset gain)', () => {
    const res = deriveReceivableRevaluation({
      invoices: [mkInvoice({ number: 'INV-1', currency: 'EUR', amount: 1000, exchangeRate: 1.1 })],
      rates: [mkRate('EUR', 'USD', 1.2, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(1);
    expect(res.receivableDelta).toBe(100); // 1000×1.2 − 1000×1.1
    expect(res.unrealizedGainLoss).toBe(100); // asset up = gain
    expect(res.skippedNoRate).toBe(0);
    expect(res.items[0]).toMatchObject({
      document: 'INV-1',
      currency: 'EUR',
      outstanding: 1000,
      bookedRate: 1.1,
      revalRate: 1.2,
      functionalBooked: 1100,
      functionalCurrent: 1200,
      delta: 100,
    });
  });

  it('excludes functional-currency, draft, cancelled, and fully-paid invoices', () => {
    const res = deriveReceivableRevaluation({
      invoices: [
        mkInvoice({ number: 'USD-1', currency: 'USD', amount: 1000, exchangeRate: 1 }), // functional → skip
        mkInvoice({ number: 'DRAFT', currency: 'EUR', amount: 1000, exchangeRate: 1.1, status: 'draft' }),
        mkInvoice({ number: 'CANC', currency: 'EUR', amount: 1000, exchangeRate: 1.1, status: 'cancelled' }),
        mkInvoice({ number: 'PAID', currency: 'EUR', amount: 1000, amountPaid: 1000, exchangeRate: 1.1 }), // outstanding 0
      ],
      rates: [mkRate('EUR', 'USD', 1.2, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(0);
    expect(res.receivableDelta).toBe(0);
    expect(res.skippedNoRate).toBe(0);
  });

  it('skips (and counts) an open FX receivable with no period-end rate — never faked 1:1', () => {
    const res = deriveReceivableRevaluation({
      invoices: [mkInvoice({ number: 'GBP-1', currency: 'GBP', amount: 500, exchangeRate: 1.25 })],
      rates: [], // no GBP rate governs the date
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(0);
    expect(res.skippedNoRate).toBe(1);
    expect(res.receivableDelta).toBe(0);
  });

  it('signs a receivable LOSS when the period-end rate falls', () => {
    const res = deriveReceivableRevaluation({
      invoices: [mkInvoice({ number: 'EUR-2', currency: 'EUR', amount: 1000, exchangeRate: 1.2 })],
      rates: [mkRate('EUR', 'USD', 1.1, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.receivableDelta).toBe(-100);
    expect(res.unrealizedGainLoss).toBe(-100);
  });

  it('only counts a partial-payment invoice on its OUTSTANDING balance', () => {
    const res = deriveReceivableRevaluation({
      invoices: [mkInvoice({ number: 'EUR-3', currency: 'EUR', amount: 1000, amountPaid: 400, exchangeRate: 1.1, status: 'partially_paid' })],
      rates: [mkRate('EUR', 'USD', 1.2, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    // outstanding 600 → 600×(1.2−1.1) = 60
    expect(res.items[0].outstanding).toBe(600);
    expect(res.receivableDelta).toBe(60);
  });
});

describe('Unrealized revaluation lines + reversal (pure)', () => {
  it('a receivable GAIN debits AR and credits 7811; the reversal is its exact inverse', () => {
    const lines = unrealizedRevaluationLines({ receivableDelta: 100, payableDelta: 0, receivableCode: AR, payableCode: '2000', fxCode: FX });
    expect(shape(lines)).toEqual([
      { account: AR, debit: 100, credit: 0 },
      { account: FX, debit: 0, credit: 100 },
    ]);
    expect(shape(reverseFxLines(lines))).toEqual([
      { account: AR, debit: 0, credit: 100 },
      { account: FX, debit: 100, credit: 0 },
    ]);
  });

  it('a receivable LOSS debits 7811 and credits AR; the entry is balanced', () => {
    const lines = unrealizedRevaluationLines({ receivableDelta: -80, payableDelta: 0, receivableCode: AR, payableCode: '2000', fxCode: FX });
    expect(shape(lines)).toEqual([
      { account: AR, debit: 0, credit: 80 },
      { account: FX, debit: 80, credit: 0 },
    ]);
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBe(cr);
  });

  it('zero exposure produces no lines, and the period key rolls over at year end', () => {
    expect(unrealizedRevaluationLines({ receivableDelta: 0, payableDelta: 0, receivableCode: AR, payableCode: '2000', fxCode: FX })).toEqual([]);
    expect(glNextPeriodKey('2026-08')).toBe('2026-09');
    expect(glNextPeriodKey('2026-12')).toBe('2027-01');
  });
});

describe('FX revaluation module — posting, reversal, and accounting regression', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let rates: EnterpriseModule;
  let periods: EnterpriseModule;
  let fxreval: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fxreval-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    rates = createExchangeRateModule(join(dir, 'rates.json'));
    periods = createAccountingPeriodModule(join(dir, 'periods.json'));
    fxreval = createFxRevaluationModule(join(dir, 'fxreval.json'), invoices.store, rates.store, periods.store);
    await Promise.all([accounts, journal, invoices, rates, periods, fxreval].map((m) => m.store.load()));
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID
          ? accounts
          : id === JOURNAL_ENTRIES_MODULE_ID
            ? journal
            : id === FINANCE_MODULE_ID
              ? invoices
              : id === EXCHANGE_RATES_MODULE_ID
                ? rates
                : id === ACCOUNTING_PERIODS_MODULE_ID
                  ? periods
                  : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts, journal, invoices, rates, periods, fxreval].map((m) => m.store.flush()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const account = (code: string, cls: string): void => {
    const v = accounts.hooks.validate({ fields: { code, name: code, class: cls, currency: 'USD' } });
    if (v.ok) accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };
  const addInvoice = (number: string, currency: string, amount: number, exchangeRate: number, status = 'issued'): void => {
    const v = invoices.hooks.validate({ fields: { number, customer: 'Acme', amount, taxRate: 0, currency, exchangeRate, status } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) invoices.store.create({ title: number, fields: v.values, actor: 't@np', now: T0 });
  };
  const addRate = (from: string, to: string, rate: number, effectiveFrom: string): void => {
    const v = rates.hooks.validate({ fields: { fromCurrency: from, toCurrency: to, rate, effectiveFrom } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) rates.store.create({ title: `${from}-${to}`, fields: v.values, actor: 't@np', now: T0 });
  };
  const generate = async (period: string) => {
    const v = fxreval.hooks.validate({ fields: { period } });
    if (v.ok) {
      const rec = fxreval.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
      await fxreval.hooks.onChange!({ record: rec }, ctx);
    }
    return v;
  };

  it('generates, posts a period-end revaluation + a next-period reversal, and stays reconciled', async () => {
    account('1100', 'asset'); // AR exists (a real chart always has it once receivables are booked)
    addInvoice('INV-1', 'EUR', 1000, 1.1); // open EUR receivable booked at 1.10
    addRate('EUR', 'USD', 1.2, '2026-08-15'); // period-end rate 1.20
    const v = await generate('2026-08');
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.receivableDelta).toBe(100);
    expect(v.values.unrealizedGainLoss).toBe(100);
    expect(v.values.revaluedCount).toBe(1);
    expect(v.values.revalDate).toBe('2026-08-31');
    expect(v.values.reversalDate).toBe('2026-09-01');
    expect(v.values.reportNumber).toBe('FXR-2026-08-1');
    expect(v.values.revalEntryNumber).toBe('JE-FXREVAL-2026-08');
    expect(v.values.reversalEntryNumber).toBe('JE-FXREVAL-2026-08-REV');

    const entries = journal.store.list().map(glJournalEntryFromRecord);
    const reval = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08');
    const reversal = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08-REV');
    expect(reval, 'revaluation entry posted').toBeTruthy();
    expect(reversal, 'reversal entry posted').toBeTruthy();
    if (!reval || !reversal) throw new Error('unreachable');
    expect(reval.posted).toBe(true);
    expect(reval.entryDate).toBe('2026-08-31');
    expect(shape(reval.lines)).toEqual([
      { account: AR, debit: 100, credit: 0 },
      { account: FX, debit: 0, credit: 100 },
    ]);
    expect(reversal.posted).toBe(true);
    expect(reversal.entryDate).toBe('2026-09-01'); // first day of the NEXT period
    expect(shape(reversal.lines)).toEqual([
      { account: AR, debit: 0, credit: 100 },
      { account: FX, debit: 100, credit: 0 },
    ]);
  });

  it('reflects in the trial balance / P&L in-period, reverses to zero across the boundary, and leaves cash flow untouched', async () => {
    account('1100', 'asset');
    addInvoice('INV-1', 'EUR', 1000, 1.1);
    addRate('EUR', 'USD', 1.2, '2026-08-15');
    await generate('2026-08');

    const acctViews = accounts.store.list().map(glAccountFromRecord);
    const posted = journal.store.list().map(glJournalEntryFromRecord).filter((e) => e.posted);

    // In-period (entries dated on/before the period end): only the revaluation. AR up 100; unrealized gain 100 in P&L.
    const inPeriod = posted.filter((e) => e.entryDate <= '2026-08-31');
    const s1 = glStatement(acctViews, inPeriod);
    expect(s1.assets).toBe(100); // AR carrying value raised to the period-end rate
    expect(s1.netIncome).toBe(100); // unrealized gain recognised (7811 credit → negative expense)

    // Across the boundary (revaluation + reversal): the unrealized entry nets to exactly zero.
    const sAll = glStatement(acctViews, posted);
    expect(sAll.assets).toBe(0);
    expect(sAll.netIncome).toBe(0);

    // Cash Flow (W6-B6) is UNAFFECTED — the unrealized entries touch AR + 7811, never cash.
    const cashCodes = new Set([GL_CONTROL_ACCOUNTS.cash.code]);
    const cf = deriveCashFlowStatement(posted, new Map<string, CashFlowCategory>(), cashCodes, { startDate: '2026-08-01', endDate: '2026-09-30' });
    expect(cf.entryCount).toBe(0);
    expect(cf.totalCashMovement).toBe(0);
    expect(cf.operating).toBe(0);
  });

  it('honours the period lock, forbids a duplicate, is immutable, and no-ops single currency', async () => {
    account('1100', 'asset');

    // Single-currency invoice → nothing to revalue, nothing posts.
    addInvoice('USD-1', 'USD', 500, 1);
    const usdOnly = await generate('2026-07');
    expect(usdOnly.ok).toBe(true);
    if (usdOnly.ok) expect(usdOnly.values.revaluedCount).toBe(0);
    expect(journal.store.list().some((r) => String(r.fields.entryNumber).startsWith('JE-FXREVAL'))).toBe(false);

    // A foreign receivable + rate, and CLOSE 2026-08.
    addInvoice('INV-1', 'EUR', 1000, 1.1);
    addRate('EUR', 'USD', 1.2, '2026-08-15');
    const pv = periods.hooks.validate({ fields: { periodKey: '2026-08' } });
    expect(pv.ok).toBe(true);
    if (pv.ok) {
      const prec = periods.store.create({ title: '2026-08', fields: pv.values, actor: 't@np', now: T0 });
      await periods.hooks.runAction!('close', prec, ctx);
    }
    // Period lock: a closed period cannot be revalued.
    expect(fxreval.hooks.validate({ fields: { period: '2026-08' } }).ok).toBe(false);

    // The OPEN next period generates fine; a SECOND generation for it is refused.
    const first = await generate('2026-09');
    expect(first.ok).toBe(true);
    expect(fxreval.hooks.validate({ fields: { period: '2026-09' } }).ok).toBe(false); // one revaluation per period

    // Immutable once generated.
    const rec = fxreval.store.list().find((r) => String(r.fields.period) === '2026-09');
    expect(rec, 'a 2026-09 revaluation exists').toBeTruthy();
    if (rec) expect(fxreval.hooks.validate({ fields: { ...rec.fields, receivableDelta: 0 } }).ok).toBe(false);
  });
});

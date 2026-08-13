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
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  glJournalEntryFromRecord,
} from '@neuropause/shared';
import type { GlJournalLine } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createExchangeRateModule } from './exchangeRateModule';
import { createAccountingPeriodModule } from './accountingPeriodModule';
import { createFxRevaluationModule } from './fxRevaluationModule';

const T0 = '2026-08-06T00:00:00.000Z';
const FX = FX_UNREALIZED_ACCOUNT.code; // 7811
const shape = (lines: readonly GlJournalLine[]): Array<{ account: string; debit: number; credit: number }> =>
  lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));

describe('FX revaluation module — foreign cash revaluation (W6-C1)', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let rates: EnterpriseModule;
  let periods: EnterpriseModule;
  let fxreval: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fxcash-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    rates = createExchangeRateModule(join(dir, 'rates.json'));
    periods = createAccountingPeriodModule(join(dir, 'periods.json'));
    // W6-C1: inject the ledger-account + journal stores so cash reval reads real balances.
    fxreval = createFxRevaluationModule(
      join(dir, 'fxreval.json'),
      invoices.store,
      rates.store,
      periods.store,
      undefined,
      accounts.store,
      journal.store,
    );
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

  const addAccount = (code: string, cls: string, currency: string, cashFlowCategory?: string): void => {
    const fields: Record<string, unknown> = { code, name: code, class: cls, currency };
    if (cashFlowCategory) fields.cashFlowCategory = cashFlowCategory;
    const v = accounts.hooks.validate({ fields });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };
  const postEntry = async (entryNumber: string, lines: unknown[]): Promise<void> => {
    const v = journal.hooks.validate({ fields: { entryNumber, lines: JSON.stringify(lines), status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
    const res = await journal.hooks.runAction!('post', rec, ctx);
    expect(res.ok, JSON.stringify(res)).toBe(true);
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

  it('revalues a foreign cash balance at period-end and posts a reversing entry to 7811', async () => {
    addAccount('1001', 'asset', 'EUR', 'cash'); // EUR bank account
    addAccount('3000', 'equity', 'USD'); // funding source (functional)
    // Seed a EUR 100 balance booked at 1.20 (functional 120) via a posted journal entry.
    await postEntry('JE-SEED', [
      { account: '1001', debit: 120, credit: 0, txnCurrency: 'EUR', txnAmount: 100, exchangeRate: 1.2 },
      { account: '3000', debit: 0, credit: 120 },
    ]);
    addRate('EUR', 'USD', 1.25, '2026-08-15'); // period-end rate 1.25 → EUR 100 now worth 125

    const v = await generate('2026-08');
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.cashDelta).toBe(5); // 125 − 120
    expect(v.values.receivableDelta).toBe(0);
    expect(v.values.payableDelta).toBe(0);
    expect(v.values.unrealizedGainLoss).toBe(5);
    expect(v.values.revaluedCount).toBe(1);
    const cashItems = JSON.parse(String(v.values.cashItems)) as Array<Record<string, unknown>>;
    expect(cashItems).toHaveLength(1);
    expect(cashItems[0]).toMatchObject({ account: '1001', currency: 'EUR', delta: 5 });

    const entries = journal.store.list().map(glJournalEntryFromRecord);
    const reval = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08');
    const reversal = entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08-REV');
    expect(reval && reversal, 'reval + reversal posted').toBeTruthy();
    if (!reval || !reversal) throw new Error('unreachable');
    expect(reval.entryDate).toBe('2026-08-31');
    expect(shape(reval.lines)).toEqual([
      { account: '1001', debit: 5, credit: 0 }, // asset up → gain
      { account: FX, debit: 0, credit: 5 },
    ]);
    expect(reversal.entryDate).toBe('2026-09-01'); // first day of the NEXT period
    expect(shape(reversal.lines)).toEqual([
      { account: '1001', debit: 0, credit: 5 },
      { account: FX, debit: 5, credit: 0 },
    ]);
  });

  it('skips a foreign cash account with no period-end rate and posts nothing', async () => {
    addAccount('1001', 'asset', 'EUR', 'cash');
    addAccount('3000', 'equity', 'USD');
    await postEntry('JE-SEED', [
      { account: '1001', debit: 120, credit: 0, txnCurrency: 'EUR', txnAmount: 100 },
      { account: '3000', debit: 0, credit: 120 },
    ]);
    // no EUR→USD rate registered

    const v = await generate('2026-08');
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.cashDelta).toBe(0);
    expect(v.values.revaluedCount).toBe(0);
    expect(v.values.skippedNoRate).toBe(1);
    const entries = journal.store.list().map(glJournalEntryFromRecord);
    expect(entries.find((e) => e.entryNumber === 'JE-FXREVAL-2026-08')).toBeUndefined(); // nothing posted
  });
});

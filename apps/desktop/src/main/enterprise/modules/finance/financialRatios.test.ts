import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveFinancialRatios,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createFinancialRatiosModule } from './financialRatiosModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('Financial ratio engine (pure)', () => {
  it('computes class-total ratios and returns null (not zero) for non-positive denominators', () => {
    const r = deriveFinancialRatios({ revenue: 1000, expenses: 400, netIncome: 600, assets: 1200, liabilities: 400, equity: 200 });
    expect(r.netProfitMargin).toBe(60); // 600/1000
    expect(r.expenseRatio).toBe(40);
    expect(r.returnOnAssets).toBe(50); // 600/1200
    expect(r.returnOnEquity).toBe(300); // 600/200
    expect(r.debtToEquity).toBe(2); // 400/200
    expect(r.equityRatio).toBe(16.67); // 200/1200
    // Non-positive denominators → null, never a fabricated 0 or a divide error.
    const empty = deriveFinancialRatios({ revenue: 0, expenses: 0, netIncome: 0, assets: 0, liabilities: 0, equity: 0 });
    expect(empty.netProfitMargin).toBeNull();
    expect(empty.returnOnAssets).toBeNull();
    expect(empty.debtToEquity).toBeNull();
    // Zero equity → ROE and D/E undefined, but asset-based ratios still compute.
    const noEquity = deriveFinancialRatios({ revenue: 1000, expenses: 400, netIncome: 600, assets: 1000, liabilities: 400, equity: 0 });
    expect(noEquity.returnOnEquity).toBeNull();
    expect(noEquity.debtToEquity).toBeNull();
    expect(noEquity.equityRatio).toBe(0); // 0/1000 is a real 0, not undefined
  });
});

describe('Financial ratios module over a real ledger', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let ratios: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-ratios-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    ratios = createFinancialRatiosModule(join(dir, 'ratios.json'), accounts.store, journal.store);
    await Promise.all([accounts.store.load(), journal.store.load(), ratios.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), ratios.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const account = (code: string, cls: string): void => {
    const v = accounts.hooks.validate({ fields: { code, name: code, class: cls, currency: 'USD' } });
    if (v.ok) accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };
  const postEntry = async (entryNumber: string, lines: Array<{ account: string; debit: number; credit: number }>): Promise<void> => {
    const v = journal.hooks.validate({ fields: { entryNumber, entryDate: '2026-08-05', lines: JSON.stringify(lines), status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const je = journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
    await journal.hooks.runAction!('post', je, ctx);
  };

  it('generates ratios from real posted balances, immutably, and reports empty honestly', async () => {
    // Empty ledger → no data, ratios null.
    const empty = ratios.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.values.netProfitMargin).toBeNull();
      expect(String(empty.values.note)).toContain('no posted accounting data');
    }
    // Build a small book: revenue 1000 / AR 1000, expense 400 / AP 400, cash 200 / equity 200.
    account('1100', 'asset');
    account('4000', 'revenue');
    account('5000', 'expense');
    account('2000', 'liability');
    account('1000', 'asset');
    account('3000', 'equity');
    await postEntry('JE-1', [{ account: '1100', debit: 1000, credit: 0 }, { account: '4000', debit: 0, credit: 1000 }]);
    await postEntry('JE-2', [{ account: '5000', debit: 400, credit: 0 }, { account: '2000', debit: 0, credit: 400 }]);
    await postEntry('JE-3', [{ account: '1000', debit: 200, credit: 0 }, { account: '3000', debit: 0, credit: 200 }]);
    const v = ratios.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.revenue).toBe(1000);
    expect(v.values.netIncome).toBe(600);
    expect(v.values.totalAssets).toBe(1200); // AR 1000 + cash 200
    expect(v.values.totalEquity).toBe(200);
    expect(v.values.netProfitMargin).toBe(60);
    expect(v.values.returnOnAssets).toBe(50);
    expect(v.values.returnOnEquity).toBe(300);
    expect(v.values.debtToEquity).toBe(2);
    expect(v.values.reportNumber).toBe('FR-2026-08-06-1'); // first PERSISTED register (the empty check only validated, never created)
    // Immutable once generated.
    const rec = ratios.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    expect(ratios.hooks.validate({ fields: { ...ratios.store.get(rec.id)!.fields, netProfitMargin: 0 } }).ok).toBe(false);
  });
});

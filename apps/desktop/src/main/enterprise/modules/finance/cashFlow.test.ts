import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  defaultCashFlowCategory,
  deriveCashFlowStatement,
  resolveCashFlowCategory,
} from '@neuropause/shared';
import type { CashFlowCategory, GlJournalEntry } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createCashFlowModule } from './cashFlowModule';

const T0 = '2026-08-06T00:00:00.000Z';
const WINDOW = { startDate: '2026-08-01', endDate: '2026-08-31' };

const mkEntry = (entryDate: string, lines: GlJournalEntry['lines'], posted = true): GlJournalEntry => ({
  id: 'je',
  entryNumber: 'JE',
  memo: '',
  entryDate,
  lines,
  totalDebits: 0,
  totalCredits: 0,
  posted,
  postedAt: posted ? T0 : '',
  sourceModule: '',
  sourceRef: '',
  createdAt: T0,
  updatedAt: T0,
});

describe('Cash flow engine (pure, direct method)', () => {
  it('classifies each entry by its counterpart category and reconciles to actual cash movement', () => {
    const cashCodes = new Set(['1000']);
    const categoryByCode = new Map<string, CashFlowCategory>([
      ['4000', 'operating'],
      ['1500', 'investing'],
      ['2500', 'financing'],
    ]);
    const entries: GlJournalEntry[] = [
      mkEntry('2026-08-05', [{ account: '1000', debit: 1000, credit: 0 }, { account: '4000', debit: 0, credit: 1000 }]), // op +1000
      mkEntry('2026-08-10', [{ account: '1500', debit: 500, credit: 0 }, { account: '1000', debit: 0, credit: 500 }]), // inv -500
      mkEntry('2026-08-20', [{ account: '1000', debit: 2000, credit: 0 }, { account: '2500', debit: 0, credit: 2000 }]), // fin +2000
    ];
    const s = deriveCashFlowStatement(entries, categoryByCode, cashCodes, WINDOW);
    expect(s.operating).toBe(1000);
    expect(s.investing).toBe(-500);
    expect(s.financing).toBe(2000);
    expect(s.netCashFlow).toBe(2500);
    expect(s.totalCashMovement).toBe(2500);
    expect(s.reconciled).toBe(true);
    expect(s.entryCount).toBe(3);
  });

  it('splits a mixed entry proportionally across categories', () => {
    const s = deriveCashFlowStatement(
      [
        mkEntry('2026-08-15', [
          { account: '1000', debit: 1000, credit: 0 },
          { account: '4000', debit: 0, credit: 600 },
          { account: '2500', debit: 0, credit: 400 },
        ]),
      ],
      new Map<string, CashFlowCategory>([
        ['4000', 'operating'],
        ['2500', 'financing'],
      ]),
      new Set(['1000']),
      WINDOW,
    );
    expect(s.operating).toBe(600); // 1000 × 600/1000
    expect(s.financing).toBe(400); // 1000 × 400/1000
    expect(s.netCashFlow).toBe(1000);
    expect(s.reconciled).toBe(true);
  });

  it('excludes out-of-window and unposted entries', () => {
    const cat = new Map<string, CashFlowCategory>([['4000', 'operating']]);
    const cash = new Set(['1000']);
    const lines = [
      { account: '1000', debit: 100, credit: 0 },
      { account: '4000', debit: 0, credit: 100 },
    ];
    const outOfWindow = deriveCashFlowStatement([mkEntry('2026-07-31', lines)], cat, cash, WINDOW);
    expect(outOfWindow.entryCount).toBe(0);
    expect(outOfWindow.totalCashMovement).toBe(0);
    const unposted = deriveCashFlowStatement([mkEntry('2026-08-05', lines, false)], cat, cash, WINDOW);
    expect(unposted.entryCount).toBe(0);
  });

  it('defaults category by class honestly (equity → financing, else operating) and honors explicit tags', () => {
    expect(defaultCashFlowCategory('equity')).toBe('financing');
    expect(defaultCashFlowCategory('asset')).toBe('operating');
    expect(defaultCashFlowCategory('revenue')).toBe('operating');
    expect(resolveCashFlowCategory('investing', 'asset')).toBe('investing');
    expect(resolveCashFlowCategory('auto', 'equity')).toBe('financing');
    expect(resolveCashFlowCategory('', 'revenue')).toBe('operating');
    expect(resolveCashFlowCategory('nonsense', 'liability')).toBe('operating');
  });
});

describe('Cash flow module over a real ledger', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let cashflow: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-cashflow-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    cashflow = createCashFlowModule(join(dir, 'cashflow.json'), accounts.store, journal.store);
    await Promise.all([accounts.store.load(), journal.store.load(), cashflow.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), cashflow.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const account = (code: string, cls: string, cashFlowCategory?: string): void => {
    const fields: Record<string, string> = { code, name: code, class: cls, currency: 'USD' };
    if (cashFlowCategory) fields.cashFlowCategory = cashFlowCategory;
    const v = accounts.hooks.validate({ fields });
    if (v.ok) accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };
  const postEntry = async (
    entryNumber: string,
    entryDate: string,
    lines: Array<{ account: string; debit: number; credit: number }>,
  ): Promise<void> => {
    const v = journal.hooks.validate({ fields: { entryNumber, entryDate, lines: JSON.stringify(lines), status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const je = journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
    await journal.hooks.runAction!('post', je, ctx);
  };

  it('generates a reconciled direct-method statement, immutably, and reports empty honestly', async () => {
    // Empty ledger → nothing is tagged as cash; the note says so, and 0 trivially reconciles.
    const empty = cashflow.hooks.validate({ fields: { period: '2026-08' } });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(String(empty.values.note)).toContain('no cash/bank accounts tagged');
      expect(empty.values.entryCount).toBe(0);
      expect(empty.values.reconciled).toBe('yes');
      // NP-011 C — the tile law: even the empty statement names its register honestly.
      expect(String(empty.values.sourceLineage)).toMatch(/^(No journal entries yet|Computed over \d+ journal entries)/);
    }

    // A real book: cash (the seeded control account, auto-detected), operating revenue,
    // an explicitly tagged investing account, and an explicitly tagged financing account.
    account('1000', 'asset'); // Cash — GL_CONTROL_ACCOUNTS.cash, auto-detected without a tag
    account('4000', 'revenue'); // Sales revenue → operating (class default)
    account('1500', 'asset', 'investing'); // Equipment → investing (explicit tag)
    account('2500', 'liability', 'financing'); // Bank loan → financing (explicit tag)
    await postEntry('JE-1', '2026-08-05', [{ account: '1000', debit: 1000, credit: 0 }, { account: '4000', debit: 0, credit: 1000 }]); // op +1000
    await postEntry('JE-2', '2026-08-10', [{ account: '1500', debit: 500, credit: 0 }, { account: '1000', debit: 0, credit: 500 }]); // inv -500
    await postEntry('JE-3', '2026-08-20', [{ account: '1000', debit: 2000, credit: 0 }, { account: '2500', debit: 0, credit: 2000 }]); // fin +2000
    await postEntry('JE-0', '2026-07-31', [{ account: '1000', debit: 9999, credit: 0 }, { account: '4000', debit: 0, credit: 9999 }]); // prior month — excluded

    const v = cashflow.hooks.validate({ fields: { period: '2026-08' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.startDate).toBe('2026-08-01');
    expect(v.values.endDate).toBe('2026-08-31');
    expect(v.values.operating).toBe(1000);
    expect(v.values.investing).toBe(-500);
    expect(v.values.financing).toBe(2000);
    expect(v.values.netCashFlow).toBe(2500);
    expect(v.values.totalCashMovement).toBe(2500); // JE-0 excluded by the period window
    expect(v.values.reconciled).toBe('yes');
    expect(v.values.entryCount).toBe(3);
    expect(v.values.reportNumber).toBe('CF-2026-08-1'); // first PERSISTED statement (the empty check only validated)

    // Immutable once generated: any edit to a generated statement is refused.
    const rec = cashflow.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    expect(cashflow.hooks.validate({ fields: { ...cashflow.store.get(rec.id)!.fields, operating: 0 } }).ok).toBe(false);
    // Persistence-aware numbering: the next generation for the same period is sequence 2.
    const v2 = cashflow.hooks.validate({ fields: { period: '2026-08' } });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.values.reportNumber).toBe('CF-2026-08-2');
  });

  it('detects an explicitly tagged cash/bank account beyond the seeded control account', async () => {
    account('1001', 'asset', 'cash'); // a second bank account, explicitly tagged
    account('4000', 'revenue');
    await postEntry('JE-1', '2026-08-05', [{ account: '1001', debit: 1500, credit: 0 }, { account: '4000', debit: 0, credit: 1500 }]);
    const v = cashflow.hooks.validate({ fields: { period: '2026-08' } });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.values.entryCount).toBe(1);
      expect(v.values.operating).toBe(1500);
      expect(v.values.totalCashMovement).toBe(1500);
      expect(v.values.reconciled).toBe('yes');
    }
  });

  it('rejects a malformed period', () => {
    expect(cashflow.hooks.validate({ fields: { period: '2026-13' } }).ok).toBe(false);
    expect(cashflow.hooks.validate({ fields: { period: 'August' } }).ok).toBe(false);
  });
});

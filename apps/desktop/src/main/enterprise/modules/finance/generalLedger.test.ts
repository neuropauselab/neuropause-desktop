import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  glAccountBalance,
  glAccountFromRecord,
  glAccountLedgerTotals,
  glJournalEntryFromRecord,
  glNormalBalance,
  glStatement,
  glTrialBalance,
  isBalancedGlJournal,
  parseGlJournalLines,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';

const T0 = '2026-08-05T00:00:00.000Z';

/* ── pure GL rules (the module-layer projection of the ErpCore kernel) ── */

describe('glNormalBalance (kernel NORMAL mapping)', () => {
  it('assets/expenses are debit-normal; liability/equity/revenue are credit-normal', () => {
    expect(glNormalBalance('asset')).toBe('debit');
    expect(glNormalBalance('expense')).toBe('debit');
    expect(glNormalBalance('liability')).toBe('credit');
    expect(glNormalBalance('equity')).toBe('credit');
    expect(glNormalBalance('revenue')).toBe('credit');
  });
});

describe('parseGlJournalLines (deterministic guards)', () => {
  it('accepts a well-formed array and normalizes it', () => {
    const p = parseGlJournalLines('[{"account":" 1000 ","debit":100,"credit":0}]');
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.lines[0]).toEqual({ account: '1000', debit: 100, credit: 0 });
  });
  it('rejects malformed JSON, non-arrays, empties, negatives, two-sided and zero lines', () => {
    expect(parseGlJournalLines('not json').ok).toBe(false);
    expect(parseGlJournalLines('{"account":"1"}').ok).toBe(false);
    expect(parseGlJournalLines('[]').ok).toBe(false);
    expect(parseGlJournalLines('').ok).toBe(false);
    expect(parseGlJournalLines('[{"account":"1","debit":-5,"credit":0}]').ok).toBe(false);
    expect(parseGlJournalLines('[{"account":"1","debit":5,"credit":5}]').ok).toBe(false);
    expect(parseGlJournalLines('[{"account":"1","debit":0,"credit":0}]').ok).toBe(false);
    expect(parseGlJournalLines('[{"account":"","debit":5,"credit":0}]').ok).toBe(false);
  });
});

describe('isBalancedGlJournal (kernel cents-rounding rule)', () => {
  it('balances on cents, tolerating float artifacts', () => {
    expect(isBalancedGlJournal({ debits: 100, credits: 100 })).toBe(true);
    expect(isBalancedGlJournal({ debits: 100, credits: 99.999 })).toBe(true); // < half a cent
    expect(isBalancedGlJournal({ debits: 0.1 + 0.2, credits: 0.3 })).toBe(true);
    expect(isBalancedGlJournal({ debits: 100, credits: 99.9 })).toBe(false);
  });
});

describe('glAccountBalance (kernel balance formula)', () => {
  it('signs the balance by the account normal side', () => {
    expect(glAccountBalance('debit', 150, 50)).toBe(100);
    expect(glAccountBalance('credit', 50, 150)).toBe(100);
    expect(glAccountBalance('credit', 150, 50)).toBe(-100);
  });
});

/* ── module behaviour over real stores (Electron-free, temp files) ── */

describe('GL modules — Chart of Accounts + Journal', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let emitted: Array<{ moduleId: string; action: string; id: string }>;
  let ctx: EnterpriseModuleActionContext;

  const createAccount = (code: string, name: string, cls: string): EnterpriseEntity => {
    const v = accounts.hooks.validate({ fields: { code, name, class: cls, currency: 'USD' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return accounts.store.create({ title: code, fields: v.values, actor: 't@np', now: T0 });
  };

  const draftEntry = (entryNumber: string, lines: unknown): EnterpriseEntity => {
    const v = journal.hooks.validate({
      fields: { entryNumber, memo: 'test', lines: JSON.stringify(lines), status: 'draft' },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return journal.store.create({ title: entryNumber, fields: v.values, actor: 't@np', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-gl-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    await accounts.store.load();
    await journal.store.load();
    emitted = [];
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: (m, action, rec) => emitted.push({ moduleId: m.descriptor.id, action, id: rec.id }),
    };
  });

  afterEach(async () => {
    await accounts.store.flush();
    await journal.store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stamps normalBalance from the class and refuses forged classes', () => {
    const cash = createAccount('1000', 'Cash', 'asset');
    expect(cash.fields.normalBalance).toBe('debit');
    const rev = createAccount('4000', 'Revenue', 'revenue');
    expect(rev.fields.normalBalance).toBe('credit');
    const bad = accounts.hooks.validate({ fields: { code: '9', name: 'X', class: 'weird', currency: 'USD' } });
    expect(bad.ok).toBe(false);
  });

  it('refuses journal lines that reference unknown or ambiguous account codes', () => {
    createAccount('1000', 'Cash', 'asset');
    const unknown = journal.hooks.validate({
      fields: { entryNumber: 'JE-1', lines: '[{"account":"7777","debit":5,"credit":0}]', status: 'draft' },
    });
    expect(unknown.ok).toBe(false);
    // Two accounts sharing a code → the journal refuses to guess.
    accounts.store.create({ title: '1000', fields: { code: '1000', name: 'Dup', class: 'asset', normalBalance: 'debit', currency: 'USD' }, actor: 't@np', now: T0 });
    const ambiguous = journal.hooks.validate({
      fields: { entryNumber: 'JE-2', lines: '[{"account":"1000","debit":5,"credit":0}]', status: 'draft' },
    });
    expect(ambiguous.ok).toBe(false);
  });

  it('allows an unbalanced DRAFT (stamping totals) but refuses to POST it — the kernel rule', async () => {
    createAccount('1000', 'Cash', 'asset');
    createAccount('4000', 'Sales Revenue', 'revenue');
    const rec = draftEntry('JE-1', [
      { account: '1000', debit: 100, credit: 0 },
      { account: '4000', debit: 0, credit: 90 },
    ]);
    expect(rec.fields.totalDebits).toBe(100);
    expect(rec.fields.totalCredits).toBe(90);
    expect(rec.fields.status).toBe('draft');
    expect(journal.hooks.runAction).toBeDefined();
    const result = await journal.hooks.runAction!('post', rec, ctx);
    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain('debits 100 != credits 90');
    expect(journal.store.get(rec.id)?.fields.postedAt ?? '').toBe('');
  });

  it('posts a balanced entry, stamps postedAt/status, and reconciles account balances from the ledger', async () => {
    const cash = createAccount('1000', 'Cash', 'asset');
    const rev = createAccount('4000', 'Sales Revenue', 'revenue');
    const rec = draftEntry('JE-1', [
      { account: '1000', debit: 250, credit: 0 },
      { account: '4000', debit: 0, credit: 250 },
    ]);
    const result = await journal.hooks.runAction!('post', rec, ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const posted = journal.store.get(rec.id)!;
    expect(posted.fields.status).toBe('posted');
    expect(String(posted.fields.postedAt)).toBe(T0);
    const cashNow = glAccountFromRecord(accounts.store.get(cash.id)!);
    const revNow = glAccountFromRecord(accounts.store.get(rev.id)!);
    expect(cashNow.debitTotal).toBe(250);
    expect(cashNow.balance).toBe(250);
    expect(revNow.creditTotal).toBe(250);
    expect(revNow.balance).toBe(250);
    expect(emitted.some((e) => e.moduleId === LEDGER_ACCOUNTS_MODULE_ID && e.action === 'updated')).toBe(true);
    // Second post refused — an entry posts once.
    const again = await journal.hooks.runAction!('post', posted, ctx);
    expect(again.ok).toBe(false);
  });

  it('makes posted entries immutable through the validated update path', async () => {
    createAccount('1000', 'Cash', 'asset');
    createAccount('4000', 'Sales Revenue', 'revenue');
    const rec = draftEntry('JE-1', [
      { account: '1000', debit: 10, credit: 0 },
      { account: '4000', debit: 0, credit: 10 },
    ]);
    await journal.hooks.runAction!('post', rec, ctx);
    const posted = journal.store.get(rec.id)!;
    // The registry validates MERGED fields on update — postedAt is present → refused.
    const edit = journal.hooks.validate({ fields: { ...posted.fields, memo: 'tamper' } });
    expect(edit.ok).toBe(false);
  });

  it('reverse drafts a mirrored entry that, once posted, zeroes the accounts', async () => {
    const cash = createAccount('1000', 'Cash', 'asset');
    const rev = createAccount('4000', 'Sales Revenue', 'revenue');
    const rec = draftEntry('JE-1', [
      { account: '1000', debit: 75, credit: 0 },
      { account: '4000', debit: 0, credit: 75 },
    ]);
    await journal.hooks.runAction!('post', rec, ctx);
    const posted = journal.store.get(rec.id)!;
    const reversal = await journal.hooks.runAction!('reverse', posted, ctx);
    expect(reversal.ok, JSON.stringify(reversal)).toBe(true);
    const draft = journal.store.list().find((r) => r.fields.entryNumber === 'JE-1-REV')!;
    expect(draft).toBeDefined();
    const view = glJournalEntryFromRecord(draft);
    expect(view.lines).toEqual([
      { account: '1000', debit: 0, credit: 75 },
      { account: '4000', debit: 75, credit: 0 },
    ]);
    // Reversing twice is refused while the reversal draft exists.
    const again = await journal.hooks.runAction!('reverse', posted, ctx);
    expect(again.ok).toBe(false);
    // Posting the reversal returns both balances to zero — drift-free recompute.
    await journal.hooks.runAction!('post', draft, ctx);
    expect(glAccountFromRecord(accounts.store.get(cash.id)!).balance).toBe(0);
    expect(glAccountFromRecord(accounts.store.get(rev.id)!).balance).toBe(0);
  });

  it('derives trial balance and statements from posted entries only (kernel semantics)', async () => {
    createAccount('1000', 'Cash', 'asset');
    createAccount('4000', 'Sales Revenue', 'revenue');
    createAccount('5000', 'Rent Expense', 'expense');
    const sale = draftEntry('JE-1', [
      { account: '1000', debit: 500, credit: 0 },
      { account: '4000', debit: 0, credit: 500 },
    ]);
    const rent = draftEntry('JE-2', [
      { account: '5000', debit: 120, credit: 0 },
      { account: '1000', debit: 0, credit: 120 },
    ]);
    draftEntry('JE-3', [
      { account: '1000', debit: 999, credit: 0 },
      { account: '4000', debit: 0, credit: 999 },
    ]); // stays a draft — must not count
    await journal.hooks.runAction!('post', sale, ctx);
    await journal.hooks.runAction!('post', rent, ctx);
    const ledger = journal.store.list().map(glJournalEntryFromRecord);
    const tb = glTrialBalance(ledger);
    expect(tb.totalDebits).toBe(620);
    expect(tb.totalCredits).toBe(620);
    expect(tb.balanced).toBe(true);
    expect(glAccountLedgerTotals('1000', ledger)).toEqual({ debitTotal: 500, creditTotal: 120 });
    const stmt = glStatement(accounts.store.list().map(glAccountFromRecord), ledger);
    expect(stmt.revenue).toBe(500);
    expect(stmt.expenses).toBe(120);
    expect(stmt.netIncome).toBe(380);
    expect(stmt.assets).toBe(380);
    expect(stmt.hasData).toBe(true);
    expect(stmt.note).toBe('derived from real posted journal entries');
    const empty = glStatement([], []);
    expect(empty.hasData).toBe(false);
    expect(empty.note).toBe('no accounting data — statements are empty, not fabricated');
  });
});

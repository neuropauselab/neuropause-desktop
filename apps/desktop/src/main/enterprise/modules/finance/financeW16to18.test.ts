import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AP_AGING_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  deriveApAging,
  deriveBudgetActuals,
  glAccountFromRecord,
  matchBankStatement,
  parseBankStatementLines,
  vendorBillFromRecord,
  type BankMatchCandidate,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createBankStatementModule } from './bankStatementModule';
import { createBudgetModule } from './budgetModule';
import { createVendorBillModule } from './vendorBillModule';
import { createApAgingModule } from './apAgingModule';
import { createPaymentModule } from './paymentModule';
import { createInvoiceModule } from './invoiceModule';

const T0 = '2026-08-05T00:00:00.000Z';

/* ── W1.6 pure matching ── */

describe('bank statement parsing + matching (pure, deterministic)', () => {
  const candidates: BankMatchCandidate[] = [
    { paymentNumber: 'PAY-1', amount: 118, receivedDate: '2026-08-01', transactionRef: 'TXN123' },
    { paymentNumber: 'PAY-2', amount: 50, receivedDate: '2026-08-02', transactionRef: '' },
    { paymentNumber: 'PAY-3', amount: 50, receivedDate: '2026-08-03', transactionRef: '' },
  ];
  it('parses lines and rejects malformed rows', () => {
    expect(parseBankStatementLines('[{"date":"2026-08-01","description":"x","reference":"r","amount":10}]').ok).toBe(true);
    expect(parseBankStatementLines('[{"date":"01-08-2026","amount":10}]').ok).toBe(false);
    expect(parseBankStatementLines('[{"date":"2026-08-01","amount":0}]').ok).toBe(false);
    expect(parseBankStatementLines('nope').ok).toBe(false);
  });
  it('matches by exact reference first, then unique amount±3d; ambiguity stays unmatched', () => {
    const { lines, summary } = matchBankStatement(
      [
        { date: '2026-08-01', description: 'NEFT', reference: 'TXN123', amount: 118 },
        { date: '2026-08-02', description: 'AMBIGUOUS', reference: '', amount: 50 }, // PAY-2 and PAY-3 both fit
        { date: '2026-08-03', description: 'CHARGES', reference: '', amount: -25 }, // withdrawal — no vendor side yet
      ],
      candidates,
    );
    expect(lines[0].matchType).toBe('exact-reference');
    expect(lines[0].paymentNumber).toBe('PAY-1');
    expect(lines[1].matchType).toBe('unmatched'); // never guessed
    expect(lines[2].matchType).toBe('unmatched');
    expect(summary.matchedCount).toBe(1);
    expect(summary.unmatchedAmount).toBe(25); // 50 − 25
    // Idempotent: same inputs, same verdicts.
    expect(matchBankStatement(lines, candidates).summary.matchedCount).toBe(1);
  });
  it('amount-date matches when the candidate is unique in the window', () => {
    const { lines } = matchBankStatement(
      [{ date: '2026-08-02', description: 'UPI', reference: '', amount: 118 }],
      [candidates[0]],
    );
    expect(lines[0].matchType).toBe('amount-date');
  });
});

/* ── W1.7 pure budget variance ── */

describe('deriveBudgetActuals (pure, sign-aware)', () => {
  const entry = (num: string, date: string, lines: { account: string; debit: number; credit: number }[]) => ({
    id: num, entryNumber: num, memo: '', entryDate: date, lines, totalDebits: 0, totalCredits: 0,
    posted: true, postedAt: 'x', sourceModule: '', sourceRef: '', createdAt: '', updatedAt: '',
  });
  const entries = [
    entry('JE-1', '2026-08-05', [
      { account: '5000', debit: 900, credit: 0 },
      { account: '1000', debit: 0, credit: 900 },
    ]),
  ];
  it('expense over budget is OVER; within ±5% is on-track; other periods excluded', () => {
    const over = deriveBudgetActuals({ accountCode: '5000', accountClass: 'expense', periodKey: '2026-08', budgetAmount: 500, entries });
    expect(over.actualAmount).toBe(900);
    expect(over.health).toBe('over');
    const onTrack = deriveBudgetActuals({ accountCode: '5000', accountClass: 'expense', periodKey: '2026-08', budgetAmount: 880, entries });
    expect(onTrack.health).toBe('on-track'); // 2.3% over — inside tolerance
    const otherPeriod = deriveBudgetActuals({ accountCode: '5000', accountClass: 'expense', periodKey: '2026-07', budgetAmount: 500, entries });
    expect(otherPeriod.health).toBe('no-actuals');
  });
  it('revenue above budget is favourable, short is UNDER', () => {
    const revEntries = [entry('JE-2', '2026-08-05', [
      { account: '1000', debit: 400, credit: 0 },
      { account: '4000', debit: 0, credit: 400 },
    ])];
    expect(deriveBudgetActuals({ accountCode: '4000', accountClass: 'revenue', periodKey: '2026-08', budgetAmount: 300, entries: revEntries }).health).toBe('on-track');
    expect(deriveBudgetActuals({ accountCode: '4000', accountClass: 'revenue', periodKey: '2026-08', budgetAmount: 600, entries: revEntries }).health).toBe('under');
  });
});

/* ── the wired modules over real stores ── */

describe('W1.6–W1.8 modules over real stores', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoicesM: EnterpriseModule;
  let payments: EnterpriseModule;
  let bank: EnterpriseModule;
  let budgets: EnterpriseModule;
  let bills: EnterpriseModule;
  let apAging: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-w168-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoicesM = createInvoiceModule(join(dir, 'invoices.json'));
    payments = createPaymentModule(join(dir, 'payments.json'), invoicesM.store);
    bank = createBankStatementModule(join(dir, 'bank.json'), payments.store);
    budgets = createBudgetModule(join(dir, 'budgets.json'), journal.store, accounts.store);
    bills = createVendorBillModule(join(dir, 'bills.json'));
    apAging = createApAgingModule(join(dir, 'apaging.json'), bills.store);
    await Promise.all([
      accounts.store.load(), journal.store.load(), invoicesM.store.load(), payments.store.load(),
      bank.store.load(), budgets.store.load(), bills.store.load(), apAging.store.load(),
    ]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === VENDOR_BILLS_MODULE_ID ? bills
        : id === AP_AGING_MODULE_ID ? apAging
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      accounts.store.flush(), journal.store.flush(), invoicesM.store.flush(), payments.store.flush(),
      bank.store.flush(), budgets.store.flush(), bills.store.flush(), apAging.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };

  it('W1.6: reconcile matches cleared payments, re-runs idempotently, finalize locks the statement', async () => {
    payments.store.create({
      title: 'PAY-1',
      fields: { paymentNumber: 'PAY-1', invoiceRef: 'INV-1', amount: 118, currency: 'USD', method: 'bank_transfer', status: 'cleared', receivedDate: '2026-08-01', transactionRef: 'TXN123' } as EnterpriseEntity['fields'],
      actor: 't@np', now: T0,
    });
    const v = bank.hooks.validate({
      fields: { statementNumber: 'STMT-1', bankAccount: 'HDFC', lines: '[{"date":"2026-08-01","description":"NEFT","reference":"TXN123","amount":118},{"date":"2026-08-02","description":"FEE","reference":"","amount":-25}]', status: 'imported' },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = bank.store.create({ title: 'STMT-1', fields: v.values, actor: 't@np', now: T0 });
    const result = await bank.hooks.runAction!('reconcile', rec, ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const after = bank.store.get(rec.id)!;
    expect(after.fields.matchedCount).toBe(1);
    expect(after.fields.unmatchedCount).toBe(1);
    expect(after.fields.status).toBe('reconciled');
    // Finalize → immutable through the validated path, reconcile refused.
    await bank.hooks.runAction!('finalize', bank.store.get(rec.id)!, ctx);
    expect(bank.store.get(rec.id)!.fields.status).toBe('finalized');
    expect(bank.hooks.validate({ fields: { ...bank.store.get(rec.id)!.fields } }).ok).toBe(false);
    expect((await bank.hooks.runAction!('reconcile', bank.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('W1.7: budgets refuse unknown accounts, refresh stamps books-derived actuals', async () => {
    const av = accounts.hooks.validate({ fields: { code: '5000', name: 'Opex', class: 'expense', currency: 'USD' } });
    if (av.ok) accounts.store.create({ title: '5000', fields: av.values, actor: 't@np', now: T0 });
    const av2 = accounts.hooks.validate({ fields: { code: '1000', name: 'Cash', class: 'asset', currency: 'USD' } });
    if (av2.ok) accounts.store.create({ title: '1000', fields: av2.values, actor: 't@np', now: T0 });
    expect(budgets.hooks.validate({ fields: { budgetName: 'X', periodKey: '2026-08', accountCode: '9999', budgetAmount: 100 } }).ok).toBe(false);
    const bv = budgets.hooks.validate({ fields: { budgetName: 'Opex Aug', periodKey: '2026-08', accountCode: '5000', budgetAmount: 500 } });
    expect(bv.ok, JSON.stringify('errors' in bv ? bv.errors : {})).toBe(true);
    if (!bv.ok) throw new Error('unreachable');
    const rec = budgets.store.create({ title: 'Opex Aug', fields: bv.values, actor: 't@np', now: T0 });
    // Post real spending: Dr 5000 / Cr 1000, 900.
    const jv = journal.hooks.validate({ fields: { entryNumber: 'JE-1', entryDate: '2026-08-05', lines: '[{"account":"5000","debit":900,"credit":0},{"account":"1000","debit":0,"credit":900}]', status: 'draft' } });
    if (!jv.ok) throw new Error('journal draft invalid');
    const je = journal.store.create({ title: 'JE-1', fields: jv.values, actor: 't@np', now: T0 });
    await journal.hooks.runAction!('post', je, ctx);
    const refreshed = await budgets.hooks.runAction!('refresh', rec, ctx);
    expect(refreshed.ok, JSON.stringify(refreshed)).toBe(true);
    const after = budgets.store.get(rec.id)!;
    expect(after.fields.actualAmount).toBe(900);
    expect(after.fields.health).toBe('over');
  });

  it('W1.8: approve books AP+expense+ITC, markPaid settles, cancel reverses cumulatively; AP aging sees only open bills', async () => {
    const bv = bills.hooks.validate({ fields: { billNumber: 'BILL-1', vendor: 'Supplies Co', amount: 100, taxRate: 18, currency: 'USD', dueDate: '2026-07-01', status: 'draft' } });
    expect(bv.ok, JSON.stringify('errors' in bv ? bv.errors : {})).toBe(true);
    if (!bv.ok) throw new Error('unreachable');
    expect(bv.values.total).toBe(118);
    expect(bv.values.status).toBe('draft'); // forged status impossible — derived from markers
    const rec = bills.store.create({ title: 'BILL-1', fields: bv.values, actor: 't@np', now: T0 });
    // Approve → payable booked through the GL seam (seeds the full control chart).
    const approved = await bills.hooks.runAction!('approve', rec, ctx);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx);
    expect(balanceOf('2000')).toBe(118); // AP
    expect(balanceOf('5000')).toBe(100); // expense
    expect(balanceOf('1200')).toBe(18); // input credit
    // Aging sees the open bill (34 days late at 2026-08-05).
    const agingV = apAging.hooks.validate({ fields: { asOfDate: '2026-08-05' } });
    expect(agingV.ok).toBe(true);
    if (agingV.ok) {
      expect(agingV.values.totalOutstanding).toBe(118);
      expect(agingV.values.days31to60).toBe(118);
    }
    // markPaid → settlement booked; aging empties.
    const paid = await bills.hooks.runAction!('markPaid', bills.store.get(rec.id)!, ctx);
    expect(paid.ok, JSON.stringify(paid)).toBe(true);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx);
    expect(balanceOf('2000')).toBe(0);
    expect(balanceOf('1000')).toBe(-118); // cash out
    const agingAfter = apAging.hooks.validate({ fields: { asOfDate: '2026-08-05' } });
    if (agingAfter.ok) expect(agingAfter.values.totalOutstanding).toBe(0);
    // Cancel after payment → BOTH legs reversed, books net to zero.
    const cancelled = await bills.hooks.runAction!('cancel', bills.store.get(rec.id)!, ctx);
    expect(cancelled.ok).toBe(true);
    await bills.hooks.onChange!({ action: 'updated', record: bills.store.get(rec.id)! }, ctx);
    expect(balanceOf('2000')).toBe(0);
    expect(balanceOf('5000')).toBe(0);
    expect(balanceOf('1200')).toBe(0);
    expect(balanceOf('1000')).toBe(0);
    expect(vendorBillFromRecord(bills.store.get(rec.id)!).status).toBe('cancelled');
  });

  it('W1.8: deriveApAging ages only approved unpaid bills', () => {
    const bill = (status: string, dueDate: string) =>
      vendorBillFromRecord({
        id: 'b', moduleId: VENDOR_BILLS_MODULE_ID, kind: 'vendorBill', title: 'B', status: 'active',
        fields: { billNumber: 'B-1', vendor: 'V', amount: 100, taxRate: 0, status, dueDate,
          approvedAt: status === 'draft' ? '' : 'x', paidDate: status === 'paid' ? 'x' : '', cancelledAt: status === 'cancelled' ? 'x' : '' } as EnterpriseEntity['fields'],
        tags: [], rev: 1, createdAt: T0, updatedAt: T0, createdBy: null, updatedBy: null, metadata: {},
      });
    const NOW = Date.parse('2026-08-05T23:59:59.999Z');
    expect(deriveApAging([bill('approved', '2026-07-26')], NOW).days1to30).toBe(100);
    expect(deriveApAging([bill('draft', '2026-07-26')], NOW).billCount).toBe(0);
    expect(deriveApAging([bill('paid', '2026-07-26')], NOW).billCount).toBe(0);
    expect(deriveApAging([bill('cancelled', '2026-07-26')], NOW).billCount).toBe(0);
  });
});

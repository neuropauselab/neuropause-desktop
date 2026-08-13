import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CREDIT_NOTES_MODULE_ID,
  DEBIT_NOTES_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  creditNoteIssueLines,
  debitNoteIssueLines,
  glAccountFromRecord,
  overAdjustmentError,
  sumIssuedNotesFor,
  adjustmentNoteFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createVendorBillModule } from './vendorBillModule';
import { createCreditNoteModule } from './creditNoteModule';
import { createDebitNoteModule } from './debitNoteModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('adjustment-note domain rules (pure)', () => {
  it('issue lines always balance, with and without tax', () => {
    const bal = (ls: { debit: number; credit: number }[]) =>
      Math.round(ls.reduce((s, l) => s + l.debit - l.credit, 0) * 100);
    expect(bal(creditNoteIssueLines(100, 18, 118))).toBe(0);
    expect(bal(creditNoteIssueLines(100, 0, 100))).toBe(0);
    expect(creditNoteIssueLines(100, 0, 100)).toHaveLength(2);
    expect(bal(debitNoteIssueLines(100, 18, 118))).toBe(0);
    expect(bal(debitNoteIssueLines(100, 0, 100))).toBe(0);
  });
  it('the over-adjustment guard states the remaining amount', () => {
    expect(overAdjustmentError({ documentTotal: 118, alreadyIssued: 0, noteTotal: 118, documentLabel: 'invoice' })).toBe('');
    const err = overAdjustmentError({ documentTotal: 118, alreadyIssued: 100, noteTotal: 20, documentLabel: 'invoice' });
    expect(err).toContain('remaining adjustable amount (18)');
  });
});

describe('Credit + Debit Note modules over real stores', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let bills: EnterpriseModule;
  let creditNotes: EnterpriseModule;
  let debitNotes: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-notes-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    bills = createVendorBillModule(join(dir, 'bills.json'));
    creditNotes = createCreditNoteModule(join(dir, 'cn.json'), invoices.store);
    debitNotes = createDebitNoteModule(join(dir, 'dn.json'), bills.store);
    await Promise.all([
      accounts.store.load(), journal.store.load(), invoices.store.load(), bills.store.load(),
      creditNotes.store.load(), debitNotes.store.load(),
    ]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === CREDIT_NOTES_MODULE_ID ? creditNotes
        : id === DEBIT_NOTES_MODULE_ID ? debitNotes
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      accounts.store.flush(), journal.store.flush(), invoices.store.flush(), bills.store.flush(),
      creditNotes.store.flush(), debitNotes.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };

  const seedInvoice = (number: string, amount: number, taxRate: number): void => {
    invoices.store.create({
      title: number,
      fields: { number, customer: 'Acme', currency: 'USD', status: 'issued', amount, taxRate, amountPaid: 0 } as EnterpriseEntity['fields'],
      actor: 't@np', now: T0,
    });
  };

  const draftCreditNote = (noteNumber: string, documentRef: string, amount: number, taxRate: number): EnterpriseEntity => {
    const v = creditNotes.hooks.validate({ fields: { noteNumber, documentRef, party: 'Acme', amount, taxRate, currency: 'USD', status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return creditNotes.store.create({ title: noteNumber, fields: v.values, actor: 't@np', now: T0 });
  };

  it('credit note: refuses unknown invoices, issues with revenue/tax reversal, blocks over-crediting, cancel reverses', async () => {
    expect(creditNotes.hooks.validate({ fields: { noteNumber: 'CN-X', documentRef: 'NOPE', amount: 10, currency: 'USD', status: 'draft' } }).ok).toBe(false);
    seedInvoice('INV-1', 100, 18); // total 118
    const cn = draftCreditNote('CN-1', 'INV-1', 50, 18); // total 59
    const issued = await creditNotes.hooks.runAction!('issue', cn, ctx);
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    expect(balanceOf('4000')).toBe(-50); // revenue reduced
    expect(balanceOf('2100')).toBe(-9); // tax reduced
    expect(balanceOf('1100')).toBe(-59); // AR reduced
    // Issued notes are immutable and cannot re-issue.
    expect(creditNotes.hooks.validate({ fields: { ...creditNotes.store.get(cn.id)!.fields } }).ok).toBe(false);
    expect((await creditNotes.hooks.runAction!('issue', creditNotes.store.get(cn.id)!, ctx)).ok).toBe(false);
    // Over-crediting the remaining 59 with 60 is refused; exactly 59 is allowed.
    const tooBig = draftCreditNote('CN-2', 'INV-1', 50.85, 18); // 60.00 total
    expect((await creditNotes.hooks.runAction!('issue', tooBig, ctx)).ok).toBe(false);
    const exact = draftCreditNote('CN-3', 'INV-1', 50, 18); // 59 total
    expect((await creditNotes.hooks.runAction!('issue', exact, ctx)).ok).toBe(true);
    // Cancel restores the books.
    const cancel = await creditNotes.hooks.runAction!('cancel', creditNotes.store.get(cn.id)!, ctx);
    expect(cancel.ok).toBe(true);
    expect(balanceOf('1100')).toBe(-59); // only CN-3 remains booked
    expect(adjustmentNoteFromRecord(creditNotes.store.get(cn.id)!).status).toBe('cancelled');
    expect(sumIssuedNotesFor('INV-1', creditNotes.store.list().map(adjustmentNoteFromRecord))).toBe(59);
  });

  it('debit note: resolves the bill, issues with AP/expense/ITC reversal, blocks over-debiting', async () => {
    const bv = bills.hooks.validate({ fields: { billNumber: 'BILL-1', vendor: 'Supplies Co', amount: 200, taxRate: 18, currency: 'USD', status: 'draft' } });
    expect(bv.ok).toBe(true);
    if (bv.ok) bills.store.create({ title: 'BILL-1', fields: bv.values, actor: 't@np', now: T0 }); // total 236
    const dv = debitNotes.hooks.validate({ fields: { noteNumber: 'DN-1', documentRef: 'BILL-1', party: 'Supplies Co', amount: 100, taxRate: 18, currency: 'USD', status: 'draft' } });
    expect(dv.ok, JSON.stringify('errors' in dv ? dv.errors : {})).toBe(true);
    if (!dv.ok) throw new Error('unreachable');
    const dn = debitNotes.store.create({ title: 'DN-1', fields: dv.values, actor: 't@np', now: T0 });
    const issued = await debitNotes.hooks.runAction!('issue', dn, ctx);
    expect(issued.ok, JSON.stringify(issued)).toBe(true);
    expect(balanceOf('2000')).toBe(-118); // AP reduced
    expect(balanceOf('5000')).toBe(-100); // expense reduced
    expect(balanceOf('1200')).toBe(-18); // input credit reduced
    // Over-debiting past the bill total (236 − 118 = 118 remaining) is refused.
    const dv2 = debitNotes.hooks.validate({ fields: { noteNumber: 'DN-2', documentRef: 'BILL-1', amount: 110, taxRate: 18, currency: 'USD', status: 'draft' } });
    if (!dv2.ok) throw new Error('unreachable');
    const dn2 = debitNotes.store.create({ title: 'DN-2', fields: dv2.values, actor: 't@np', now: T0 }); // 129.80 total
    const refused = await debitNotes.hooks.runAction!('issue', dn2, ctx);
    expect(refused.ok).toBe(false);
    expect(String(refused.message)).toContain('remaining adjustable amount');
  });
});

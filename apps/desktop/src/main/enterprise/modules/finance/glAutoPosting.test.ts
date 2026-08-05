import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  GL_CONTROL_ACCOUNTS,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  glAccountFromRecord,
  glDecideInvoicePostings,
  glDecidePaymentPostings,
  glInvoiceEntryNumber,
  glJournalEntryFromRecord,
  glPaymentEntryNumber,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { handleInvoiceChangeForGl, handlePaymentChangeForGl } from './glPosting';

const T0 = '2026-08-05T00:00:00.000Z';

/* ── pure decisions (idempotent bookkeeping) ── */

describe('glDecideInvoicePostings', () => {
  const base = {
    invoiceId: 'inv_1',
    invoiceNumber: 'INV-7',
    subtotal: 100,
    taxAmount: 18,
    total: 118,
    deleted: false,
    sourceModule: 'finance',
  };
  it('derives Dr AR / Cr Revenue / Cr Tax once an invoice leaves draft', () => {
    const [entry] = glDecideInvoicePostings({ ...base, status: 'issued', existingEntryNumbers: new Set() });
    expect(entry.entryNumber).toBe(glInvoiceEntryNumber('INV-7'));
    expect(entry.lines).toEqual([
      { account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: 118, credit: 0 },
      { account: GL_CONTROL_ACCOUNTS.salesRevenue.code, debit: 0, credit: 100 },
      { account: GL_CONTROL_ACCOUNTS.taxPayable.code, debit: 0, credit: 18 },
    ]);
  });
  it('omits the tax line for untaxed invoices and skips drafts, zero totals, and already-posted numbers', () => {
    const [untaxed] = glDecideInvoicePostings({ ...base, taxAmount: 0, total: 100, status: 'paid', existingEntryNumbers: new Set() });
    expect(untaxed.lines).toHaveLength(2);
    expect(glDecideInvoicePostings({ ...base, status: 'draft', existingEntryNumbers: new Set() })).toEqual([]);
    expect(glDecideInvoicePostings({ ...base, total: 0, status: 'issued', existingEntryNumbers: new Set() })).toEqual([]);
    expect(
      glDecideInvoicePostings({ ...base, status: 'issued', existingEntryNumbers: new Set([glInvoiceEntryNumber('INV-7')]) }),
    ).toEqual([]);
  });
  it('derives exactly one mirrored reversal after cancellation or deletion', () => {
    const posted = new Set([glInvoiceEntryNumber('INV-7')]);
    const [rev] = glDecideInvoicePostings({ ...base, status: 'cancelled', existingEntryNumbers: posted });
    expect(rev.entryNumber).toBe(`${glInvoiceEntryNumber('INV-7')}-REV`);
    expect(rev.lines[0]).toEqual({ account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: 0, credit: 118 });
    const both = new Set([glInvoiceEntryNumber('INV-7'), `${glInvoiceEntryNumber('INV-7')}-REV`]);
    expect(glDecideInvoicePostings({ ...base, status: 'cancelled', existingEntryNumbers: both })).toEqual([]);
    // Cancelling an invoice that was never posted decides nothing.
    expect(glDecideInvoicePostings({ ...base, status: 'cancelled', existingEntryNumbers: new Set() })).toEqual([]);
  });
});

describe('glDecidePaymentPostings', () => {
  const base = { paymentId: 'pay_1', paymentNumber: 'PAY-3', amount: 118, deleted: false, sourceModule: 'finance-payments' };
  it('derives Dr Cash / Cr AR on cleared, once; reversal on void/delete, once', () => {
    const [entry] = glDecidePaymentPostings({ ...base, status: 'cleared', existingEntryNumbers: new Set() });
    expect(entry.entryNumber).toBe(glPaymentEntryNumber('PAY-3'));
    expect(entry.lines).toEqual([
      { account: GL_CONTROL_ACCOUNTS.cash.code, debit: 118, credit: 0 },
      { account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: 0, credit: 118 },
    ]);
    expect(glDecidePaymentPostings({ ...base, status: 'pending', existingEntryNumbers: new Set() })).toEqual([]);
    const posted = new Set([glPaymentEntryNumber('PAY-3')]);
    const [rev] = glDecidePaymentPostings({ ...base, status: 'void', existingEntryNumbers: posted });
    expect(rev.entryNumber).toBe(`${glPaymentEntryNumber('PAY-3')}-REV`);
    const both = new Set([glPaymentEntryNumber('PAY-3'), `${glPaymentEntryNumber('PAY-3')}-REV`]);
    expect(glDecidePaymentPostings({ ...base, status: 'void', existingEntryNumbers: both })).toEqual([]);
  });
});

/* ── the wired seam over real stores ── */

describe('GL auto-posting through the real modules', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  const invoiceRecord = (fields: Record<string, unknown>, status = 'active'): EnterpriseEntity => ({
    id: 'inv_1',
    moduleId: 'finance',
    kind: 'invoice',
    title: String(fields.number ?? ''),
    status: status as EnterpriseEntity['status'],
    fields: fields as EnterpriseEntity['fields'],
    tags: [],
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
    createdBy: 't@np',
    updatedBy: 't@np',
    metadata: {},
  });

  const paymentRecord = (fields: Record<string, unknown>, status = 'active'): EnterpriseEntity => ({
    ...invoiceRecord(fields, status),
    id: 'pay_1',
    moduleId: 'finance-payments',
    kind: 'payment',
    title: String(fields.paymentNumber ?? ''),
  });

  beforeEach(async () => {
    dir = join(tmpdir(), `np-glauto-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    await accounts.store.load();
    await journal.store.load();
    ctx = {
      actor: () => 'system:test',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await accounts.store.flush();
    await journal.store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };

  it('seeds an empty chart, posts the issue entry, and books AR/Revenue/Tax', async () => {
    const record = invoiceRecord({ number: 'INV-7', customer: 'Acme', amount: 100, taxRate: 18, status: 'issued' });
    await handleInvoiceChangeForGl({ record }, ctx);
    expect(accounts.store.count()).toBe(4); // seeded control chart
    const je = journal.store.list().find((r) => r.fields.entryNumber === 'JE-INV-INV-7');
    expect(je).toBeDefined();
    expect(glJournalEntryFromRecord(je!).posted).toBe(true);
    expect(balanceOf('1100')).toBe(118);
    expect(balanceOf('4000')).toBe(100);
    expect(balanceOf('2100')).toBe(18);
    // Re-firing the same lifecycle event books nothing twice.
    await handleInvoiceChangeForGl({ record }, ctx);
    expect(journal.store.count()).toBe(1);
  });

  it('books a cleared payment and reverses a later cancellation, leaving consistent balances', async () => {
    const inv = invoiceRecord({ number: 'INV-7', customer: 'Acme', amount: 100, taxRate: 18, status: 'issued' });
    await handleInvoiceChangeForGl({ record: inv }, ctx);
    await handlePaymentChangeForGl(
      { record: paymentRecord({ paymentNumber: 'PAY-3', invoiceRef: 'INV-7', amount: 118, status: 'cleared' }) },
      ctx,
    );
    expect(balanceOf('1000')).toBe(118); // cash in
    expect(balanceOf('1100')).toBe(0); // receivable settled
    const cancelled = invoiceRecord({ number: 'INV-7', customer: 'Acme', amount: 100, taxRate: 18, status: 'cancelled' });
    await handleInvoiceChangeForGl({ record: cancelled }, ctx);
    const rev = journal.store.list().find((r) => r.fields.entryNumber === 'JE-INV-INV-7-REV');
    expect(rev).toBeDefined();
    expect(glJournalEntryFromRecord(rev!).posted).toBe(true);
    expect(balanceOf('1100')).toBe(-118); // AR now shows the over-collection to refund
    expect(balanceOf('4000')).toBe(0); // revenue fully reversed
  });

  it('pauses (writes nothing partial) when a customized chart lacks a control account', async () => {
    // A non-empty chart WITHOUT AR/Revenue/Tax — the seed must not run, the post must not force.
    const v = accounts.hooks.validate({ fields: { code: '9999', name: 'Custom', class: 'asset', currency: 'USD' } });
    expect(v.ok).toBe(true);
    if (v.ok) accounts.store.create({ title: '9999', fields: v.values, actor: 't@np', now: T0 });
    const record = invoiceRecord({ number: 'INV-9', customer: 'Acme', amount: 50, taxRate: 0, status: 'issued' });
    await handleInvoiceChangeForGl({ record }, ctx);
    expect(accounts.store.count()).toBe(1); // never overwrote the custom chart
    expect(journal.store.count()).toBe(0); // nothing partial recorded
    expect(balanceOf('9999')).toBe(0);
    // Once the chart resolves, the SAME lifecycle event books the entry.
    for (const c of [
      { code: '1100', name: 'AR', class: 'asset' },
      { code: '4000', name: 'Revenue', class: 'revenue' },
    ]) {
      const ok = accounts.hooks.validate({ fields: { ...c, currency: 'USD' } });
      if (ok.ok) accounts.store.create({ title: c.code, fields: ok.values, actor: 't@np', now: T0 });
    }
    await handleInvoiceChangeForGl({ record }, ctx);
    expect(journal.store.count()).toBe(1);
    expect(balanceOf('1100')).toBe(50);
  });

  it('no-ops gracefully when the GL modules are not wired', async () => {
    const bare: EnterpriseModuleActionContext = { ...ctx, moduleFor: () => null };
    await handleInvoiceChangeForGl(
      { record: invoiceRecord({ number: 'INV-1', amount: 10, taxRate: 0, status: 'issued' }) },
      bare,
    );
    expect(journal.store.count()).toBe(0);
  });
});

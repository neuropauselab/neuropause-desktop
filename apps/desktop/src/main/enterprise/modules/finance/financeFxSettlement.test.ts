import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FINANCE_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  glAccountFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createInvoiceModule } from './invoiceModule';
import { createPaymentModule } from './paymentModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { handleInvoiceChangeForGl, handlePaymentChangeForGl } from './glPosting';

const T0 = '2026-08-06T00:00:00.000Z';

describe('W6-B4 realized FX gain/loss on customer payment settlement', () => {
  let dir: string;
  let invoices: EnterpriseModule;
  let payments: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fx-settle-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    payments = createPaymentModule(join(dir, 'payments.json'), invoices.store);
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    await Promise.all([invoices.store.load(), payments.store.load(), accounts.store.load(), journal.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === FINANCE_MODULE_ID ? invoices
        : id === PAYMENTS_MODULE_ID ? payments
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([invoices.store.flush(), payments.store.flush(), accounts.store.flush(), journal.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balance = (code: string): number => {
    const a = accounts.store.list().find((r) => String(r.fields.code) === code);
    return a ? glAccountFromRecord(a).balance : 0;
  };
  const issueInvoice = async (fields: Record<string, unknown>): Promise<EnterpriseEntity> => {
    const v = invoices.hooks.validate({ fields: { customer: 'Acme', amount: 100, taxRate: 0, status: 'issued', ...fields } });
    if (!v.ok) throw new Error('invoice invalid');
    const rec = invoices.store.create({ title: String(v.values.number), fields: v.values, actor: 't@np', now: T0 });
    await handleInvoiceChangeForGl({ record: rec }, ctx);
    return rec;
  };
  // Customer-payment GL posting is `handlePaymentChangeForGl` (the module's
  // onChange reconciles the invoice; the GL leg is this function, invoked the
  // same way glAutoPosting.test exercises it).
  const pay = async (fields: Record<string, unknown>): Promise<EnterpriseEntity> => {
    const v = payments.hooks.validate({ fields: { paymentNumber: `PAY-${randomUUID().slice(0, 4)}`, amount: 100, status: 'cleared', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = payments.store.create({ title: String(v.values.paymentNumber), fields: v.values, actor: 't@np', now: T0 });
    await handlePaymentChangeForGl({ record: rec }, ctx);
    return rec;
  };

  it('B4.5 wiring: a customer payment through the module onChange now posts to the GL', async () => {
    await issueInvoice({ number: 'INV-W', amount: 100, currency: 'USD' });
    expect(balance('1100')).toBe(100); // AR booked by the invoice
    const v = payments.hooks.validate({ fields: { paymentNumber: 'PAY-W', invoiceRef: 'INV-W', amount: 100, status: 'cleared' } });
    if (!v.ok) throw new Error('unreachable');
    const rec = payments.store.create({ title: 'PAY-W', fields: v.values, actor: 't@np', now: T0 });
    // The wired onChange (reconcile → post) clears AR — previously it only reconciled.
    await payments.hooks.onChange!({ action: 'created', record: rec }, ctx);
    expect(balance('1100')).toBe(0);
    expect(balance('1000')).toBe(100); // customer cash now booked in the ledger
  });

  it('single-currency settlement is unchanged — Dr Cash / Cr AR, no FX account touched', async () => {
    await issueInvoice({ number: 'INV-USD', amount: 100, currency: 'USD' });
    expect(balance('1100')).toBe(100); // AR booked
    await pay({ invoiceRef: 'INV-USD', amount: 100, currency: 'USD' });
    expect(balance('1100')).toBe(0); // AR fully cleared, functional == original
    expect(balance('7810')).toBe(0); // FX account never created for a flat settlement
  });

  it('a foreign invoice paid at a HIGHER rate books a realized exchange GAIN', async () => {
    await issueInvoice({ number: 'INV-EUR', amount: 100, currency: 'EUR', exchangeRate: 90 });
    expect(balance('1100')).toBe(9000); // AR booked in functional
    await pay({ invoiceRef: 'INV-EUR', amount: 100, currency: 'EUR', exchangeRate: 92 });
    // AR cleared at the BOOKING rate (9000), cash received at the SETTLEMENT rate (9200).
    expect(balance('1100')).toBe(0);
    expect(balance('1000')).toBe(9200); // cash debited in functional
    expect(Math.abs(balance('7810'))).toBe(200); // realized gain 9200 − 9000
    expect(journal.store.list().some((r) => String(r.fields.entryNumber).startsWith('JE-PAY-'))).toBe(true);
  });

  it('a foreign invoice paid at a LOWER rate books a realized exchange LOSS, and void reverses it', async () => {
    await issueInvoice({ number: 'INV-EUR2', amount: 100, currency: 'EUR', exchangeRate: 90 });
    const payRec = await pay({ invoiceRef: 'INV-EUR2', amount: 100, currency: 'EUR', exchangeRate: 88 });
    expect(balance('1100')).toBe(0); // AR still cleared at booking rate 9000
    expect(balance('1000')).toBe(8800); // less cash received
    expect(Math.abs(balance('7810'))).toBe(200); // realized loss 9000 − 8800
    // Void the payment → the whole 3-line entry reverses.
    payments.store.update(payRec.id, { fields: { status: 'void' }, actor: 't@np', now: T0 });
    await handlePaymentChangeForGl({ record: payments.store.get(payRec.id)! }, ctx);
    expect(balance('1100')).toBe(9000); // AR restored
    expect(balance('1000')).toBe(0); // cash restored
    expect(balance('7810')).toBe(0); // realized loss reversed
  });
});

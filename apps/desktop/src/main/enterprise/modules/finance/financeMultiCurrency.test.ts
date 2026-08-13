import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FINANCE_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  functionalInvoiceTotal,
  glAccountFromRecord,
  invoiceFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createInvoiceModule } from './invoiceModule';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('W6-B2 invoice functional-currency posting (additive, GL preserved)', () => {
  let dir: string;
  let invoices: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fx-inv-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    await Promise.all([invoices.store.load(), accounts.store.load(), journal.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === FINANCE_MODULE_ID ? invoices
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([invoices.store.flush(), accounts.store.flush(), journal.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const issue = (fields: Record<string, unknown>): EnterpriseEntity => {
    const v = invoices.hooks.validate({ fields: { customer: 'Acme', amount: 100, taxRate: 0, status: 'issued', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return invoices.store.create({ title: String(v.values.number), fields: v.values, actor: 't@np', now: T0 });
  };
  const balance = (code: string): number => {
    const a = accounts.store.list().find((r) => String(r.fields.code) === code);
    return a ? glAccountFromRecord(a).balance : 0;
  };

  it('single-currency invoice is unchanged — rate defaults to 1, functional == original, GL posts original', async () => {
    const rec = issue({ number: 'INV-USD', amount: 100, currency: 'USD' });
    expect(rec.fields.exchangeRate).toBe(1);
    expect(rec.fields.total).toBe(100);
    expect(rec.fields.functionalTotal).toBe(100); // functional == original at rate 1
    await invoices.hooks.onChange!({ action: 'created', record: rec }, ctx);
    expect(balance('1100')).toBe(100); // AR booked at original == functional
  });

  it('foreign-currency invoice posts the FUNCTIONAL amount to the GL, keeping the original on the record', async () => {
    // 100 EUR @ 90 INR/EUR, no tax → functional 9,000.
    const rec = issue({ number: 'INV-EUR', amount: 100, currency: 'EUR', exchangeRate: 90 });
    expect(rec.fields.total).toBe(100); // original (transaction currency) preserved
    expect(rec.fields.exchangeRate).toBe(90);
    expect(rec.fields.functionalTotal).toBe(9000); // 100 × 90
    await invoices.hooks.onChange!({ action: 'created', record: rec }, ctx);
    expect(balance('1100')).toBe(9000); // AR booked in FUNCTIONAL currency
    // The entry is balanced: AR debit 9000 == Revenue credit 9000.
    expect(Math.abs(balance('4000'))).toBe(9000);
    // The functional entry was posted, and the FX audit trail (currency + rate +
    // functional amount) lives on the invoice record it derives from.
    expect(journal.store.list().some((r) => String(r.fields.entryNumber) === 'JE-INV-INV-EUR')).toBe(true);
    expect(invoiceFromRecord(rec).exchangeRate).toBe(90);
    expect(rec.fields.currency).toBe('EUR');
    expect(rec.fields.functionalTotal).toBe(9000);
  });

  it('functional-total math converts each component and matches the projection helper', () => {
    // 1000 EUR subtotal + 18% tax (180) at rate 90 → (1000+180)×90 = 106,200.
    const rec = issue({ number: 'INV-TAX', amount: 1000, taxRate: 18, currency: 'EUR', exchangeRate: 90 });
    expect(rec.fields.total).toBe(1180);
    expect(rec.fields.functionalTotal).toBe(106200);
    expect(functionalInvoiceTotal(invoiceFromRecord(rec))).toBe(106200);
  });
});

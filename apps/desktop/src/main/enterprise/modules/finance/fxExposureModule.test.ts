import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FxExposureByCurrency } from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createVendorBillModule } from './vendorBillModule';
import { createExchangeRateModule } from './exchangeRateModule';
import { createFxExposureModule } from './fxExposureModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('FX exposure module — immutable point-in-time snapshots (W6-C2c)', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let bills: EnterpriseModule;
  let rates: EnterpriseModule;
  let fxexp: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fxexp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    bills = createVendorBillModule(join(dir, 'bills.json'));
    rates = createExchangeRateModule(join(dir, 'rates.json'));
    fxexp = createFxExposureModule(join(dir, 'fxexp.json'), invoices.store, bills.store, rates.store, accounts.store, journal.store);
    await Promise.all([accounts, journal, invoices, bills, rates, fxexp].map((m) => m.store.load()));
  });

  afterEach(async () => {
    await Promise.all([accounts, journal, invoices, bills, rates, fxexp].map((m) => m.store.flush()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const addInvoice = (number: string, customer: string, currency: string, amount: number, exchangeRate: number): void => {
    const v = invoices.hooks.validate({ fields: { number, customer, amount, taxRate: 0, currency, exchangeRate, status: 'issued' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) invoices.store.create({ title: number, fields: v.values, actor: 't@np', now: T0 });
  };
  const addRate = (from: string, to: string, rate: number, effectiveFrom: string): void => {
    const v = rates.hooks.validate({ fields: { fromCurrency: from, toCurrency: to, rate, effectiveFrom } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) rates.store.create({ title: `${from}-${to}`, fields: v.values, actor: 't@np', now: T0 });
  };
  const generate = (asOfDate: string) => {
    const v = fxexp.hooks.validate({ fields: { asOfDate } });
    if (v.ok) fxexp.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    return v;
  };

  it('snapshots open foreign receivables marked to the as-of rate', () => {
    addInvoice('INV-1', 'Acme', 'EUR', 1000, 1.1); // open EUR AR booked at 1.10
    addRate('EUR', 'USD', 1.25, '2026-08-01'); // as-of rate 1.25

    const v = generate('2026-08-31');
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.reportNumber).toBe('FXE-2026-08-31-1');
    expect(v.values.functionalCurrency).toBe('USD');
    expect(v.values.currencyCount).toBe(1);
    expect(v.values.totalFunctionalCurrent).toBe(1250); // 1000 × 1.25
    expect(v.values.totalUnrealizedDelta).toBe(150); // 1250 − 1100
    expect(v.values.skippedNoRate).toBe(0);

    const byCurrency = JSON.parse(String(v.values.byCurrency)) as FxExposureByCurrency[];
    expect(byCurrency).toHaveLength(1);
    expect(byCurrency[0]).toMatchObject({ currency: 'EUR', receivableForeign: 1000, functionalCurrent: 1250, unrealizedDelta: 150 });
    const byCustomer = JSON.parse(String(v.values.byCustomer)) as Array<Record<string, unknown>>;
    expect(byCustomer[0]).toMatchObject({ party: 'Acme', currency: 'EUR', functionalCurrent: 1250 });
    expect(JSON.parse(String(v.values.byVendor))).toEqual([]);
  });

  it('produces an empty snapshot for a single-currency book', () => {
    addInvoice('INV-USD', 'Acme', 'USD', 1000, 1); // functional currency → no exposure
    const v = generate('2026-08-31');
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.currencyCount).toBe(0);
    expect(v.values.totalFunctionalCurrent).toBe(0);
    expect(JSON.parse(String(v.values.byCurrency))).toEqual([]);
    expect(String(v.values.note)).toContain('nothing at risk');
  });

  it('refuses to regenerate an immutable snapshot', () => {
    const v = generate('2026-08-31');
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const again = fxexp.hooks.validate({ fields: { asOfDate: '2026-08-31', generatedAt: String(v.values.generatedAt) } });
    expect(again.ok).toBe(false);
  });
});

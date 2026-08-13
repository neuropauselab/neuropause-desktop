import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  TAX_REPORTS_MODULE_ID,
  glTaxReportForPeriod,
  type EnterpriseEntity,
  type GlTaxReportLine,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createTaxReportModule } from './taxReportModule';
import { createInvoiceModule } from './invoiceModule';
import { handleInvoiceChangeForGl } from './glPosting';

const T0 = '2026-08-05T00:00:00.000Z';

describe('glTaxReportForPeriod (pure)', () => {
  it('reports an empty period honestly', () => {
    const report = glTaxReportForPeriod({ periodKey: '2026-08', entries: [], invoices: [] });
    expect(report.taxCollected).toBe(0);
    expect(report.invoiceCount).toBe(0);
    expect(report.note).toBe('no posted tax activity in this period — the report is empty, not fabricated');
  });
});

describe('Tax Reports module — generated from the posted books', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let taxReports: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  /** Issue an invoice: persist the record in the invoice store, then fire the GL seam. */
  const issueInvoice = async (number: string, amount: number, taxRate: number, gstin = ''): Promise<EnterpriseEntity> => {
    const fields = { number, customer: 'Acme', customerGstin: gstin, amount, taxRate, status: 'issued', currency: 'USD' };
    const record = invoices.store.create({ title: number, fields: fields as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
    await handleInvoiceChangeForGl({ record }, ctx);
    return record;
  };

  const generateReport = (periodKey: string): EnterpriseEntity => {
    const v = taxReports.hooks.validate({ fields: { periodKey } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return taxReports.store.create({
      title: String(v.values.reportNumber),
      fields: v.values,
      actor: 't@np',
      now: T0,
    });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-gltax-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    taxReports = createTaxReportModule(join(dir, 'tax.json'), journal.store, invoices.store);
    await Promise.all([accounts.store.load(), journal.store.load(), invoices.store.load(), taxReports.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID
          ? accounts
          : id === JOURNAL_ENTRIES_MODULE_ID
            ? journal
            : id === TAX_REPORTS_MODULE_ID
              ? taxReports
              : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), invoices.store.flush(), taxReports.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('generates the period report from posted entries with a per-invoice breakdown that agrees', async () => {
    await issueInvoice('INV-1', 100, 18, '22AAAAA0000A1Z5');
    await issueInvoice('INV-2', 200, 18);
    const report = generateReport('2026-08');
    expect(report.fields.reportNumber).toBe('GST-2026-08-1');
    expect(report.fields.taxCollected).toBe(54); // 18 + 36, from the books
    expect(report.fields.taxableRevenue).toBe(300);
    expect(report.fields.invoiceCount).toBe(2);
    expect(report.fields.discrepancy).toBe(0);
    expect(String(report.fields.note)).toContain('books and declared invoice tax agree');
    const lines = JSON.parse(String(report.fields.lines)) as GlTaxReportLine[];
    expect(lines.map((l) => l.invoiceNumber)).toEqual(['INV-1', 'INV-2']);
    expect(lines[0].customerGstin).toBe('22AAAAA0000A1Z5');
    expect(lines[0].bookedTax).toBe(18);
    expect(lines[0].declaredTax).toBe(18);
  });

  it('surfaces a books-vs-declared discrepancy instead of reconciling it silently', async () => {
    const rec = await issueInvoice('INV-3', 100, 18);
    // The invoice's declared tax changes WITHOUT its GL event firing — the exact
    // drift the report must expose, not hide.
    invoices.store.update(rec.id, { fields: { taxRate: 28 }, actor: 't@np', now: T0 });
    const report = generateReport('2026-08');
    expect(report.fields.taxCollected).toBe(18); // books still hold the posted 18
    expect(report.fields.declaredTax).toBe(28);
    expect(report.fields.discrepancy).toBe(-10);
    expect(String(report.fields.note)).toContain('review before filing');
  });

  it('reports are immutable snapshots; regenerating supersedes the earlier one', async () => {
    await issueInvoice('INV-4', 100, 18);
    const first = generateReport('2026-08');
    // Edits are refused (validate sees the stamped generatedAt).
    expect(taxReports.hooks.validate({ fields: { ...first.fields } }).ok).toBe(false);
    const second = generateReport('2026-08');
    expect(second.fields.reportNumber).toBe('GST-2026-08-2');
    await taxReports.hooks.onChange!({ action: 'created', record: second }, ctx);
    expect(String(taxReports.store.get(first.id)!.fields.status)).toBe('superseded');
    expect(String(taxReports.store.get(second.id)!.fields.status)).toBe('generated');
  });

  it('rejects malformed period keys and excludes other periods from the figures', async () => {
    expect(taxReports.hooks.validate({ fields: { periodKey: '2026-13' } }).ok).toBe(false);
    expect(taxReports.hooks.validate({ fields: { periodKey: 'august' } }).ok).toBe(false);
    await issueInvoice('INV-5', 100, 18);
    const other = generateReport('2026-07');
    expect(other.fields.taxCollected).toBe(0);
    expect(other.fields.invoiceCount).toBe(0);
    expect(String(other.fields.note)).toContain('empty, not fabricated');
  });
});

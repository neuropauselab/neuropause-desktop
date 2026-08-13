import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  arAgingBucketFor,
  deriveArAging,
  type ArAgingRow,
  type EnterpriseEntity,
  type FinanceInvoice,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createInvoiceModule } from './invoiceModule';
import { createArAgingModule } from './arAgingModule';

const NOW = Date.parse('2026-08-05T23:59:59.999Z');
const DAY = 86400000;
const day = (offset: number): string => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

function invoice(partial: Partial<FinanceInvoice>): FinanceInvoice {
  return {
    id: 'i1',
    number: 'INV-1',
    customer: 'Acme',
    amount: 100,
    taxRate: 0,
    amountPaid: 0,
    currency: 'USD',
    status: 'issued',
    paymentTerms: 'net30',
    issueDate: null,
    dueDate: null,
    sourceOrder: '',
    notes: null,
    ...partial,
  };
}

describe('arAgingBucketFor (pure boundaries)', () => {
  it('buckets exactly at 0/30/60/90', () => {
    expect(arAgingBucketFor(0)).toBe('current');
    expect(arAgingBucketFor(-5)).toBe('current');
    expect(arAgingBucketFor(1)).toBe('days1to30');
    expect(arAgingBucketFor(30)).toBe('days1to30');
    expect(arAgingBucketFor(31)).toBe('days31to60');
    expect(arAgingBucketFor(60)).toBe('days31to60');
    expect(arAgingBucketFor(61)).toBe('days61to90');
    expect(arAgingBucketFor(90)).toBe('days61to90');
    expect(arAgingBucketFor(91)).toBe('days90plus');
  });
});

describe('deriveArAging (pure)', () => {
  it('ages only open invoices, buckets by days past due, and excludes settled/draft/cancelled', () => {
    const aging = deriveArAging(
      [
        invoice({ number: 'DUE-TODAY', dueDate: day(0) }), // current
        invoice({ number: 'LATE-10', dueDate: day(-10) }), // 1–30
        invoice({ number: 'LATE-45', dueDate: day(-45), amount: 200, amountPaid: 50 }), // 31–60, partially paid
        invoice({ number: 'LATE-95', dueDate: day(-95) }), // 90+
        invoice({ number: 'NO-DUE' }), // current — cannot be overdue by a date it lacks
        invoice({ number: 'PAID', dueDate: day(-40), amountPaid: 100 }), // settled — never ages
        invoice({ number: 'DRAFT', status: 'draft' }),
        invoice({ number: 'CANCELLED', status: 'cancelled', dueDate: day(-99) }),
      ],
      NOW,
    );
    expect(aging.invoiceCount).toBe(5);
    expect(aging.current).toBe(200); // DUE-TODAY + NO-DUE
    expect(aging.days1to30).toBe(100);
    expect(aging.days31to60).toBe(150); // 200 − 50 paid
    expect(aging.days61to90).toBe(0);
    expect(aging.days90plus).toBe(100);
    expect(aging.totalOutstanding).toBe(550);
    // Sorted worst-first.
    expect(aging.rows[0].invoiceNumber).toBe('LATE-95');
    expect(aging.rows[0].daysOverdue).toBe(95);
  });
});

describe('Receivables Aging module — snapshots over the real invoice store', () => {
  let dir: string;
  let invoices: EnterpriseModule;
  let agingReports: EnterpriseModule;

  const seedInvoice = (number: string, fields: Record<string, unknown>): void => {
    invoices.store.create({
      title: number,
      fields: { number, customer: 'Acme', currency: 'USD', status: 'issued', amount: 100, taxRate: 0, amountPaid: 0, ...fields } as EnterpriseEntity['fields'],
      actor: 't@np',
      now: '2026-08-01T00:00:00.000Z',
    });
  };

  const generate = (asOfDate: string): EnterpriseEntity => {
    const v = agingReports.hooks.validate({ fields: { asOfDate } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return agingReports.store.create({
      title: String(v.values.reportNumber),
      fields: v.values,
      actor: 't@np',
      now: '2026-08-05T00:00:00.000Z',
    });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-araging-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    agingReports = createArAgingModule(join(dir, 'aging.json'), invoices.store);
    await Promise.all([invoices.store.load(), agingReports.store.load()]);
  });

  afterEach(async () => {
    await Promise.all([invoices.store.flush(), agingReports.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('generates a deterministic snapshot at the given as-of date with a worst-first breakdown', () => {
    seedInvoice('INV-1', { dueDate: '2026-07-26' }); // 10 days late at 2026-08-05
    seedInvoice('INV-2', { dueDate: '2026-04-27' }); // 100 days late
    seedInvoice('INV-3', { dueDate: '2026-09-01' }); // current
    const report = generate('2026-08-05');
    expect(report.fields.reportNumber).toBe('AR-AGING-2026-08-05-1');
    expect(report.fields.totalOutstanding).toBe(300);
    expect(report.fields.current).toBe(100);
    expect(report.fields.days1to30).toBe(100);
    expect(report.fields.days90plus).toBe(100);
    expect(String(report.fields.note)).toContain('payables aging arrives with the vendor-bill module');
    const rows = JSON.parse(String(report.fields.rows)) as ArAgingRow[];
    expect(rows[0].invoiceNumber).toBe('INV-2');
    expect(rows[0].bucket).toBe('days90plus');
  });

  it('reports are immutable; repeat generations number sequentially and history is kept', () => {
    seedInvoice('INV-1', { dueDate: '2026-07-26' });
    const first = generate('2026-08-05');
    expect(agingReports.hooks.validate({ fields: { ...first.fields } }).ok).toBe(false);
    const second = generate('2026-08-05');
    expect(second.fields.reportNumber).toBe('AR-AGING-2026-08-05-2');
    expect(agingReports.store.count()).toBe(2); // history, never superseded
  });

  it('rejects malformed as-of dates and reports empty books honestly', () => {
    expect(agingReports.hooks.validate({ fields: { asOfDate: 'not-a-date' } }).ok).toBe(false);
    const report = generate('2026-08-05');
    expect(report.fields.invoiceCount).toBe(0);
    expect(String(report.fields.note)).toContain('empty, not fabricated');
  });
});

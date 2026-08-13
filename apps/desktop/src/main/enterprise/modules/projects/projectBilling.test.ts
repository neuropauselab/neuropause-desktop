import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FINANCE_MODULE_ID,
  TIME_ENTRIES_MODULE_ID,
  deriveBillingRun,
  timeEntryFromRecord,
  type EnterpriseEntity,
  type TimeEntry,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createInvoiceModule } from '../finance/invoiceModule';
import { createProjectModule } from './projectModule';
import { createTimeEntryModule } from './timeEntryModule';
import { createBillingRunModule } from './billingRunModule';

const T0 = '2026-08-06T00:00:00.000Z';

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: 'e1', entryNumber: 'TE-1', projectRef: 'p1', person: 'kinjal', date: '2026-08-03',
  hours: 4, hourlyRate: 50, billable: true, description: '', invoicedBy: '',
  createdAt: T0, updatedAt: T0, ...over,
});

describe('billing run engine (pure) — unbilled billable time only, rate-less counted', () => {
  it('groups person+rate, sums exactly, and skips what it must — visibly', () => {
    const run = deriveBillingRun(
      [
        entry({}),
        entry({ id: 'e2', hours: 3.5 }), // same person+rate → same line
        entry({ id: 'e3', person: 'dishant', hourlyRate: 60, hours: 2 }),
        entry({ id: 'e4', billable: false }), // non-billable — excluded
        entry({ id: 'e5', invoicedBy: 'inv-1' }), // already billed — excluded
        entry({ id: 'e6', date: '2026-09-10' }), // outside period — excluded
        entry({ id: 'e7', hourlyRate: 0 }), // no rate — skipped AND counted
      ],
      'p1', '2026-08-01', '2026-08-31',
    );
    expect(run.entryCount).toBe(3);
    expect(run.skippedNoRate).toBe(1);
    const kinjal = run.lines.find((l) => l.person === 'kinjal')!;
    expect(kinjal.hours).toBe(7.5);
    expect(kinjal.amount).toBe(375);
    expect(kinjal.entryIds).toEqual(['e1', 'e2']);
    expect(run.totalAmount).toBe(495); // 375 + 120
    expect(run.totalHours).toBe(9.5);
  });
});

describe('Time entries + billing runs over real stores — the portfolio→billing chain', () => {
  let dir: string;
  let projects: EnterpriseModule;
  let entries: EnterpriseModule;
  let invoices: EnterpriseModule;
  let runs: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;
  let projectId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bill-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    projects = createProjectModule(join(dir, 'projects.json'));
    entries = createTimeEntryModule(join(dir, 'entries.json'), projects.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    runs = createBillingRunModule(join(dir, 'runs.json'), entries.store, projects.store);
    await Promise.all([projects.store.load(), entries.store.load(), invoices.store.load(), runs.store.load()]);
    const pv = projects.hooks.validate({ fields: { projectNumber: 'PRJ-1', name: 'Relaunch', billingType: 'time_material' } });
    if (!pv.ok) throw new Error('project invalid');
    projectId = projects.store.create({ title: 'Relaunch', fields: pv.values, actor: 't@np', now: T0 }).id;
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === FINANCE_MODULE_ID ? invoices
        : id === TIME_ENTRIES_MODULE_ID ? entries
        : null,
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([projects.store.flush(), entries.store.flush(), invoices.store.flush(), runs.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const logTime = (over: Record<string, unknown> = {}): EnterpriseEntity => {
    const v = entries.hooks.validate({
      fields: { entryNumber: `TE-${randomUUID().slice(0, 4)}`, projectRef: projectId, person: 'kinjal', date: '2026-08-03', hours: 4, hourlyRate: 50, billable: 'yes', ...over },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return entries.store.create({ title: 'TE', fields: v.values, actor: 't@np', now: T0 });
  };

  it('guards entries (hours, open project) and previews runs deterministically', () => {
    expect(entries.hooks.validate({ fields: { entryNumber: 'X', projectRef: projectId, person: 'k', date: '2026-08-03', hours: 0 } }).ok).toBe(false);
    expect(entries.hooks.validate({ fields: { entryNumber: 'X', projectRef: 'ghost', person: 'k', date: '2026-08-03', hours: 1 } }).ok).toBe(false);
    logTime({});
    logTime({ hours: 3.5 });
    const v = runs.hooks.validate({ fields: { projectRef: projectId, periodFrom: '2026-08-01', periodTo: '2026-08-31' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) {
      expect(v.values.runNumber).toBe('BR-PRJ-1-1');
      expect(v.values.totalAmount).toBe(375);
      expect(v.values.entryCount).toBe(2);
    }
  });

  it('issuing creates a REAL draft invoice, freezes the entries, and closes the run', async () => {
    const e1 = logTime({});
    logTime({ hours: 2, person: 'dishant', hourlyRate: 60 });
    const v = runs.hooks.validate({ fields: { projectRef: projectId, periodFrom: '2026-08-01', periodTo: '2026-08-31', taxRate: 18 } });
    if (!v.ok) throw new Error('unreachable');
    const rec = runs.store.create({ title: String(v.values.runNumber), fields: v.values, actor: 't@np', now: T0 });
    const res = await runs.hooks.runAction!('issueInvoice', rec, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const run = runs.store.get(rec.id)!;
    expect(run.fields.status).toBe('invoiced');
    const invoice = invoices.store.get(String(run.fields.invoiceRef))!;
    expect(invoice.fields.number).toBe('INV-BR-PRJ-1-1');
    expect(invoice.fields.amount).toBe(320); // 200 + 120
    expect(invoice.fields.status).toBe('draft'); // walks the certified chain from here
    // Entries frozen: stamped and immutable.
    const billed = timeEntryFromRecord(entries.store.get(e1.id)!);
    expect(billed.invoicedBy).toBe(invoice.id);
    expect(entries.hooks.validate({ fields: { ...entries.store.get(e1.id)!.fields, hours: 9 } }).ok).toBe(false);
    // One invoice per run; a re-run of the same period finds nothing.
    expect((await runs.hooks.runAction!('issueInvoice', runs.store.get(rec.id)!, ctx)).ok).toBe(false);
    const v2 = runs.hooks.validate({ fields: { projectRef: projectId, periodFrom: '2026-08-01', periodTo: '2026-08-31' } });
    if (v2.ok) expect(v2.values.entryCount).toBe(0);
  });
});

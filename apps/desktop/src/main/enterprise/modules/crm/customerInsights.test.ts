import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  deriveCustomerHealthRegister,
  deriveCustomerTimeline,
  type CrmActivity,
  type CrmCustomer,
  type CrmOpportunity,
  type FinanceInvoice,
  type SalesContract,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createCustomerModule } from './customerModule';
import { createOpportunityModule } from './opportunityModule';
import { createActivityModule } from './activityModule';
import { createInvoiceModule } from '../finance/invoiceModule';
import { createContractModule } from '../sales/contractModule';
import { createQuoteModule } from '../sales/quoteModule';
import { createCustomerHealthModule } from './customerHealthModule';
import { createCustomerTimelineModule } from './customerTimelineModule';

const T0 = '2026-08-06T00:00:00.000Z';
const NOW = Date.parse('2026-08-06T12:00:00.000Z');

const customer = (over: Partial<CrmCustomer>): CrmCustomer => ({
  id: 'c1', name: 'Acme Inc.', customerCode: '', company: 'Acme Inc.', primaryContact: '', email: '',
  status: 'active', tier: 'gold', accountManager: '', creditLimit: 0, outstandingBalance: 0,
  lifetimeRevenue: 100000, paymentTerms: 'net30', createdAt: T0, updatedAt: T0, ...over,
});

const invoice = (over: Partial<FinanceInvoice>): FinanceInvoice =>
  ({
    id: 'i1', number: 'INV-1', customer: 'Acme Inc.', amount: 1000, taxRate: 0, amountPaid: 0,
    currency: 'USD', status: 'issued', paymentTerms: 'net30', issueDate: '2026-06-01',
    dueDate: '2026-06-15', sourceOrder: '', notes: null, ...over,
  }) as FinanceInvoice;

const openOpp = (over: Partial<CrmOpportunity>): CrmOpportunity => ({
  id: 'o1', name: 'Expansion', account: 'Acme Inc.', sourceLeadRef: '', quoteRef: '', stage: 'proposal',
  amount: 20000, probability: 50, weightedValue: 10000, expectedCloseDate: '2026-09-15',
  assignedTo: '', closedAt: null, outcome: null, lostReason: '', createdAt: T0, updatedAt: T0, ...over,
});

const activity = (over: Partial<CrmActivity>): CrmActivity => ({
  id: 'a1', subject: 'Overdue task', activityType: 'task', direction: '', relatedLeadRef: '',
  relatedOpportunityRef: '', relatedCustomerRef: 'c1', scheduledFor: null, durationMinutes: 0,
  dueDate: '2026-08-01', priority: 'medium', assignedTo: '', completedAt: null, cancelledAt: null,
  outcome: '', createdAt: T0, updatedAt: T0, ...over,
});

const contract = (over: Partial<SalesContract>): SalesContract => ({
  id: 'k1', contractNumber: 'CTR-1', title: '', customerRef: 'c1', opportunityRef: '',
  contractValue: 50000, currency: 'USD', startDate: '2025-08-01', endDate: '2026-07-31',
  autoRenew: false, renewalTermMonths: 12, status: 'active', activatedAt: T0, terminatedAt: null,
  terminationReason: '', renewedFromRef: '', renewedToRef: '', createdAt: T0, updatedAt: T0, ...over,
});

describe('customer health register (pure) — explainable cross-module penalties', () => {
  it('applies overdue-AR, overdue-activity, and expired-contract penalties with reasons', () => {
    const reg = deriveCustomerHealthRegister(
      [customer({}), customer({ id: 'c2', name: 'Clean Co.' })],
      [invoice({})], // overdue (due 2026-06-15, unpaid)
      [openOpp({})],
      [activity({})], // overdue task for c1
      [contract({})], // ended 2026-07-31 → expired
      NOW,
    );
    expect(reg.customerCount).toBe(2);
    const acme = reg.rows.find((r) => r.customer === 'Acme Inc.')!;
    expect(acme.overdueAr).toBe(1000);
    expect(acme.overdueActivities).toBe(1);
    expect(acme.expiredContracts).toBe(1);
    expect(acme.openPipelineWeighted).toBe(10000);
    expect(acme.reasons.join(' ')).toContain('−25');
    expect(acme.reasons.join(' ')).toContain('−15');
    expect(acme.reasons.join(' ')).toContain('−20');
    const clean = reg.rows.find((r) => r.customer === 'Clean Co.')!;
    expect(clean.score).toBeGreaterThan(acme.score); // penalties bite
    expect(reg.rows[0].customer).toBe('Acme Inc.'); // worst first
    expect(reg.totalOpenAr).toBe(1000);
    // Archived customers never appear.
    const reg2 = deriveCustomerHealthRegister([customer({ status: 'archived' })], [], [], [], [], NOW);
    expect(reg2.customerCount).toBe(0);
  });
});

describe('customer timeline (pure) — one story, newest first, id+name matching', () => {
  it('assembles cross-module events for exactly the requested customer', () => {
    const { events, totalBeforeCap } = deriveCustomerTimeline(
      { id: 'c1', name: 'Acme Inc.' },
      {
        quotes: [],
        invoices: [invoice({}), invoice({ id: 'i2', number: 'INV-9', customer: 'Other Co.' })],
        opportunities: [openOpp({ createdAt: '2026-07-01T00:00:00.000Z' })],
        activities: [activity({ completedAt: '2026-08-05T00:00:00.000Z' }), activity({ id: 'a2', relatedCustomerRef: 'c9' })],
        contracts: [contract({ activatedAt: '2025-08-01T00:00:00.000Z' })],
      },
    );
    expect(totalBeforeCap).toBe(4);
    expect(events.map((e) => e.kind)).toEqual(['task', 'opportunity', 'invoice', 'contract']); // newest first
    expect(events.every((e) => !e.label.includes('INV-9'))).toBe(true); // other customers excluded
  });
});

describe('Health + Timeline modules over real stores — generation and immutability', () => {
  let dir: string;
  let customers: EnterpriseModule;
  let invoices: EnterpriseModule;
  let opps: EnterpriseModule;
  let activities: EnterpriseModule;
  let contracts: EnterpriseModule;
  let quotes: EnterpriseModule;
  let health: EnterpriseModule;
  let timelines: EnterpriseModule;
  let customerId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-ci-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    customers = createCustomerModule(join(dir, 'customers.json'));
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    opps = createOpportunityModule(join(dir, 'opps.json'));
    activities = createActivityModule(join(dir, 'acts.json'));
    contracts = createContractModule(join(dir, 'contracts.json'), customers.store);
    quotes = createQuoteModule(join(dir, 'quotes.json'));
    health = createCustomerHealthModule(
      join(dir, 'health.json'), customers.store, invoices.store, opps.store, activities.store, contracts.store,
    );
    timelines = createCustomerTimelineModule(
      join(dir, 'timelines.json'), customers.store, quotes.store, invoices.store, opps.store, activities.store, contracts.store,
    );
    await Promise.all([
      customers.store.load(), invoices.store.load(), opps.store.load(), activities.store.load(),
      contracts.store.load(), quotes.store.load(), health.store.load(), timelines.store.load(),
    ]);
    customerId = customers.store.create({ title: 'Acme Inc.', fields: { name: 'Acme Inc.', status: 'active', customerTier: 'gold', lifetimeRevenue: 100000 }, actor: 't@np', now: T0 }).id;
    opps.store.create({ title: 'Expansion', fields: { name: 'Expansion', account: 'Acme Inc.', stage: 'proposal', amount: 20000, probability: 50, weightedValue: 10000 }, actor: 't@np', now: T0 });
  });

  afterEach(async () => {
    await Promise.all([
      customers.store.flush(), invoices.store.flush(), opps.store.flush(), activities.store.flush(),
      contracts.store.flush(), quotes.store.flush(), health.store.flush(), timelines.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('generates an immutable health register from real stores', () => {
    const v = health.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.reportNumber).toBe('CH-2026-08-06-1');
    expect(v.values.customerCount).toBe(1);
    expect(v.values.totalPipelineWeighted).toBe(10000);
    const rec = health.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    const edit = health.hooks.validate({ fields: { ...health.store.get(rec.id)!.fields, asOfDate: '2026-09-01' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
  });

  it('generates a timeline by exact name, stamps the resolved id, refuses unknowns', () => {
    const v = timelines.hooks.validate({ fields: { customerRef: 'Acme Inc.' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.customerRef).toBe(customerId); // resolved to the record id
    expect(v.values.customerName).toBe('Acme Inc.');
    expect(v.values.eventCount).toBe(1); // the opportunity-opened event
    const rows = JSON.parse(String(v.values.rows));
    expect(rows[0].kind).toBe('opportunity');
    expect(timelines.hooks.validate({ fields: { customerRef: 'Ghost Co.' } }).ok).toBe(false);
  });
});

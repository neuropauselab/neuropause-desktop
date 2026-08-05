import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from './platform';

describe('Modules 1,2,3 — CRM, Sales, Customer Success', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;
  let acct: string;

  beforeAll(async () => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
    acct = (await biz.crm().createAccount({ name: 'Acme Corp', industry: 'tech' })).id;
  });

  it('starts with EMPTY registries — no customers or revenue are fabricated', () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const fresh = createBusinessPlatform(rt, { clock });
    expect(fresh.crm().counts().accounts).toBe(0);
    expect(fresh.sales().pipeline().openValue).toBe(0);
    expect(fresh.sales().forecast().weighted).toBe(0);
  });

  it('runs the CRM lifecycle: account → contact → lead → opportunity → health', async () => {
    await biz.crm().createContact({ firstName: 'Ada', lastName: 'Lovelace', accountId: acct, email: 'ada@acme.test' });
    const lead = await biz.crm().createLead({ name: 'Inbound demo' });
    await biz.crm().advanceLead(lead.id, 'qualified');
    const opp = await biz.crm().createOpportunity({ accountId: acct, name: 'Platform deal', amount: 100000 });
    await biz.crm().advanceOpportunity(opp.id, 'negotiation');
    await biz.crm().logActivity({ subjectId: acct, kind: 'meeting', note: 'discovery call' });
    const h = biz.crm().health(acct);
    expect(h.score).not.toBeNull();
    expect(h.signals.openOpportunities).toBe(1);
  });

  it('computes pipeline and forecast from REAL opportunities only', () => {
    const pipe = biz.sales().pipeline();
    expect(pipe.count).toBeGreaterThanOrEqual(1);
    expect(pipe.openValue).toBeGreaterThanOrEqual(100000);
    expect(biz.sales().forecast().weighted).toBeGreaterThan(0);
  });

  it('creates quotes with computed totals; commission only on real won deals', async () => {
    const q = await biz.sales().createQuote({ accountId: acct, lines: [{ productId: 'p1', qty: 2, unitPrice: 500 }], discountPct: 10 });
    expect(q.subtotal).toBe(1000);
    expect(q.total).toBe(900);
    const opp = await biz.crm().createOpportunity({ accountId: acct, name: 'Won deal', amount: 50000 });
    expect(biz.sales().computeCommission(opp.id, 10)).toBeNull(); // not won yet
    await biz.crm().advanceOpportunity(opp.id, 'closed-won');
    expect(biz.sales().computeCommission(opp.id, 10)!.commission).toBe(5000);
  });

  it('derives churn risk from real health; unknown when there is no data', async () => {
    await biz.customerSuccess().startOnboarding(acct);
    expect(['low', 'medium', 'high']).toContain(biz.customerSuccess().churnRisk(acct));
    const empty = (await biz.crm().createAccount({ name: 'Empty Co' })).id;
    expect(biz.customerSuccess().churnRisk(empty)).toBe('unknown');
  });
});

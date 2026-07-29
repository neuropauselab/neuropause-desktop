import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createIndustryPlatform, type IndustryPlatform } from './platform';

describe('AI Copilots, Compliance Packs, Connector Marketplace', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let ind: IndustryPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    ind = createIndustryPlatform(runtime, { clock, business });
  });

  it('industry copilot reuses Enterprise AI; grounded only in real data', async () => {
    const empty = await ind.copilots().ask('healthcare', 'patients');
    expect(empty.answer).toBe('No business data available'); // reused copilot, no data yet
    expect(empty.skills.length).toBeGreaterThan(0);
    await business.crm().createAccount({ name: 'Mercy Hospital' });
    const res = await ind.copilots().ask('healthcare', 'Mercy');
    expect(res.grounded).toBe(true);
  });

  it('compliance packs represent frameworks but never claim certification', async () => {
    expect(ind.compliancePacks().packs()).toEqual(expect.arrayContaining(['iso-13485', 'hipaa', 'gmp', 'glp']));
    const adopted = await ind.compliancePacks().adopt('tenant-1', 'hipaa');
    expect(adopted.certified).toBe(false);
    expect(ind.compliancePacks().certificationStatus('hipaa').certified).toBe(false);
    expect(ind.compliancePacks().adoptedFor('tenant-1').length).toBe(1);
  });

  it('connector marketplace stays adapter-verified until configured', async () => {
    await ind.connectors().seed();
    expect(ind.connectors().count()).toBeGreaterThanOrEqual(14);
    expect(ind.connectors().systems()).toEqual(expect.arrayContaining(['SAP', 'Epic', 'Shopify', 'Stripe', 'Workday']));
    const c = ind.connectors().list()[0]!;
    expect(c.evidence).toBe('adapter-verified');
    expect(c.configured).toBe(false);
  });
});

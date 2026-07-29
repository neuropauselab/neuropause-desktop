import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform } from '@neuropause/business';
import { createExecutionPlatform } from '@neuropause/execution';
import { createIndustryPlatform } from './platform';
import { INDUSTRY_MATRIX } from './evidence';

describe('Industry Analytics, honesty boundary, and reuse', () => {
  it('KPIs compute over real data; "No business data available" when empty', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const business = createBusinessPlatform(rt, { clock });
    const ind = createIndustryPlatform(rt, { clock, business });
    expect(ind.analytics().dashboard('retail').hasData).toBe(false);
    await business.crm().createAccount({ name: 'Shopper A' });
    const customers = ind.analytics().kpis('retail').find((k) => k.name === 'customers')!;
    expect(customers.value).toBe(1); // reflects the one real account
    expect(ind.analytics().dashboard('retail').hasData).toBe(true);
  });

  it('reuses the Wave 5 execution connector count', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const ind = createIndustryPlatform(rt, { clock, execution: exec });
    expect(ind.reusedConnectorCount()).toBe(22);
  });

  it('governs industry operations and keeps the four-level honesty boundary', async () => {
    const clock = new ManualClock(1000);
    const runtime = createEnterpriseRuntime({ clock });
    const ind = createIndustryPlatform(runtime, { clock });
    await ind.sdk().activate('t1', 'healthcare');
    await ind.connectors().seed();
    expect(ind.governance().count()).toBeGreaterThan(0);
    expect(ind.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    const fabricated = INDUSTRY_MATRIX.filter(
      (m) => m.level === 'live-verified' && /submission|filing|certification|settlement|screening|issuance|airworthiness|\behr\b|\bphi\b|batch release/i.test(m.capability),
    );
    expect(fabricated.length).toBe(0);
    const r = ind.readiness();
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBeGreaterThan(0);
  });
});

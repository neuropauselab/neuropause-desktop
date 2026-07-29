import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createWorkforcePlatform, type WorkforcePlatform } from './platform';

describe('Modules 7,8 — Reasoning (evidence never fabricated) + governed Tool Runtime', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let wf: WorkforcePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    wf = createWorkforcePlatform(runtime, { clock, business });
  });

  it('reasoning collects evidence from REAL sources — with none, confidence is 0 (never fabricated)', async () => {
    const t1 = await wf.reasoning().reason({ query: 'how many customers do we have?', worker: 'CRM Manager', org: 'org1' });
    expect(t1.evidence.length).toBe(0);
    expect(t1.confidence).toBe(0);
    expect(t1.verified).toBe(false);
    expect(t1.reflection).toMatch(/not fabricated/);
    // add real data → evidence appears and confidence rises
    await business.crm().createAccount({ name: 'Acme' });
    const t2 = await wf.reasoning().reason({ query: 'customer accounts', worker: 'CRM Manager', org: 'org1' });
    expect(t2.evidence.length).toBeGreaterThan(0);
    expect(t2.confidence).toBeGreaterThan(0);
    expect(t2.verified).toBe(true);
  });

  it('tools: governed access to real data; unavailable domains are honest', async () => {
    const r = await wf.tools().use({ worker: 'CRM Manager', org: 'org1', domain: 'crm', op: 'count' });
    expect(r.available).toBe(true);
    expect((r.data as { accounts: number }).accounts).toBeGreaterThanOrEqual(1);
    const c = await wf.tools().use({ worker: 'x', org: 'org1', domain: 'connectors', op: 'list' });
    expect(c.available).toBe(false); // connector execution is governed by Wave 5, not invoked here
  });
});

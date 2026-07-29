import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createWorkforcePlatform, type WorkforcePlatform } from './platform';

describe('Modules 14,15,16,18 — Executive AI, Marketplace, SDK, Adapters', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let wf: WorkforcePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    wf = createWorkforcePlatform(runtime, { clock, business });
  });

  it('executive briefings are built only from real data', async () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const empty = createWorkforcePlatform(rt, { clock }); // no business
    expect(empty.executive().briefing('CFO').metrics['status']).toBe('No business data available');
    await business.crm().createAccount({ name: 'Globex' });
    expect(typeof wf.executive().briefing('CEO').metrics['customers']).toBe('number');
  });

  it('marketplace install, SDK register, and AI-provider adapters', async () => {
    await wf.marketplace().install({ kind: 'worker', name: 'Sales Bot Pro' });
    expect(wf.marketplace().count()).toBe(1);
    await wf.sdk().register({ kind: 'skill', name: 'Summarize' });
    expect(wf.sdk().list('skill').length).toBe(1);
    await wf.adapters().seed();
    expect(wf.adapters().systems()).toEqual(expect.arrayContaining(['External LLM Provider', 'Voice Provider', 'Translation Service', 'OCR Service']));
    expect(wf.adapters().list()[0]!.evidence).toBe('adapter-verified');
  });
});

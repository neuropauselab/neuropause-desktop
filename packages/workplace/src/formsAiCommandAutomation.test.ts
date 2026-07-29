import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from '@neuropause/business';
import { createIndustryPlatform, type IndustryPlatform } from '@neuropause/industry';
import { createWorkplacePlatform, type WorkplacePlatform } from './platform';

describe('Modules 13,14,15,16 — Forms (reuse low-code), AI (reuse Enterprise AI), Command, Automation', () => {
  let runtime: EnterpriseRuntime;
  let business: BusinessPlatform;
  let industry: IndustryPlatform;
  let wp: WorkplacePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    business = createBusinessPlatform(runtime, { clock });
    industry = createIndustryPlatform(runtime, { clock, business });
    wp = createWorkplacePlatform(runtime, { clock, business, industry });
  });

  it('forms REUSE the Wave 9 low-code builder', async () => {
    const f = await wp.forms().create({ name: 'LeaveRequest', kind: 'request', fields: [{ name: 'days', type: 'number' }] });
    await wp.forms().submit(f.id, { days: 3 });
    expect(wp.forms().submissionsFor(f.id).length).toBe(1);
    expect(industry.lowcode().forms().some((x) => x.name === 'LeaveRequest')).toBe(true);
  });

  it('workspace AI REUSES Enterprise AI; grounded only in real data', async () => {
    const empty = await wp.ai().ask('assistant', 'globex');
    expect(empty.answer).toBe('No business data available');
    await business.crm().createAccount({ name: 'Globex' });
    const res = await wp.ai().ask('assistant', 'Globex');
    expect(res.grounded).toBe(true);
    expect(wp.ai().assistants().length).toBe(7);
  });

  it('command center dispatches; automation reuses the HITL gate', async () => {
    const r = await wp.command().execute({ kind: 'search', text: 'Globex' });
    expect(r.result).toContain('result');
    const denied = await wp.automation().requestApproval({ operation: 'document.approve', actor: 'ai', aiInitiated: true });
    expect(denied.approved).toBe(false);
    expect(denied.requiresHuman).toBe(true);
    const ok = await wp.automation().requestApproval({ operation: 'document.approve', actor: 'mgr' });
    expect(ok.approved).toBe(true);
  });
});

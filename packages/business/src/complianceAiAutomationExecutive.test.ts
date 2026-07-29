import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createBusinessPlatform, type BusinessPlatform } from './platform';
import { BUSINESS_MATRIX } from './evidence';

describe('Modules 16,17,18,19,20 — Compliance, AI, Automation, Executive + honesty', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
  });

  it('tracks compliance readiness but NEVER claims certification', async () => {
    const fw = await biz.compliance().adoptFramework('soc2');
    const controls = biz.compliance().controls(fw.id);
    expect(controls.length).toBe(3);
    await biz.compliance().recordEvidence(controls[0]!.id, 'access-policy.pdf');
    expect(biz.compliance().readiness(fw.id).pct).toBe(33); // 1 of 3 controls
    expect(biz.compliance().certificationStatus(fw.id).certified).toBe(false);
  });

  it('business AI indexes real objects; copilot says "No business data available" when empty', async () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const empty = createBusinessPlatform(rt, { clock });
    expect((await empty.intelligence().copilot('acme')).answer).toBe('No business data available');

    await biz.crm().createAccount({ name: 'Globex' });
    const res = await biz.intelligence().search('Globex');
    expect(res.hits.some((h) => h.source === 'crm')).toBe(true);
    expect(biz.intelligence().sources()).toEqual(expect.arrayContaining(['crm', 'hr', 'procurement', 'projects', 'assets']));
  });

  it('business automation reuses the HITL gate — AI cannot self-approve restricted ops', async () => {
    const denied = await biz.automation().requestApproval({ domain: 'payroll', operation: 'payroll.run', actor: 'ai', aiInitiated: true });
    expect(denied.approved).toBe(false);
    expect(denied.requiresHuman).toBe(true);
    const granted = await biz.automation().requestApproval({ domain: 'payroll', operation: 'payroll.run', actor: 'cfo' });
    expect(granted.approved).toBe(true);
    const auto = await biz.automation().requestApproval({ domain: 'crm', operation: 'crm.note', actor: 'ai', aiInitiated: true });
    expect(auto.approved).toBe(true); // not a restricted operation
  });

  it('executive dashboards show "No business data available" when empty; real values otherwise', () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const empty = createBusinessPlatform(rt, { clock });
    expect(empty.executive().build('CFO').panels['netIncome']).toBe('No business data available');
    expect(typeof biz.executive().build('CEO').panels['customers']).toBe('number'); // biz has Globex
  });

  it('reuses the Wave 5 execution connector count', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const b = createBusinessPlatform(rt, { clock, execution: exec });
    expect(b.reusedConnectorCount()).toBe(22);
    expect(b.analytics().overview().reusedConnectors).toBe(22);
  });

  it('represents external systems as adapters (adapter-verified, never executed)', async () => {
    await biz.adapters().seed();
    expect(biz.adapters().count()).toBeGreaterThanOrEqual(20);
    expect(biz.adapters().systems()).toEqual(expect.arrayContaining(['SAP', 'Stripe', 'Epic', 'FHIR', 'MES']));
    expect(biz.adapters().list()[0]!.evidence).toBe('adapter-verified');
  });

  it('governs on the one chain and keeps the four-level honesty boundary', () => {
    expect(biz.governance().count()).toBeGreaterThan(0);
    expect(biz.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    // nothing regulated-external / business-data is ever marked live-verified
    const fabricated = BUSINESS_MATRIX.filter(
      (m) => m.level === 'live-verified' && /processing|filing|transfer|settlement|\behr\b|insurance claim|manufacturing execution|legal filing|certification|government api/i.test(m.capability),
    );
    expect(fabricated.length).toBe(0);
    const r = biz.readiness();
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBeGreaterThan(0);
  });
});

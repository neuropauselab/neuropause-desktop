import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createWorkforcePlatform } from './platform';
import { WORKFORCE_MATRIX, workforceReadiness } from './evidence';

describe('Governance, honesty boundary, and reuse', () => {
  it('reuses the Wave 5 execution connector count', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const wf = createWorkforcePlatform(rt, { clock, execution: exec });
    expect(wf.reusedConnectorCount()).toBe(22);
  });

  it('every AI action is audited on the one chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const runtime = createEnterpriseRuntime({ clock });
    const wf = createWorkforcePlatform(runtime, { clock });
    const events: Array<Record<string, unknown>> = [];
    runtime.events().subscribe((e) => e.type === 'workforce.action', (e) => {
      events.push(e.payload as Record<string, unknown>);
    });
    await wf.agents().register({ name: 'x', role: 'CRM Manager', orgId: 'org1' });
    expect(wf.governance().count()).toBeGreaterThan(0);
    expect(wf.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last['worker']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
  });

  it('keeps the four-level honesty boundary — no regulated/data-pending capability is live-verified', () => {
    const fabricated = WORKFORCE_MATRIX.filter(
      (m) => m.level === 'live-verified' && /autonomous (financial|payroll|banking|tax|clinical|legal)|production change|security policy|impersonation/i.test(m.capability),
    );
    expect(fabricated.length).toBe(0);
    const r = workforceReadiness();
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createCloudOpsPlatform } from '@neuropause/cloudops';
import { createAutonomousOpsPlatform } from './platform';

describe('M11–M13 — business continuity, incident management, SLA', () => {
  it('DR plans REUSE the Wave 7 cloud-ops backup runtime when present', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const solo = createAutonomousOpsPlatform(rt, { clock });
    const cont = await solo.continuity().createPlan({ name: 'BC', kind: 'continuity' });
    expect(cont.reusedCloudOps).toBe(false);

    const cloud = createCloudOpsPlatform(rt, { clock });
    const ops = createAutonomousOpsPlatform(rt, { clock, cloudops: cloud });
    const dr = await ops.continuity().createPlan({ name: 'DR', kind: 'disaster-recovery', rpoMinutes: 15, rtoMinutes: 60 });
    expect(dr.reusedCloudOps).toBe(true);
    expect(cloud.backups().count()).toBeGreaterThan(0); // the reused runtime actually recorded the plan
  });

  it('incident management REUSES the @neuropause/operations registry (lifecycle, MTTR, postmortem)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    expect(ops.incidents().reusesOperations()).toBe(true);

    const inc = await ops.incidents().detect({ title: 'API 5xx', severity: 'sev2', services: ['api'] });
    ops.incidents().acknowledge(inc.id, 'oncall');
    clock.advance(5000);
    await ops.incidents().resolve(inc.id, { rootCause: 'bad deploy' });

    const status = ops.incidents().status();
    expect(status.total).toBe(1);
    expect(status.mttrMs).toBe(5000); // computed from REAL timestamps, not fabricated
    const pm = ops.incidents().postmortem(inc.id);
    expect(pm).toMatch(/# Postmortem/);
    expect(pm).toMatch(/bad deploy/);
  });

  it('SLA compliance is null until real measurements exist, then computed from them', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const sla = await ops.sla().defineSLA({ name: 'API latency', targetMs: 200 });
    expect(ops.sla().compliance(sla.id).compliancePct).toBeNull();
    await ops.sla().track({ slaId: sla.id, valueMs: 150 }); // met
    await ops.sla().track({ slaId: sla.id, valueMs: 300 }); // breached
    expect(ops.sla().compliance(sla.id).compliancePct).toBe(50);
  });
});

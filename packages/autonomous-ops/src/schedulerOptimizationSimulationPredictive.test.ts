import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createAutonomousOpsPlatform } from './platform';

describe('M7–M10 — scheduler, optimization, simulation, predictive', () => {
  it('scheduler rejects a real overlapping booking of the same resource', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    await ops.scheduler().schedule({ kind: 'facility', resourceId: 'r1', label: 'A', start: 0, end: 100 });
    await expect(ops.scheduler().schedule({ kind: 'facility', resourceId: 'r1', label: 'B', start: 50, end: 150 })).rejects.toThrow(/already scheduled/);
    // a non-overlapping slot on the same resource is fine
    const ok = await ops.scheduler().schedule({ kind: 'facility', resourceId: 'r1', label: 'C', start: 100, end: 200 });
    expect(ok.id).toBeTruthy();
  });

  it('optimization never invents utilization when capacity is unknown', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    expect(ops.optimization().utilization({ allocated: 5, capacity: 0 }).utilizationPct).toBeNull();
    expect(ops.optimization().utilization({ allocated: 5, capacity: 10 }).utilizationPct).toBe(50);
    expect(ops.optimization().workforceCapacity().agents).toBe(0);
  });

  it('optimization reads REAL workforce capacity when connected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const wf = createWorkforcePlatform(rt, { clock });
    await wf.agents().register({ name: 'a1', role: 'Analyst', orgId: 'org1' });
    const ops = createAutonomousOpsPlatform(rt, { clock, workforce: wf });
    expect(ops.optimization().workforceCapacity().agents).toBe(1);
  });

  it('every simulation result is CLEARLY a projection, never real state', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const sim = await ops.simulation().run({ kind: 'capacity', name: 'peak', baseline: 100, factor: 1.5 });
    expect(sim.projection).toBe(true);
    expect(sim.projected).toBe(150);
    expect(sim.note).toMatch(/PROJECTION/);
  });

  it('predictive returns no forecast (null) without evidence, and a trend with it', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const none = await ops.predictive().forecast({ kind: 'capacity', history: [] });
    expect(none.forecast).toBeNull();
    expect(none.note).toMatch(/insufficient evidence/);
    const trend = await ops.predictive().forecast({ kind: 'capacity', history: [10, 20, 30] });
    expect(trend.forecast).toBe(40);
  });
});

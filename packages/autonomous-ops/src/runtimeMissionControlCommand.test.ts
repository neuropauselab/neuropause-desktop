import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform } from '@neuropause/business';
import { createAutonomousOpsPlatform } from './platform';
import { NO_OPS_DATA } from './constants';

describe('M1–M3 — operations runtime, mission control, command center', () => {
  it('creates missions and reports real operational context — never fabricated', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });

    // no missions yet → mission control is honest, not invented
    expect(ops.missionControl().operationalHealth('org1')).toBe(NO_OPS_DATA);
    expect(ops.missionControl().overview('org1').status).toBe(NO_OPS_DATA);

    const m = await ops.runtime().createMission({ name: 'Launch', orgId: 'org1', goal: 'Ship v1' });
    expect(m.state).toBe('planned');
    await ops.runtime().setMissionState(m.id, 'active');

    const ctx = ops.runtime().context('org1');
    expect(ctx.missions).toBe(1);
    expect(ctx.active).toBe(1);
    expect(ops.missionControl().liveOperations('org1')).toHaveLength(1);
    expect(ops.missionControl().operationalHealth('org1')).toBe(100);
  });

  it('lowers operational health when critical alerts are raised (from real alerts only)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    await ops.runtime().createMission({ name: 'Ops', orgId: 'org1' });
    await ops.missionControl().raiseAlert({ orgId: 'org1', severity: 'sev1', message: 'DB down' });
    expect(ops.missionControl().operationalHealth('org1')).toBe(80);
    expect(ops.missionControl().overview('org1').status).toBe('attention');
  });

  it('command center reads real business data or says there is none', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const empty = createAutonomousOpsPlatform(rt, { clock });
    expect(empty.commandCenter().health('business').value).toBe(NO_OPS_DATA);
    expect(empty.commandCenter().globalDashboard().note).toBe(NO_OPS_DATA);

    const biz = createBusinessPlatform(rt, { clock });
    await biz.crm().createAccount({ name: 'Acme' });
    const ops = createAutonomousOpsPlatform(rt, { clock, business: biz });
    expect(ops.commandCenter().health('business').value).toBe(1);
    expect(ops.commandCenter().globalDashboard().note).toBe('composed from real platform data');
  });
});

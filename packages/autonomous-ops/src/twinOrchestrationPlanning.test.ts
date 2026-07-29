import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform } from '@neuropause/business';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createAutonomousOpsPlatform } from './platform';

describe('M4–M6 — digital twin, orchestration, mission planning', () => {
  it('digital-twin state reflects REAL business data and is 0 (not fabricated) with none', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const empty = createAutonomousOpsPlatform(rt, { clock });
    const emptyModel = empty.digitalTwin().model('org1');
    expect(emptyModel.hasData).toBe(false);
    expect(emptyModel.note).toMatch(/not fabricated/);
    const customerNode0 = emptyModel.nodes.find((n) => n.type === 'customer')!;
    expect(customerNode0.count).toBe(0);
    expect(customerNode0.evidence).toBe('business-data-pending');

    const biz = createBusinessPlatform(rt, { clock });
    await biz.crm().createAccount({ name: 'Acme' });
    await biz.crm().createAccount({ name: 'Globex' });
    const ops = createAutonomousOpsPlatform(rt, { clock, business: biz });
    const model = ops.digitalTwin().model('org1');
    expect(model.hasData).toBe(true);
    const customerNode = model.nodes.find((n) => n.type === 'customer')!;
    expect(customerNode.count).toBe(2);
    expect(customerNode.evidence).toBe('live-verified');
  });

  it('orchestration coordinates teams and distributes goals deterministically', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const c = await ops.orchestration().coordinate({ missionId: 'm1', orgId: 'org1', kind: 'cross-team', teams: ['a', 'b'] });
    expect(c.teams).toEqual(['a', 'b']);
    const dist = ops.orchestration().distributeGoals(['g1', 'g2', 'g3'], ['t1', 't2']);
    expect(dist).toEqual([
      { goal: 'g1', team: 't1' },
      { goal: 'g2', team: 't2' },
      { goal: 'g3', team: 't1' },
    ]);
    expect(() => ops.orchestration().distributeGoals(['g'], [])).toThrow();
  });

  it('mission planning REUSES the Wave 11 planner when a workforce is connected', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const solo = createAutonomousOpsPlatform(rt, { clock });
    const p1 = await solo.planning().planMission({ goal: 'Expand EMEA', orgId: 'org1' });
    expect(p1.reusedWave11).toBe(false);
    expect(p1.taskTree.length).toBeGreaterThan(0);

    const wf = createWorkforcePlatform(rt, { clock });
    const ops = createAutonomousOpsPlatform(rt, { clock, workforce: wf });
    const p2 = await ops.planning().planMission({ goal: 'Expand APAC', orgId: 'org1' });
    expect(p2.reusedWave11).toBe(true);
    expect(p2.taskTree.length).toBeGreaterThan(0);
  });
});

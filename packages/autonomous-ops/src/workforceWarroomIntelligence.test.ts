import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform } from '@neuropause/business';
import { createWorkforcePlatform } from '@neuropause/workforce';
import { createAutonomousOpsPlatform } from './platform';
import { NO_OPS_DATA } from './constants';

describe('M14–M16 — AI workforce orchestration, war room, enterprise intelligence', () => {
  it('assigns REAL Wave 11 AI agents to a mission — 0 (not fabricated) with no workforce', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const solo = createAutonomousOpsPlatform(rt, { clock });
    const none = await solo.workforceOrchestration().assign({ missionId: 'm1', orgId: 'org1' });
    expect(none.aiWorkers).toHaveLength(0);
    expect(none.note).toMatch(/not fabricated/);

    const wf = createWorkforcePlatform(rt, { clock });
    await wf.agents().register({ name: 'a1', role: 'Analyst', orgId: 'org1' });
    await wf.agents().register({ name: 'a2', role: 'Engineer', orgId: 'org1' });
    const ops = createAutonomousOpsPlatform(rt, { clock, workforce: wf });
    const a = await ops.workforceOrchestration().assign({ missionId: 'm1', orgId: 'org1' });
    expect(a.aiWorkers).toHaveLength(2);
    expect(ops.workforceOrchestration().capacity().agents).toBe(2);
  });

  it('war-room decisions are recorded and governed but NEVER executed; regulated ones are represented only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'operations.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const s = await ops.warRoom().open({ orgId: 'org1', title: 'Outage', severity: 'sev1' });
    const d = await ops.warRoom().decide({ sessionId: s.id, text: 'Move funds to reserve', by: 'cfo', regulatedKind: 'financial-operations' });
    expect(d.regulated).toBe(true);
    expect(d.executed).toBe(false);
    expect(d.note).toMatch(/represented only/);

    const decisionEvt = events.find((e) => e['operation'] === 'warroom.decision')!;
    expect(decisionEvt['evidence']).toBe('regulated-external');
    expect(decisionEvt['approval']).toBe('pending');
  });

  it('enterprise intelligence is grounded ONLY in real data', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });

    const empty = createAutonomousOpsPlatform(rt, { clock });
    expect(empty.intelligence().metrics().customers).toBe(NO_OPS_DATA);
    expect((await empty.intelligence().query('anything')).grounded).toBe(false);

    const biz = createBusinessPlatform(rt, { clock });
    await biz.crm().createAccount({ name: 'Acme' });
    const ops = createAutonomousOpsPlatform(rt, { clock, business: biz });
    expect(ops.intelligence().metrics().customers).toBe(1);
    const ans = await ops.intelligence().query('Acme');
    expect(ans.grounded).toBe(true);
  });
});

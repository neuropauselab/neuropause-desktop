import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createWorkforcePlatform, type WorkforcePlatform } from './platform';

describe('Modules 10,11,13 — Human Collaboration, AI Organization, Autonomous Workflows', () => {
  let runtime: EnterpriseRuntime;
  let wf: WorkforcePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    wf = createWorkforcePlatform(runtime, { clock });
  });

  it('human collaboration: HITL refuses AI self-approval of a regulated action; human override wins', async () => {
    const denied = await wf.humans().requestApproval({ worker: 'CFO Assistant', action: 'financial-approval', actor: 'ai', org: 'org1', aiInitiated: true });
    expect(denied.approved).toBe(false);
    expect(denied.requiresHuman).toBe(true);
    const ok = await wf.humans().requestApproval({ worker: 'CFO Assistant', action: 'financial-approval', actor: 'cfo', org: 'org1' });
    expect(ok.approved).toBe(true);
    const ov = await wf.humans().override({ worker: 'CFO Assistant', actionId: 'act1', byHuman: 'cfo', decision: 'approved', org: 'org1' });
    expect(ov.decision).toBe('approved');
  });

  it('AI organization: departments, teams, and an org chart from the real registry', async () => {
    const d = await wf.organization().createDepartment({ name: 'Revenue', orgId: 'org1' });
    await wf.organization().createTeam({ name: 'Sales', departmentId: d.id, orgId: 'org1' });
    const chart = wf.organization().orgChart('org1');
    expect(chart.departments.length).toBe(1);
    expect(chart.departments[0]!.teams.length).toBe(1);
  });

  it('autonomous workflows are restricted by governance — regulated ones await a human', async () => {
    const regulated = await wf.workflows().define({ name: 'Auto Payroll', domain: 'payroll', steps: ['calc', 'pay'], requiresApproval: true });
    const run = await wf.workflows().run({ workflowId: regulated.id, actor: 'ai', org: 'org1', aiInitiated: true });
    expect(run.status).toBe('awaiting-approval');
    expect(run.requiresHuman).toBe(true);
    const safe = await wf.workflows().define({ name: 'Draft Report', domain: 'reporting', steps: ['draft'], requiresApproval: false });
    const run2 = await wf.workflows().run({ workflowId: safe.id, actor: 'ai', org: 'org1', aiInitiated: true });
    expect(run2.status).toBe('completed');
  });
});

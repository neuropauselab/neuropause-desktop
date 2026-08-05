import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, type NemsPlatform } from '@neuropause/nems';
import { createAutomationPlatform, type AutomationPlatform } from './platform';
import { AUTOMATION_MATRIX } from './evidence';
import type { ApprovalRequest } from './approvals';

describe('Modules 4,7,9,10,12,13 — Playbooks, Tasks, SLA, Analytics, Governance, Dashboards', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let auto: AutomationPlatform;
  let T: string;
  const approve = (req: ApprovalRequest): boolean => {
    auto.approvals().approve(req.id, 'manager');
    return true;
  };

  beforeAll(async () => {
    const clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    T = (await nems.organizations().create({ name: 'Acme', slug: 'acme' })).id;
    auto = createAutomationPlatform(runtime, { clock, nems });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('ships ten playbooks; employee onboarding runs end-to-end and creates a real NEMS user', async () => {
    expect(auto.playbooks().list().length).toBe(10);
    const ex = await auto.playbooks().run('employee-onboarding', { tenantId: T, actor: 'hr', trigger: 'manual', inputs: { email: 'newhire@acme.test', name: 'New Hire' }, approver: approve });
    expect(ex.status).toBe('completed');
    expect(ex.outputs['create-account']).toHaveProperty('userId'); // real user id
    expect((await nems.users().list(T)).some((u) => u.email === 'newhire@acme.test')).toBe(true);
  });

  it('runs playbooks with external steps without claiming external delivery', async () => {
    const ex = await auto.playbooks().run('release-management', { tenantId: T, actor: 'eng', trigger: 'manual', approver: approve });
    expect(ex.status).toBe('completed');
    // the external step records intent, not delivery
    expect(ex.outputs['tag-release']).toMatchObject({ delivered: false });
    expect(ex.steps.find((s) => s.name === 'tag-release')!.external).toBe(true);
  });

  it('governs every execution — audited, replayable, chain verifies', async () => {
    await auto.playbooks().run('customer-onboarding', { tenantId: T, actor: 'cs', trigger: 'manual', inputs: { name: 'Globex' } });
    expect(auto.governance().count('automation.execution')).toBeGreaterThan(0);
    expect(auto.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('orchestrates tasks with dependency gating, escalation, and tracking', () => {
    const t1 = auto.tasks().create({ tenantId: T, title: 'Design', priority: 'high' });
    const t2 = auto.tasks().create({ tenantId: T, title: 'Build', dependsOn: [t1.id] });
    const t3 = auto.tasks().create({ tenantId: T, title: 'Docs' });
    expect(() => auto.tasks().complete(t2.id)).toThrow(/blocked/); // dep not done
    auto.tasks().complete(t1.id);
    expect(auto.tasks().complete(t2.id).status).toBe('done');
    expect(auto.tasks().escalate(t3.id).priority).toBe('urgent');
    const tr = auto.tasks().tracking(T);
    expect(tr.done).toBeGreaterThanOrEqual(2);
    expect(tr.total).toBeGreaterThanOrEqual(3);
  });

  it('reports SLA and analytics over real execution history', () => {
    const s = auto.operations().report(T);
    expect(s.totalExecutions).toBeGreaterThan(0);
    expect(s.completionRate).toBeGreaterThan(0);
    expect(s.slaCompliance).toBeGreaterThan(0);
    const a = auto.analytics().report(T);
    expect(a.workflowSuccessRate).toBeGreaterThan(0);
    expect(Array.isArray(a.bottlenecks)).toBe(true);
    expect(a.businessImpact).toContain('infra-pending'); // honest, not a fabricated dollar figure
  });

  it('builds operations dashboards from live state', () => {
    const d = auto.dashboards().build('COO', T);
    expect(d.role).toBe('COO');
    expect(d.panels.workflowHealth.completionRate).toBeGreaterThan(0);
    expect(typeof d.panels.pendingApprovals).toBe('number');
    expect(typeof d.panels.executionQueue).toBe('number');
  });

  it('keeps the evidence discipline honest — nothing with external side effects is live-verified', () => {
    const external = AUTOMATION_MATRIX.find((m) => m.capability.includes('external SaaS') && m.module === 'M4')!;
    expect(external.level).toBe('adapter-verified');
    const email = AUTOMATION_MATRIX.find((m) => m.capability.includes('email/Slack'))!;
    expect(email.level).toBe('infra-pending');
    expect(AUTOMATION_MATRIX.filter((m) => /external|email\/Slack/.test(m.capability) && m.level === 'live-verified').length).toBe(0);
    expect(auto.readiness().liveVerified).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { createNemsPlatform, type NemsPlatform } from '@neuropause/nems';
import { createAutomationPlatform, type AutomationPlatform } from './platform';
import type { WorkflowDefinition } from './types';

describe('Modules 1,3,8 — Workflow Engine, Approvals, Human-in-the-Loop', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let auto: AutomationPlatform;
  let nems: NemsPlatform;
  const T = 'tenant-acme';

  beforeAll(async () => {
    const clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock });
    await nems.migrate();
    auto = createAutomationPlatform(runtime, { clock, nems });
  });
  afterAll(async () => {
    await driver.close();
  });

  const wf = (id: string, steps: WorkflowDefinition['steps'], mode: 'sequential' | 'parallel' = 'sequential'): WorkflowDefinition => ({ id, name: id, version: 1, mode, steps });

  it('runs a sequential workflow, threading state and auditing the execution', async () => {
    const def = wf('seq', [
      { name: 'a', kind: 'action', action: async () => ({ v: 1 }) },
      { name: 'b', kind: 'action', action: async (ctx) => ({ prev: ctx.state.outputs.a }) },
    ]);
    auto.workflows().register(def);
    const before = runtime.audit().list().length;
    const ex = await auto.workflows().run(def, { tenantId: T, actor: 'ada', trigger: 'manual' });
    expect(ex.status).toBe('completed');
    expect(ex.steps.map((s) => s.ok)).toEqual([true, true]);
    expect(ex.auditId).toBeTruthy();
    expect(ex.replayId).toBeTruthy();
    expect(runtime.audit().list().length).toBeGreaterThan(before);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('honors conditional (skip), loop, retry, and compensation', async () => {
    // conditional skip
    const cond = wf('cond', [{ name: 'maybe', kind: 'action', when: (s) => s.inputs.go === true, action: async () => 'ran' }]);
    auto.workflows().register(cond);
    expect((await auto.workflows().run(cond, { tenantId: T, actor: 'ada', trigger: 'manual', inputs: { go: false } })).steps[0].skipped).toBe(true);

    // loop over items
    let sum = 0;
    const loop = wf('loop', [{ name: 'loop', kind: 'loop', loop: { over: 'items', body: { name: 'add', kind: 'action', action: async (ctx) => (sum += Number(ctx.state.inputs.item)) } } }]);
    auto.workflows().register(loop);
    const lex = await auto.workflows().run(loop, { tenantId: T, actor: 'ada', trigger: 'manual', inputs: { items: [1, 2, 3] } });
    expect(sum).toBe(6);
    expect(lex.steps[0].attempts).toBe(3);

    // retry then succeed
    let n = 0;
    const retry = wf('retry', [{ name: 'flaky', kind: 'action', retries: 3, action: async () => { n += 1; if (n < 3) throw new Error('transient'); return 'ok'; } }]);
    auto.workflows().register(retry);
    const rex = await auto.workflows().run(retry, { tenantId: T, actor: 'ada', trigger: 'manual' });
    expect(rex.status).toBe('completed');
    expect(n).toBe(3);
    expect(rex.steps[0].attempts).toBe(3);

    // compensation on failure
    let compensated = false;
    const comp = wf('comp', [
      { name: 's1', kind: 'action', action: async () => 'done', compensate: async () => { compensated = true; } },
      { name: 's2', kind: 'action', action: async () => { throw new Error('boom'); } },
    ]);
    auto.workflows().register(comp);
    const cex = await auto.workflows().run(comp, { tenantId: T, actor: 'ada', trigger: 'manual' });
    expect(cex.status).toBe('compensated');
    expect(cex.rollbackId).toBeTruthy();
    expect(compensated).toBe(true);
  });

  it('runs a parallel workflow', async () => {
    const par = wf('par', [
      { name: 'x', kind: 'action', action: async () => 1 },
      { name: 'y', kind: 'action', action: async () => 2 },
    ], 'parallel');
    auto.workflows().register(par);
    const ex = await auto.workflows().run(par, { tenantId: T, actor: 'ada', trigger: 'manual' });
    expect(ex.status).toBe('completed');
    expect(ex.steps.length).toBe(2);
  });

  it('gates workflows on approval policy — no bypass', async () => {
    const def = wf('appr', [
      { name: 'gate', kind: 'approval', approval: { policyId: 'default-approval' } },
      { name: 'after', kind: 'action', action: async () => 'done' },
    ]);
    auto.workflows().register(def);
    // no approver → awaiting-approval, 'after' never runs
    const pending = await auto.workflows().run(def, { tenantId: T, actor: 'ada', trigger: 'manual' });
    expect(pending.status).toBe('awaiting-approval');
    expect(pending.approvals.length).toBe(1);
    expect(pending.outputs.after).toBeUndefined();
    // with an approving human → completed
    const ok = await auto.workflows().run(def, { tenantId: T, actor: 'ada', trigger: 'manual', approver: (req) => { auto.approvals().approve(req.id, 'manager'); return true; } });
    expect(ok.status).toBe('completed');
  });

  it('supports multi-level approval, delegation, escalation, and digital sign-off', () => {
    const ap = auto.approvals();
    ap.definePolicy({ id: 'two-level', name: 'Two level', levels: [{ approvers: ['manager'], quorum: 1 }, { approvers: ['exec'], quorum: 1 }] });
    const req = ap.request({ tenantId: T, policyId: 'two-level', requester: 'ada' });
    ap.approve(req.id, 'manager');
    expect(ap.get(req.id)!.currentLevel).toBe(1); // advanced to level 2
    expect(ap.isApproved(req.id)).toBe(false);
    ap.approve(req.id, 'exec');
    expect(ap.isApproved(req.id)).toBe(true);
    expect(ap.get(req.id)!.decisions.every((d) => d.signature.length > 0)).toBe(true); // digital sign-off

    // delegation
    const r2 = ap.request({ tenantId: T, policyId: 'default-approval', requester: 'ada' });
    ap.delegate(r2.id, 'manager', 'deputy');
    ap.approve(r2.id, 'deputy'); // deputy acts on behalf of manager
    expect(ap.isApproved(r2.id)).toBe(true);
    expect(ap.get(r2.id)!.decisions[0].onBehalfOf).toBe('manager');

    // escalation
    const r3 = ap.request({ tenantId: T, policyId: 'two-level', requester: 'ada' });
    ap.escalate(r3.id);
    expect(ap.get(r3.id)!.status).toBe('escalated');
    expect(ap.get(r3.id)!.currentLevel).toBe(1);
  });

  it('enforces the human-in-the-loop policy — AI cannot execute restricted ops alone', () => {
    const gate = auto.hitl();
    expect(gate.guard({ operation: 'draft', aiInitiated: true }).allowed).toBe(true); // assistive
    expect(gate.guard({ operation: 'summarize', aiInitiated: true }).allowed).toBe(true);
    const blocked = gate.guard({ operation: 'delete-data', aiInitiated: true });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiresApproval).toBe(true);
    expect(gate.guard({ operation: 'delete-data', aiInitiated: true, humanApproved: true }).allowed).toBe(true);
    // recommendations must be evidence-backed
    expect(() => gate.recommend('prioritize', 'do X first', [])).toThrow(/requires evidence/);
    expect(gate.recommend('prioritize', 'do X first', [{ kind: 'nems.objective', id: 'o1', source: 'nems' }]).confidence).toBeGreaterThan(0);
  });

  it('blocks an AI-initiated high-risk workflow step that lacks an approval gate', async () => {
    const def = wf('ai-risky', [{ name: 'wipe', kind: 'action', riskTier: 'restricted', action: async () => 'wiped' }]);
    // validation rejects a restricted step with no approval gate
    expect(auto.workflows().validate(def).ok).toBe(false);
    // a gated version, AI-initiated, blocks until approved
    const gated = wf('ai-gated', [
      { name: 'approve', kind: 'approval', approval: { policyId: 'default-approval' }, riskTier: 'restricted' },
      { name: 'wipe', kind: 'action', action: async () => 'wiped' },
    ]);
    auto.workflows().register(gated);
    const blocked = await auto.workflows().run(gated, { tenantId: T, actor: 'ai-agent', trigger: 'event', aiInitiated: true });
    expect(blocked.status).toBe('awaiting-approval');
    const approved = await auto.workflows().run(gated, { tenantId: T, actor: 'ai-agent', trigger: 'event', aiInitiated: true, approver: (r) => { auto.approvals().approve(r.id, 'ciso'); return true; } });
    expect(approved.status).toBe('completed');
  });

  it('replays a recorded execution from its stored definition', async () => {
    const def = wf('replayable', [{ name: 'a', kind: 'action', action: async () => 'x' }]);
    auto.workflows().register(def);
    const orig = await auto.workflows().run(def, { tenantId: T, actor: 'ada', trigger: 'manual', inputs: { k: 1 } });
    const replay = await auto.workflows().replay(orig.id);
    expect(replay.replayOf).toBe(orig.id);
    expect(replay.workflowId).toBe('replayable');
    expect(replay.status).toBe('completed');
  });
});

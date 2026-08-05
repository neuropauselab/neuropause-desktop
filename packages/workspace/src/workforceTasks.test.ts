import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createAiRuntime, type AiRuntime } from '@neuropause/ai-runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { WorkspaceGovernance } from './governance';
import { IdentityDirectory } from './identity';
import { DigitalWorkforce, aiRuntimeExecutor } from './workforce';
import { TaskBoard } from './tasks';

function workforceHarness(): {
  clock: ManualClock;
  runtime: EnterpriseRuntime;
  ai: AiRuntime;
  workforce: DigitalWorkforce;
  identity: IdentityDirectory;
  governance: WorkspaceGovernance;
} {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const ai = createAiRuntime(runtime, { clock });
  const governance = new WorkspaceGovernance(runtime, clock);
  const identity = new IdentityDirectory(clock, governance);
  const workforce = new DigitalWorkforce(runtime, identity, governance, clock, aiRuntimeExecutor(ai));
  return { clock, runtime, ai, workforce, identity, governance };
}

describe('DigitalWorkforce — AI employees execute through the AI runtime', () => {
  it('hires an AI employee (a principal) and dispatches through a governed agent', async () => {
    const { ai, workforce, identity, governance } = workforceHarness();
    ai.agents().register({
      name: 'research-agent',
      kind: 'analysis',
      run: async (input: unknown) => ({ summary: `did ${(input as { topic: string }).topic}` }),
    });
    const owner = await identity.registerPrincipal({ type: 'human', displayName: 'Manager' });
    const emp = await workforce.hire({
      role: 'researcher',
      displayName: 'Ada',
      agentName: 'research-agent',
      ownerPrincipalId: owner.id,
      costPerRunUsd: 0.25,
    });
    expect(identity.getPrincipal(emp.id)?.type).toBe('ai-employee'); // same identity model

    const result = await workforce.dispatch(emp.id, { topic: 'market scan' });
    expect(result.output).toMatchObject({ summary: 'did market scan' });
    expect(workforce.performance(emp.id).runs).toBe(1);
    expect(workforce.totalCost()).toBeCloseTo(0.25);
    // dispatch is governed both in the AI runtime AND the workforce
    expect(governance.byDomain('workforce').some((r) => r.action === 'dispatch' && r.ok)).toBe(true);
  });

  it('enforces the human approval gate', async () => {
    const { ai, workforce, identity } = workforceHarness();
    ai.agents().register({ name: 'noop', kind: 'task', run: async () => ({ done: true }) });
    const owner = await identity.registerPrincipal({ type: 'human', displayName: 'Boss' });
    const emp = await workforce.hire({
      role: 'operator',
      displayName: 'Ops',
      agentName: 'noop',
      ownerPrincipalId: owner.id,
      requiresApproval: true,
    });
    const denied = await workforce.dispatch(emp.id, { do: 'thing' });
    expect(denied.approvalRequired).toBe(true);

    const request = await workforce.requestApproval(emp.id, { do: 'thing' }, owner.id);
    await workforce.decideApproval(request.id, true, owner.id);
    const ok = await workforce.dispatch(emp.id, { do: 'thing' }, { approvedRequestId: request.id });
    expect(ok.approvalRequired).toBe(false);
  });

  it('schedules recurring dispatch on the shared runtime scheduler', async () => {
    const { clock, runtime, ai, workforce, identity } = workforceHarness();
    let runs = 0;
    ai.agents().register({ name: 'tick-agent', kind: 'task', run: async () => void runs++ });
    const owner = await identity.registerPrincipal({ type: 'human', displayName: 'M' });
    const emp = await workforce.hire({ role: 'operator', displayName: 'Cron', agentName: 'tick-agent', ownerPrincipalId: owner.id });
    workforce.schedule(emp.id, 1000, {});
    expect(runtime.scheduler().names()).toContain(`workforce:${emp.id}`);
    clock.advance(1000);
    await runtime.scheduler().tick();
    expect(runs).toBe(1);
  });
});

describe('TaskBoard — dependencies, automation, projections', () => {
  function taskHarness(): { tasks: TaskBoard; governance: WorkspaceGovernance; runtime: EnterpriseRuntime } {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const governance = new WorkspaceGovernance(runtime, clock);
    return { tasks: new TaskBoard(clock, governance), governance, runtime };
  }

  it('gates completion on dependencies and rejects cycles', async () => {
    const { tasks } = taskHarness();
    const a = await tasks.create({ title: 'A', workspaceId: 'ws_1' });
    const b = await tasks.create({ title: 'B', workspaceId: 'ws_1' });
    await tasks.addDependency(b.id, a.id);
    await expect(tasks.transition(b.id, 'done')).rejects.toThrow(/dependency/);
    await expect(tasks.addDependency(a.id, b.id)).rejects.toThrow(/cycle/);
    await tasks.transition(a.id, 'done');
    await tasks.transition(b.id, 'done');
    expect(tasks.get(b.id)?.status).toBe('done');
  });

  it('routes assignments + mentions via notify and runs automation rules', async () => {
    const { tasks, governance } = taskHarness();
    tasks.addRule('in-review', { type: 'set-priority', priority: 'urgent' });
    const t = await tasks.create({ title: 'Ship', workspaceId: 'ws_1' });
    await tasks.assign(t.id, 'prin_assignee');
    await tasks.comment(t.id, 'prin_author', 'ping @reviewer', ['prin_reviewer']);
    await tasks.transition(t.id, 'in-review');
    expect(tasks.get(t.id)?.priority).toBe('urgent'); // automation fired
    const notifies = governance.history().flatMap((r) => r.notify ?? []);
    expect(notifies).toContain('prin_assignee');
    expect(notifies).toContain('prin_reviewer');
  });

  it('projects the same tasks into a kanban view', async () => {
    const { tasks } = taskHarness();
    await tasks.create({ title: 'T1', workspaceId: 'ws_1' });
    const t2 = await tasks.create({ title: 'T2', workspaceId: 'ws_1' });
    await tasks.transition(t2.id, 'in-progress');
    const board = tasks.kanban('ws_1');
    expect(board.todo).toHaveLength(1);
    expect(board['in-progress']).toHaveLength(1);
  });
});

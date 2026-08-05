import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createWorkforcePlatform, type WorkforcePlatform } from './platform';

describe('Modules 5,6 — Multi-Agent Collaboration + Planning', () => {
  let runtime: EnterpriseRuntime;
  let wf: WorkforcePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    wf = createWorkforcePlatform(runtime, { clock });
  });

  it('collaboration: delegate, round-robin task distribution, team goals', async () => {
    await wf.collaboration().delegate({ fromAgent: 'a1', toAgent: 'a2', taskId: 't1' });
    expect(wf.collaboration().delegations('a1').length).toBe(1);
    const assign = wf.collaboration().distributeTasks(['t1', 't2', 't3'], ['a1', 'a2']);
    expect(assign).toEqual([{ taskId: 't1', agentId: 'a1' }, { taskId: 't2', agentId: 'a2' }, { taskId: 't3', agentId: 'a1' }]);
    await wf.collaboration().setTeamGoal('team1', 'ship wave 11');
    expect(wf.collaboration().teamGoal('team1')!.goal).toBe('ship wave 11');
  });

  it('planning: decompose a goal into a dependency-ordered task graph', async () => {
    const p = await wf.planning().plan({ goal: 'Launch product', ownerId: 'org1' });
    expect(p.tasks.length).toBe(4);
    expect(p.tasks[0]!.phase).toBe('analyze');
    const ready = wf.planning().readyTasks(p.id, []);
    expect(ready.length).toBe(1);
    expect(ready[0]!.phase).toBe('analyze'); // only the dependency-free task is ready
    const ready2 = wf.planning().readyTasks(p.id, [p.tasks[0]!.id]);
    expect(ready2[0]!.phase).toBe('plan'); // next task unblocks after analyze
  });
});

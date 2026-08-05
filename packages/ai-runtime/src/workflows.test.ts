import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { GovernanceRecorder } from './governance';
import { WorkflowEngine, type Workflow } from './workflows';

function setup() {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new GovernanceRecorder(runtime, clock);
  return { runtime, governance, engine: new WorkflowEngine(runtime, governance) };
}

describe('WorkflowEngine', () => {
  it('runs sequential steps and records governance', async () => {
    const { engine, runtime, governance } = setup();
    const order: string[] = [];
    const wf: Workflow = {
      name: 'ingest',
      mode: 'sequential',
      steps: [
        { name: 'a', run: async () => void order.push('a') },
        { name: 'b', run: async () => void order.push('b') },
      ],
    };
    const res = await engine.run(wf, { actor: 'usr_1' });
    expect(res.ok).toBe(true);
    expect(res.completed).toEqual(['a', 'b']);
    expect(order).toEqual(['a', 'b']);
    expect(governance.history().some((r) => r.kind === 'workflow' && r.ok)).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('skips conditional steps', async () => {
    const { engine } = setup();
    const wf: Workflow = {
      name: 'cond',
      mode: 'sequential',
      steps: [
        { name: 'always', run: async () => undefined },
        { name: 'never', when: () => false, run: async () => { throw new Error('should not run'); } },
      ],
    };
    const res = await engine.run(wf);
    expect(res.ok).toBe(true);
    expect(res.completed).toEqual(['always']);
    expect(res.skipped).toEqual(['never']);
  });

  it('retries a flaky step then succeeds', async () => {
    const { engine } = setup();
    let tries = 0;
    const res = await engine.run({
      name: 'retry',
      mode: 'sequential',
      steps: [{ name: 'flaky', retries: 2, run: async () => { tries++; if (tries < 3) throw new Error('x'); } }],
    });
    expect(res.ok).toBe(true);
    expect(tries).toBe(3);
  });

  it('rolls back completed steps on failure (reverse order)', async () => {
    const { engine } = setup();
    const undone: string[] = [];
    const res = await engine.run({
      name: 'rollback',
      mode: 'sequential',
      steps: [
        { name: 'a', run: async () => undefined, compensate: async () => void undone.push('a') },
        { name: 'b', run: async () => undefined, compensate: async () => void undone.push('b') },
        { name: 'c', run: async () => { throw new Error('boom'); } },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.failed).toBe('c');
    expect(res.rolledBack).toEqual(['b', 'a']); // reverse order
  });

  it('aborts + rolls back on approval rejection', async () => {
    const { engine } = setup();
    const undone: string[] = [];
    const res = await engine.run(
      {
        name: 'approve',
        mode: 'sequential',
        steps: [
          { name: 'prep', run: async () => undefined, compensate: async () => void undone.push('prep') },
          { name: 'apply', approval: true, run: async () => undefined },
        ],
      },
      { approver: () => false },
    );
    expect(res.ok).toBe(false);
    expect(res.failed).toBe('apply');
    expect(res.reason).toContain('approval');
    expect(undone).toEqual(['prep']);
  });

  it('runs parallel steps', async () => {
    const { engine } = setup();
    const wf: Workflow = {
      name: 'par',
      mode: 'parallel',
      steps: [
        { name: 'x', run: async () => undefined },
        { name: 'y', run: async () => undefined },
      ],
    };
    const res = await engine.run(wf);
    expect(res.ok).toBe(true);
    expect(res.completed.sort()).toEqual(['x', 'y']);
  });

  it('honors cancellation', async () => {
    const { engine } = setup();
    const signal = { aborted: false };
    const res = await engine.run(
      {
        name: 'cancel',
        mode: 'sequential',
        steps: [
          { name: 'a', run: async () => { signal.aborted = true; } },
          { name: 'b', run: async () => { throw new Error('should not reach'); } },
        ],
      },
      { signal },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('cancelled');
    expect(res.completed).toEqual(['a']);
  });

  it('enforces a per-step timeout', async () => {
    const { engine } = setup();
    const res = await engine.run({
      name: 'timeout',
      mode: 'sequential',
      steps: [{ name: 'slow', timeoutMs: 10, run: () => new Promise((r) => setTimeout(r, 200)) }],
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('timed out');
  });
});

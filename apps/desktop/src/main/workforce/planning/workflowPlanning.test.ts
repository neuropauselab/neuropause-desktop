import { describe, expect, it, vi } from 'vitest';
import type { WorkflowSpec, WorkflowStep } from '@neuropause/shared';
import { Orchestrator } from '../orchestrator/orchestrator';
import type { WorkerRuntime } from '../runtime';
import { planWorkflow } from './workflowPlanning';

function workerStep(id: string, dependsOn: string[] = []): WorkflowStep {
  return { id, dependsOn, kind: 'worker', workerId: 'w1', skillId: 's1', input: {} };
}

function spec(steps: WorkflowStep[], id = 'wf1'): WorkflowSpec {
  return { id, steps };
}

describe('planWorkflow (V7.1 bridge)', () => {
  it('plans a valid workflow DAG into waves', () => {
    const r = planWorkflow(spec([workerStep('a'), workerStep('b', ['a'])]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.waves).toEqual([['a'], ['b']]);
  });

  it('detects a cycle in the workflow', () => {
    const r = planWorkflow(spec([workerStep('a', ['b']), workerStep('b', ['a'])]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('cycle');
  });

  it('rejects an unknown dependency', () => {
    const r = planWorkflow(spec([workerStep('a', ['ghost'])]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_dependency');
  });

  it('rejects duplicate step ids', () => {
    const r = planWorkflow(spec([workerStep('a'), workerStep('a')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('duplicate_task');
  });
});

describe('Orchestrator up-front validation (V7.1)', () => {
  it('fails a cyclic workflow immediately, running no job', () => {
    const runJob = vi.fn(() => {
      throw new Error('runJob must not be called for an invalid workflow');
    });
    const runtime = { runJob, getJob: () => null } as unknown as WorkerRuntime;
    const orch = new Orchestrator({ runtime, newId: () => 'run1', clock: () => 'NOW' });

    const run = orch.start(spec([workerStep('a', ['b']), workerStep('b', ['a'])]));

    expect(run.status).toBe('failed');
    expect(runJob).not.toHaveBeenCalled();
    expect(run.stepRuns.every((sr) => sr.status === 'skipped')).toBe(true);
    expect(run.finishedAt).toBe('NOW');
  });

  it('does not block a valid workflow', () => {
    const runtime = { runJob: vi.fn(), getJob: () => null } as unknown as WorkerRuntime;
    const orch = new Orchestrator({ runtime, newId: () => 'run2', clock: () => 'NOW' });
    const approval: WorkflowStep = { id: 'appr', dependsOn: [], kind: 'approval' };

    const run = orch.start(spec([approval], 'wf2'));

    // Valid plan → normal execution; an approval step parks for a human.
    expect(run.status).toBe('awaiting_approval');
  });
});

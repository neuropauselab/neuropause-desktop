import { describe, expect, it } from 'vitest';
import type { Job, JobSpec, WorkflowSpec, WorkflowStep } from '@neuropause/shared';
import { Orchestrator } from './orchestrator';
import type { WorkerRuntime } from '../runtime';

type Result = { status: Job['status']; error?: string };

function makeJob(spec: JobSpec, i: number, result: Result): Job {
  return {
    id: `job-${spec.workerId}-${i}`,
    workerId: spec.workerId,
    workerRole: 'operations',
    skillId: spec.skillId,
    status: result.status,
    input: spec.input ?? {},
    requestedBy: spec.requestedBy ?? 'system',
    summary: null,
    evidence: [],
    proposals: [],
    logs: [],
    error: result.error ?? null,
    grounded: false,
    createdAt: 'NOW',
    startedAt: 'NOW',
    finishedAt: 'NOW',
    durationMs: 0,
  };
}

/** Stub runtime: per workerId, a sequence of results consumed one per call. */
function stubRuntime(script: Record<string, Result[]>): {
  runtime: WorkerRuntime;
  calls: () => Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const jobs = new Map<string, Job>();
  const runtime = {
    runJob(spec: JobSpec): Job {
      const key = spec.workerId;
      const seq = script[key] ?? [{ status: 'succeeded' as Job['status'] }];
      const idx = counts[key] ?? 0;
      counts[key] = idx + 1;
      const job = makeJob(spec, idx, seq[Math.min(idx, seq.length - 1)]);
      jobs.set(job.id, job);
      return job;
    },
    getJob(id: string): Job | null {
      return jobs.get(id) ?? null;
    },
  } as unknown as WorkerRuntime;
  return { runtime, calls: () => counts };
}

function step(id: string, dependsOn: string[] = [], retry = 3): WorkflowStep {
  return { id, dependsOn, kind: 'worker', workerId: id, skillId: 's', input: {}, retry };
}

function spec(steps: WorkflowStep[]): WorkflowSpec {
  return { id: 'wf', steps };
}

describe('V7.2.2 — failure policy in the orchestrator', () => {
  it('does not retry a deterministic (validation) failure despite retry budget', () => {
    const { runtime, calls } = stubRuntime({
      a: [{ status: 'failed', error: 'validation failed: bad input' }],
    });
    const orch = new Orchestrator({ runtime, newId: () => 'r', clock: () => 'NOW' });
    const run = orch.start(spec([step('a', [], 3)]));
    expect(run.status).toBe('failed');
    expect(calls().a).toBe(1); // classified deterministic → not retried
  });

  it('retries a transient (network) failure, then succeeds', () => {
    const { runtime, calls } = stubRuntime({
      a: [{ status: 'failed', error: 'ECONNRESET' }, { status: 'succeeded' }],
    });
    const orch = new Orchestrator({ runtime, newId: () => 'r', clock: () => 'NOW' });
    const run = orch.start(spec([step('a', [], 3)]));
    expect(run.status).toBe('succeeded');
    expect(calls().a).toBe(2); // retried once, then succeeded
  });

  it('stops retrying a transient failure once the attempt budget is spent', () => {
    const { runtime, calls } = stubRuntime({ a: [{ status: 'failed', error: 'ECONNRESET' }] });
    const orch = new Orchestrator({ runtime, newId: () => 'r', clock: () => 'NOW' });
    const run = orch.start(spec([step('a', [], 2)])); // retry 2 → 3 attempts
    expect(run.status).toBe('failed');
    expect(calls().a).toBe(3);
  });
});

describe('V7.2.2 — recovery in the orchestrator', () => {
  it('replays only the failed step and never re-runs succeeded work', () => {
    const { runtime, calls } = stubRuntime({
      a: [{ status: 'succeeded' }],
      b: [{ status: 'failed', error: 'validation' }, { status: 'succeeded' }],
    });
    const orch = new Orchestrator({ runtime, newId: () => 'r', clock: () => 'NOW' });
    const s = spec([step('a', [], 0), step('b', ['a'], 0)]);

    const run = orch.start(s);
    expect(run.status).toBe('failed');
    expect(calls().a).toBe(1);
    expect(calls().b).toBe(1);

    const recovered = orch.recover(run, s);
    expect(recovered.status).toBe('succeeded');
    expect(calls().a).toBe(1); // preserved — NOT re-run
    expect(calls().b).toBe(2); // replayed
  });
});

/**
 * P8.2 — pure worker timeline-event builders.
 */
import { describe, expect, it } from 'vitest';
import { approvalDecisionEvent, jobLifecycleEvent } from './workerEvents';

const base = {
  jobId: 'job-1',
  workerId: 'worker:ops',
  workerRole: 'operations' as const,
  skillId: 'read',
  correlationId: 'goal-1',
};

describe('jobLifecycleEvent', () => {
  it('maps each kind to its event type with automation category + workforce source', () => {
    expect(jobLifecycleEvent('queued', base).type).toBe('worker.job_queued');
    expect(jobLifecycleEvent('started', base).type).toBe('worker.job_started');
    expect(jobLifecycleEvent('awaiting_approval', base).type).toBe('worker.job_awaiting_approval');
    expect(jobLifecycleEvent('succeeded', base).type).toBe('worker.job_succeeded');
    expect(jobLifecycleEvent('failed', base).type).toBe('worker.job_failed');
    const e = jobLifecycleEvent('started', base);
    expect(e.category).toBe('automation');
    expect(e.source).toBe('workforce');
    expect(e.correlationId).toBe('goal-1');
  });

  it('carries correlation/worker/task ids in flat metadata + a system actor + job resource', () => {
    const e = jobLifecycleEvent('succeeded', { ...base, summary: 'done', durationMs: 42 });
    expect(e.actor).toEqual({ kind: 'system', id: 'worker:ops' });
    expect(e.resource).toEqual({ type: 'job', id: 'job-1', name: 'read · worker:ops' });
    expect(e.metadata).toMatchObject({
      correlationId: 'goal-1',
      workerId: 'worker:ops',
      workerRole: 'operations',
      skillId: 'read',
      jobId: 'job-1',
      taskId: 'job-1',
      summary: 'done',
      durationMs: 42,
    });
  });

  it('drops undefined optional fields so metadata stays flat + primitive', () => {
    const e = jobLifecycleEvent('queued', base);
    const m = e.metadata ?? {};
    expect('summary' in m).toBe(false);
    expect('pendingApprovals' in m).toBe(false);
    expect('error' in m).toBe(false);
    for (const v of Object.values(m)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
  });

  it('includes pendingApprovals only for awaiting_approval', () => {
    expect(jobLifecycleEvent('awaiting_approval', { ...base, pendingApprovals: 2 }).metadata?.pendingApprovals).toBe(2);
  });
});

describe('approvalDecisionEvent', () => {
  const f = {
    jobId: 'job-1',
    workerId: 'worker:ops',
    workerRole: 'operations' as const,
    proposalId: 'p1',
    proposalTitle: 'Send draft',
    by: 'alice',
    correlationId: 'job-1',
  };

  it('maps granted/rejected with a user actor + proposal resource + ids in metadata', () => {
    expect(approvalDecisionEvent('granted', f).type).toBe('approval.granted');
    expect(approvalDecisionEvent('rejected', f).type).toBe('approval.rejected');
    const e = approvalDecisionEvent('granted', { ...f, note: 'ok' });
    expect(e.actor).toEqual({ kind: 'user', id: 'alice' });
    expect(e.resource).toEqual({ type: 'proposal', id: 'p1', name: 'Send draft' });
    expect(e.correlationId).toBe('job-1');
    expect(e.metadata).toMatchObject({
      jobId: 'job-1',
      taskId: 'job-1',
      proposalId: 'p1',
      decidedBy: 'alice',
      note: 'ok',
      workerId: 'worker:ops',
    });
  });
});

/**
 * P8.3 — Workforce execution router (pure).
 */
import { describe, expect, it } from 'vitest';
import type { ExecutionSession, GovernanceVerdict, Job, JobProposal } from '@neuropause/shared';
import { WORKFORCE_ACTION_KIND, aggregateOutcome, bindingToRequest } from './router';

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1',
  workerId: 'w',
  workerRole: 'operations',
  skillId: 's',
  status: 'running',
  input: {},
  requestedBy: 'u',
  summary: null,
  evidence: [],
  proposals: [],
  logs: [],
  error: null,
  grounded: true,
  createdAt: 'x',
  startedAt: 'x',
  finishedAt: null,
  durationMs: null,
  correlationId: 'goal-9',
  ...over,
});

const proposal = (over: Partial<JobProposal> = {}): JobProposal => ({
  id: 'p1',
  title: 'Do it',
  summary: 's',
  sideEffects: true,
  risk: 'medium',
  evidence: [],
  payload: {},
  verdict: { decision: 'require_approval' } as GovernanceVerdict,
  approval: null,
  ...over,
});

const session = (over: Partial<ExecutionSession> = {}): ExecutionSession => ({
  id: 'exec-1',
  kind: 'connector',
  label: 'l',
  state: 'completed',
  steps: [],
  currentStep: -1,
  startedAt: 'x',
  completedAt: 'y',
  durationMs: 5,
  error: null,
  resultSummary: 'done',
  result: null,
  ...over,
});

describe('bindingToRequest', () => {
  it('returns null for a proposal with no binding', () => {
    expect(bindingToRequest(job(), proposal())).toBeNull();
  });

  it('builds an in-process request carrying the binding, confirmed, and correlationId', () => {
    const req = bindingToRequest(
      job(),
      proposal({ execution: { executor: 'infra', target: 'aws', accountId: 'a', actionId: 'stop', params: { id: 'i-1' } } }),
    )!;
    expect(req.kind).toBe(WORKFORCE_ACTION_KIND);
    expect(req.confirmed).toBe(true);
    expect(req.correlationId).toBe('goal-9');
    const params = req.params as { binding: { executor: string }; jobId: string; proposalId: string };
    expect(params.binding.executor).toBe('infra');
    expect(params.jobId).toBe('job-1');
    expect(params.proposalId).toBe('p1');
  });

  it('falls the correlationId back to the job id', () => {
    const req = bindingToRequest(job({ correlationId: undefined }), proposal({ execution: { executor: 'm365', target: 'c' } }))!;
    expect(req.correlationId).toBe('job-1');
  });
});

describe('aggregateOutcome', () => {
  it('is ok when all sessions completed; carries the last executionId + summary', () => {
    const o = aggregateOutcome([session({ id: 'e1' }), session({ id: 'e2', resultSummary: 'last' })], 'infra');
    expect(o.ok).toBe(true);
    expect(o.executionId).toBe('e2');
    expect(o.summary).toBe('last');
    expect(o.executor).toBe('infra');
    expect(o.error).toBeNull();
  });

  it('fails when any session did not complete', () => {
    const o = aggregateOutcome([session(), session({ state: 'failed', error: 'boom' })], 'm365');
    expect(o.ok).toBe(false);
    expect(o.error).toBe('boom');
  });

  it('handles an empty session list', () => {
    const o = aggregateOutcome([], 'automation');
    expect(o.ok).toBe(false);
    expect(o.error).toBe('No execution ran');
    expect(o.executionId).toBe('');
  });
});

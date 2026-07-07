import { describe, expect, it } from 'vitest';
import type { WorkflowRun, WorkflowSpec, WorkflowStep, WorkflowStepRun } from '@neuropause/shared';
import {
  classifyFailure,
  retryDecision,
  DEFAULT_RETRY_LIMITS,
  type FailureClass,
} from './failurePolicy';
import { planRecovery } from './recoveryPlanner';

describe('classifyFailure', () => {
  const cases: Array<[Parameters<typeof classifyFailure>[0], FailureClass]> = [
    [{ status: 401 }, 'authentication'],
    [{ message: 'invalid token' }, 'authentication'],
    [{ status: 429 }, 'rate_limit'],
    [{ message: 'Rate limit exceeded' }, 'rate_limit'],
    [{ status: 422, message: 'validation failed' }, 'validation'],
    [{ message: 'ECONNRESET' }, 'network'],
    [{ message: 'socket timeout' }, 'network'],
    [{ status: 503 }, 'temporary_service'],
    [{ message: 'bad gateway' }, 'temporary_service'],
    [{ message: 'something exploded' }, 'internal'],
  ];
  it.each(cases)('classifies %o as %s', (signal, expected) => {
    expect(classifyFailure(signal)).toBe(expected);
  });
});

describe('retryDecision', () => {
  it('retries transient failures with exponential backoff', () => {
    const a1 = retryDecision('network', 1);
    const a2 = retryDecision('network', 2);
    expect(a1.retry).toBe(true);
    expect(a1.delayMs).toBe(1000);
    expect(a2.delayMs).toBe(2000); // doubled
  });

  it('stops after the attempt budget and escalates', () => {
    const last = retryDecision('network', DEFAULT_RETRY_LIMITS.maxAttempts);
    expect(last.retry).toBe(false);
    expect(last.escalation).toBe('notify');
  });

  it('never retries deterministic failures (validation, user error, internal)', () => {
    expect(retryDecision('validation', 1).retry).toBe(false);
    expect(retryDecision('user_error', 1).retry).toBe(false);
    const internal = retryDecision('internal', 1);
    expect(internal.retry).toBe(false);
    expect(internal.escalation).toBe('block');
  });

  it('does not retry authentication failures (needs user re-auth)', () => {
    const d = retryDecision('authentication', 1);
    expect(d.retry).toBe(false);
    expect(d.escalation).toBe('notify');
  });

  it('caps exponential backoff at maxDelayMs', () => {
    const d = retryDecision('rate_limit', 20, {
      maxAttempts: 100,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
    });
    expect(d.delayMs).toBe(30_000);
  });
});

function step(id: string, dependsOn: string[] = []): WorkflowStep {
  return { id, dependsOn, kind: 'worker', workerId: 'w', skillId: 's', input: {} };
}

function spec(steps: WorkflowStep[]): WorkflowSpec {
  return { id: 'wf', steps };
}

function run(statuses: Record<string, WorkflowStepRun['status']>): WorkflowRun {
  return {
    id: 'run1',
    workflowId: 'wf',
    status: 'failed',
    stepRuns: Object.entries(statuses).map(([stepId, status]) => ({
      stepId,
      status,
      jobId: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
    })),
    startedAt: 'NOW',
    finishedAt: null,
  };
}

describe('planRecovery', () => {
  it('replays nothing when every step succeeded', () => {
    const r = planRecovery(
      spec([step('a'), step('b', ['a'])]),
      run({ a: 'succeeded', b: 'succeeded' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.toReplay).toEqual([]);
    expect(r.plan.preserved.sort()).toEqual(['a', 'b']);
  });

  it('replays only the failed step, preserving the succeeded one', () => {
    const r = planRecovery(
      spec([step('a'), step('b', ['a'])]),
      run({ a: 'succeeded', b: 'failed' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.toReplay).toEqual(['b']);
    expect(r.plan.preserved).toEqual(['a']);
    // b's dependency on the preserved 'a' is dropped, so b starts immediately.
    expect(r.plan.waves).toEqual([['b']]);
  });

  it('replays a failed step and its skipped dependents in order', () => {
    const r = planRecovery(
      spec([step('a'), step('b', ['a']), step('c', ['b'])]),
      run({ a: 'succeeded', b: 'failed', c: 'skipped' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.preserved).toEqual(['a']);
    expect(r.plan.toReplay).toEqual(['b', 'c']);
    expect(r.plan.waves).toEqual([['b'], ['c']]); // c still waits on b within the replay
  });

  it('keeps replay-internal dependencies while dropping preserved ones', () => {
    // a,b succeeded; c failed depending on both; d skipped depending on c.
    const r = planRecovery(
      spec([step('a'), step('b'), step('c', ['a', 'b']), step('d', ['c'])]),
      run({ a: 'succeeded', b: 'succeeded', c: 'failed', d: 'skipped' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.waves).toEqual([['c'], ['d']]); // c's deps on a,b dropped; d still waits on c
  });
});

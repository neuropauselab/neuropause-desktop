/**
 * NeuroPause OS — Wave 2 / Increment 2. The AI/worker EXECUTION lifecycle is made observable from EXISTING
 * durable records (ipc.execute.sessions correlated to the assistant conversation's stamped executionIds), with
 * HONEST states. Pins: a governed consequential `failed` session is OUTCOME_UNCERTAIN (possibly-UNKNOWN, reconcile)
 * — never a proven failure and never success; `completed` is ACKNOWLEDGED, never VERIFIED_SUCCESS; the AI→execution
 * correlation is by executionId only (renderer stays presentation-only, no authority).
 */
import { describe, expect, it } from 'vitest';
import type { ExecutionSession } from '@neuropause/shared';
import { classifyExecutionSession, correlateAssistantExecutions } from '@renderer/understanding/operatorConsole';

function session(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec_1',
    kind: 'connector',
    label: 'Send email (Microsoft 365)',
    state: 'completed',
    steps: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    durationMs: null,
    error: null,
    resultSummary: null,
    result: null,
    correlationId: 'job-1',
    currentStep: -1,
    tenantId: 'org-A',
    decisionId: 'req-1',
    bindingDigest: 'abc',
    claimNonce: 'n1',
    ...over,
  } as ExecutionSession;
}

describe('classifyExecutionSession — honest AI/worker execution states', () => {
  it('governed consequential FAILED → OUTCOME_UNCERTAIN (possibly-UNKNOWN, reconcile) — not a proven failure', () => {
    const v = classifyExecutionSession(session({ state: 'failed' }));
    expect(v.state).toBe('OUTCOME_UNCERTAIN');
    expect(v.reconciliationRequired).toBe(true);
    expect(v.needsAttention).toBe(true);
    expect(v.detail.toLowerCase()).toContain('do not blindly retry');
    expect(v.state).not.toBe('EXECUTION_FAILED');
  });

  it('a NON-governed failed session → plain EXECUTION_FAILED (no false uncertainty)', () => {
    const v = classifyExecutionSession(session({ kind: 'task', decisionId: undefined, state: 'failed' }));
    expect(v.state).toBe('EXECUTION_FAILED');
    expect(v.reconciliationRequired).toBe(false);
  });

  it('completed → ACKNOWLEDGED, never VERIFIED_SUCCESS; governed note says NOT independently verified', () => {
    const v = classifyExecutionSession(session({ state: 'completed' }));
    expect(v.state).toBe('ACKNOWLEDGED');
    expect(v.state).not.toBe('VERIFIED_SUCCESS' as unknown as typeof v.state);
    expect(v.detail.toLowerCase()).toContain('not independently verified');
  });

  it('interrupted → INTERRUPTED, needs attention; governed one requires reconciliation', () => {
    const v = classifyExecutionSession(session({ state: 'interrupted' }));
    expect(v.state).toBe('INTERRUPTED');
    expect(v.needsAttention).toBe(true);
    expect(v.reconciliationRequired).toBe(true);
  });

  it('running → EXECUTING; queued/waiting → PENDING; cancelled → CANCELLED', () => {
    expect(classifyExecutionSession(session({ state: 'running' })).state).toBe('EXECUTING');
    expect(classifyExecutionSession(session({ state: 'queued' })).state).toBe('PENDING');
    expect(classifyExecutionSession(session({ state: 'cancelled' })).state).toBe('CANCELLED');
  });
});

describe('correlateAssistantExecutions — the AI→execution link from existing ids', () => {
  it('returns exactly the sessions the assistant turn stamped (by executionId)', () => {
    const sessions = [session({ id: 'exec_1' }), session({ id: 'exec_2' }), session({ id: 'exec_3' })];
    const linked = correlateAssistantExecutions(['exec_1', 'exec_3'], sessions);
    expect(linked.map((s) => s.id)).toEqual(['exec_1', 'exec_3']);
  });

  it('empty executionIds → empty (honest: no AI-linked execution yet)', () => {
    expect(correlateAssistantExecutions([], [session()])).toEqual([]);
  });
});

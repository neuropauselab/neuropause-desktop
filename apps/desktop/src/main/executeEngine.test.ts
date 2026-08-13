import { describe, expect, it } from 'vitest';
import {
  computeExecutionStats,
  defaultExecutionLabel,
  isTerminalState,
  planExecution,
  type ExecutionSession,
} from '@neuropause/shared';

function session(over: Partial<ExecutionSession>): ExecutionSession {
  return {
    id: 'e1',
    kind: 'task',
    label: 'Task',
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: '2026-01-10T00:00:00.000Z',
    completedAt: '2026-01-10T00:00:01.000Z',
    durationMs: 1000,
    error: null,
    resultSummary: null,
    ...over,
  };
}

describe('isTerminalState', () => {
  it('marks completed/failed/cancelled terminal', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('cancelled')).toBe(true);
    expect(isTerminalState('running')).toBe(false);
    expect(isTerminalState('queued')).toBe(false);
  });
});

describe('planExecution (V5.4)', () => {
  it('produces per-kind steps in queued state', () => {
    const plan = planExecution({ kind: 'automation', targetId: 'auto_1' });
    expect(plan.kind).toBe('automation');
    expect(plan.steps.map((s) => s.label)).toEqual(['Match rule', 'Execute actions', 'Record run']);
    expect(plan.steps.every((s) => s.state === 'queued')).toBe(true);
  });

  it('task steps differ from automation steps', () => {
    expect(planExecution({ kind: 'task' }).steps[0].label).toBe('Resolve intent');
  });
});

describe('defaultExecutionLabel', () => {
  it('uses an explicit label when given', () => {
    expect(defaultExecutionLabel({ kind: 'task', label: 'My run' })).toBe('My run');
  });
  it('derives from input, truncating long text', () => {
    expect(defaultExecutionLabel({ kind: 'task', input: 'summarize today' })).toBe(
      'Task: summarize today',
    );
    const long = 'x'.repeat(80);
    expect(defaultExecutionLabel({ kind: 'task', input: long }).endsWith('…')).toBe(true);
  });
  it('derives from target id when no input', () => {
    expect(defaultExecutionLabel({ kind: 'automation', targetId: 'auto_9' })).toBe(
      'Automation auto_9',
    );
  });
});

describe('computeExecutionStats (V5.4)', () => {
  it('computes success rate and average runtime from history', () => {
    const stats = computeExecutionStats(
      [session({ id: 'a', state: 'running', completedAt: null, durationMs: null })],
      [
        session({ id: 'b', state: 'completed', durationMs: 1000 }),
        session({ id: 'c', state: 'completed', durationMs: 3000 }),
        session({ id: 'd', state: 'failed', durationMs: 500 }),
      ],
    );
    expect(stats.active).toBe(1);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBe(67); // 2 of 3
    expect(stats.averageRuntimeMs).toBe(1500); // (1000+3000+500)/3
  });

  it('returns null rates with no finished executions', () => {
    const stats = computeExecutionStats([], []);
    expect(stats.successRate).toBeNull();
    expect(stats.averageRuntimeMs).toBeNull();
  });
});

import { ExecuteEngine } from './executeEngine';
import { TEST_TENANT_SCOPE } from './tenancy/testScope';

describe('ExecuteEngine class (V5.4/V5.6)', () => {
  it('runs a registered executor and preserves the typed result', async () => {
    const engine = new ExecuteEngine({ tenantId: () => TEST_TENANT_SCOPE.tenantId });
    engine.register('memory', async () => ({
      ok: true,
      summary: '3 memories found',
      result: { hits: [1, 2, 3], total: 3 },
    }));
    const s = await engine.execute({ kind: 'memory', input: 'yesterday' });
    expect(s.state).toBe('completed');
    expect(s.resultSummary).toBe('3 memories found');
    expect(s.result).toEqual({ hits: [1, 2, 3], total: 3 });
    // Landed in history, cleared from active.
    expect(engine.getHistory().some((h) => h.id === s.id)).toBe(true);
    expect(engine.activeSessions()).toHaveLength(0);
  });

  it('fails cleanly when no executor is registered for the kind', async () => {
    const engine = new ExecuteEngine({ tenantId: () => TEST_TENANT_SCOPE.tenantId });
    const s = await engine.execute({ kind: 'connector' });
    expect(s.state).toBe('failed');
    expect(s.error).toContain('No executor registered');
  });

  it('marks a session failed when the executor throws', async () => {
    const engine = new ExecuteEngine({ tenantId: () => TEST_TENANT_SCOPE.tenantId });
    engine.register('runtime', async () => {
      throw new Error('boom');
    });
    const s = await engine.execute({ kind: 'runtime' });
    expect(s.state).toBe('failed');
    expect(s.error).toBe('boom');
  });

  it('reports registered kinds and computes stats', async () => {
    const engine = new ExecuteEngine({ tenantId: () => TEST_TENANT_SCOPE.tenantId });
    engine.register('executive', async () => ({ ok: true, summary: 'ok' }));
    engine.register('runtime', async () => ({ ok: false, error: 'nope' }));
    await engine.execute({ kind: 'executive' });
    await engine.execute({ kind: 'runtime' });
    expect(engine.registeredKinds().sort()).toEqual(['executive', 'runtime']);
    const stats = engine.stats();
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBe(50);
  });

  it('cancels a running session (cooperative)', async () => {
    const engine = new ExecuteEngine({ tenantId: () => TEST_TENANT_SCOPE.tenantId });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    engine.register('task', async () => {
      await gate;
      return { ok: true, summary: 'done' };
    });
    const running = engine.execute({ kind: 'task', input: 'x' });
    // While pending, it should be an active session and cancellable.
    const active = engine.activeSessions();
    expect(active).toHaveLength(1);
    const cancelled = engine.cancel(active[0].id);
    expect(cancelled?.state).toBe('cancelled');
    release();
    await running;
  });
});

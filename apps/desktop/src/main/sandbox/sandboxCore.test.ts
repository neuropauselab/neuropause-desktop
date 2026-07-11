/** AI Sandbox — Sandbox Core (S1): pure-model + report-generator tests. */
import { describe, expect, it } from 'vitest';
import {
  canTransitionExecution,
  checksumSpec,
  composeSandboxDashboard,
  isTerminalExecutionStatus,
  orderQueue,
  runnableEntries,
  statusFromOutcome,
  type Artifact,
  type Execution,
  type QueueEntry,
  type RunResult,
  type Scenario,
} from '@neuropause/shared';
import { generateReport } from './reportGenerator';

describe('checksumSpec', () => {
  it('is deterministic and key-order invariant', () => {
    expect(checksumSpec({ a: 1, b: [2, 3], c: { d: true } })).toBe(checksumSpec({ c: { d: true }, b: [2, 3], a: 1 }));
    expect(checksumSpec({ a: 1 })).not.toBe(checksumSpec({ a: 2 }));
  });
});

describe('status machine', () => {
  it('permits only legal transitions', () => {
    expect(canTransitionExecution('queued', 'running')).toBe(true);
    expect(canTransitionExecution('queued', 'cancelled')).toBe(true);
    expect(canTransitionExecution('running', 'passed')).toBe(true);
    expect(canTransitionExecution('running', 'timed_out')).toBe(true);
    // illegal
    expect(canTransitionExecution('queued', 'passed')).toBe(false);
    expect(canTransitionExecution('passed', 'running')).toBe(false);
    expect(canTransitionExecution('running', 'queued')).toBe(false);
    expect(canTransitionExecution('running', 'running')).toBe(false);
  });
  it('classifies terminal states + maps outcomes', () => {
    expect(isTerminalExecutionStatus('passed')).toBe(true);
    expect(isTerminalExecutionStatus('running')).toBe(false);
    expect(statusFromOutcome('pass')).toBe('passed');
    expect(statusFromOutcome('fail')).toBe('failed');
    expect(statusFromOutcome('error')).toBe('error');
  });
});

describe('queue scheduling', () => {
  const q = (id: string, priority: QueueEntry['priority'], enqueuedAt: string): QueueEntry => ({ executionId: id, scenarioId: 's', priority, enqueuedAt });
  it('orders by priority then FIFO', () => {
    const ordered = orderQueue([
      q('a', 'normal', '2026-01-01T00:00:02Z'),
      q('b', 'high', '2026-01-01T00:00:03Z'),
      q('c', 'high', '2026-01-01T00:00:01Z'),
      q('d', 'low', '2026-01-01T00:00:00Z'),
    ]);
    expect(ordered.map((e) => e.executionId)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('respects available slots', () => {
    const pending = [q('a', 'normal', '1'), q('b', 'high', '2'), q('c', 'low', '3')];
    expect(runnableEntries(pending, 1, 2).map((e) => e.executionId)).toEqual(['b']); // 1 running, concurrency 2 → 1 slot → highest
    expect(runnableEntries(pending, 0, 0)).toEqual([]);
  });
});

function exec(over: Partial<Execution> = {}): Execution {
  return {
    id: 'e1', workspaceId: 'w1', scenarioId: 's1', scenarioVersion: 1, status: 'passed', trigger: 'manual', priority: 'normal',
    queuedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 1000, attempt: 1, resultId: null, reportId: null, error: null, ...over,
  };
}

describe('composeSandboxDashboard', () => {
  it('rolls up counts, pass rate, and recent runs', () => {
    const d = composeSandboxDashboard({
      workspaces: 2,
      scenarios: 3,
      executions: [exec({ id: 'a', status: 'passed', queuedAt: '2026-01-01T00:00:01Z' }), exec({ id: 'b', status: 'failed', queuedAt: '2026-01-01T00:00:03Z' }), exec({ id: 'c', status: 'running', queuedAt: '2026-01-01T00:00:02Z' })],
      queue: { depth: 1, running: 1 },
      artifacts: [{ kind: 'screenshot' }, { kind: 'screenshot' }, { kind: 'log' }],
      generatedAt: '2026-01-01T00:01:00Z',
    });
    expect(d.executions.total).toBe(3);
    expect(d.executions.byStatus).toEqual({ passed: 1, failed: 1, running: 1 });
    expect(d.passRate).toBe(0.5); // 1 passed / 2 finished
    expect(d.artifacts.byKind).toEqual({ screenshot: 2, log: 1 });
    expect(d.recentRuns[0].id).toBe('b'); // newest queuedAt first
  });
  it('passRate is null when nothing has finished', () => {
    expect(composeSandboxDashboard({ workspaces: 1, scenarios: 0, executions: [exec({ status: 'running' })], queue: { depth: 0, running: 1 }, artifacts: [], generatedAt: 'x' }).passRate).toBeNull();
  });
});

describe('generateReport', () => {
  const scenario: Scenario = {
    id: 's1', workspaceId: 'w1', key: 'k', name: 'Checkout', description: '', metadata: { tags: [], category: null, owner: null, labels: {} },
    latestVersion: 1, versionCount: 1, archived: false, createdAt: 'x', updatedAt: 'x',
  };
  const result: RunResult = { id: 'r1', executionId: 'e1', outcome: 'pass', summary: 'All good', assertions: { total: 3, passed: 3, failed: 0 }, metrics: { durationMs: 1000, steps: 2 }, createdAt: 'x' };
  const artifacts: Artifact[] = [
    { id: 'a1', executionId: 'e1', workspaceId: 'w1', kind: 'screenshot', name: 's.png', mimeType: 'image/png', sizeBytes: 10, storageRef: 'ref', inline: null, createdAt: 'x', metadata: {} },
  ];

  it('produces a structured report from the execution + result + artifacts', () => {
    const report = generateReport({
      execution: exec({ status: 'passed', durationMs: 1000 }),
      scenario,
      result,
      artifacts,
      timeline: [{ id: 't1', executionId: 'e1', at: '2026-01-01T00:00:01Z', phase: 'started', level: 'info', message: 'Execution started', data: {} }],
      now: () => 0,
    });
    expect(report.status).toBe('passed');
    expect(report.summary).toBe('All good');
    expect(report.sections.map((s) => s.heading)).toEqual(['Overview', 'Result', 'Artifacts', 'Timeline']);
    expect(report.sections[1].items).toContain('Assertions: 3/3 passed');
    expect(report.sections[2].items).toContain('screenshot: 1');
  });
});

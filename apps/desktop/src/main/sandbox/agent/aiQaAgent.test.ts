/** AI Sandbox S4 — AI QA agent contract (goal parsing, agent inference, planning helpers). */
import { describe, expect, it } from 'vitest';
import {
  inferAgent,
  isDestructiveSpec,
  parseQaGoal,
  severityFor,
  topoSortTasks,
  type QaTask,
} from '@neuropause/shared';

describe('parseQaGoal + inferAgent', () => {
  it('parses a natural-language goal and infers the agent', () => {
    const g = parseQaGoal('Validate RBAC permission enforcement across CRM');
    expect(g.kind).toBe('natural');
    expect(g.agent).toBe('security'); // security keywords win
    expect(g.priority).toBe('p1');
  });

  it('honors a structured goal', () => {
    const g = parseQaGoal({ text: 'run manufacturing checks', agent: 'manufacturing', priority: 'p0', requireApproval: true });
    expect(g.kind).toBe('structured');
    expect(g.agent).toBe('manufacturing');
    expect(g.priority).toBe('p0');
    expect(g.requireApproval).toBe(true);
  });

  it('maps domain keywords to agents deterministically', () => {
    expect(inferAgent('check the invoice and payment flow')).toBe('finance');
    expect(inferAgent('production order and BOM')).toBe('manufacturing');
    expect(inferAgent('procure to pay end to end')).toBe('erp');
    expect(inferAgent('sync the connector')).toBe('connector');
    expect(inferAgent('something unrelated')).toBe('regression'); // fallback
  });
});

describe('planning helpers', () => {
  it('topologically sorts tasks (cycle-safe)', () => {
    const tasks: QaTask[] = [
      task('c', ['b']),
      task('b', ['a']),
      task('a', []),
    ];
    expect(topoSortTasks(tasks)).toEqual(['a', 'b', 'c']);
    // cycle does not hang
    const cyclic: QaTask[] = [task('x', ['y']), task('y', ['x'])];
    expect(topoSortTasks(cyclic)).toHaveLength(2);
  });

  it('derives severity deterministically', () => {
    expect(severityFor('pass', 'none', 'p0')).toBe('info');
    expect(severityFor('error', 'crash', 'p0')).toBe('critical');
    expect(severityFor('fail', 'permission', 'p2')).toBe('high');
    expect(severityFor('fail', 'flaky', 'p1')).toBe('low');
  });

  it('detects destructive specs', () => {
    expect(isDestructiveSpec({ kind: 'enterprise', steps: [{ action: 'deleteCustomer' }] })).toBe(true);
    expect(isDestructiveSpec({ kind: 'enterprise', steps: [{ action: 'createCustomer' }] })).toBe(false);
  });
});

function task(id: string, dependsOn: string[]): QaTask {
  return { id, name: id, goalId: 'g', spec: { kind: 'enterprise', steps: [] }, expectations: [], dependsOn, priority: 'p2', destructive: false, retry: { maxAttempts: 1, backoffMs: 0 } };
}

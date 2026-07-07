import { describe, expect, it } from 'vitest';
import type { WorkflowSpec, WorkflowStep } from '@neuropause/shared';
import { analyzeWorkflowHealth, criticalPath } from './workflowAnalysis';

function step(
  id: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowStep> = {},
): WorkflowStep {
  return { id, dependsOn, kind: 'worker', workerId: 'w', skillId: 's', input: {}, ...extra };
}

function spec(steps: WorkflowStep[]): WorkflowSpec {
  return { id: 'wf', steps };
}

describe('analyzeWorkflowHealth', () => {
  it('scores a clean linear workflow at 100 with no issues', () => {
    const h = analyzeWorkflowHealth(spec([step('a'), step('b', ['a']), step('c', ['b'])]));
    expect(h.score).toBe(100);
    expect(h.issues).toEqual([]);
    expect(h.depth).toBe(3);
    expect(h.maxParallelism).toBe(1);
  });

  it('scores an invalid (cyclic) workflow at 0', () => {
    const h = analyzeWorkflowHealth(spec([step('a', ['b']), step('b', ['a'])]));
    expect(h.score).toBe(0);
    expect(h.issues[0].kind).toBe('invalid');
  });

  it('flags excessive parallelism', () => {
    const steps = Array.from({ length: 12 }, (_, i) => step(`p${i}`));
    const h = analyzeWorkflowHealth(spec(steps));
    expect(h.maxParallelism).toBe(12);
    expect(h.issues.some((i) => i.kind === 'excessive_parallelism')).toBe(true);
    expect(h.score).toBeLessThan(100);
  });

  it('flags an over-long dependency chain', () => {
    const steps: WorkflowStep[] = [step('s0')];
    for (let i = 1; i < 12; i++) steps.push(step(`s${i}`, [`s${i - 1}`]));
    const h = analyzeWorkflowHealth(spec(steps));
    expect(h.depth).toBe(12);
    expect(h.issues.some((i) => i.kind === 'long_chain')).toBe(true);
  });

  it('flags a disconnected step', () => {
    const h = analyzeWorkflowHealth(spec([step('a'), step('b', ['a']), step('island')]));
    expect(h.issues.some((i) => i.kind === 'isolated_step' && i.detail.includes('island'))).toBe(
      true,
    );
  });

  it('flags an approval that gates most of the workflow', () => {
    const h = analyzeWorkflowHealth(
      spec([
        step('gate', [], { kind: 'approval' }),
        step('a', ['gate']),
        step('b', ['a']),
        step('c', ['b']),
      ]),
    );
    expect(h.issues.some((i) => i.kind === 'approval_bottleneck')).toBe(true);
  });
});

describe('criticalPath', () => {
  it('marks every step critical on a linear chain', () => {
    const cp = criticalPath(spec([step('a'), step('b', ['a']), step('c', ['b'])]));
    expect(cp.estimatedDuration).toBe(3);
    expect(cp.bottlenecks).toEqual(['a', 'b', 'c']);
    expect(Object.values(cp.slack).every((s) => s === 0)).toBe(true);
  });

  it('gives the shorter branch of a diamond slack, keeping the longer branch critical', () => {
    const cp = criticalPath(
      spec([step('a'), step('long', ['a']), step('short', ['a']), step('d', ['long', 'short'])]),
      (s) => (s.id === 'long' ? 3 : 1),
    );
    // a(1) → long(3) → d(1) = 5 ; a → short(1) → d = 3, so short has slack.
    expect(cp.estimatedDuration).toBe(5);
    expect(cp.bottlenecks).toEqual(['a', 'long', 'd']);
    expect(cp.slack['short']).toBeGreaterThan(0);
  });

  it('honors a custom duration function', () => {
    const cp = criticalPath(spec([step('a'), step('b', ['a'])]), (s) => (s.id === 'a' ? 10 : 5));
    expect(cp.estimatedDuration).toBe(15);
  });

  it('returns an empty result for an invalid DAG', () => {
    const cp = criticalPath(spec([step('a', ['b']), step('b', ['a'])]));
    expect(cp).toEqual({ path: [], estimatedDuration: 0, slack: {}, bottlenecks: [] });
  });
});

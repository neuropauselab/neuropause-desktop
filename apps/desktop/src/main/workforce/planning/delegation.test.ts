/**
 * P8 — Workforce Delegation engine. Pure (Node). Locks owner-assignment scoring,
 * eligibility, topological waves + critical-path scheduling (reusing planGoal /
 * criticalPath), load-balancing, confidence, and malformed-graph handling.
 */
import { describe, expect, it } from 'vitest';
import type {
  DelegationGoalInput,
  DelegationTaskInput,
  Worker,
  WorkerHealthState,
  WorkerLifecycle,
  WorkerPermissionScope,
  WorkerRole,
} from '@neuropause/shared';
import { isEligible, scoreCandidate } from '@neuropause/shared';
import { planDelegation, toDelegationCandidate } from './delegation';

const NOW = '2026-07-15T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function mkWorker(
  id: string,
  role: WorkerRole,
  opts: {
    trust?: number;
    lifecycle?: WorkerLifecycle;
    health?: WorkerHealthState;
    scopes?: WorkerPermissionScope[];
    name?: string;
  } = {},
): Worker {
  return {
    identity: { id, name: opts.name ?? id, role, version: '1.0.0', developer: 'test' },
    goals: [],
    skills: [],
    permissions: (opts.scopes ?? []).map((scope) => ({ scope, granted: true })),
    memoryScope: 'self',
    policyIds: [],
    trustScore: opts.trust ?? 0.7,
    lifecycle: opts.lifecycle ?? 'idle',
    health: { state: opts.health ?? 'healthy', lastCheckAt: null, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
    createdAt: NOW,
    updatedAt: NOW,
    builtIn: false,
    metadata: {},
  };
}

const goal = (id: string, title: string, tasks: DelegationTaskInput[]): DelegationGoalInput => ({ id, title, tasks });

describe('scoreCandidate + isEligible', () => {
  it('rewards an exact role match over a cross-role assignment', () => {
    const task: DelegationTaskInput = { id: 't', title: 'T', role: 'finance' };
    const fin = scoreCandidate(task, toDelegationCandidate(mkWorker('a', 'finance', { trust: 0.9 })));
    const sales = scoreCandidate(task, toDelegationCandidate(mkWorker('b', 'sales', { trust: 0.9 })));
    expect(fin.roleMatch).toBe(1);
    expect(sales.roleMatch).toBe(0.35);
    expect(fin.total).toBeGreaterThan(sales.total);
    expect(fin.reasons).toContain('role match (finance)');
  });

  it('scores required-scope coverage and lists it', () => {
    const task: DelegationTaskInput = { id: 't', title: 'T', role: 'engineering', requiredScopes: ['read:entities', 'write:memory'] };
    const full = scoreCandidate(task, toDelegationCandidate(mkWorker('a', 'engineering', { scopes: ['read:entities', 'write:memory'] })));
    const partial = scoreCandidate(task, toDelegationCandidate(mkWorker('b', 'engineering', { scopes: ['read:entities'] })));
    expect(full.scopeCoverage).toBe(1);
    expect(partial.scopeCoverage).toBe(0.5);
    expect(full.reasons).toContain('all required scopes granted');
  });

  it('marks stopped/errored workers and missing scopes ineligible', () => {
    const task: DelegationTaskInput = { id: 't', title: 'T', requiredScopes: ['write:memory'] };
    expect(isEligible(task, toDelegationCandidate(mkWorker('a', 'finance', { scopes: ['write:memory'] })))).toBe(true);
    expect(isEligible(task, toDelegationCandidate(mkWorker('b', 'finance', { scopes: [] })))).toBe(false);
    expect(isEligible({ id: 't', title: 'T' }, toDelegationCandidate(mkWorker('c', 'finance', { lifecycle: 'stopped' })))).toBe(false);
    expect(isEligible({ id: 't', title: 'T' }, toDelegationCandidate(mkWorker('d', 'finance', { lifecycle: 'errored' })))).toBe(false);
  });
});

describe('planDelegation — assignment', () => {
  it('assigns each task to the best role-matched worker', () => {
    const plan = planDelegation(
      goal('g1', 'Close the quarter', [
        { id: 'books', title: 'Reconcile books', role: 'finance' },
        { id: 'brief', title: 'Draft the brief', role: 'marketing' },
      ]),
      [mkWorker('w-fin', 'finance', { name: 'Fin' }), mkWorker('w-mkt', 'marketing', { name: 'Mkt' })],
      NOW_MS,
    );
    const books = plan.assignments.find((a) => a.taskId === 'books')!;
    const brief = plan.assignments.find((a) => a.taskId === 'brief')!;
    expect(books.workerId).toBe('w-fin');
    expect(brief.workerId).toBe('w-mkt');
    expect(plan.assignedTasks).toBe(2);
    expect(plan.error).toBeNull();
  });

  it('leaves a task unassigned when no worker grants its required scopes', () => {
    const plan = planDelegation(
      goal('g2', 'Send an approved email', [{ id: 'send', title: 'Send', role: 'support', requiredScopes: ['propose:message'] }]),
      [mkWorker('w', 'support', { scopes: ['read:entities'] })],
      NOW_MS,
    );
    expect(plan.unassigned).toEqual(['send']);
    expect(plan.assignedTasks).toBe(0);
    expect(plan.assignments[0].workerId).toBeNull();
    expect(plan.confidence).toBe(0);
  });

  it('load-balances equal candidates across independent tasks (tie → least-loaded → id)', () => {
    const plan = planDelegation(
      goal('g3', 'Two reports', [
        { id: 't1', title: 'One', role: 'research' },
        { id: 't2', title: 'Two', role: 'research' },
      ]),
      [mkWorker('a', 'research'), mkWorker('b', 'research')],
      NOW_MS,
    );
    expect(plan.assignments.find((a) => a.taskId === 't1')!.workerId).toBe('a');
    expect(plan.assignments.find((a) => a.taskId === 't2')!.workerId).toBe('b');
    expect(plan.load).toHaveLength(2);
    expect(plan.load.every((l) => l.taskCount === 1)).toBe(true);
  });

  it('prefers the higher-trust worker for the same role', () => {
    const plan = planDelegation(
      goal('g4', 'One task', [{ id: 't', title: 'T', role: 'engineering' }]),
      [mkWorker('lo', 'engineering', { trust: 0.2 }), mkWorker('hi', 'engineering', { trust: 0.95 })],
      NOW_MS,
    );
    expect(plan.assignments[0].workerId).toBe('hi');
    expect(plan.assignments[0].matchScore).toBeGreaterThan(0);
  });
});

describe('planDelegation — scheduling (reuses planGoal + criticalPath)', () => {
  it('schedules a dependency chain and flags every step on the critical path', () => {
    const plan = planDelegation(
      goal('g5', 'Chain', [
        { id: 'a', title: 'A', role: 'operations' },
        { id: 'b', title: 'B', role: 'operations', dependsOn: ['a'] },
        { id: 'c', title: 'C', role: 'operations', dependsOn: ['b'] },
      ]),
      [mkWorker('w', 'operations')],
      NOW_MS,
    );
    expect(plan.waves).toEqual([['a'], ['b'], ['c']]);
    expect(plan.estimatedDuration).toBe(3);
    expect(plan.criticalPath).toEqual(['a', 'b', 'c']);
    const c = plan.assignments.find((a) => a.taskId === 'c')!;
    expect(c.startOffset).toBe(2);
    expect(c.finishOffset).toBe(3);
    expect(c.onCriticalPath).toBe(true);
  });

  it('parallelizes independent tasks and respects effort in the schedule', () => {
    const plan = planDelegation(
      goal('g6', 'Fan-in', [
        { id: 'a', title: 'A', role: 'operations', effort: 3 },
        { id: 'b', title: 'B', role: 'operations', effort: 1 },
        { id: 'c', title: 'C', role: 'operations', dependsOn: ['a', 'b'] },
      ]),
      [mkWorker('w', 'operations')],
      NOW_MS,
    );
    expect(plan.waves[0].sort()).toEqual(['a', 'b']);
    const c = plan.assignments.find((x) => x.taskId === 'c')!;
    expect(c.startOffset).toBe(3); // waits for the longer branch A (effort 3)
    expect(plan.estimatedDuration).toBe(4);
  });
});

describe('planDelegation — malformed graphs + edge cases', () => {
  it('returns an error plan (all unassigned) for a dependency cycle', () => {
    const plan = planDelegation(
      goal('g7', 'Cycle', [
        { id: 'a', title: 'A', dependsOn: ['b'] },
        { id: 'b', title: 'B', dependsOn: ['a'] },
      ]),
      [mkWorker('w', 'operations')],
      NOW_MS,
    );
    expect(plan.error).toBe('cycle');
    expect(plan.assignments).toHaveLength(0);
    expect(plan.unassigned).toEqual(['a', 'b']);
    expect(plan.confidence).toBe(0);
  });

  it('flags an unknown dependency', () => {
    const plan = planDelegation(
      goal('g8', 'Bad dep', [{ id: 'a', title: 'A', dependsOn: ['ghost'] }]),
      [mkWorker('w', 'operations')],
      NOW_MS,
    );
    expect(plan.error).toBe('unknown_dependency');
  });

  it('is stable + non-throwing on an empty goal', () => {
    const plan = planDelegation(goal('g9', 'Empty', []), [], NOW_MS);
    expect(plan.error).toBeNull();
    expect(plan.totalTasks).toBe(0);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.estimatedDuration).toBe(0);
    expect(plan.confidence).toBe(0);
    expect(plan.generatedAt).toBe(NOW);
  });

  it('a NaN trustScore never poisons the score or hijacks the argmax (regression)', () => {
    // The high-trust worker must win regardless of roster order, and confidence stays finite.
    for (const workers of [
      [mkWorker('a-bad', 'engineering', { trust: NaN }), mkWorker('z-good', 'engineering', { trust: 0.95 })],
      [mkWorker('z-good', 'engineering', { trust: 0.95 }), mkWorker('a-bad', 'engineering', { trust: NaN })],
    ]) {
      const plan = planDelegation(goal('g', 'G', [{ id: 't', title: 'T', role: 'engineering' }]), workers, NOW_MS);
      expect(plan.assignments[0].workerId).toBe('z-good');
      expect(Number.isFinite(plan.assignments[0].matchScore)).toBe(true);
      expect(Number.isFinite(plan.confidence)).toBe(true);
    }
  });

  it('count-balances zero-effort tasks across equal workers (regression)', () => {
    const plan = planDelegation(
      goal('g', 'G', [
        { id: 't1', title: '1', role: 'research', effort: 0 },
        { id: 't2', title: '2', role: 'research', effort: 0 },
      ]),
      [mkWorker('a', 'research'), mkWorker('b', 'research')],
      NOW_MS,
    );
    expect(plan.load).toHaveLength(2);
    expect(plan.load.every((l) => l.taskCount === 1)).toBe(true);
  });

  it('does not throw on a non-finite nowMs (regression)', () => {
    expect(() => planDelegation(goal('g', 'G', []), [], NaN)).not.toThrow();
    expect(() => planDelegation(goal('g', 'G', []), [], 9e15)).not.toThrow();
  });

  it('confidence blends mean match with coverage', () => {
    // One assignable task + one unassignable → coverage 0.5 halves confidence.
    const plan = planDelegation(
      goal('g10', 'Mixed', [
        { id: 'ok', title: 'OK', role: 'finance' },
        { id: 'no', title: 'No', role: 'finance', requiredScopes: ['propose:message'] },
      ]),
      [mkWorker('w', 'finance', { trust: 1, scopes: [] })],
      NOW_MS,
    );
    expect(plan.assignedTasks).toBe(1);
    expect(plan.unassigned).toEqual(['no']);
    expect(plan.confidence).toBeGreaterThan(0);
    expect(plan.confidence).toBeLessThan(plan.assignments.find((a) => a.taskId === 'ok')!.matchScore);
  });
});

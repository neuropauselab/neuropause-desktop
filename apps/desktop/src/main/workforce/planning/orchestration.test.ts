import { describe, expect, it } from 'vitest';
import { planGoal, type Goal } from './goalPlanner';
import {
  canTransition,
  isTerminal,
  nextStates,
  transition,
  type AgentState,
} from './agentStateMachine';
import { mergeSharedContext, resolveContextEntry, type ContextEntry } from './sharedContext';

function goal(tasks: Goal['tasks']): Goal {
  return { id: 'g1', tasks };
}

describe('planGoal', () => {
  it('orders a linear chain into sequential waves', () => {
    const r = planGoal(
      goal([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.waves).toEqual([['a'], ['b'], ['c']]);
    expect(r.plan.order).toEqual(['a', 'b', 'c']);
  });

  it('puts independent tasks in a single parallel wave', () => {
    const r = planGoal(goal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    expect(r.ok && r.plan.waves).toEqual([['a', 'b', 'c']]);
  });

  it('resolves a diamond into three waves', () => {
    const r = planGoal(
      goal([
        { id: 'a' },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['a'] },
        { id: 'd', dependsOn: ['b', 'c'] },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.waves).toEqual([['a'], ['b', 'c'], ['d']]);
  });

  it('orders a wave by priority (desc) then id', () => {
    const r = planGoal(
      goal([
        { id: 'low', priority: 1 },
        { id: 'high', priority: 10 },
        { id: 'mid', priority: 5 },
      ]),
    );
    expect(r.ok && r.plan.waves[0]).toEqual(['high', 'mid', 'low']);
  });

  it('detects a dependency cycle', () => {
    const r = planGoal(
      goal([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('cycle');
  });

  it('rejects an unknown dependency', () => {
    const r = planGoal(goal([{ id: 'a', dependsOn: ['ghost'] }]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('unknown_dependency');
  });

  it('rejects duplicate task ids', () => {
    const r = planGoal(goal([{ id: 'a' }, { id: 'a' }]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('duplicate_task');
  });

  it('plans an empty goal as an empty plan', () => {
    const r = planGoal(goal([]));
    expect(r.ok && r.plan.waves).toEqual([]);
  });

  it('is deterministic', () => {
    const tasks = goal([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a'] }]);
    const first = planGoal(tasks);
    const second = planGoal(tasks);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('agent state machine', () => {
  it('allows legal transitions and rejects illegal ones', () => {
    expect(canTransition('idle', 'planning')).toBe(true);
    expect(canTransition('planning', 'executing')).toBe(true);
    expect(canTransition('executing', 'reviewing')).toBe(true);
    expect(canTransition('reviewing', 'completed')).toBe(true);
    expect(canTransition('idle', 'completed')).toBe(false);
    expect(canTransition('completed', 'executing')).toBe(false);
  });

  it('transition returns the new state or an error', () => {
    expect(transition('idle', 'planning')).toEqual({ ok: true, state: 'planning' });
    const bad = transition('completed', 'idle');
    expect(bad.ok).toBe(false);
  });

  it('marks completed and cancelled terminal, but not failed (retry)', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('failed')).toBe(false);
    expect(canTransition('failed', 'planning')).toBe(true); // retry
  });

  it('every state lists its allowed next states', () => {
    const states: AgentState[] = ['idle', 'planning', 'waiting', 'executing', 'reviewing'];
    for (const s of states) expect(nextStates(s).length).toBeGreaterThan(0);
    expect(nextStates('completed')).toEqual([]);
  });
});

describe('shared context resolution', () => {
  const entry = (over: Partial<ContextEntry<string>> = {}): ContextEntry<string> => ({
    key: 'k',
    value: 'v',
    agentId: 'agent-1',
    version: 1,
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...over,
  });

  it('higher version wins', () => {
    const a = entry({ version: 2, value: 'newer' });
    const b = entry({ version: 1, value: 'older' });
    expect(resolveContextEntry(a, b).value).toBe('newer');
    expect(resolveContextEntry(b, a).value).toBe('newer'); // order-independent
  });

  it('ties on version break by updatedAt', () => {
    const a = entry({ version: 1, updatedAt: '2026-07-06T02:00:00.000Z', value: 'late' });
    const b = entry({ version: 1, updatedAt: '2026-07-06T01:00:00.000Z', value: 'early' });
    expect(resolveContextEntry(a, b).value).toBe('late');
  });

  it('ties on version and time break by agentId (deterministic)', () => {
    const a = entry({ agentId: 'zzz' });
    const b = entry({ agentId: 'aaa' });
    expect(resolveContextEntry(a, b).agentId).toBe('zzz');
    expect(resolveContextEntry(b, a).agentId).toBe('zzz');
  });

  it('merges two context maps, resolving per-key conflicts', () => {
    const local = new Map<string, ContextEntry<string>>([
      ['shared', entry({ key: 'shared', version: 1, value: 'local' })],
      ['localOnly', entry({ key: 'localOnly', value: 'L' })],
    ]);
    const incoming = new Map<string, ContextEntry<string>>([
      ['shared', entry({ key: 'shared', version: 2, value: 'remote' })],
      ['remoteOnly', entry({ key: 'remoteOnly', value: 'R' })],
    ]);
    const merged = mergeSharedContext(local, incoming);
    expect(merged.get('shared')?.value).toBe('remote'); // higher version
    expect(merged.get('localOnly')?.value).toBe('L');
    expect(merged.get('remoteOnly')?.value).toBe('R');
  });

  it('merge is idempotent', () => {
    const local = new Map<string, ContextEntry<string>>([['k', entry({ version: 1 })]]);
    const incoming = new Map<string, ContextEntry<string>>([['k', entry({ version: 2 })]]);
    const once = mergeSharedContext(local, incoming);
    const twice = mergeSharedContext(once, incoming);
    expect(twice.get('k')?.version).toBe(2);
    expect(twice.size).toBe(once.size);
  });
});

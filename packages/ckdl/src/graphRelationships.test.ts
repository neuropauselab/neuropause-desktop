import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { KnowledgeGovernance } from './governance';
import { RelationshipStore } from './relationships';
import { EnterpriseKnowledgeGraph } from './graph';

function harness(): { runtime: EnterpriseRuntime; graph: EnterpriseKnowledgeGraph; rels: RelationshipStore; gov: KnowledgeGovernance } {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const gov = new KnowledgeGovernance(runtime, clock);
  const rels = new RelationshipStore(clock, gov);
  const graph = new EnterpriseKnowledgeGraph(clock, gov, rels);
  return { runtime, graph, rels, gov };
}

describe('EnterpriseKnowledgeGraph — one governed graph of references', () => {
  let runtime: EnterpriseRuntime;
  let graph: EnterpriseKnowledgeGraph;
  let rels: RelationshipStore;
  beforeEach(() => {
    ({ runtime, graph, rels } = harness());
  });

  it('registers typed references idempotently (never forks an entity)', async () => {
    await graph.register({ kind: 'project', id: 'p1', label: 'Launch' });
    await graph.register({ kind: 'project', id: 'p1', label: 'Launch (renamed)', metadata: { phase: 2 } });
    expect(graph.count()).toBe(1); // same key → updated, not duplicated
    expect(graph.get({ kind: 'project', id: 'p1' })?.label).toBe('Launch (renamed)');
    expect(graph.get({ kind: 'project', id: 'p1' })?.metadata).toMatchObject({ phase: 2 });
    expect(runtime.audit().verify().valid).toBe(true);
    expect(runtime.timeline().all().some((e) => e.type === 'ckdl.activity')).toBe(true);
  });

  it('treats relationships as first-class and explainable', async () => {
    await graph.register({ kind: 'ai-employee', id: 'ada', label: 'Ada' });
    await graph.register({ kind: 'task', id: 't1', label: 'Write spec' });
    const edge = await rels.relate({ kind: 'ai-employee', id: 'ada' }, { kind: 'task', id: 't1' }, 'assigned-to', {
      explanation: 'Ada owns the spec',
    });
    expect(edge.type).toBe('assigned-to');
    expect(edge.explanation).toBe('Ada owns the spec');
    expect(rels.byType('assigned-to')).toHaveLength(1);
  });

  it('walks neighbors and finds a shortest path', async () => {
    for (const [kind, id, label] of [
      ['organization', 'o1', 'Acme'],
      ['project', 'p1', 'Launch'],
      ['task', 't1', 'Spec'],
    ] as const) {
      await graph.register({ kind, id, label });
    }
    await rels.relate({ kind: 'organization', id: 'o1' }, { kind: 'project', id: 'p1' }, 'owns');
    await rels.relate({ kind: 'project', id: 'p1' }, { kind: 'task', id: 't1' }, 'contributes-to');
    expect(graph.neighbors({ kind: 'project', id: 'p1' }).map((n) => n.key).sort()).toEqual(['organization:o1', 'task:t1']);
    expect(graph.path({ kind: 'organization', id: 'o1' }, { kind: 'task', id: 't1' })).toEqual(['organization:o1', 'project:p1', 'task:t1']);
    expect(graph.subgraph({ kind: 'project', id: 'p1' }).edgeCount).toBe(2);
  });

  it('returns an empty path when entities are unconnected', async () => {
    await graph.register({ kind: 'project', id: 'p1', label: 'A' });
    await graph.register({ kind: 'project', id: 'p2', label: 'B' });
    expect(graph.path({ kind: 'project', id: 'p1' }, { kind: 'project', id: 'p2' })).toEqual([]);
  });
});

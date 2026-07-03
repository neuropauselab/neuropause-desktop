import { describe, expect, it } from 'vitest';
import type { EnterpriseTimelineEntry, MemoryItem, TraceEntityRef, UnifiedEntity } from '@neuropause/shared';
import {
  buildContextTrace,
  buildGovernanceTrace,
  buildRelationshipPath,
  buildRelationshipTrace,
  listGovernanceDecisions,
  type TraceNeighbor,
} from './traceBuilders';

const NOW = '2026-02-10T18:00:00.000Z';

function ent(p: Partial<UnifiedEntity> & { id: string; kind: string }): UnifiedEntity {
  return {
    id: p.id, kind: p.kind as never, connectorId: p.connectorId ?? 'github', accountId: 'a', sourceId: p.id,
    createdAt: NOW, updatedAt: p.updatedAt ?? NOW, syncState: 'active', syncedAt: NOW, metadata: {},
    title: p.title ?? p.id, url: null, parentId: null, containerId: p.containerId ?? null, body: null,
    status: p.status ?? null, author: null, timestamp: p.timestamp ?? null, endTimestamp: null, labels: [],
  } as UnifiedEntity;
}

function mem(p: Partial<MemoryItem> & { id: string; kind: string }): MemoryItem {
  return {
    id: p.id, kind: p.kind as never, origin: p.origin ?? 'explicit', title: p.title ?? p.id,
    content: p.content ?? '', connectorId: null, source: p.source ?? 'manual', entityRefs: p.entityRefs ?? [],
    tags: [], occurredAt: p.occurredAt ?? NOW, createdAt: NOW, updatedAt: NOW, evidence: null, metadata: {},
  } as MemoryItem;
}

function ev(id: string, at: string, refs: string[]): EnterpriseTimelineEntry {
  return {
    id, source: 'activity', at, kind: 'task', category: 'activity', title: id, summary: null,
    actorId: null, actorLabel: null, connectorId: 'github', resourceId: refs[0] ?? null, entityRefs: refs,
    url: null, metadata: {},
  };
}

describe('trace builders', () => {
  it('governance: lists decisions and traces one to its evidence + timeline', () => {
    const memories = [
      mem({ id: 'mem:explicit:d1', kind: 'decision', title: 'Adopt Postgres', content: 'use postgres', entityRefs: ['proj1', 'doc1'] }),
      mem({ id: 'mem:explicit:n1', kind: 'note', title: 'random note' }),
    ];
    const entities = [ent({ id: 'proj1', kind: 'project', title: 'Apollo' }), ent({ id: 'doc1', kind: 'document', title: 'RFC' })];
    const events = [ev('e1', NOW, ['proj1']), ev('e2', NOW, ['unrelated'])];

    const list = listGovernanceDecisions(memories, undefined, 50);
    expect(list.total).toBe(1);
    expect(list.decisions[0]?.id).toBe('mem:explicit:d1');

    const trace = buildGovernanceTrace('mem:explicit:d1', { memories, entities, events });
    expect(trace).not.toBeNull();
    expect(trace?.evidence.map((e) => e.id).sort()).toEqual(['doc1', 'proj1']);
    expect(trace?.timeline.map((t) => t.id)).toEqual(['e1']); // only events touching the decision's entities
    expect(trace?.approvals).toEqual([]); // honest empty slot
    expect(trace?.grounded).toBe(true);

    expect(buildGovernanceTrace('missing', { memories, entities, events })).toBeNull();
  });

  it('context: assembles timeline, related entities, and memories for a subject', () => {
    const entities = [ent({ id: 'proj1', kind: 'project', title: 'Apollo' })];
    const events = [ev('e1', '2026-02-09T00:00:00.000Z', ['proj1']), ev('e2', '2026-02-10T00:00:00.000Z', ['proj1'])];
    const memories = [mem({ id: 'm1', kind: 'context', title: 'About Apollo', entityRefs: ['proj1'] })];
    const neighbors = (id: string): TraceNeighbor[] =>
      id === 'proj1'
        ? [{ id: 'task1', type: 'task', label: 'Build', connectorId: 'github', updatedAt: NOW, rel: 'belongs_to', direction: 'in' }]
        : [];

    const ctx = buildContextTrace('proj1', { entities, events, memories, neighbors });
    expect(ctx.subject?.id).toBe('proj1');
    expect(ctx.timeline.map((t) => t.id)).toEqual(['e2', 'e1']); // newest first
    expect(ctx.related.map((r) => r.id)).toEqual(['task1']);
    expect(ctx.memories.map((m) => m.id)).toEqual(['m1']);
    expect(ctx.grounded).toBe(true);
  });

  it('relationship: groups typed relationships and resolves a path', () => {
    const neighbors = (id: string): TraceNeighbor[] =>
      id === 'proj1'
        ? [
            { id: 'task1', type: 'task', label: 'Build', connectorId: 'github', updatedAt: NOW, rel: 'belongs_to', direction: 'in' },
            { id: 'person:github:dev', type: 'person', label: 'dev', connectorId: 'github', updatedAt: NOW, rel: 'assigned_to', direction: 'in' },
          ]
        : [];
    const refs: Record<string, TraceEntityRef> = {
      proj1: { id: 'proj1', kind: 'project', title: 'Apollo', connectorId: 'github', at: NOW },
      'person:github:dev': { id: 'person:github:dev', kind: 'person', title: 'dev', connectorId: 'github', at: NOW },
    };
    const resolveRef = (id: string): TraceEntityRef | null => refs[id] ?? null;

    const rel = buildRelationshipTrace('proj1', { resolveRef, neighbors });
    expect(rel.root?.id).toBe('proj1');
    expect(rel.related.length).toBe(2);
    expect(rel.byType).toEqual({ belongs_to: 1, assigned_to: 1 });

    const path = buildRelationshipPath('proj1', 'person:github:dev', {
      pathRefs: () => [refs.proj1!, refs['person:github:dev']!],
    });
    expect(path.found).toBe(true);
    expect(path.length).toBe(1);
    expect(path.nodes.map((n) => n.id)).toEqual(['proj1', 'person:github:dev']);

    const none = buildRelationshipPath('a', 'b', { pathRefs: () => [] });
    expect(none.found).toBe(false);
    expect(none.length).toBe(0);
  });
});

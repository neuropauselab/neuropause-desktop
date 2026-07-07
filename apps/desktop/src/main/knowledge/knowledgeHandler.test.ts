import { describe, expect, it, vi } from 'vitest';
import { handleRelatedMemories, type KnowledgeGraph, type KnowledgeHandlerDeps } from './knowledgeHandler';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[]): MemoryItem {
  return {
    id, kind: 'context', origin: 'projected', title: id, content: id, connectorId: null,
    source: 'manual', entityRefs, tags: [], occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    evidence: null, metadata: {} as MemoryItem['metadata'],
  };
}

/** Graph stub: adjacency of entity ids → neighbor entity ids. */
function graphOf(adj: Record<string, string[]>): KnowledgeGraph {
  return {
    neighbors: (q) => {
      const ns = adj[q.id];
      if (!ns) return null;
      return { node: { sourceId: q.id }, neighbors: ns.map((sourceId) => ({ node: { sourceId } })) };
    },
  };
}

function deps(over: Partial<KnowledgeHandlerDeps> = {}): KnowledgeHandlerDeps {
  return {
    listItems: () => [mem('a', ['e1']), mem('b', ['e1'])],
    graph: graphOf({}),
    ...over,
  };
}

describe('handleRelatedMemories', () => {
  it('returns related memories by direct shared entity', () => {
    const out = handleRelatedMemories(deps(), { memoryId: 'a' });
    expect(out.memoryId).toBe('a');
    expect(out.related.map((r) => r.memoryId)).toEqual(['b']);
  });

  it('activates the graph: links a memory whose entity is a graph-neighbor', () => {
    const listItems = () => [mem('a', ['e1']), mem('viaGraph', ['e2']), mem('none', ['e9'])];
    const graph = graphOf({ e1: ['e2'], e2: ['e1'] }); // e1 <-> e2
    const out = handleRelatedMemories(deps({ listItems, graph }), { memoryId: 'a' });
    const ids = out.related.map((r) => r.memoryId);
    expect(ids).toContain('viaGraph');
    expect(ids).not.toContain('none');
  });

  it('queries the graph with the entity id, both directions, and a neighbor limit', () => {
    const neighbors = vi.fn(() => null);
    const graph: KnowledgeGraph = { neighbors };
    handleRelatedMemories(deps({ graph, neighborLimit: 10 }), { memoryId: 'a' });
    expect(neighbors).toHaveBeenCalledWith({ id: 'e1', direction: 'both', limit: 10 });
  });

  it('passes the limit through to relatedMemories', () => {
    // 8 memories share 'e' with src; padding memories keep 'e' rare enough to survive
    // the generic-entity filter, so links actually form and the limit applies.
    const sharers = Array.from({ length: 8 }, (_, i) => mem(`m${i}`, ['e']));
    const padding = Array.from({ length: 15 }, (_, i) => mem(`pad${i}`, [`pad-${i}`]));
    const listItems = () => [mem('src', ['e']), ...sharers, ...padding];
    const out = handleRelatedMemories(deps({ listItems }), { memoryId: 'src', limit: 3 });
    expect(out.related).toHaveLength(3);
  });

  it('tolerates a graph that returns null (no neighbors) — falls back to direct links', () => {
    const listItems = () => [mem('a', ['e1']), mem('b', ['e1'])];
    const graph: KnowledgeGraph = { neighbors: () => null };
    const out = handleRelatedMemories(deps({ listItems, graph }), { memoryId: 'a' });
    expect(out.related.map((r) => r.memoryId)).toEqual(['b']);
  });
});

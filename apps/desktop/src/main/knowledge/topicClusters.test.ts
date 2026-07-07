import { describe, expect, it } from 'vitest';
import { topicClusters } from './topicClusters';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[], over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id, kind: 'context', origin: 'projected', title: id, content: id, connectorId: null,
    source: 'manual', entityRefs, tags: [], occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    evidence: null, metadata: {} as MemoryItem['metadata'], ...over,
  };
}

describe('topicClusters', () => {
  it('groups two memories that share an entity into one topic', () => {
    const clusters = topicClusters([
      mem('a', ['project:apollo']),
      mem('b', ['project:apollo']),
      mem('c', ['project:zephyr']), // alone → excluded (min size 2)
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memoryIds).toEqual(['a', 'b']);
    expect(clusters[0].label).toBe('project:apollo');
    expect(clusters[0].size).toBe(2);
  });

  it('clusters transitively-connected memories (A–B via e1, B–C via e2)', () => {
    const clusters = topicClusters([
      mem('a', ['e1']),
      mem('b', ['e1', 'e2']),
      mem('c', ['e2']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memoryIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0].size).toBe(3);
  });

  it('keeps disjoint groups as separate topics', () => {
    const clusters = topicClusters([
      mem('a1', ['team:alpha']),
      mem('a2', ['team:alpha']),
      mem('b1', ['team:beta']),
      mem('b2', ['team:beta']),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.label).sort()).toEqual(['team:alpha', 'team:beta']);
  });

  it('does not merge everything through an over-generic (hub) entity', () => {
    // 'everywhere' is in all 4 → filtered; 'special' links only a1+a2.
    const clusters = topicClusters([
      mem('a1', ['everywhere', 'special']),
      mem('a2', ['everywhere', 'special']),
      mem('x', ['everywhere']),
      mem('y', ['everywhere']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memoryIds).toEqual(['a1', 'a2']);
    expect(clusters[0].label).toBe('special');
  });

  it('excludes singletons by default and honors minClusterSize', () => {
    const corpus = [mem('a', ['e1']), mem('b', ['e1']), mem('lonely', ['unique'])];
    expect(topicClusters(corpus).map((c) => c.memoryIds)).toEqual([['a', 'b']]);
    expect(topicClusters(corpus, { minClusterSize: 3 })).toEqual([]);
  });

  it('excludes tombstoned memories', () => {
    const clusters = topicClusters([
      mem('a', ['e1']),
      mem('b', ['e1']),
      mem('dead', ['e1'], { sync: { deleted: true } as MemoryItem['sync'] }),
    ]);
    expect(clusters[0].memoryIds).toEqual(['a', 'b']);
  });

  it('reports defining entities most-shared first, capped by maxTopicEntities', () => {
    const clusters = topicClusters(
      [
        mem('a', ['common', 'rareish']),
        mem('b', ['common', 'rareish']),
        mem('c', ['common']),
      ],
      { maxTopicEntities: 1, maxEntityFrequency: 1 },
    );
    // 'common' shared by 3, 'rareish' by 2 → 'common' leads; capped to 1 entity.
    expect(clusters[0].entities).toEqual(['common']);
  });

  it('is deterministic (stable id + sorted output)', () => {
    const corpus = [mem('z', ['e']), mem('a', ['e'])];
    const a = topicClusters(corpus);
    const b = topicClusters(corpus);
    expect(a).toEqual(b);
    expect(a[0].id).toBe('topic:a'); // smallest member id
    expect(a[0].memoryIds).toEqual(['a', 'z']);
  });

  it('returns [] for an empty corpus', () => {
    expect(topicClusters([])).toEqual([]);
  });
});

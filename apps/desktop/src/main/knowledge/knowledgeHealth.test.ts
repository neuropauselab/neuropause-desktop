import { describe, expect, it } from 'vitest';
import { knowledgeHealth } from './knowledgeHealth';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[], over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id, kind: 'context', origin: 'projected', title: id, content: id, connectorId: null,
    source: 'manual', entityRefs, tags: [], occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    evidence: null, metadata: {} as MemoryItem['metadata'], ...over,
  };
}

describe('knowledgeHealth', () => {
  it('returns an all-zero snapshot for an empty corpus', () => {
    expect(knowledgeHealth([])).toMatchObject({ totalMemories: 0, coveragePercent: 0, topicCount: 0 });
  });

  it('reports coverage: memories in topics vs orphans', () => {
    const h = knowledgeHealth([
      mem('a', ['e1']),
      mem('b', ['e1']), // a+b form a topic
      mem('orphan', ['unique']), // no shared entity → orphan
    ]);
    expect(h.totalMemories).toBe(3);
    expect(h.topicCount).toBe(1);
    expect(h.memoriesInTopics).toBe(2);
    expect(h.orphanCount).toBe(1);
    expect(h.coveragePercent).toBe(67); // 2/3
    expect(h.largestTopicSize).toBe(2);
  });

  it('computes entity-link density and memoriesWithEntities', () => {
    const h = knowledgeHealth([
      mem('a', ['e1', 'e2']), // 2 entities
      mem('b', ['e1']), // 1
      mem('c', []), // 0
    ]);
    expect(h.memoriesWithEntities).toBe(2);
    expect(h.avgEntitiesPerMemory).toBe(1); // (2+1+0)/3 = 1.0
  });

  it('excludes tombstoned memories from every metric', () => {
    const h = knowledgeHealth([
      mem('a', ['e1']),
      mem('b', ['e1']),
      mem('dead', ['e1'], { sync: { deleted: true } as MemoryItem['sync'] }),
    ]);
    expect(h.totalMemories).toBe(2);
    expect(h.coveragePercent).toBe(100);
  });

  it('reports 100% coverage when all memories cluster', () => {
    const h = knowledgeHealth([mem('a', ['e1']), mem('b', ['e1']), mem('c', ['e1'])], {
      maxEntityFrequency: 1,
    });
    expect(h.coveragePercent).toBe(100);
    expect(h.orphanCount).toBe(0);
  });
});

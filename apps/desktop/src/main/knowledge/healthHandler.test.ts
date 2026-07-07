import { describe, expect, it } from 'vitest';
import { handleKnowledgeHealth } from './healthHandler';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[]): MemoryItem {
  return {
    id, kind: 'context', origin: 'projected', title: id, content: id, connectorId: null,
    source: 'manual', entityRefs, tags: [], occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    evidence: null, metadata: {} as MemoryItem['metadata'],
  };
}

describe('handleKnowledgeHealth', () => {
  it('returns a health snapshot for the memory set', () => {
    const h = handleKnowledgeHealth({ listItems: () => [mem('a', ['e1']), mem('b', ['e1'])] });
    expect(h).toMatchObject({ totalMemories: 2, topicCount: 1, coveragePercent: 100 });
  });
});

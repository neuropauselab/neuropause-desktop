import { describe, expect, it } from 'vitest';
import { handleTopics } from './topicsHandler';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[]): MemoryItem {
  return {
    id, kind: 'context', origin: 'projected', title: id, content: id, connectorId: null,
    source: 'manual', entityRefs, tags: [], occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    evidence: null, metadata: {} as MemoryItem['metadata'],
  };
}

describe('handleTopics', () => {
  it('returns clustered topics with a total', () => {
    const out = handleTopics({ listItems: () => [mem('a', ['e1']), mem('b', ['e1']), mem('c', ['e2']), mem('d', ['e2'])] });
    expect(out.total).toBe(2);
    expect(out.topics.map((t) => t.label).sort()).toEqual(['e1', 'e2']);
  });
  it('empty corpus → no topics', () => {
    expect(handleTopics({ listItems: () => [] })).toEqual({ topics: [], total: 0 });
  });
});

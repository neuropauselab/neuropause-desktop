import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '@neuropause/shared';
import { rankRecallHits } from './memoryRecallRanking';
import type { RetrievalHit } from './memoryHybridSearch';

const NOW = '2026-07-07T00:00:00.000Z';

function makeItem(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    kind: 'note',
    origin: 'explicit',
    title: `Item ${id}`,
    content: '',
    connectorId: null,
    source: 'test',
    entityRefs: [],
    tags: [],
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    evidence: null,
    metadata: {},
    ...over,
  };
}

function itemLookup(items: MemoryItem[]): (id: string) => MemoryItem | undefined {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id) => map.get(id);
}

const hit = (memoryId: string, score: number): RetrievalHit => ({ memoryId, score });

describe('rankRecallHits — lexical-only (unchanged V7.5 behavior)', () => {
  it('exposes no semanticScore when no semantic hits are supplied', () => {
    const items = [makeItem('a')];
    const [h] = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.9)],
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(h.ranking?.semanticScore).toBeUndefined();
    expect(h.ranking?.lexicalScore).toBe(0.9);
    // No 'semantic' reason in the lexical-only blend (vector weight 0).
    expect(h.ranking?.reasons.some((r) => r.factor === 'semantic')).toBe(false);
  });
});

describe('rankRecallHits — hybrid (V8.2 semantic path)', () => {
  it('carries semanticScore and a semantic reason when semantic hits are supplied', () => {
    const items = [makeItem('a')];
    const [h] = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.8)],
      semanticHits: [hit('a', 0.7)],
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(h.ranking?.lexicalScore).toBe(0.8);
    expect(h.ranking?.semanticScore).toBe(0.7);
    expect(h.ranking?.reasons.some((r) => r.factor === 'semantic')).toBe(true);
    expect(h.ranking?.reasons.some((r) => r.factor === 'keyword')).toBe(true);
  });

  it('includes a semantic-only memory (found by vector, not lexical) with lexicalScore 0', () => {
    const items = [makeItem('a'), makeItem('b')];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.6)],
      semanticHits: [hit('b', 0.95)],
      getItem: itemLookup(items),
      now: NOW,
    });
    const ids = ranked.map((h) => h.item.id).sort();
    expect(ids).toEqual(['a', 'b']);
    const b = ranked.find((h) => h.item.id === 'b');
    expect(b?.ranking?.lexicalScore).toBe(0);
    expect(b?.ranking?.semanticScore).toBe(0.95);
  });

  it('lets a strong semantic match outrank a weak lexical one once the vector weight is live', () => {
    // 'b' has no lexical signal but a near-perfect vector score; 'a' is weak lexical only.
    const items = [makeItem('a'), makeItem('b')];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.2)],
      semanticHits: [hit('b', 1)],
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked[0].item.id).toBe('b');
  });

  it('top-level score stays 0..1 and ranking.score stays 0..100 in the hybrid path', () => {
    const items = [makeItem('a')];
    const [h] = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.8)],
      semanticHits: [hit('a', 0.9)],
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThanOrEqual(1);
    expect(h.ranking!.score).toBeGreaterThan(0);
    expect(h.ranking!.score).toBeLessThanOrEqual(100);
    expect(Math.abs(h.ranking!.score / 100 - h.score)).toBeLessThan(0.01);
  });

  it('respects an explicit weights override', () => {
    const items = [makeItem('a')];
    const [h] = rankRecallHits({
      query: {},
      lexicalHits: [hit('a', 0.5)],
      semanticHits: [hit('a', 0.5)],
      weights: { keyword: 1, vector: 0, recency: 0, importance: 0, pinned: 0 },
      getItem: itemLookup(items),
      now: NOW,
    });
    // vector weighted to 0 → no semantic reason despite a semantic hit being present.
    expect(h.ranking?.reasons.some((r) => r.factor === 'semantic')).toBe(false);
    expect(h.ranking?.semanticScore).toBe(0.5); // sub-score still reported (it was a real hit)
  });
});

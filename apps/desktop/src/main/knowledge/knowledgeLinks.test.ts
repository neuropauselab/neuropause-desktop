import { describe, expect, it } from 'vitest';
import { relatedMemories } from './knowledgeLinks';
import type { MemoryItem } from '@neuropause/shared';

function mem(id: string, entityRefs: string[], over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    kind: 'context',
    origin: 'projected',
    title: id,
    content: id,
    connectorId: null,
    source: 'manual',
    entityRefs,
    tags: [],
    occurredAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    evidence: null,
    metadata: {} as MemoryItem['metadata'],
    ...over,
  };
}

describe('relatedMemories', () => {
  it('links memories that share an entity, and not those that do not', () => {
    const corpus = [
      mem('a', ['project:apollo', 'person:alice']),
      mem('b', ['project:apollo', 'person:bob']), // shares apollo with a
      mem('c', ['project:zephyr']), // shares nothing with a
    ];
    const rel = relatedMemories('a', corpus);
    expect(rel.map((r) => r.memoryId)).toEqual(['b']);
    expect(rel[0].sharedEntities).toEqual(['project:apollo']);
  });

  it('ranks a memory sharing more entities above one sharing fewer', () => {
    const corpus = [
      mem('a', ['e1', 'e2', 'e3']),
      mem('more', ['e1', 'e2']), // shares 2
      mem('less', ['e3', 'x']), // shares 1
    ];
    const rel = relatedMemories('a', corpus);
    expect(rel.map((r) => r.memoryId)).toEqual(['more', 'less']);
    expect(rel[0].score).toBeGreaterThanOrEqual(rel[1].score);
  });

  it('weights rare shared entities above ubiquitous ones', () => {
    // "common" appears in many memories; "rare" in few. Sharing "rare" should rank higher.
    const corpus = [
      mem('src', ['rare', 'common']),
      mem('viaRare', ['rare']),
      mem('viaCommon', ['common']),
      mem('c1', ['common']),
      mem('c2', ['common']),
      mem('c3', ['common']),
    ];
    const rel = relatedMemories('src', corpus, { maxEntityFrequency: 1 }); // don't filter common out
    const byId = Object.fromEntries(rel.map((r) => [r.memoryId, r.score]));
    expect(byId['viaRare']).toBeGreaterThan(byId['viaCommon']);
  });

  it('ignores over-generic entities (shared by too much of the corpus)', () => {
    // "everywhere" is in all 4 memories → filtered by the default frequency cap.
    const corpus = [
      mem('a', ['everywhere', 'special']),
      mem('b', ['everywhere']), // only shares the generic one
      mem('c', ['everywhere', 'special']), // shares the meaningful one too
      mem('d', ['everywhere']),
    ];
    const rel = relatedMemories('a', corpus);
    // b (generic-only) should not appear; c (shares 'special') should.
    expect(rel.map((r) => r.memoryId)).toContain('c');
    expect(rel.map((r) => r.memoryId)).not.toContain('b');
  });

  it('excludes the source and tombstoned memories', () => {
    const corpus = [
      mem('a', ['e1']),
      mem('dead', ['e1'], { sync: { deleted: true } as MemoryItem['sync'] }),
    ];
    expect(relatedMemories('a', corpus)).toEqual([]);
  });

  it('returns [] for an unknown source or a source with no discriminating entities', () => {
    expect(relatedMemories('missing', [mem('a', ['e1'])])).toEqual([]);
    // 'x' is in every memory ⇒ no discriminating entities ⇒ no links.
    const allSame = [mem('a', ['x']), mem('b', ['x']), mem('c', ['x'])];
    expect(relatedMemories('a', allSame)).toEqual([]);
  });

  it('respects the limit', () => {
    const corpus = [mem('src', ['e']), ...Array.from({ length: 20 }, (_, i) => mem(`m${i}`, ['e']))];
    expect(relatedMemories('src', corpus, { limit: 5, maxEntityFrequency: 1 })).toHaveLength(5);
  });

  it('links memories via a graph hop (entity-adjacent, not identical) at reduced weight', () => {
    const corpus = [
      mem('src', ['e1']),
      mem('direct', ['e1']), // shares e1 directly
      mem('viaGraph', ['e2']), // e2 is a graph-neighbor of e1
      mem('unrelated', ['e9']),
    ];
    // Graph: e1 <-> e2.
    const expandEntities = (id: string) => (id === 'e1' ? ['e2'] : id === 'e2' ? ['e1'] : []);
    const rel = relatedMemories('src', corpus, { expandEntities, maxEntityFrequency: 1 });
    const ids = rel.map((r) => r.memoryId);
    expect(ids).toContain('direct');
    expect(ids).toContain('viaGraph'); // now linked through the graph
    expect(ids).not.toContain('unrelated');
    // Direct shared entity outranks a graph-hop match.
    const byId = Object.fromEntries(rel.map((r) => [r.memoryId, r.score]));
    expect(byId['direct']).toBeGreaterThan(byId['viaGraph']);
  });

  it('without expandEntities, behavior is unchanged (graph-adjacent memories do NOT link)', () => {
    const corpus = [mem('src', ['e1']), mem('viaGraph', ['e2'])];
    // No expandEntities passed → e2 never reached → no link (inc1 behavior preserved).
    expect(relatedMemories('src', corpus, { maxEntityFrequency: 1 })).toEqual([]);
  });

});

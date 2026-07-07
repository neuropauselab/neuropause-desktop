import { describe, expect, it } from 'vitest';
import { rankMemories } from './memoryRanking';
import {
  mergeRetrievalCandidates,
  relatedMemories,
  type CandidateMetadata,
  type RetrievalHit,
} from './memoryHybridSearch';

const NOW = '2026-07-06T00:00:00.000Z';

function meta(over: Partial<CandidateMetadata> = {}): CandidateMetadata {
  return { timestamp: NOW, scope: 'organization', orgId: 'org-1', deleted: false, ...over };
}

function lookupFrom(map: Record<string, CandidateMetadata>) {
  return (id: string): CandidateMetadata | null => map[id] ?? null;
}

describe('mergeRetrievalCandidates', () => {
  it('deduplicates a memory found by both retrievers, keeping both scores', () => {
    const out = mergeRetrievalCandidates(
      [{ memoryId: 'a', score: 0.8 }],
      [{ memoryId: 'a', score: 0.6 }],
      lookupFrom({ a: meta() }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].keywordScore).toBe(0.8);
    expect(out[0].vectorScore).toBe(0.6);
  });

  it('lexical-only hit leaves vectorScore undefined (absent, not zero)', () => {
    const out = mergeRetrievalCandidates(
      [{ memoryId: 'a', score: 0.8 }],
      [],
      lookupFrom({ a: meta() }),
    );
    expect(out[0].keywordScore).toBe(0.8);
    expect(out[0].vectorScore).toBeUndefined();
  });

  it('semantic-only hit gets keywordScore 0 and the vector score', () => {
    const out = mergeRetrievalCandidates(
      [],
      [{ memoryId: 'a', score: 0.7 }],
      lookupFrom({ a: meta() }),
    );
    expect(out[0].keywordScore).toBe(0);
    expect(out[0].vectorScore).toBe(0.7);
  });

  it('skips memories the lookup cannot resolve', () => {
    const out = mergeRetrievalCandidates([{ memoryId: 'gone', score: 0.9 }], [], lookupFrom({}));
    expect(out).toHaveLength(0);
  });

  it('attaches metadata (timestamp, scope, org, deleted, pinned)', () => {
    const out = mergeRetrievalCandidates(
      [{ memoryId: 'a', score: 0.5 }],
      [],
      lookupFrom({ a: meta({ pinned: true, project: 'alpha', deleted: false }) }),
    );
    expect(out[0]).toMatchObject({
      scope: 'organization',
      orgId: 'org-1',
      pinned: true,
      project: 'alpha',
    });
  });

  it('with no semantic hits, produces exactly the lexical set (fallback path)', () => {
    const out = mergeRetrievalCandidates(
      [
        { memoryId: 'a', score: 0.5 },
        { memoryId: 'b', score: 0.3 },
      ],
      [],
      lookupFrom({ a: meta(), b: meta() }),
    );
    expect(out.map((c) => c.memoryId).sort()).toEqual(['a', 'b']);
  });

  it('merged candidates feed rankMemories and rank correctly', () => {
    const candidates = mergeRetrievalCandidates(
      [{ memoryId: 'kw', score: 0.9 }],
      [{ memoryId: 'sem', score: 0.9 }],
      lookupFrom({ kw: meta(), sem: meta() }),
    );
    const ranked = rankMemories({ now: NOW }, candidates);
    expect(ranked).toHaveLength(2);
    // keyword weight (.45) > vector weight (.35), so the keyword-only hit ranks first.
    expect(ranked[0].memoryId).toBe('kw');
  });

  it('a deleted memory surfaced by retrieval is dropped by rankMemories downstream', () => {
    const candidates = mergeRetrievalCandidates(
      [{ memoryId: 'dead', score: 0.9 }],
      [],
      lookupFrom({ dead: meta({ deleted: true }) }),
    );
    // merge keeps it (metadata resolved), but ranking never returns deleted.
    expect(rankMemories({ now: NOW }, candidates)).toHaveLength(0);
  });
});

describe('relatedMemories', () => {
  const neighbors: RetrievalHit[] = [
    { memoryId: 'self', score: 1.0 },
    { memoryId: 'strong', score: 0.92 },
    { memoryId: 'mid', score: 0.7 },
    { memoryId: 'weak', score: 0.4 },
  ];

  it('excludes the target itself and sub-threshold neighbors', () => {
    const out = relatedMemories('self', neighbors);
    const ids = out.map((r) => r.memoryId);
    expect(ids).not.toContain('self');
    expect(ids).not.toContain('weak'); // 0.4 < default 0.5
    expect(ids).toEqual(['strong', 'mid']);
  });

  it('orders by similarity descending and reports percent + reason', () => {
    const out = relatedMemories('self', neighbors);
    expect(out[0]).toMatchObject({ memoryId: 'strong', similarityPercent: 92 });
    expect(out[0].reason).toBe('very strong semantic similarity');
    expect(out[1].reason).toBe('moderate semantic similarity');
  });

  it('respects the limit', () => {
    expect(relatedMemories('self', neighbors, { limit: 1 }).map((r) => r.memoryId)).toEqual([
      'strong',
    ]);
  });

  it('excludes deleted neighbors when a lookup is provided', () => {
    const out = relatedMemories('self', neighbors, {
      memoryLookup: lookupFrom({ strong: meta({ deleted: true }), mid: meta() }),
    });
    expect(out.map((r) => r.memoryId)).toEqual(['mid']);
  });

  it('enforces organization isolation', () => {
    const out = relatedMemories('self', neighbors, {
      organizationId: 'org-1',
      memoryLookup: lookupFrom({ strong: meta({ orgId: 'org-2' }), mid: meta({ orgId: 'org-1' }) }),
    });
    expect(out.map((r) => r.memoryId)).toEqual(['mid']);
  });

  it('is deterministic on tied similarity (memoryId order)', () => {
    const tied: RetrievalHit[] = [
      { memoryId: 'zzz', score: 0.8 },
      { memoryId: 'aaa', score: 0.8 },
    ];
    expect(relatedMemories('t', tied).map((r) => r.memoryId)).toEqual(['aaa', 'zzz']);
  });
});

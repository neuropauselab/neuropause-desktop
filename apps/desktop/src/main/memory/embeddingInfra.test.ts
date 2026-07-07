import { describe, expect, it } from 'vitest';
import {
  isEmbeddingStale,
  selectStaleMemories,
  type EmbeddingMetadata,
  type EmbeddingVersion,
} from './embedding';
import { cosineSimilarity, createInMemoryVectorStore, type Embedding } from './vectorStore';
import { semanticSearch, type SemanticRetrieverDeps } from './semanticRetriever';
import { mergeRetrievalCandidates, type CandidateMetadata } from './memoryHybridSearch';
import { rankMemories } from './memoryRanking';

const V1: EmbeddingVersion = { model: 'stub:v1', dimensions: 3, revision: 1 };
const V2: EmbeddingVersion = { model: 'stub:v1', dimensions: 3, revision: 2 };

function stored(over: Partial<EmbeddingMetadata> = {}): EmbeddingMetadata {
  return {
    memoryId: 'm1',
    orgId: 'org-1',
    contentHash: 'hash-1',
    version: V1,
    embeddedAt: '2026-07-06T00:00:00.000Z',
    ...over,
  };
}

describe('embedding staleness (V6.9 STEP 6)', () => {
  it('is stale when never embedded', () => {
    expect(isEmbeddingStale(null, 'hash-1', V1)).toBe(true);
  });
  it('is stale when content changed', () => {
    expect(isEmbeddingStale(stored(), 'hash-2', V1)).toBe(true);
  });
  it('is stale when the model version moved', () => {
    expect(isEmbeddingStale(stored(), 'hash-1', V2)).toBe(true);
  });
  it('is fresh when content and version match', () => {
    expect(isEmbeddingStale(stored(), 'hash-1', V1)).toBe(false);
  });
  it('selectStaleMemories returns only the stale ids', () => {
    const map = new Map<string, EmbeddingMetadata>([
      ['fresh', stored({ memoryId: 'fresh', contentHash: 'h' })],
      ['changed', stored({ memoryId: 'changed', contentHash: 'old' })],
    ]);
    const out = selectStaleMemories(
      [
        { memoryId: 'fresh', contentHash: 'h' },
        { memoryId: 'changed', contentHash: 'new' },
        { memoryId: 'never', contentHash: 'x' },
      ],
      map,
      V1,
    );
    expect(out.sort()).toEqual(['changed', 'never']);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('clamps opposite vectors to 0', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });
  it('is 0 for mismatched dimensions or empty', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('InMemoryVectorStore', () => {
  const A: Embedding = [1, 0, 0];
  const B: Embedding = [0.9, 0.1, 0];
  const C: Embedding = [0, 1, 0];

  it('upserts and searches by similarity', async () => {
    const store = createInMemoryVectorStore();
    await store.batchUpsert([
      { id: 'a', orgId: 'org-1', vector: A },
      { id: 'b', orgId: 'org-1', vector: B },
      { id: 'c', orgId: 'org-1', vector: C },
    ]);
    const out = await store.search(A, { orgId: 'org-1', topK: 2 });
    expect(out.map((r) => r.id)).toEqual(['a', 'b']); // a exact, b close
  });

  it('enforces organization isolation', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert({ id: 'mine', orgId: 'org-1', vector: A });
    await store.upsert({ id: 'theirs', orgId: 'org-2', vector: A });
    const out = await store.search(A, { orgId: 'org-1', topK: 10 });
    expect(out.map((r) => r.id)).toEqual(['mine']);
  });

  it('excludes deleted vectors by default, includes them on request', async () => {
    const store = createInMemoryVectorStore();
    await store.upsert({ id: 'live', orgId: 'org-1', vector: A });
    await store.upsert({ id: 'dead', orgId: 'org-1', vector: B, deleted: true });
    expect((await store.search(A, { orgId: 'org-1', topK: 10 })).map((r) => r.id)).toEqual([
      'live',
    ]);
    expect(
      (await store.search(A, { orgId: 'org-1', topK: 10, includeDeleted: true }))
        .map((r) => r.id)
        .sort(),
    ).toEqual(['dead', 'live']);
  });

  it('respects topK and is deterministic on ties', async () => {
    const store = createInMemoryVectorStore();
    await store.batchUpsert([
      { id: 'zzz', orgId: 'org-1', vector: A },
      { id: 'aaa', orgId: 'org-1', vector: A },
    ]);
    const out = await store.search(A, { orgId: 'org-1', topK: 5 });
    expect(out.map((r) => r.id)).toEqual(['aaa', 'zzz']); // equal score → id asc
  });

  it('delete removes a vector; stats report counts', async () => {
    const store = createInMemoryVectorStore();
    await store.batchUpsert([
      { id: 'a', orgId: 'org-1', vector: A },
      { id: 'b', orgId: 'org-2', vector: B },
    ]);
    await store.delete('a', 'org-1');
    const stats = await store.stats();
    expect(stats.vectors).toBe(1);
    expect(stats.orgs).toBe(1);
    expect((await store.health()).ok).toBe(true);
  });
});

describe('semanticSearch + full pipeline', () => {
  const vectors: Record<string, Embedding> = {
    'roadmap query': [1, 0, 0],
    unrelated: [0, 0, 1],
  };
  const deps: SemanticRetrieverDeps = {
    embeddingService: { embed: async (t: string) => vectors[t] ?? [0, 0, 0] },
    vectorStore: createInMemoryVectorStore(),
  };

  async function seed(): Promise<void> {
    const store = deps.vectorStore as ReturnType<typeof createInMemoryVectorStore>;
    await store.batchUpsert([
      { id: 'roadmap', orgId: 'org-1', vector: [1, 0, 0] },
      { id: 'sideChat', orgId: 'org-1', vector: [0.2, 0.1, 0.9] },
    ]);
  }

  it('returns [] for an empty query without embedding', async () => {
    expect(await semanticSearch(deps, { text: '   ', orgId: 'org-1' })).toEqual([]);
  });

  it('embeds, searches, and returns semantic hits scoped to the org', async () => {
    await seed();
    const hits = await semanticSearch(deps, { text: 'roadmap query', orgId: 'org-1', topK: 5 });
    expect(hits[0].memoryId).toBe('roadmap');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('flows end-to-end: semantic hits → merge with lexical → rankMemories', async () => {
    await seed();
    const semantic = await semanticSearch(deps, { text: 'roadmap query', orgId: 'org-1', topK: 5 });
    const lexical = [{ memoryId: 'roadmap', score: 0.8 }];
    const meta = (id: string): CandidateMetadata => ({
      timestamp: '2026-07-06T00:00:00.000Z',
      scope: 'organization',
      orgId: 'org-1',
      deleted: false,
      // mark sideChat deleted to prove filtering through the whole chain
      ...(id === 'sideChat' ? { deleted: true } : {}),
    });
    const candidates = mergeRetrievalCandidates(lexical, semantic, meta);
    const ranked = rankMemories({ now: '2026-07-06T00:00:00.000Z' }, candidates);
    expect(ranked[0].memoryId).toBe('roadmap'); // found by both, ranks top
    expect(ranked.map((r) => r.memoryId)).not.toContain('sideChat'); // deleted, filtered
  });
});

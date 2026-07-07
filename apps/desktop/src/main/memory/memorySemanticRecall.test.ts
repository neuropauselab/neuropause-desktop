import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '@neuropause/shared';
import { hybridRecall, localSemanticSearch } from './memorySemanticRecall';
import { createInMemoryVectorStore, type Embedding } from './vectorStore';
import type { EmbeddingService } from './embedding';
import type { RetrievalHit } from './memoryHybridSearch';

const NOW = '2026-07-07T00:00:00.000Z';
const ORG = 'org-1';

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
    sync: { orgId: ORG, deleted: false } as MemoryItem['sync'],
    ...over,
  };
}

function itemLookup(items: MemoryItem[]): (id: string) => MemoryItem | undefined {
  const map = new Map(items.map((i) => [i.id, i]));
  return (id) => map.get(id);
}

/** Deterministic stub embedder: returns the vector registered for a phrase. */
function stubEmbedder(table: Record<string, Embedding>): EmbeddingService {
  const version = { model: 'stub', dimensions: 3, revision: 1 };
  const embed = async (text: string): Promise<Embedding> => table[text] ?? [0, 0, 0];
  return { version, embed, embedBatch: async (ts) => ts.map((t) => table[t] ?? [0, 0, 0]) };
}

const hit = (memoryId: string, score: number): RetrievalHit => ({ memoryId, score });

describe('hybridRecall — semantic activation (V8.2)', () => {
  it('degrades to lexical-only when no semantic deps are provided', async () => {
    const items = [makeItem('a')];
    const hits = await hybridRecall(
      {},
      { text: 'anything', orgId: ORG, limit: 10, lexicalHits: [hit('a', 0.9)], getItem: itemLookup(items), now: NOW },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].ranking?.semanticScore).toBeUndefined();
  });

  it('degrades to lexical-only when orgId is absent (personal-only recall)', async () => {
    const items = [makeItem('a')];
    const vectorStore = createInMemoryVectorStore();
    await vectorStore.upsert({ id: 'a', orgId: ORG, vector: [1, 0, 0] });
    const hits = await hybridRecall(
      { searchSemantic: localSemanticSearch({ embeddingService: stubEmbedder({ q: [1, 0, 0] }), vectorStore }) },
      { text: 'q', orgId: undefined, limit: 10, lexicalHits: [hit('a', 0.5)], getItem: itemLookup(items), now: NOW },
    );
    expect(hits[0].ranking?.semanticScore).toBeUndefined();
  });

  it('blends real semantic hits: a vector-only match surfaces with its cosine as semanticScore', async () => {
    const items = [makeItem('a'), makeItem('b')];
    const vectorStore = createInMemoryVectorStore();
    await vectorStore.batchUpsert([
      { id: 'a', orgId: ORG, vector: [1, 0, 0] },
      { id: 'b', orgId: ORG, vector: [0, 1, 0] },
    ]);
    // Query embeds parallel to 'b' → strong semantic match on 'b', which has no lexical hit.
    const searchSemantic = localSemanticSearch({ embeddingService: stubEmbedder({ 'find b': [0, 1, 0] }), vectorStore });
    const hits = await hybridRecall(
      { searchSemantic },
      { text: 'find b', orgId: ORG, limit: 10, lexicalHits: [hit('a', 0.3)], getItem: itemLookup(items), now: NOW },
    );
    const ids = hits.map((h) => h.item.id).sort();
    expect(ids).toEqual(['a', 'b']);
    const b = hits.find((h) => h.item.id === 'b');
    expect(b?.ranking?.semanticScore).toBeCloseTo(1, 5);
    expect(b?.ranking?.reasons.some((r) => r.factor === 'semantic')).toBe(true);
  });

  it('enforces org isolation: another org’s vectors never surface', async () => {
    const items = [makeItem('a')];
    const vectorStore = createInMemoryVectorStore();
    await vectorStore.batchUpsert([
      { id: 'a', orgId: ORG, vector: [1, 0, 0] },
      { id: 'secret', orgId: 'org-2', vector: [1, 0, 0] }, // perfect match, WRONG org
    ]);
    const searchSemantic = localSemanticSearch({ embeddingService: stubEmbedder({ q: [1, 0, 0] }), vectorStore });
    const hits = await hybridRecall(
      { searchSemantic },
      { text: 'q', orgId: ORG, limit: 10, lexicalHits: [], getItem: itemLookup(items), now: NOW },
    );
    // Only org-1's 'a' can appear; 'secret' from org-2 must not.
    expect(hits.every((h) => h.item.id !== 'secret')).toBe(true);
    expect(hits.map((h) => h.item.id)).toEqual(['a']);
  });

  it('a strong semantic match outranks a weak lexical-only one', async () => {
    const items = [makeItem('a'), makeItem('b')];
    const vectorStore = createInMemoryVectorStore();
    await vectorStore.upsert({ id: 'b', orgId: ORG, vector: [1, 0, 0] });
    const searchSemantic = localSemanticSearch({ embeddingService: stubEmbedder({ q: [1, 0, 0] }), vectorStore });
    const hits = await hybridRecall(
      { searchSemantic },
      { text: 'q', orgId: ORG, limit: 10, lexicalHits: [hit('a', 0.2)], getItem: itemLookup(items), now: NOW },
    );
    expect(hits[0].item.id).toBe('b');
  });
});

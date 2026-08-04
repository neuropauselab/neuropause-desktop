import { describe, expect, it, vi } from 'vitest';
import type { SemanticOutcome } from '@neuropause/shared';
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

describe('hybridRecall — outcome reporting (A6)', () => {
  const ITEMS = [makeItem('a')];

  /** Run a recall, collecting every outcome the orchestrator reported. */
  async function reportedOutcomes(
    deps: Parameters<typeof hybridRecall>[0],
    over: Partial<Parameters<typeof hybridRecall>[1]> = {},
  ): Promise<SemanticOutcome[]> {
    const seen: SemanticOutcome[] = [];
    await hybridRecall(deps, {
      text: 'q',
      orgId: ORG,
      limit: 10,
      lexicalHits: [hit('a', 0.5)],
      getItem: itemLookup(ITEMS),
      now: NOW,
      onSemanticOutcome: (o) => seen.push(o),
      ...over,
    });
    return seen;
  }

  it('reports not_configured rather than silently returning a lexical answer', async () => {
    expect(await reportedOutcomes({})).toEqual([{ state: 'skipped', reason: 'not_configured' }]);
  });

  it('reports no_org when the personal-only path skips semantic', async () => {
    const seen = await reportedOutcomes({ searchSemantic: async () => [] }, { orgId: undefined });
    expect(seen).toEqual([{ state: 'skipped', reason: 'no_org' }]);
  });

  it('reports no_query_text for a whitespace-only query', async () => {
    const seen = await reportedOutcomes({ searchSemantic: async () => [] }, { text: '  ' });
    expect(seen).toEqual([{ state: 'skipped', reason: 'no_query_text' }]);
  });

  it('does not call the source at all when it decides to skip', async () => {
    const searchSemantic = vi.fn(async () => []);
    await reportedOutcomes({ searchSemantic }, { orgId: undefined });
    expect(searchSemantic).not.toHaveBeenCalled();
  });

  it('forwards the source’s own verdict verbatim — the source measured it, not this frame', async () => {
    const outcome: SemanticOutcome = {
      state: 'failed',
      kind: 'timeout',
      retryable: true,
      code: 'timeout',
      detail: 'deadline elapsed',
      latencyMs: 4_000,
    };
    const seen = await reportedOutcomes({
      searchSemantic: async (_q, options) => {
        options?.onOutcome?.(outcome);
        return [];
      },
    });
    expect(seen).toEqual([outcome]);
  });

  it('synthesises an ok outcome for a pre-A6 source that ignores the options argument', async () => {
    // `localSemanticSearch` and every other one-parameter source predates the
    // options bag. It still returned, and the hit count and elapsed time are both
    // known here, so "reported exactly once" holds for old sources too.
    const seen = await reportedOutcomes({
      searchSemantic: async () => [hit('a', 0.8), hit('b', 0.4)],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ state: 'ok', hits: 2 });
    expect(seen[0].state === 'ok' ? seen[0].latencyMs : -1).toBeGreaterThanOrEqual(0);
  });

  it('reports exactly once even when the source also reports', async () => {
    const seen = await reportedOutcomes({
      searchSemantic: async (_q, options) => {
        options?.onOutcome?.({ state: 'ok', hits: 1, latencyMs: 5 });
        return [hit('a', 0.9)];
      },
    });
    expect(seen).toEqual([{ state: 'ok', hits: 1, latencyMs: 5 }]);
  });

  it('lets a source failure propagate — absorbing it is the store’s job, not the orchestrator’s', async () => {
    const seen: SemanticOutcome[] = [];
    await expect(
      hybridRecall(
        {
          searchSemantic: async () => {
            throw new Error('backend 503');
          },
        },
        {
          text: 'q',
          orgId: ORG,
          limit: 10,
          lexicalHits: [hit('a', 0.5)],
          getItem: itemLookup(ITEMS),
          now: NOW,
          onSemanticOutcome: (o) => seen.push(o),
        },
      ),
    ).rejects.toThrow('backend 503');
    // The source never reported, and the orchestrator does not invent a verdict
    // for a call that did not return — classification belongs to the catch.
    expect(seen).toEqual([]);
  });

  it('stays exactly as it was pre-A6 when no observer is supplied', async () => {
    const hits = await hybridRecall(
      { searchSemantic: async () => [hit('a', 0.9)] },
      { text: 'q', orgId: ORG, limit: 10, lexicalHits: [hit('a', 0.5)], getItem: itemLookup(ITEMS), now: NOW },
    );
    expect(hits.map((h) => h.item.id)).toEqual(['a']);
  });
});

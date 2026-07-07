import { describe, expect, it, vi } from 'vitest';
import { backfillOrgMemories, BackfillError, type BackfillDeps } from './backfillService';
import type { VectorRecord } from '../qdrant/qdrantTypes';
import type { EmbeddingVersion } from '../embedding/embeddingTypes';

const VERSION: EmbeddingVersion = { model: 'nomic-embed-text', dimensions: 3, revision: 1 };

function deps(over: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    embeddingProvider: { version: VERSION, embed: vi.fn(async () => [1, 0, 0]) },
    vectorStore: { batchUpsert: vi.fn(async () => {}) },
    stateRepo: { getMany: vi.fn(async () => new Map()), record: vi.fn(async () => {}) },
    getMemberRole: vi.fn(async () => 'member'),
    ...over,
  };
}

const input = {
  orgId: 'org-1',
  userId: 'user-1',
  memories: [
    { memoryId: 'm1', content: 'alpha' },
    { memoryId: 'm2', content: 'beta' },
  ],
};

describe('backfillOrgMemories — authorization', () => {
  it('rejects a non-member BEFORE embedding anything', async () => {
    const d = deps({ getMemberRole: vi.fn(async () => null) });
    await expect(backfillOrgMemories(d, input)).rejects.toMatchObject({ code: 'not_member' });
    expect(d.embeddingProvider.embed).not.toHaveBeenCalled();
    expect(d.vectorStore.batchUpsert).not.toHaveBeenCalled();
  });
});

describe('backfillOrgMemories — validation', () => {
  it('rejects an empty batch', async () => {
    await expect(backfillOrgMemories(deps(), { ...input, memories: [] })).rejects.toBeInstanceOf(BackfillError);
  });
});

describe('backfillOrgMemories — embedding via the pipeline', () => {
  it('embeds provided memories and reports pipeline results', async () => {
    const d = deps();
    const result = await backfillOrgMemories(d, input);
    expect(result).toMatchObject({ processed: 2, embedded: 2, skipped: 0, failed: 0 });
    expect(d.embeddingProvider.embed).toHaveBeenCalledTimes(2);
    expect(d.vectorStore.batchUpsert).toHaveBeenCalledTimes(1);
  });

  it('stamps the VERIFIED path org on every upserted vector (isolation)', async () => {
    let captured: VectorRecord[] = [];
    const d = deps({ vectorStore: { batchUpsert: vi.fn(async (recs: VectorRecord[]) => { captured = recs; }) } });
    await backfillOrgMemories(d, input);
    expect(captured.map((r) => r.orgId)).toEqual(['org-1', 'org-1']);
    expect(captured.map((r) => r.id)).toEqual(['m1', 'm2']);
  });

  it('skips already-embedded memories on a second run (idempotent)', async () => {
    // Shared state repo across two runs.
    const store = new Map();
    const stateRepo = {
      getMany: vi.fn(async (ids: string[]) => {
        const out = new Map();
        for (const id of ids) if (store.has(id)) out.set(id, store.get(id));
        return out;
      }),
      record: vi.fn(async (s: { memoryId: string }) => {
        store.set(s.memoryId, s);
      }),
    };
    const d1 = deps({ stateRepo });
    await backfillOrgMemories(d1, input); // first run embeds both

    const embed2 = vi.fn(async () => [1, 0, 0]);
    const d2 = deps({ stateRepo, embeddingProvider: { version: VERSION, embed: embed2 } });
    const result = await backfillOrgMemories(d2, input);
    expect(result).toMatchObject({ embedded: 0, skipped: 2 });
    expect(embed2).not.toHaveBeenCalled();
  });

  it('drops memories with blank content before embedding', async () => {
    const d = deps();
    const result = await backfillOrgMemories(d, {
      ...input,
      memories: [{ memoryId: 'm1', content: 'ok' }, { memoryId: 'm2', content: '   ' }],
    });
    expect(result.processed).toBe(1);
    expect(d.embeddingProvider.embed).toHaveBeenCalledTimes(1);
  });
});

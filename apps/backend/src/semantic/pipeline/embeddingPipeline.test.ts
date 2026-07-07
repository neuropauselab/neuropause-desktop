import { describe, expect, it, vi } from 'vitest';
import {
  embeddingContentHash,
  embeddingVersionKey,
  runEmbeddingPipeline,
  type EmbeddingPipelineDeps,
  type EmbeddingState,
  type MemorySource,
} from './embeddingPipeline';
import type { EmbeddingVersion } from '../embedding/embeddingTypes';

const VERSION: EmbeddingVersion = { model: 'nomic-embed-text', dimensions: 3, revision: 1 };
const VKEY = embeddingVersionKey(VERSION);

/** In-memory state repo mirroring the real repository's contract. */
function memRepo(seed: EmbeddingState[] = []) {
  const store = new Map<string, EmbeddingState>(seed.map((s) => [s.memoryId, s]));
  return {
    store,
    getMany: vi.fn(async (ids: string[]) => {
      const out = new Map<string, EmbeddingState>();
      for (const id of ids) {
        const s = store.get(id);
        if (s) out.set(id, s);
      }
      return out;
    }),
    record: vi.fn(async (s: EmbeddingState) => {
      store.set(s.memoryId, s);
    }),
  };
}

function deps(over: Partial<EmbeddingPipelineDeps> = {}): EmbeddingPipelineDeps {
  return {
    embeddingProvider: { version: VERSION, embed: vi.fn(async () => [1, 0, 0]) },
    vectorStore: { batchUpsert: vi.fn(async () => {}) },
    stateRepo: memRepo(),
    ...over,
  };
}

function mem(id: string, content: string, orgId = 'org-1'): MemorySource {
  return { id, orgId, content };
}

describe('embeddingContentHash', () => {
  it('is stable for the same content + version and changes when content changes', () => {
    const a = embeddingContentHash('hello', VKEY);
    expect(embeddingContentHash('hello', VKEY)).toBe(a);
    expect(embeddingContentHash('hello!', VKEY)).not.toBe(a);
  });

  it('changes when the embedding version changes (forces re-embed)', () => {
    expect(embeddingContentHash('hello', 'm@1')).not.toBe(embeddingContentHash('hello', 'm@2'));
  });
});

describe('runEmbeddingPipeline — idempotency', () => {
  it('embeds new memories and records their state', async () => {
    const d = deps();
    const r = await runEmbeddingPipeline(d, [mem('a', 'x'), mem('b', 'y')]);
    expect(r).toMatchObject({ processed: 2, embedded: 2, skipped: 0, failed: 0 });
    expect(d.embeddingProvider.embed).toHaveBeenCalledTimes(2);
    expect(d.vectorStore.batchUpsert).toHaveBeenCalledTimes(1); // one batch
  });

  it('skips unchanged memories (re-run is a no-op)', async () => {
    const memories = [mem('a', 'x'), mem('b', 'y')];
    const stateRepo = memRepo();
    const d = deps({ stateRepo });
    await runEmbeddingPipeline(d, memories); // first run embeds

    const embed2 = vi.fn(async () => [1, 0, 0]);
    const upsert2 = vi.fn(async () => {});
    const r = await runEmbeddingPipeline(
      { embeddingProvider: { version: VERSION, embed: embed2 }, vectorStore: { batchUpsert: upsert2 }, stateRepo },
      memories,
    );
    expect(r).toMatchObject({ embedded: 0, skipped: 2, failed: 0 });
    expect(embed2).not.toHaveBeenCalled(); // nothing re-embedded
    expect(upsert2).not.toHaveBeenCalled();
  });

  it('re-embeds a memory whose content changed', async () => {
    const stateRepo = memRepo();
    await runEmbeddingPipeline(deps({ stateRepo }), [mem('a', 'original')]);
    const embed2 = vi.fn(async () => [0, 1, 0]);
    const r = await runEmbeddingPipeline(
      { embeddingProvider: { version: VERSION, embed: embed2 }, vectorStore: { batchUpsert: vi.fn(async () => {}) }, stateRepo },
      [mem('a', 'CHANGED')],
    );
    expect(r).toMatchObject({ embedded: 1, skipped: 0 });
    expect(embed2).toHaveBeenCalledTimes(1);
  });
});

describe('runEmbeddingPipeline — resumability', () => {
  it('skips memories already recorded (a crash mid-run resumes on the rest)', async () => {
    // Pretend 'a' was embedded before a crash: seed its state with the matching hash.
    const stateRepo = memRepo([
      { memoryId: 'a', orgId: 'org-1', contentHash: embeddingContentHash('x', VKEY), embeddingVersion: VKEY, embeddedAt: '2026-01-01T00:00:00Z' },
    ]);
    const embed = vi.fn(async () => [1, 0, 0]);
    const r = await runEmbeddingPipeline(
      { embeddingProvider: { version: VERSION, embed }, vectorStore: { batchUpsert: vi.fn(async () => {}) }, stateRepo },
      [mem('a', 'x'), mem('b', 'y')],
    );
    expect(r).toMatchObject({ embedded: 1, skipped: 1 }); // only 'b' is new
    expect(embed).toHaveBeenCalledTimes(1);
  });
});

describe('runEmbeddingPipeline — resilience + batching', () => {
  it('isolates a single embed failure and keeps processing', async () => {
    const embed = vi.fn(async (text: string) => {
      if (text === 'boom') throw new Error('provider down');
      return [1, 0, 0];
    });
    const r = await runEmbeddingPipeline(
      { embeddingProvider: { version: VERSION, embed }, vectorStore: { batchUpsert: vi.fn(async () => {}) }, stateRepo: memRepo() },
      [mem('a', 'ok'), mem('b', 'boom'), mem('c', 'ok')],
    );
    expect(r).toMatchObject({ processed: 3, embedded: 2, failed: 1 });
    expect(r.errors[0]).toMatchObject({ memoryId: 'b' });
  });

  it('does not record state when the upsert fails (so items retry next run)', async () => {
    const stateRepo = memRepo();
    const r = await runEmbeddingPipeline(
      {
        embeddingProvider: { version: VERSION, embed: vi.fn(async () => [1, 0, 0]) },
        vectorStore: { batchUpsert: vi.fn(async () => { throw new Error('qdrant down'); }) },
        stateRepo,
      },
      [mem('a', 'x')],
    );
    expect(r).toMatchObject({ embedded: 0, failed: 1 });
    expect(stateRepo.record).not.toHaveBeenCalled();
    expect(stateRepo.store.size).toBe(0);
  });

  it('processes in batches and reports progress per batch', async () => {
    const progress: number[] = [];
    await runEmbeddingPipeline(deps(), [mem('a', '1'), mem('b', '2'), mem('c', '3'), mem('d', '4'), mem('e', '5')], {
      batchSize: 2,
      onProgress: (p) => progress.push(p.processed),
    });
    // 5 items, batch 2 ⇒ batches of 2,2,1 ⇒ progress after each: 2,4,5
    expect(progress).toEqual([2, 4, 5]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { semanticHealth, type SemanticHealthDeps } from './semanticHealthService';
import { EmbeddingError, type EmbeddingVersion } from '../embedding/embeddingTypes';
import { QdrantError } from '../qdrant/qdrantTypes';

const VERSION: EmbeddingVersion = { model: 'nomic-embed-text', dimensions: 768, revision: 1 };

function deps(over: Partial<SemanticHealthDeps> = {}): SemanticHealthDeps {
  return {
    embeddingProvider: { version: VERSION, embed: vi.fn(async () => [1, 0, 0]) },
    vectorStore: { health: vi.fn(async () => ({ ok: true })) },
    getCoverage: vi.fn(async () => ({ embedded: 8, total: 10 })),
    ...over,
  };
}

describe('semanticHealth', () => {
  it('reports healthy when provider + vector store are both reachable', async () => {
    const out = await semanticHealth(deps(), 'org-1');
    expect(out.healthy).toBe(true);
    expect(out.provider).toMatchObject({ ok: true, model: 'nomic-embed-text', dimensions: 768 });
    expect(out.vectorStore.ok).toBe(true);
    expect(out.coverage).toEqual({ embedded: 8, total: 10, percent: 80 });
  });

  it('marks unhealthy and classifies the error when the provider is down (but still probes the rest)', async () => {
    // A6: `error` is the failure's stable code, not its message. This response is
    // served to any org member, and the provider's messages are built as
    // `HTTP ${status} from ${url}: ${detail}` (embeddingHttp.ts) — the raw text
    // carries the embedding host and the upstream body.
    const d = deps({
      embeddingProvider: {
        version: VERSION,
        embed: vi.fn(async () => {
          throw new EmbeddingError(
            'provider_unavailable',
            'Request to http://ollama.internal:11434/api/embeddings failed: ECONNREFUSED',
            { retryable: true },
          );
        }),
      },
    });
    const out = await semanticHealth(d, 'org-1');
    expect(out.provider).toMatchObject({ ok: false, error: 'provider_unavailable' });
    expect(JSON.stringify(out)).not.toContain('ollama.internal');
    expect(out.vectorStore.ok).toBe(true); // isolated — still checked
    expect(out.healthy).toBe(false);
  });

  it('hands the raw failure to onProbeFailure, so the detail reaches an operator', async () => {
    // The classification above is only safe because the detail is not simply
    // discarded; without this the endpoint would be a quieter silent failure.
    const upstream = new EmbeddingError('provider_timeout', 'Request to http://ollama.internal:11434 timed out');
    const onProbeFailure = vi.fn();
    const d = deps({
      embeddingProvider: { version: VERSION, embed: vi.fn(async () => { throw upstream; }) },
      onProbeFailure,
    });
    await semanticHealth(d, 'org-1');
    expect(onProbeFailure).toHaveBeenCalledWith('provider', upstream);
  });

  it('falls back to a generic code for a failure that carries none', async () => {
    const d = deps({ embeddingProvider: { version: VERSION, embed: vi.fn(async () => { throw new Error('ollama down'); }) } });
    const out = await semanticHealth(d, 'org-1');
    expect(out.provider.error).toBe('probe_failed');
  });

  it('marks unhealthy when Qdrant is unreachable', async () => {
    const d = deps({ vectorStore: { health: vi.fn(async () => { throw new QdrantError('unavailable', 'Qdrant unreachable: http://qdrant.internal:6333', { retryable: true }); }) } });
    const out = await semanticHealth(d, 'org-1');
    expect(out.provider.ok).toBe(true);
    expect(out.vectorStore).toMatchObject({ ok: false, error: 'unavailable' });
    expect(JSON.stringify(out)).not.toContain('qdrant.internal');
    expect(out.healthy).toBe(false);
  });

  it('treats zero total memories as 100% covered (nothing to embed)', async () => {
    const d = deps({ getCoverage: vi.fn(async () => ({ embedded: 0, total: 0 })) });
    expect((await semanticHealth(d, 'org-1')).coverage).toEqual({ embedded: 0, total: 0, percent: 100 });
  });

  it('degrades coverage to zeros if the coverage lookup fails, without failing overall health', async () => {
    const d = deps({ getCoverage: vi.fn(async () => { throw new Error('db error'); }) });
    const out = await semanticHealth(d, 'org-1');
    expect(out.coverage).toEqual({ embedded: 0, total: 0, percent: 0 });
    expect(out.healthy).toBe(true); // coverage failing doesn't mean the stack is down
  });

  it('computes partial coverage percent', async () => {
    const d = deps({ getCoverage: vi.fn(async () => ({ embedded: 1, total: 3 })) });
    expect((await semanticHealth(d, 'org-1')).coverage.percent).toBe(33);
  });
});

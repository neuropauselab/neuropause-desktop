import { describe, expect, it, vi } from 'vitest';
import { semanticSearchQuery, SemanticError, type SemanticSearchDeps } from './semanticSearchService';
import type { VectorSearchResult } from '../qdrant/qdrantTypes';

function deps(over: Partial<SemanticSearchDeps> = {}): SemanticSearchDeps {
  return {
    embeddingProvider: { embed: vi.fn(async () => [1, 0, 0]) },
    vectorStore: { search: vi.fn(async (): Promise<VectorSearchResult[]> => []) },
    getMemberRole: vi.fn(async () => 'member'),
    ...over,
  };
}

const input = { orgId: 'org-1', userId: 'user-1', text: 'find the deck' };

describe('semanticSearchQuery — authorization', () => {
  it('rejects a non-member BEFORE embedding or searching', async () => {
    const d = deps({ getMemberRole: vi.fn(async () => null) });
    await expect(semanticSearchQuery(d, input)).rejects.toMatchObject({ code: 'not_member' });
    // The security guarantee: no vector work happens for an unauthorized caller.
    expect(d.embeddingProvider.embed).not.toHaveBeenCalled();
    expect(d.vectorStore.search).not.toHaveBeenCalled();
  });

  it('checks membership with the path org and the authenticated user', async () => {
    const getMemberRole = vi.fn(async () => 'admin');
    await semanticSearchQuery(deps({ getMemberRole }), input);
    expect(getMemberRole).toHaveBeenCalledWith('org-1', 'user-1');
  });
});

describe('semanticSearchQuery — org isolation', () => {
  it('feeds the VERIFIED path org into the vector search (not something client-controlled)', async () => {
    const search = vi.fn(async (): Promise<VectorSearchResult[]> => []);
    await semanticSearchQuery(deps({ vectorStore: { search } }), input);
    expect(search).toHaveBeenCalledWith([1, 0, 0], { orgId: 'org-1', topK: 20 });
  });
});

describe('semanticSearchQuery — validation', () => {
  it('rejects empty text', async () => {
    await expect(semanticSearchQuery(deps(), { ...input, text: '   ' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects over-long text', async () => {
    await expect(
      semanticSearchQuery(deps(), { ...input, text: 'x'.repeat(401) }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('clamps limit to the max and defaults when invalid', async () => {
    const search = vi.fn(async (): Promise<VectorSearchResult[]> => []);
    await semanticSearchQuery(deps({ vectorStore: { search } }), { ...input, limit: 9999 });
    expect(search).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', topK: 100 });
    search.mockClear();
    await semanticSearchQuery(deps({ vectorStore: { search } }), { ...input, limit: 0 });
    expect(search).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', topK: 20 });
  });
});

describe('semanticSearchQuery — results + error mapping', () => {
  it('maps hits, preferring the payload memoryId', async () => {
    const search = vi.fn(async (): Promise<VectorSearchResult[]> => [
      { id: 'point-1', score: 0.91, payload: { memoryId: 'mem-42', orgId: 'org-1' } },
    ]);
    const out = await semanticSearchQuery(deps({ vectorStore: { search } }), input);
    expect(out).toEqual({
      orgId: 'org-1',
      hits: [{ memoryId: 'mem-42', score: 0.91, payload: { memoryId: 'mem-42', orgId: 'org-1' } }],
    });
  });

  it('wraps an embedding failure as embedding_failed', async () => {
    const d = deps({ embeddingProvider: { embed: vi.fn(async () => { throw new Error('down'); }) } });
    await expect(semanticSearchQuery(d, input)).rejects.toMatchObject({ code: 'embedding_failed' });
  });

  it('wraps a vector-search failure as search_failed', async () => {
    const d = deps({ vectorStore: { search: vi.fn(async () => { throw new Error('qdrant down'); }) } });
    await expect(semanticSearchQuery(d, input)).rejects.toBeInstanceOf(SemanticError);
    await expect(semanticSearchQuery(d, input)).rejects.toMatchObject({ code: 'search_failed' });
  });
});

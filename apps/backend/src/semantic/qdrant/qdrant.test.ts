import { describe, expect, it } from 'vitest';
import { QdrantVectorStore } from './qdrantVectorStore';
import { QdrantError, type QdrantConfig } from './qdrantTypes';
import type { FetchFn, HttpResponse } from '../embedding/embeddingTypes';

function cfg(over: Partial<QdrantConfig> = {}): QdrantConfig {
  return {
    baseUrl: 'http://127.0.0.1:6333',
    collection: 'memories',
    dimensions: 3,
    distance: 'Cosine',
    timeoutMs: 1000,
    retries: 2,
    backoffMs: 0,
    ...over,
  };
}

function res(status: number, body: unknown): HttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

interface Captured {
  url: string;
  method: string;
  body: unknown;
}
/** Mock fetch capturing every request; `handler` decides the response per call. */
function capturing(handler: (c: Captured, n: number) => HttpResponse | Error): {
  fn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fn: FetchFn = async (url, init) => {
    const c: Captured = { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const out = handler(c, calls.length - 1);
    if (out instanceof Error) throw out;
    return out;
  };
  return { fn, calls };
}

describe('QdrantVectorStore — collection lifecycle', () => {
  it('creates the collection when it does not exist (GET 404 → PUT)', async () => {
    const { fn, calls } = capturing((c) => (c.method === 'GET' ? res(404, {}) : res(200, { result: true })));
    await new QdrantVectorStore(cfg(), fn).ensureCollection();
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].body).toMatchObject({ vectors: { size: 3, distance: 'Cosine' } });
  });

  it('does not recreate an existing collection (GET 200 → no PUT)', async () => {
    const { fn, calls } = capturing(() => res(200, { result: { status: 'green' } }));
    await new QdrantVectorStore(cfg(), fn).ensureCollection();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });
});

describe('QdrantVectorStore — org isolation (security-critical)', () => {
  it('search ALWAYS sends an orgId must-filter', async () => {
    const { fn, calls } = capturing(() => res(200, { result: [] }));
    await new QdrantVectorStore(cfg(), fn).search([1, 0, 0], { orgId: 'org-1', topK: 5 });
    const filter = (calls[0].body as { filter: { must: Array<{ key: string; match: { value: string } }> } }).filter;
    expect(filter.must).toContainEqual({ key: 'orgId', match: { value: 'org-1' } });
  });

  it('delete filters by BOTH orgId and memoryId (no cross-org delete possible)', async () => {
    const { fn, calls } = capturing(() => res(200, { result: {} }));
    await new QdrantVectorStore(cfg(), fn).delete('mem-9', 'org-1');
    const filter = (calls[0].body as { filter: { must: Array<{ key: string; match: { value: string } }> } }).filter;
    expect(filter.must).toContainEqual({ key: 'orgId', match: { value: 'org-1' } });
    expect(filter.must).toContainEqual({ key: 'memoryId', match: { value: 'mem-9' } });
  });

  it('upsert writes orgId into every point payload', async () => {
    const { fn, calls } = capturing(() => res(200, { result: true }));
    await new QdrantVectorStore(cfg(), fn).batchUpsert([
      { id: 'a', orgId: 'org-1', vector: [1, 0, 0], payload: { kind: 'note' } },
      { id: 'b', orgId: 'org-1', vector: [0, 1, 0] },
    ]);
    const points = (calls[0].body as { points: Array<{ id: string; payload: Record<string, unknown> }> }).points;
    expect(points[0].payload).toMatchObject({ orgId: 'org-1', memoryId: 'a', kind: 'note' });
    expect(points[1].payload).toMatchObject({ orgId: 'org-1', memoryId: 'b' });
  });

  it('maps memoryId to a deterministic UUID point id (Qdrant rejects non-UUID ids)', async () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const run = async () => {
      const { fn, calls } = capturing(() => res(200, { result: true }));
      await new QdrantVectorStore(cfg(), fn).batchUpsert([{ id: 'm1', orgId: 'org-1', vector: [1, 0, 0] }]);
      return (calls[0].body as { points: Array<{ id: string }> }).points[0].id;
    };
    const id1 = await run();
    const id2 = await run();
    expect(id1).toMatch(uuidRe); // valid UUID, not the raw "m1"
    expect(id1).not.toBe('m1');
    expect(id2).toBe(id1); // deterministic — same memoryId ⇒ same point (idempotent)
  });
});

describe('QdrantVectorStore — search results + validation', () => {
  it('parses hits into id/score/payload', async () => {
    const { fn } = capturing(() =>
      res(200, { result: [{ id: 'a', score: 0.9, payload: { orgId: 'org-1' } }] }),
    );
    const hits = await new QdrantVectorStore(cfg(), fn).search([1, 0, 0], { orgId: 'org-1', topK: 5 });
    expect(hits).toEqual([{ id: 'a', score: 0.9, payload: { orgId: 'org-1' } }]);
  });

  it('rejects a malformed search response', async () => {
    const { fn } = capturing(() => res(200, { nope: true }));
    await expect(new QdrantVectorStore(cfg(), fn).search([1, 0, 0], { orgId: 'o', topK: 5 })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects an upsert with a wrong-dimension vector', async () => {
    const { fn } = capturing(() => res(200, {}));
    await expect(
      new QdrantVectorStore(cfg(), fn).upsert({ id: 'a', orgId: 'o', vector: [1, 2] }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('QdrantVectorStore — resilience', () => {
  it('retries on 5xx then fails with request_failed', async () => {
    const { fn, calls } = capturing(() => res(503, { error: 'unavailable' }));
    await expect(new QdrantVectorStore(cfg({ retries: 2 }), fn).search([1, 0, 0], { orgId: 'o', topK: 1 })).rejects.toMatchObject({
      code: 'request_failed',
      retryable: true,
    });
    expect(calls).toHaveLength(3);
  });

  it('fails fast on 4xx', async () => {
    const { fn, calls } = capturing(() => res(400, { error: 'bad' }));
    await expect(new QdrantVectorStore(cfg({ retries: 3 }), fn).search([1, 0, 0], { orgId: 'o', topK: 1 })).rejects.toBeInstanceOf(
      QdrantError,
    );
    expect(calls).toHaveLength(1);
  });

  it('maps a timeout to a retryable QdrantError', async () => {
    let n = 0;
    const { fn } = capturing(() => {
      n += 1;
      return n === 1 ? abortError() : res(200, { result: [] });
    });
    // first attempt aborts, retry succeeds
    const hits = await new QdrantVectorStore(cfg({ retries: 1 }), fn).search([1, 0, 0], { orgId: 'o', topK: 1 });
    expect(hits).toEqual([]);
  });

  it('health returns ok:false instead of throwing when Qdrant is down', async () => {
    const { fn } = capturing(() => res(500, {}));
    expect(await new QdrantVectorStore(cfg({ retries: 0 }), fn).health()).toEqual({ ok: false });
  });
});

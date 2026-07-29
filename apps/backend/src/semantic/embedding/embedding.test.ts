import { describe, expect, it, vi } from 'vitest';
import { loadEmbeddingConfig, type EmbeddingConfig } from './embeddingConfig';
import { createEmbeddingProvider, OllamaEmbeddingProvider, OpenAIEmbeddingProvider } from './embeddingProvider';
import { EmbeddingError, type FetchFn, type HttpResponse } from './embeddingTypes';

function cfg(over: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
  return {
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://127.0.0.1:11434',
    dimensions: 3,
    timeoutMs: 1000,
    retries: 2,
    backoffMs: 0, // no real waiting in tests
    ...over,
  };
}

function ok(body: unknown): HttpResponse {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function err(status: number, text = 'error'): HttpResponse {
  return { ok: false, status, json: async () => ({}), text: async () => text };
}
function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

/** FetchFn returning a queued sequence of responses/throws; last step repeats. */
function seq(steps: Array<HttpResponse | Error>): FetchFn {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return step;
  };
}

describe('loadEmbeddingConfig', () => {
  it('defaults to ollama with local base url and no key required', () => {
    const c = loadEmbeddingConfig({});
    expect(c.provider).toBe('ollama');
    expect(c.baseUrl).toBe('http://127.0.0.1:11434');
    expect(c.apiKey).toBeUndefined();
  });

  it('rejects an unknown provider', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'nope' })).toThrowError(EmbeddingError);
  });

  it('requires an API key for openai/voyage', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai' })).toThrowError(/API_KEY is required/);
    const c = loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai', EMBEDDING_API_KEY: 'sk-x' });
    expect(c.provider).toBe('openai');
    expect(c.apiKey).toBe('sk-x');
  });

  it('strips a trailing slash from the base url and validates integers', () => {
    const c = loadEmbeddingConfig({ EMBEDDING_BASE_URL: 'http://host:1234/', EMBEDDING_DIMENSIONS: '512' });
    expect(c.baseUrl).toBe('http://host:1234');
    expect(c.dimensions).toBe(512);
    expect(() => loadEmbeddingConfig({ EMBEDDING_TIMEOUT_MS: 'abc' })).toThrowError(/positive integer/);
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('embeds a single text and reports its version', async () => {
    const p = new OllamaEmbeddingProvider(cfg(), { fetchFn: seq([ok({ embedding: [0.1, 0.2, 0.3] })]) });
    expect(await p.embed('hi')).toEqual([0.1, 0.2, 0.3]);
    expect(p.version).toEqual({ model: 'nomic-embed-text', dimensions: 3, revision: 1 });
  });

  it('embeds a batch preserving order', async () => {
    const p = new OllamaEmbeddingProvider(cfg(), {
      fetchFn: seq([ok({ embedding: [1, 0, 0] }), ok({ embedding: [0, 1, 0] })]),
    });
    expect(await p.embedBatch(['a', 'b'])).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it('maps a timeout (AbortError) to a retryable provider_timeout and retries', async () => {
    const fetchFn = vi.fn(seq([abortError(), ok({ embedding: [1, 1, 1] })]));
    const p = new OllamaEmbeddingProvider(cfg({ retries: 1 }), { fetchFn });
    expect(await p.embed('x')).toEqual([1, 1, 1]); // recovered on the retry
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx then throws provider_error after exhausting retries', async () => {
    const fetchFn = vi.fn(seq([err(503), err(503), err(503)]));
    const p = new OllamaEmbeddingProvider(cfg({ retries: 2 }), { fetchFn });
    await expect(p.embed('x')).rejects.toMatchObject({ code: 'provider_error', retryable: true });
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('fails fast (no retry) on a 4xx', async () => {
    const fetchFn = vi.fn(seq([err(400, 'bad request')]));
    const p = new OllamaEmbeddingProvider(cfg({ retries: 3 }), { fetchFn });
    await expect(p.embed('x')).rejects.toMatchObject({ code: 'provider_error' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed response body', async () => {
    const p = new OllamaEmbeddingProvider(cfg(), { fetchFn: seq([ok({ nope: true })]) });
    await expect(p.embed('x')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a dimension mismatch', async () => {
    const p = new OllamaEmbeddingProvider(cfg({ dimensions: 4 }), { fetchFn: seq([ok({ embedding: [1, 2, 3] })]) });
    await expect(p.embed('x')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

// ---------------------------------------------------------------------------
// OpenAI provider (V8.2 Part 1 completion)
// ---------------------------------------------------------------------------

/** An OpenAI-shaped success body. `indices` lets a test scramble the order. */
function oaiBody(vectors: number[][], indices?: number[]): unknown {
  return {
    object: 'list',
    model: 'text-embedding-3-small',
    data: vectors.map((embedding, i) => ({
      object: 'embedding',
      index: indices ? indices[i] : i,
      embedding,
    })),
    usage: { prompt_tokens: 1, total_tokens: 1 },
  };
}

const oaiOk = (vectors: number[][], indices?: number[]) => ok(oaiBody(vectors, indices));

const oaiCfg = (over: Parameters<typeof cfg>[0] = {}) =>
  cfg({
    provider: 'openai',
    model: 'text-embedding-3-small',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-key',
    ...over,
  });

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Like `seq`, but keeps every (url, headers, body) so request shape is assertable. */
function recorder(steps: Array<HttpResponse | Error>): { fetchFn: FetchFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchFn, calls };
}

/**
 * Structural error capture: avoids importing EmbeddingError and avoids any
 * framework-specific mocking, so the assertions stay on `code` and `message`.
 */
async function catchErr(p: Promise<unknown>): Promise<{ name: string; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const x = e as { name?: string; code?: string; message?: string };
    return { name: x.name ?? '', code: x.code ?? '', message: x.message ?? '' };
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('OpenAIEmbeddingProvider', () => {
  it('POSTs to /embeddings with a bearer token and an input array', async () => {
    const r = recorder([oaiOk([[1, 2, 3]])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });

    expect(await p.embed('hello')).toEqual([1, 2, 3]);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].url).toBe('https://api.openai.com/v1/embeddings');
    expect(r.calls[0].headers.authorization).toBe('Bearer sk-test-key');
    expect(r.calls[0].headers['content-type']).toBe('application/json');
    expect(r.calls[0].body).toEqual({ model: 'text-embedding-3-small', input: ['hello'] });
  });

  it('exposes the configured version', () => {
    const p = new OpenAIEmbeddingProvider(oaiCfg({ dimensions: 1536 }), { fetchFn: recorder([]).fetchFn });
    expect(p.version).toEqual({ model: 'text-embedding-3-small', dimensions: 1536, revision: 1 });
  });

  it('sends ONE request for a batch and orders results by the response index', async () => {
    // Deliberately scrambled: array position 0 carries index 2.
    const r = recorder([oaiOk([[7, 8, 9], [1, 2, 3], [4, 5, 6]], [2, 0, 1])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });

    expect(await p.embedBatch(['a', 'b', 'c'])).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0].body).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b', 'c'] });
  });

  it('makes no request at all for an empty batch', async () => {
    const r = recorder([]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    expect(await p.embedBatch([])).toEqual([]);
    expect(r.calls.length).toBe(0);
  });

  it('does NOT send `dimensions` in the request body (validated, not requested)', async () => {
    const r = recorder([oaiOk([[1, 2, 3]])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    await p.embed('hello');
    expect(Object.keys(r.calls[0].body as object).sort()).toEqual(['input', 'model']);
  });

  it('rejects a response with no data array', async () => {
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: recorder([ok({ object: 'list' })]).fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/missing a "data" array/);
  });

  it('rejects the wrong number of embeddings', async () => {
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: recorder([oaiOk([[1, 2, 3]])]).fetchFn });
    const e = await catchErr(p.embedBatch(['a', 'b']));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/returned 1 embeddings, expected 2/);
  });

  it('rejects a repeated index', async () => {
    const r = recorder([oaiOk([[1, 2, 3], [4, 5, 6]], [0, 0])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    const e = await catchErr(p.embedBatch(['a', 'b']));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/repeats index 0/);
  });

  it('rejects an out-of-range index', async () => {
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: recorder([oaiOk([[1, 2, 3]], [5])]).fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/out-of-range index: 5/);
  });

  it('rejects a dimension mismatch', async () => {
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: recorder([oaiOk([[1, 2]])]).fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/expected 3, got 2/);
  });

  it('rejects a non-numeric embedding', async () => {
    const r = recorder([ok({ data: [{ index: 0, embedding: [1, 'x', 3] }] })]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('invalid_response');
    expect(e.message).toMatch(/index 0 has no numeric "embedding" array/);
  });

  it('refuses to construct without an API key', () => {
    expect(
      () => new OpenAIEmbeddingProvider(oaiCfg({ apiKey: '   ' }), { fetchFn: recorder([]).fetchFn }),
    ).toThrowError(/EMBEDDING_API_KEY is required/);
  });

  it('retries a 500 and succeeds on the next attempt', async () => {
    const r = recorder([err(500, 'upstream'), oaiOk([[1, 2, 3]])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    expect(await p.embed('hello')).toEqual([1, 2, 3]);
    expect(r.calls.length).toBe(2);
  });

  it('does not retry a 400', async () => {
    const r = recorder([err(400, 'bad request')]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('provider_error');
    expect(e.message).toMatch(/HTTP 400/);
    expect(r.calls.length).toBe(1);
  });

  it('maps an aborted request to a retryable failure and recovers', async () => {
    const r = recorder([abortError(), oaiOk([[1, 2, 3]])]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    expect(await p.embed('hello')).toEqual([1, 2, 3]);
    expect(r.calls.length).toBe(2);
  });

  it('gives up after exhausting retries on a persistent 503', async () => {
    const r = recorder([err(503, 'unavailable')]);
    const p = new OpenAIEmbeddingProvider(oaiCfg(), { fetchFn: r.fetchFn });
    const e = await catchErr(p.embed('hello'));
    expect(e.code).toBe('provider_error');
    expect(r.calls.length).toBe(3);
  });
});

describe('createEmbeddingProvider', () => {
  it('builds an Ollama provider', () => {
    const p = createEmbeddingProvider(cfg(), { fetchFn: seq([ok({ embedding: [1, 2, 3] })]) });
    expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('builds an OpenAI provider', () => {
    const p = createEmbeddingProvider(oaiCfg(), { fetchFn: seq([]) });
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it('builds an OpenAI provider from the production environment shape', () => {
    // Regression guard. This exact call threw EmbeddingError config_invalid and
    // crash-looped both nems-prod replicas before the OpenAI provider existed.
    // The keys and values mirror the live nems-embedding Secret; the API key is
    // a stand-in, since only its presence is read at construction.
    const env = {
      EMBEDDING_PROVIDER: 'openai',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
      EMBEDDING_DIMENSIONS: '1536',
      EMBEDDING_API_KEY: 'sk-test-key',
    };
    const p = createEmbeddingProvider(loadEmbeddingConfig(env), { fetchFn: seq([]) });
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(p.version).toEqual({ model: 'text-embedding-3-small', dimensions: 1536, revision: 1 });
  });

  it('still throws a structured error for voyage', () => {
    expect(() => createEmbeddingProvider(cfg({ provider: 'voyage' }), { fetchFn: seq([]) })).toThrowError(
      /not implemented yet/,
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { loadEmbeddingConfig, type EmbeddingConfig } from './embeddingConfig';
import { createEmbeddingProvider, OllamaEmbeddingProvider } from './embeddingProvider';
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

describe('createEmbeddingProvider', () => {
  it('builds an Ollama provider', () => {
    const p = createEmbeddingProvider(cfg(), { fetchFn: seq([ok({ embedding: [1, 2, 3] })]) });
    expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it('throws a structured error for not-yet-implemented providers', () => {
    expect(() => createEmbeddingProvider(cfg({ provider: 'openai' }), { fetchFn: seq([]) })).toThrowError(
      /not implemented yet/,
    );
  });
});

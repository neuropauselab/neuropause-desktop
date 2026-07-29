/**
 * Embedding providers + provider factory (V8.2 Part 1).
 *
 * Two providers implement the same `EmbeddingProvider` interface and are selected
 * entirely by `config.provider`, so callers never change:
 *
 *   - Ollama: local, no API key, no memory content leaving the machine — aligned
 *     with NeuroPause's local-first memory. Its `/api/embeddings` endpoint takes a
 *     single `prompt`, so a batch is N sequential requests.
 *   - OpenAI: hosted, requires `EMBEDDING_API_KEY`. Its `/embeddings` endpoint
 *     takes an `input` array, so a batch is ONE request, and the response `index`
 *     field — not array position — is authoritative for ordering.
 *
 * Voyage is still declared in the config type so the factory switch stays
 * exhaustive; it throws an explicit, structured "not implemented yet" rather than
 * falling through silently.
 *
 * Both providers take an injected `FetchFn`, so they are unit-tested with a mock
 * HTTP client and swap to Node's global `fetch` in production.
 */
import type { EmbeddingConfig } from './embeddingConfig';
import { postJson, type RequestPolicy } from './embeddingHttp';
import {
  EmbeddingError,
  type Embedding,
  type EmbeddingProvider,
  type EmbeddingVersion,
  type FetchFn,
} from './embeddingTypes';

export interface ProviderDeps {
  /** Injected HTTP client. Production: (url, init) => fetch(url, init). */
  fetchFn: FetchFn;
}

const EMBEDDING_REVISION = 1;

/** Ollama `/api/embeddings`: body `{ model, prompt }` → `{ embedding: number[] }`. */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly version: EmbeddingVersion;
  private readonly policy: RequestPolicy;

  constructor(
    private readonly config: EmbeddingConfig,
    private readonly deps: ProviderDeps,
  ) {
    this.version = { model: config.model, dimensions: config.dimensions, revision: EMBEDDING_REVISION };
    this.policy = { timeoutMs: config.timeoutMs, retries: config.retries, backoffMs: config.backoffMs };
  }

  async embed(text: string): Promise<Embedding> {
    const url = `${this.config.baseUrl}/api/embeddings`;
    const body = await postJson(this.deps.fetchFn, url, { model: this.config.model, prompt: text }, {}, this.policy);
    return this.parseEmbedding(body);
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    // Ollama's embeddings endpoint is single-input; embed sequentially to avoid
    // hammering a local model. (A batch-endpoint optimization is a later step.)
    const out: Embedding[] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }

  private parseEmbedding(body: unknown): Embedding {
    const vec = (body as { embedding?: unknown } | null)?.embedding;
    if (!Array.isArray(vec) || vec.some((n) => typeof n !== 'number')) {
      throw new EmbeddingError('invalid_response', 'Ollama response missing a numeric "embedding" array');
    }
    if (vec.length !== this.config.dimensions) {
      throw new EmbeddingError(
        'invalid_response',
        `Embedding dimension mismatch: expected ${this.config.dimensions}, got ${vec.length}`,
      );
    }
    return vec as Embedding;
  }
}

/** OpenAI `/embeddings`: body `{ model, input }` -> `{ data: [{ index, embedding }] }`. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly version: EmbeddingVersion;
  private readonly policy: RequestPolicy;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly config: EmbeddingConfig,
    private readonly deps: ProviderDeps,
  ) {
    const key = config.apiKey?.trim();
    if (!key) {
      // loadEmbeddingConfig already enforces this (needsKey: true). Repeated here
      // so the class is also safe when constructed directly, e.g. from tests.
      throw new EmbeddingError('config_invalid', 'EMBEDDING_API_KEY is required for provider "openai"');
    }
    this.version = { model: config.model, dimensions: config.dimensions, revision: EMBEDDING_REVISION };
    this.policy = { timeoutMs: config.timeoutMs, retries: config.retries, backoffMs: config.backoffMs };
    this.headers = { authorization: `Bearer ${key}` };
  }

  async embed(text: string): Promise<Embedding> {
    const [vec] = await this.request([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    // Unlike Ollama, OpenAI accepts an array input, so a batch is ONE request.
    // An empty batch must not become a request: the API rejects an empty `input`.
    if (texts.length === 0) return [];
    return this.request(texts);
  }

  /**
   * `dimensions` is deliberately NOT sent. text-embedding-3-* would happily
   * truncate to a requested width; asserting the returned width instead turns a
   * config/collection mismatch into a loud error rather than a silent reshape.
   */
  private async request(texts: string[]): Promise<Embedding[]> {
    const url = `${this.config.baseUrl}/embeddings`;
    const body = await postJson(
      this.deps.fetchFn,
      url,
      { model: this.config.model, input: texts },
      this.headers,
      this.policy,
    );
    return this.parseEmbeddings(body, texts.length);
  }

  /**
   * `index` is authoritative for ordering, not array position. Exact count +
   * in-range + no-repeat together guarantee every slot is filled; the final loop
   * turns that argument into a check rather than leaving it as a claim.
   */
  private parseEmbeddings(body: unknown, expected: number): Embedding[] {
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      throw new EmbeddingError('invalid_response', 'OpenAI response missing a "data" array');
    }
    if (data.length !== expected) {
      throw new EmbeddingError(
        'invalid_response',
        `OpenAI returned ${data.length} embeddings, expected ${expected}`,
      );
    }
    const out = new Array<Embedding | undefined>(expected).fill(undefined);
    for (const item of data) {
      const idx = (item as { index?: unknown } | null)?.index;
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= expected) {
        throw new EmbeddingError('invalid_response', `OpenAI response has an out-of-range index: ${String(idx)}`);
      }
      if (out[idx] !== undefined) {
        throw new EmbeddingError('invalid_response', `OpenAI response repeats index ${idx}`);
      }
      const vec = (item as { embedding?: unknown }).embedding;
      if (!Array.isArray(vec) || vec.some((n) => typeof n !== 'number')) {
        throw new EmbeddingError(
          'invalid_response',
          `OpenAI response index ${idx} has no numeric "embedding" array`,
        );
      }
      if (vec.length !== this.config.dimensions) {
        throw new EmbeddingError(
          'invalid_response',
          `Embedding dimension mismatch: expected ${this.config.dimensions}, got ${vec.length}`,
        );
      }
      out[idx] = vec as Embedding;
    }
    for (let i = 0; i < expected; i += 1) {
      if (out[i] === undefined) {
        throw new EmbeddingError('invalid_response', `OpenAI response is missing index ${i}`);
      }
    }
    return out as Embedding[];
  }
}

/**
 * Build the configured provider. Selection is driven entirely by `config.provider`.
 * voyage is still declared so the switch is exhaustive and its absence is an
 * explicit, structured "not yet implemented" rather than a silent fallthrough.
 */
export function createEmbeddingProvider(config: EmbeddingConfig, deps: ProviderDeps): EmbeddingProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaEmbeddingProvider(config, deps);
    case 'openai':
      return new OpenAIEmbeddingProvider(config, deps);
    case 'voyage':
      throw new EmbeddingError(
        'config_invalid',
        `Embedding provider "${config.provider}" is not implemented yet (ollama and openai are implemented).`,
      );
    default: {
      const _exhaustive: never = config.provider;
      throw new EmbeddingError('config_invalid', `Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}

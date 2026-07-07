/**
 * Ollama embedding provider + provider factory (V8.2 Part 1).
 *
 * Ollama is the first provider: local, no API key, no memory content leaving the
 * machine — aligned with NeuroPause's local-first memory. OpenAI/Voyage implement
 * the same `EmbeddingProvider` interface and drop into the factory later without
 * touching callers. The provider takes an injected `FetchFn`, so it's unit-tested
 * with a mock HTTP client and swaps to Node's global `fetch` in production.
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

/**
 * Build the configured provider. Selection is driven entirely by `config.provider`.
 * openai/voyage are declared so the switch is exhaustive and their absence is an
 * explicit, structured "not yet implemented" rather than a silent fallthrough.
 */
export function createEmbeddingProvider(config: EmbeddingConfig, deps: ProviderDeps): EmbeddingProvider {
  switch (config.provider) {
    case 'ollama':
      return new OllamaEmbeddingProvider(config, deps);
    case 'openai':
    case 'voyage':
      throw new EmbeddingError(
        'config_invalid',
        `Embedding provider "${config.provider}" is not implemented yet (Ollama is the first provider).`,
      );
    default: {
      const _exhaustive: never = config.provider;
      throw new EmbeddingError('config_invalid', `Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}

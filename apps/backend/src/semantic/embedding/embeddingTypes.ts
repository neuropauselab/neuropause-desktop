/**
 * Backend embedding layer — shared types (V8.2 Part 1).
 *
 * Mirrors the desktop's `EmbeddingProvider`/`Embedding` shape (structurally
 * compatible with apps/desktop/src/main/memory/embedding.ts) so the same vector
 * contract holds end to end. Backend-only concern: nothing here touches Qdrant or
 * the desktop — this is the provider abstraction the semantic API and background
 * pipeline consume.
 */

export type Embedding = number[];

export interface EmbeddingVersion {
  /** Provider model id, e.g. 'nomic-embed-text'. */
  model: string;
  /** Vector dimensionality — must match the Qdrant collection. */
  dimensions: number;
  /** Bumped when the embedding space changes (forces re-embed). */
  revision: number;
}

export interface EmbeddingProvider {
  readonly version: EmbeddingVersion;
  /** Embed a single text. Throws {@link EmbeddingError} on failure. */
  embed(text: string): Promise<Embedding>;
  /** Embed many texts, preserving order. */
  embedBatch(texts: string[]): Promise<Embedding[]>;
}

export type EmbeddingErrorCode =
  | 'config_invalid' // missing/invalid provider configuration
  | 'provider_unavailable' // network/connection failure (retryable)
  | 'provider_timeout' // request exceeded the timeout (retryable)
  | 'provider_error' // provider returned a non-2xx status
  | 'invalid_response'; // provider returned a malformed body

/** Structured, typed error for every embedding failure — no raw throws escape. */
export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
    readonly options: { cause?: unknown; retryable?: boolean; status?: number } = {},
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

/**
 * Minimal fetch-shaped client, injected so providers are unit-testable without a
 * live server. The production adapter passes Node's global `fetch`.
 */
export interface HttpRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

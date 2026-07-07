/**
 * Qdrant vector store — types + structured error (V8.2 Part 1). Backend-only:
 * only the server talks to Qdrant; the desktop calls the authenticated semantic
 * API. Every point carries an `orgId` payload field, and every query/delete is
 * filtered on it — the mechanism enforcing organization isolation.
 */
export type Embedding = number[];

export type QdrantErrorCode =
  | 'config_invalid'
  | 'unavailable' // network/connection (retryable)
  | 'timeout' // request timed out (retryable)
  | 'request_failed' // non-2xx from Qdrant
  | 'invalid_response'; // malformed body

export class QdrantError extends Error implements Error {
  readonly retryable: boolean;
  constructor(
    readonly code: QdrantErrorCode,
    message: string,
    readonly options: { status?: number; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'QdrantError';
    this.retryable = options.retryable ?? false;
  }
}

/** A vector to store. `orgId` is mandatory — it becomes the isolation filter key. */
export interface VectorRecord {
  id: string;
  orgId: string;
  vector: Embedding;
  /** Extra payload stored alongside (e.g. memoryId, kind). orgId is added automatically. */
  payload?: Record<string, unknown>;
}

export interface VectorSearchOptions {
  orgId: string;
  topK: number;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantConfig {
  baseUrl: string;
  apiKey?: string;
  collection: string;
  dimensions: number;
  distance: 'Cosine' | 'Dot' | 'Euclid';
  timeoutMs: number;
  retries: number;
  backoffMs: number;
}

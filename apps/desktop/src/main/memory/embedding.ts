/**
 * Embedding abstraction (V6.9, provider-agnostic core). Defines the seams every
 * embedding provider implements, plus PURE version/staleness logic. No
 * provider-specific code lives here — OpenAI / Voyage / Ollama / a local model are
 * all injected as an `EmbeddingProvider`, so nothing above this layer knows or
 * cares which is active. The staleness rules are deterministic and fully testable
 * without any provider running.
 */

export type Embedding = number[];

/** The identity of the model that produced an embedding. Bump `revision` to force
 *  a re-embed across the board (e.g. after a prompt/normalization change). */
export interface EmbeddingVersion {
  model: string;
  dimensions: number;
  revision: number;
}

/** Turns text into vectors. Implementations wrap a real API or local model. */
export interface EmbeddingProvider {
  readonly version: EmbeddingVersion;
  embed(text: string): Promise<Embedding>;
  embedBatch(texts: string[]): Promise<Embedding[]>;
}

/**
 * The embedding service the app depends on: single + batch embedding and the
 * active version. It owns cross-cutting concerns (batching, retries, versioning)
 * and delegates the actual vectorization to an injected provider — so swapping
 * providers changes nothing above.
 */
export interface EmbeddingService {
  readonly version: EmbeddingVersion;
  embed(text: string): Promise<Embedding>;
  embedBatch(texts: string[]): Promise<Embedding[]>;
}

/** Metadata recorded alongside a memory's stored vector. */
export interface EmbeddingMetadata {
  memoryId: string;
  orgId: string;
  /** Hash of the embedded content (hashMemoryContent), for change detection. */
  contentHash: string;
  version: EmbeddingVersion;
  embeddedAt: string;
}

/** A unit of embedding work, enqueued on memory write (processed by a worker). */
export interface EmbeddingJob {
  memoryId: string;
  orgId: string;
  text: string;
  contentHash: string;
  attempts: number;
}

export function sameEmbeddingVersion(a: EmbeddingVersion, b: EmbeddingVersion): boolean {
  return a.model === b.model && a.dimensions === b.dimensions && a.revision === b.revision;
}

/**
 * Whether a stored embedding is stale and must be regenerated: no embedding yet,
 * the content changed (hash differs), or the active model version moved. Pure.
 */
export function isEmbeddingStale(
  stored: EmbeddingMetadata | null,
  currentContentHash: string,
  activeVersion: EmbeddingVersion,
): boolean {
  if (!stored) return true;
  if (stored.contentHash !== currentContentHash) return true;
  if (!sameEmbeddingVersion(stored.version, activeVersion)) return true;
  return false;
}

/** From a set of stored embeddings + the current memories, which memoryIds need
 *  (re)embedding under the active model. Pure — drives the stale-scanner worker. */
export function selectStaleMemories(
  memories: ReadonlyArray<{ memoryId: string; contentHash: string }>,
  stored: ReadonlyMap<string, EmbeddingMetadata>,
  activeVersion: EmbeddingVersion,
): string[] {
  return memories
    .filter((m) => isEmbeddingStale(stored.get(m.memoryId) ?? null, m.contentHash, activeVersion))
    .map((m) => m.memoryId);
}

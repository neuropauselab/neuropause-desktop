/**
 * Vector store abstraction (V6.9). The app depends only on this interface; the
 * active implementation (InMemory now; Qdrant / Pinecone / Weaviate / Milvus later)
 * is invisible above it. The in-memory implementation does real cosine search and
 * is deterministic + unit-testable, so the whole semantic retrieval pipeline can be
 * proven end-to-end WITHOUT a running vector database — and it doubles as the test
 * double forever.
 *
 * Organization isolation is enforced in the store itself: search is scoped to one
 * org, and deleted vectors are excluded by default — so cross-org leakage and
 * tombstoned results can't slip through at this layer.
 */
import type { Embedding } from './embedding';

export interface VectorRecord {
  id: string;
  orgId: string;
  vector: Embedding;
  deleted?: boolean;
}

export interface VectorSearchResult {
  id: string;
  /** Cosine similarity, clamped to 0..1. */
  score: number;
}

export interface VectorSearchOptions {
  /** Organization namespace — only this org's vectors are searched. */
  orgId: string;
  topK: number;
  includeDeleted?: boolean;
}

export interface VectorStoreStats {
  vectors: number;
  orgs: number;
}

export interface VectorStore {
  upsert(record: VectorRecord): Promise<void>;
  batchUpsert(records: VectorRecord[]): Promise<void>;
  delete(id: string, orgId: string): Promise<void>;
  search(vector: Embedding, options: VectorSearchOptions): Promise<VectorSearchResult[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  stats(): Promise<VectorStoreStats>;
}

/** Cosine similarity, clamped to 0..1 (negative similarity ⇒ 0). Pure. */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return sim < 0 ? 0 : sim > 1 ? 1 : sim;
}

/**
 * In-memory VectorStore with real cosine search. Deterministic (ties broken by id)
 * and side-effect-free beyond its own map — the reference implementation the real
 * Qdrant store must match behaviorally.
 */
export function createInMemoryVectorStore(): VectorStore {
  const records = new Map<string, VectorRecord>();
  const key = (orgId: string, id: string): string => `${orgId}\u0000${id}`;

  return {
    async upsert(record: VectorRecord): Promise<void> {
      records.set(key(record.orgId, record.id), record);
    },
    async batchUpsert(batch: VectorRecord[]): Promise<void> {
      for (const record of batch) records.set(key(record.orgId, record.id), record);
    },
    async delete(id: string, orgId: string): Promise<void> {
      records.delete(key(orgId, id));
    },
    async search(vector: Embedding, options: VectorSearchOptions): Promise<VectorSearchResult[]> {
      const hits: VectorSearchResult[] = [];
      for (const record of records.values()) {
        if (record.orgId !== options.orgId) continue; // org isolation
        if (record.deleted && !options.includeDeleted) continue; // deleted filtering
        hits.push({ id: record.id, score: cosineSimilarity(vector, record.vector) });
      }
      hits.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.id < b.id ? -1 : 1));
      return hits.slice(0, options.topK);
    },
    async health(): Promise<{ ok: boolean }> {
      return { ok: true };
    },
    async stats(): Promise<VectorStoreStats> {
      const orgs = new Set<string>();
      for (const record of records.values()) orgs.add(record.orgId);
      return { vectors: records.size, orgs: orgs.size };
    },
  };
}

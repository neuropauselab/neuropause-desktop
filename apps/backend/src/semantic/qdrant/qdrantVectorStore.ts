/**
 * QdrantVectorStore (V8.2 Part 1) — the backend's vector store over Qdrant's REST
 * API. Organization isolation is structural: `orgId` is written into every point's
 * payload, and `search`/`delete` build a mandatory `must` filter on `orgId` inside
 * this client, so no call path can query or mutate across orgs. All I/O goes
 * through the shared retryable `httpJson`, surfacing `QdrantError`.
 *
 * Backend-only. The desktop never constructs this — it calls the authenticated
 * semantic API, which uses this server-side.
 */
import { httpJson, type HttpFailure, type HttpPolicy } from './httpJson';
import {
  QdrantError,
  type Embedding,
  type QdrantConfig,
  type VectorRecord,
  type VectorSearchOptions,
  type VectorSearchResult,
} from './qdrantTypes';
import type { FetchFn } from '../embedding/embeddingTypes';
import { createHash } from 'node:crypto';

/**
 * Qdrant point IDs must be an unsigned integer or a UUID — memory IDs are neither.
 * Derive a deterministic RFC-4122 UUID from the memoryId so the same memory always
 * maps to the same point (preserving idempotent upsert + delete-by-id). The real
 * memoryId is kept in the payload and returned as the hit id.
 */
function pointId(memoryId: string): string {
  const h = createHash('sha256').update(memoryId).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC-4122 variant
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

interface QdrantFilter {
  must: Array<{ key: string; match: { value: string } }>;
}

export class QdrantVectorStore {
  private readonly policy: HttpPolicy;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly config: QdrantConfig,
    private readonly fetchFn: FetchFn,
  ) {
    this.policy = { timeoutMs: config.timeoutMs, retries: config.retries, backoffMs: config.backoffMs };
    this.headers = config.apiKey ? { 'api-key': config.apiKey } : {};
  }

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private fail(failure: HttpFailure): QdrantError {
    switch (failure.kind) {
      case 'timeout':
        return new QdrantError('timeout', `Qdrant request timed out: ${failure.url}`, { cause: failure.cause, retryable: true });
      case 'network':
        return new QdrantError('unavailable', `Qdrant unreachable: ${failure.url} (${failure.detail ?? 'network error'})`, { cause: failure.cause, retryable: true });
      case 'http':
      default: {
        const retryable = failure.status === 429 || (failure.status ?? 0) >= 500;
        return new QdrantError('request_failed', `Qdrant HTTP ${failure.status}: ${failure.detail ?? ''}`.trim(), { status: failure.status, retryable });
      }
    }
  }

  /** orgId is ALWAYS the first filter clause. Extra equality clauses can be added. */
  private orgFilter(orgId: string, extra: Array<{ key: string; value: string }> = []): QdrantFilter {
    return {
      must: [
        { key: 'orgId', match: { value: orgId } },
        ...extra.map((e) => ({ key: e.key, match: { value: e.value } })),
      ],
    };
  }

  /** Create the collection if it doesn't already exist (idempotent). */
  async ensureCollection(): Promise<void> {
    const exists = await this.collectionExists();
    if (exists) return;
    await httpJson(
      this.fetchFn,
      'PUT',
      this.url(`/collections/${this.config.collection}`),
      { vectors: { size: this.config.dimensions, distance: this.config.distance } },
      this.headers,
      this.policy,
      (f) => this.fail(f),
    );
  }

  private async collectionExists(): Promise<boolean> {
    try {
      await httpJson(this.fetchFn, 'GET', this.url(`/collections/${this.config.collection}`), undefined, this.headers, this.policy, (f) => this.fail(f));
      return true;
    } catch (err) {
      if (err instanceof QdrantError && err.options.status === 404) return false;
      throw err;
    }
  }

  async upsert(record: VectorRecord): Promise<void> {
    await this.batchUpsert([record]);
  }

  async batchUpsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const points = records.map((r) => {
      if (r.vector.length !== this.config.dimensions) {
        throw new QdrantError('invalid_response', `Vector for ${r.id} has ${r.vector.length} dims, expected ${this.config.dimensions}`);
      }
      // orgId is forced into the payload so the isolation filter always has a key to match.
      return { id: pointId(r.id), vector: r.vector, payload: { ...r.payload, orgId: r.orgId, memoryId: r.id } };
    });
    await httpJson(
      this.fetchFn,
      'PUT',
      this.url(`/collections/${this.config.collection}/points?wait=true`),
      { points },
      this.headers,
      this.policy,
      (f) => this.fail(f),
    );
  }

  /** Delete one memory's vector — filtered by orgId AND id, so cross-org deletes are impossible. */
  async delete(id: string, orgId: string): Promise<void> {
    await httpJson(
      this.fetchFn,
      'POST',
      this.url(`/collections/${this.config.collection}/points/delete?wait=true`),
      { filter: this.orgFilter(orgId, [{ key: 'memoryId', value: id }]) },
      this.headers,
      this.policy,
      (f) => this.fail(f),
    );
  }

  /** Vector search scoped to a single org via the mandatory payload filter. */
  async search(vector: Embedding, options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    const body = await httpJson(
      this.fetchFn,
      'POST',
      this.url(`/collections/${this.config.collection}/points/search`),
      { vector, limit: options.topK, filter: this.orgFilter(options.orgId), with_payload: true },
      this.headers,
      this.policy,
      (f) => this.fail(f),
    );
    return this.parseSearch(body);
  }

  async health(): Promise<{ ok: boolean }> {
    try {
      await httpJson(this.fetchFn, 'GET', this.url('/'), undefined, this.headers, this.policy, (f) => this.fail(f));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private parseSearch(body: unknown): VectorSearchResult[] {
    const result = (body as { result?: unknown } | null)?.result;
    if (!Array.isArray(result)) {
      throw new QdrantError('invalid_response', 'Qdrant search response missing "result" array');
    }
    return result.map((r) => {
      const row = r as { id?: unknown; score?: unknown; payload?: unknown };
      if ((typeof row.id !== 'string' && typeof row.id !== 'number') || typeof row.score !== 'number') {
        throw new QdrantError('invalid_response', 'Qdrant search hit missing id/score');
      }
      return {
        id: String(row.id),
        score: row.score,
        payload: (row.payload as Record<string, unknown>) ?? {},
      };
    });
  }
}

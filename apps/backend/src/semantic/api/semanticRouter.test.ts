/**
 * Semantic search router — HTTP contract (A6).
 *
 * The service tests next door cover `semanticSearchQuery`'s logic; this covers
 * the thing only the wire can show: which status, which code, and which headers
 * a failure actually reaches the desktop as. That mapping is what the desktop's
 * retrieval taxonomy (`apps/desktop/src/main/memory/semanticFailure.ts`) branches
 * on, so it is a contract, not an implementation detail.
 *
 * Real express + the real `errorHandler`, per the pattern in sync/router.test.ts
 * and license/router.test.ts — a stubbed handler would prove nothing here, since
 * the header and the exposed message are the handler's job.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EmbeddingError } from '../embedding/embeddingTypes';
import { QdrantError, type VectorSearchResult } from '../qdrant/qdrantTypes';
import { errorHandler } from '../../middleware/error';
import { requestId } from '../../middleware/requestId';
import { createSemanticRouter, SEMANTIC_RETRY_AFTER_SECONDS } from './semanticRouter';
import type { SemanticSearchDeps } from './semanticSearchService';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const roleByUser: Record<string, string> = { owner: 'owner', member: 'member' };

/** Swapped per test; the server is built once, like the other router suites. */
let embed: SemanticSearchDeps['embeddingProvider']['embed'];
let search: SemanticSearchDeps['vectorStore']['search'];

const HIT: VectorSearchResult = {
  id: 'point-1',
  score: 0.82,
  payload: { memoryId: 'mem-1', orgId: 'org-1' },
};

describe('semantic search router — HTTP contract', () => {
  let server: Server;
  let base: string;

  beforeAll(() => {
    const app = express();
    // The real request-id middleware, because `errorHandler` stamps `req.id` onto
    // the failure envelope and a 503 you cannot trace to a log line is half an answer.
    app.use(requestId);
    app.use((req, _res, next) => {
      req.userId = req.header('x-test-user') || undefined;
      next();
    });
    app.use(express.json());
    app.use(
      '/memory/semantic',
      createSemanticRouter({
        embeddingProvider: { embed: (text) => embed(text) },
        vectorStore: { search: (vector, options) => search(vector, options) },
        getMemberRole: async (_orgId, userId) => roleByUser[userId] ?? null,
      }),
    );
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  // Healthy defaults before every test, so a test that fails only the embedder
  // isn't quietly relying on the previous test's vector store.
  beforeEach(() => {
    embed = async () => [1, 0, 0];
    search = async () => [HIT];
  });

  async function post(
    path: string,
    user?: string,
    body: unknown = { text: 'quarterly plan' },
  ): Promise<{ status: number; json: Json; retryAfter: string | null; raw: string }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (user) headers['x-test-user'] = user;
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: Json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    return { status: res.status, json, retryAfter: res.headers.get('retry-after'), raw };
  }

  // ── Unchanged behaviour: A6 must not move any of these ──

  it('serves a member’s search', async () => {
    embed = async () => [1, 0, 0];
    search = async () => [HIT];
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ orgId: 'org-1', hits: [{ memoryId: 'mem-1', score: 0.82, payload: HIT.payload }] });
    expect(r.retryAfter).toBeNull();
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const r = await post('/memory/semantic/org-1/search');
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('unauthorized');
  });

  it('rejects a non-member with 403 not_member', async () => {
    const r = await post('/memory/semantic/org-1/search', 'stranger');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('not_member');
  });

  it('rejects an invalid body with 400 invalid_request', async () => {
    const r = await post('/memory/semantic/org-1/search', 'member', { text: '' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('invalid_request');
  });

  // ── A6: a dependency outage is answerable, not a mystery 500 ──

  it('answers a retryable vector-store failure with 503 search_failed and a Retry-After', async () => {
    // Pre-A6 this was `500 {code:'internal_error'}` — the desktop could see that
    // the call failed but not that the *vector store* was what failed, so its
    // breaker and its health probe had nothing true to report.
    search = async () => {
      throw new QdrantError('unavailable', 'connect ECONNREFUSED 127.0.0.1:6333', {
        retryable: true,
      });
    };
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('search_failed');
    expect(r.retryAfter).toBe(String(SEMANTIC_RETRY_AFTER_SECONDS));
  });

  it('answers a retryable embedding failure with 503 embedding_failed and a Retry-After', async () => {
    embed = async () => {
      throw new EmbeddingError('provider_unavailable', 'fetch failed', { retryable: true });
    };
    search = async () => [HIT];
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('embedding_failed');
    expect(r.retryAfter).toBe(String(SEMANTIC_RETRY_AFTER_SECONDS));
  });

  it('reads `retryable` through a prototype getter, not just an own field', async () => {
    // EmbeddingError exposes `retryable` as a getter (embeddingTypes.ts:48) while
    // QdrantError exposes it as a field (qdrantTypes.ts:17). A structural read that
    // only saw own properties would silently mis-status every embedding outage.
    const err = new EmbeddingError('provider_timeout', 'timed out', { retryable: true });
    expect(Object.prototype.hasOwnProperty.call(err, 'retryable')).toBe(false);
    embed = async () => {
      throw err;
    };
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(503);
  });

  it('does not promise a retry for a failure retrying cannot fix', async () => {
    // A misconfigured provider is permanent until an operator intervenes. Calling
    // it 503 + Retry-After would tell the desktop's probe to report it transient —
    // precisely the kind of confident wrong answer A6 exists to remove.
    embed = async () => {
      throw new EmbeddingError('config_invalid', 'EMBEDDING_MODEL is not set', {
        retryable: false,
      });
    };
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('embedding_failed');
    expect(r.retryAfter).toBeNull();
  });

  it('falls back to 500 for a cause it cannot judge, keeping the pre-A6 status', async () => {
    search = async () => {
      throw new Error('something nobody classified');
    };
    embed = async () => [1, 0, 0];
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('search_failed');
    expect(r.retryAfter).toBeNull();
  });

  it('never leaks the upstream error into the response body', async () => {
    // `SemanticError.detail` holds the raw throw, which routinely carries the
    // upstream URL and can carry an API key. Only the service's fixed literal
    // message is exposed; the cause stays server-side for the logs.
    search = async () => {
      throw new QdrantError(
        'request_failed',
        'GET http://qdrant.internal:6333/collections?api-key=sk-live-SECRET-9f3a failed',
        { retryable: true, status: 500 },
      );
    };
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(503);
    expect(r.json.error.message).toBe('Vector search failed.');
    expect(r.raw).not.toContain('sk-live-SECRET-9f3a');
    expect(r.raw).not.toContain('qdrant.internal');
  });

  it('keeps a request id on the failure envelope, so a 503 is traceable', async () => {
    search = async () => {
      throw new QdrantError('timeout', 'deadline exceeded', { retryable: true });
    };
    const r = await post('/memory/semantic/org-1/search', 'member');
    expect(r.status).toBe(503);
    expect(r.json).toHaveProperty('requestId');
  });
});

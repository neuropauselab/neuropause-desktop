/**
 * Semantic health router — HTTP contract (A6).
 *
 * This router was written and unit-tested in V8.2 Part 2 but never mounted, so
 * until this increment none of it carried production traffic and its query
 * parsing had no test at any level. Mounting it is what makes these a contract:
 * the `?total=` handling below is the only thing standing between a desktop-
 * supplied number and the coverage figure an operator reads, and the membership
 * gate is now a real authorization boundary rather than dead code.
 *
 * Real express + the real `errorHandler`, per sync/router.test.ts.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const logWarn = vi.fn();
vi.mock('../../config/logger', () => ({
  logger: { warn: (...a: unknown[]) => logWarn(...a), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { EmbeddingError, type EmbeddingVersion } from '../embedding/embeddingTypes';
import { QdrantError } from '../qdrant/qdrantTypes';
import { errorHandler } from '../../middleware/error';
import { requestId } from '../../middleware/requestId';
import { createSemanticHealthRouter } from './semanticHealthRouter';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const VERSION: EmbeddingVersion = { model: 'nomic-embed-text', dimensions: 768, revision: 1 };
const roleByUser: Record<string, string> = { owner: 'owner', member: 'member' };

/** Swapped per test; the router's deps close over these. */
let embed: (text: string) => Promise<number[]>;
let health: () => Promise<{ ok: boolean }>;
let countEmbedded: (orgId: string) => Promise<number>;

describe('semantic health router — HTTP contract', () => {
  let server: Server;
  let base: string;

  beforeAll(() => {
    const app = express();
    app.use(requestId);
    app.use((req, _res, next) => {
      req.userId = req.header('x-test-user') || undefined;
      next();
    });
    app.use(
      '/memory/semantic',
      createSemanticHealthRouter({
        embeddingProvider: { version: VERSION, embed: (t) => embed(t) },
        vectorStore: { health: () => health() },
        countEmbedded: (orgId) => countEmbedded(orgId),
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

  beforeEach(() => {
    embed = async () => [1, 0, 0];
    health = async () => ({ ok: true });
    countEmbedded = async () => 25;
  });

  afterEach(() => {
    logWarn.mockClear();
  });

  async function get(
    path: string,
    user?: string,
  ): Promise<{ status: number; json: Json; raw: string }> {
    const headers: Record<string, string> = {};
    if (user) headers['x-test-user'] = user;
    const res = await fetch(`${base}${path}`, { headers });
    const raw = await res.text();
    let json: Json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    return { status: res.status, json, raw };
  }

  // ── The authorization boundary this mount newly made real ──

  it('rejects an unauthenticated caller with 401', async () => {
    const r = await get('/memory/semantic/org-1/health');
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('unauthorized');
  });

  it('rejects a non-member with 403, without probing anything', async () => {
    // The gate must run *before* the probes: otherwise a stranger could drive
    // billable embedding calls against an org they do not belong to.
    const probed = vi.fn(async () => [1, 0, 0]);
    embed = probed;
    const r = await get('/memory/semantic/org-1/health', 'stranger');
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('not_member');
    expect(probed).not.toHaveBeenCalled();
  });

  it('serves a member the full health shape', async () => {
    const r = await get('/memory/semantic/org-1/health', 'member');
    expect(r.status).toBe(200);
    expect(r.json.healthy).toBe(true);
    expect(r.json.provider).toMatchObject({ ok: true, model: 'nomic-embed-text', dimensions: 768 });
    expect(r.json.vectorStore.ok).toBe(true);
    expect(r.json.coverage).toEqual({ embedded: 25, total: 25, percent: 100 });
    expect(typeof r.json.checkedAt).toBe('string');
  });

  // ── ?total=N: never covered at any level before this increment ──

  it('uses a supplied total to compute coverage', async () => {
    // The backend only knows the embedded count; the desktop knows how many
    // memories exist. Without this, coverage always reads 100%.
    const r = await get('/memory/semantic/org-1/health?total=100', 'member');
    expect(r.json.coverage).toEqual({ embedded: 25, total: 100, percent: 25 });
  });

  it('ignores a non-numeric total rather than reporting NaN coverage', async () => {
    const r = await get('/memory/semantic/org-1/health?total=abc', 'member');
    expect(r.json.coverage).toEqual({ embedded: 25, total: 25, percent: 100 });
  });

  it('ignores a negative total', async () => {
    const r = await get('/memory/semantic/org-1/health?total=-5', 'member');
    expect(r.json.coverage.total).toBe(25);
  });

  it('ignores a repeated total, which express parses as an array', async () => {
    // `Number(['1','2'])` is NaN, so this lands on the same guard — worth pinning
    // because it is the one input shape a caller can send by accident.
    const r = await get('/memory/semantic/org-1/health?total=10&total=20', 'member');
    expect(r.json.coverage.total).toBe(25);
  });

  it('accepts a total below the embedded count by clamping, not by reporting >100%', async () => {
    countEmbedded = async () => 40;
    const r = await get('/memory/semantic/org-1/health?total=10', 'member');
    expect(r.json.coverage.percent).toBe(100);
    expect(r.json.coverage.embedded).toBeLessThanOrEqual(r.json.coverage.total);
  });

  // ── Degradation: this endpoint reports outages, it does not become one ──

  it('answers 200 with healthy:false when the provider is down', async () => {
    // Deliberately not a 5xx. A diagnostic endpoint that fails when the thing it
    // diagnoses fails is indistinguishable from the endpoint itself being broken —
    // which is the exact ambiguity A6 exists to remove.
    embed = async () => {
      throw new EmbeddingError('provider_unavailable', 'Request to http://ollama.internal:11434/api/embeddings failed', { retryable: true });
    };
    const r = await get('/memory/semantic/org-1/health', 'member');
    expect(r.status).toBe(200);
    expect(r.json.healthy).toBe(false);
    expect(r.json.provider).toMatchObject({ ok: false, error: 'provider_unavailable' });
    expect(r.json.vectorStore.ok).toBe(true); // isolated — one failure never masks the rest
  });

  it('never puts the upstream host or body in the response', async () => {
    // The regression: `error` used to be `err.message`, and the provider builds
    // those as `HTTP ${status} from ${url}: ${detail}`. Any org member could read
    // the internal embedding host and the upstream response body from this route.
    embed = async () => {
      throw new EmbeddingError('provider_error', 'HTTP 401 from http://ollama.internal:11434/api/embeddings: {"error":"bad key sk-live-SECRET-9f3a"}');
    };
    health = async () => {
      throw new QdrantError('unavailable', 'Qdrant unreachable: http://qdrant.internal:6333', { retryable: true });
    };
    const r = await get('/memory/semantic/org-1/health', 'member');
    expect(r.status).toBe(200);
    expect(r.raw).not.toContain('ollama.internal');
    expect(r.raw).not.toContain('qdrant.internal');
    expect(r.raw).not.toContain('sk-live-SECRET-9f3a');
    // Still actionable: two different, correctly-named failures.
    expect(r.json.provider.error).toBe('provider_error');
    expect(r.json.vectorStore.error).toBe('unavailable');
  });

  it('sends the withheld detail to the log instead of dropping it', async () => {
    const upstream = new QdrantError('timeout', 'Qdrant request timed out: http://qdrant.internal:6333', { retryable: true });
    health = async () => {
      throw upstream;
    };
    const r = await get('/memory/semantic/org-1/health', 'member');
    expect(logWarn).toHaveBeenCalledTimes(1);
    const [ctx] = logWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(ctx.err).toBe(upstream);
    expect(ctx.probe).toBe('vectorStore');
    expect(ctx.orgId).toBe('org-1');
    expect(ctx.requestId).toBeTruthy();
    expect(r.json.vectorStore.error).toBe('timeout');
  });

  it('still answers when the embedded-count lookup itself fails', async () => {
    countEmbedded = async () => {
      throw new Error('connection terminated');
    };
    const r = await get('/memory/semantic/org-1/health', 'member');
    expect(r.status).toBe(200);
    expect(r.json.coverage).toEqual({ embedded: 0, total: 0, percent: 0 });
    expect(r.json.healthy).toBe(true); // coverage is not liveness
  });
});

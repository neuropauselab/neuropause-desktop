/**
 * The HTTP error handler — the one place that decides what a failure looks like
 * to a client and to an operator (A6).
 *
 * This module had no tests before this increment, and it is now the thing every
 * `Retry-After` and every 5xx log line in the app flows through. Two properties
 * matter enough to pin: a 503 must carry an honest cooldown, and the upstream
 * cause must reach the log *without* reaching the response body. Those pull in
 * opposite directions, so testing one without the other proves nothing.
 *
 * Real express and a real socket rather than a mock `res`, because the assertions
 * are about the wire — a header that was set, a body that does not contain a
 * secret. `mockReqRes`-style doubles (as in rateLimit.test.ts) would be asserting
 * against the double. The logger is mocked, per that same file's convention, since
 * `logger` is a module-level pino instance.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import pino from 'pino';
import { z } from 'zod';

const logError = vi.fn();
vi.mock('../config/logger', () => ({
  logger: {
    error: (...args: unknown[]) => logError(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AppError, badRequest, conflict, errorHandler, notFound, notFoundHandler, serviceUnavailable, unauthorized, forbidden } from './error';
import { requestId } from './requestId';

// Loose JSON typing for test response bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Swapped per test; the route below rethrows whatever this returns. */
let thrown: unknown = new Error('unset');

describe('errorHandler', () => {
  let server: Server;
  let base: string;

  beforeAll(() => {
    const app = express();
    app.use(requestId);
    app.get('/boom', (_req, _res, next) => {
      next(thrown);
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    logError.mockClear();
  });

  async function get(
    path = '/boom',
  ): Promise<{ status: number; json: Json; retryAfter: string | null; raw: string }> {
    const res = await fetch(`${base}${path}`);
    const raw = await res.text();
    let json: Json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    return { status: res.status, json, retryAfter: res.headers.get('retry-after'), raw };
  }

  /** The single `logger.error` context object from the most recent request. */
  function lastLogContext(): Record<string, unknown> {
    expect(logError).toHaveBeenCalledTimes(1);
    return logError.mock.calls[0]![0] as Record<string, unknown>;
  }

  // ── The envelope every client already depends on ──

  it('renders an AppError as its own status, code and message', async () => {
    thrown = conflict('already_member', 'That user is already a member.');
    const r = await get();
    expect(r.status).toBe(409);
    expect(r.json.error).toEqual({
      code: 'already_member',
      message: 'That user is already a member.',
    });
    expect(r.json).toHaveProperty('requestId');
  });

  it('keeps the four short helpers on their documented statuses', async () => {
    // These are load-bearing across auth, orgs, devices and billing; the options-bag
    // refactor must not have moved any of them.
    const cases: Array<[AppError, number]> = [
      [badRequest('bad', 'x'), 400],
      [unauthorized(), 401],
      [forbidden(), 403],
      [notFound(), 404],
    ];
    for (const [err, status] of cases) {
      thrown = err;
      const r = await get();
      expect(r.status).toBe(status);
      expect(r.retryAfter).toBeNull();
    }
  });

  it('masks the message of a non-exposed error but keeps its code', async () => {
    // `expose` stayed the 4th positional parameter precisely so this call shape,
    // used by existing throw sites, survived the options-bag change.
    thrown = new AppError(500, 'db_write_failed', 'password=hunter2 in dsn', false);
    const r = await get();
    expect(r.status).toBe(500);
    expect(r.json.error).toEqual({ code: 'db_write_failed', message: 'Internal server error' });
    expect(r.raw).not.toContain('hunter2');
  });

  it('does not log a 4xx, which is the caller’s mistake rather than an incident', async () => {
    thrown = badRequest('invalid_request', 'Invalid search body.');
    await get();
    expect(logError).not.toHaveBeenCalled();
  });

  // ── Retry-After ──

  it('emits Retry-After for a 503 that names a cooldown', async () => {
    thrown = serviceUnavailable('search_failed', 'Vector search failed.', {
      retryAfterSeconds: 30,
    });
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBe('30');
  });

  it('omits Retry-After when recovery time is unknown', async () => {
    // A 503 without a cooldown is honest; a guessed one is not. RFC 9110 §10.2.3
    // makes the header a SHOULD, not a MUST, for exactly this case.
    thrown = serviceUnavailable('search_failed', 'Vector search failed.');
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBeNull();
  });

  // ── The cause reaches the operator, and only the operator ──

  it('logs the upstream cause without putting it in the response', async () => {
    // The regression this exists for: mapping a structured upstream failure into
    // an AppError used to discard it, because the handler serializes the AppError,
    // whose message is a fixed client-safe literal. The operator got a 503 and no
    // diagnosis — the same silent failure A6 removes, relocated one hop.
    const upstream = new Error(
      'GET http://qdrant.internal:6333/collections?api-key=sk-live-SECRET-9f3a failed',
    );
    thrown = serviceUnavailable('search_failed', 'Vector search failed.', {
      retryAfterSeconds: 30,
      logCause: upstream,
    });
    const r = await get();

    expect((lastLogContext().err as AppError).logCause).toBe(upstream);
    expect(r.json.error.message).toBe('Vector search failed.');
    // Against the raw text, not the parsed body: a leak anywhere in the envelope
    // — a nested field, a stack, a stray key — has to fail this.
    expect(r.raw).not.toContain('sk-live-SECRET-9f3a');
    expect(r.raw).not.toContain('qdrant.internal');
  });

  it('passes no sibling cause key, so the log has one copy rather than two', async () => {
    // pino runs its error serializer only on `err`; a top-level `cause` would be
    // serialized as bare own properties and lose an Error's message and stack
    // entirely. One copy, inside `err`, is the complete one.
    thrown = serviceUnavailable('search_failed', 'Vector search failed.', {
      logCause: new Error('ECONNREFUSED'),
    });
    await get();
    expect(lastLogContext()).not.toHaveProperty('cause');
  });

  it('leaves logCause undefined when the error carries none', async () => {
    // Every pre-existing 5xx therefore logs what it logged before this change:
    // pino omits undefined values, so no new field appears.
    thrown = new AppError(500, 'internal', 'Something broke');
    await get();
    expect((lastLogContext().err as AppError).logCause).toBeUndefined();
  });

  it('logs a 5xx once, with the request id that the client was given', async () => {
    // The id is what joins the client's 503 to this log line; a 503 you cannot
    // trace to a log line is half an answer.
    thrown = serviceUnavailable('embedding_failed', 'Failed to embed the query.');
    const r = await get();
    const ctx = lastLogContext();
    expect(ctx.requestId).toBe(r.json.requestId);
    expect(logError.mock.calls[0]![1]).toBe('Failed to embed the query.');
  });

  // ── The two non-AppError branches ──

  it('renders a ZodError as a 400 with per-field issues', async () => {
    thrown = z.object({ text: z.string().min(1) }).safeParse({ text: '' }).error;
    const r = await get();
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('validation_error');
    expect(r.json.error.issues[0].path).toBe('text');
    expect(logError).not.toHaveBeenCalled();
  });

  it('renders an unrecognised throw as a 500 that reveals nothing', async () => {
    thrown = new Error('connection string postgres://user:hunter2@db/app');
    const r = await get();
    expect(r.status).toBe(500);
    expect(r.json.error).toEqual({ code: 'internal_error', message: 'Internal server error' });
    expect(r.raw).not.toContain('hunter2');
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('answers an unmatched route with 404 before reaching the error handler', async () => {
    const r = await get('/nope');
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('not_found');
    expect(logError).not.toHaveBeenCalled();
  });
});

/**
 * The assertions above prove the handler *hands* the cause to the logger. They
 * cannot prove an operator ever reads it — that depends on how pino serializes
 * the field, which is not a given: the obvious implementation, native
 * `Error.cause`, is dropped in full. So the guarantee is pinned against a real
 * pino instance and a real destination, no mock in the path.
 */
describe('logCause serialization', () => {
  /** A real pino writing to memory — the transport an operator actually reads. */
  function captureLog(context: object, message: string): Json {
    const lines: string[] = [];
    pino({ level: 'error' }, { write: (s: string) => lines.push(s) }).error(context, message);
    return JSON.parse(lines[0]!);
  }

  it('emits the upstream type, message and stack under err.logCause', async () => {
    const upstream = new Error('connect ECONNREFUSED 127.0.0.1:6333');
    upstream.name = 'QdrantError';
    const line = captureLog(
      { err: serviceUnavailable('search_failed', 'Vector search failed.', { logCause: upstream }) },
      'Vector search failed.',
    );

    // The client-safe literal is what the client got; the operator needs more.
    expect(line.err.message).toBe('Vector search failed.');
    expect(line.err.logCause.message).toBe('connect ECONNREFUSED 127.0.0.1:6333');
    expect(line.err.logCause.stack).toContain('QdrantError');
  });

  it('would lose a native Error.cause entirely — which is why the field exists', async () => {
    // `super(msg, { cause })` defines `cause` non-enumerably, and this logger uses
    // pino's default `err` serializer (config/logger.ts sets `redact` and level
    // only), which copies own *enumerable* properties. Anyone tempted to replace
    // `logCause` with the standard field has to make this test fail first.
    const upstream = new Error('connect ECONNREFUSED 127.0.0.1:6333');
    const line = captureLog(
      { err: new Error('Vector search failed.', { cause: upstream }) },
      'Vector search failed.',
    );
    expect(line.err.cause).toBeUndefined();
  });
});

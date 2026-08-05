import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

/**
 * Rare, optional metadata for an `AppError`.
 *
 * A trailing options bag rather than more positional parameters, matching the
 * shape the repository already uses for its other error classes — `EmbeddingError`
 * (`semantic/embedding/embeddingTypes.ts`) and `QdrantError`
 * (`semantic/qdrant/qdrantTypes.ts`) both take `(code, message, options = {})`.
 * `status`, `code`, `message` and `expose` stay positional because ~15 existing
 * call sites already pass them that way.
 */
export interface AppErrorOptions {
  /**
   * Seconds the client should wait before retrying, emitted as `Retry-After`
   * (RFC 9110 §10.2.3, which says a 503 SHOULD carry one). Omitted — the default —
   * means no header, so every pre-existing `AppError` behaves exactly as before.
   *
   * It lives on the error rather than being set at the throw site because the
   * throw sites are inside `toHttpError`-style mappers that have no `res`; the
   * error handler is the one place that owns writing the response.
   */
  retryAfterSeconds?: number;
  /**
   * The original failure this error was translated from, kept for the log only.
   *
   * Without it, mapping a structured upstream failure (a `QdrantError` carrying
   * `connect ECONNREFUSED 127.0.0.1:6333`) into an `AppError` discards the entire
   * diagnosis: the handler serializes the `AppError`, whose message is a fixed
   * client-safe literal, so the operator gets a 503 with nothing to act on. That
   * is the same silent failure this increment exists to remove, merely moved from
   * the client to the operator.
   *
   * It is deliberately NOT the standard `Error.cause`, and not for style. Setting
   * a cause via `super(msg, { cause })` makes it **non-enumerable**, and pino's
   * default `err` serializer only copies own *enumerable* properties — so the
   * whole cause vanishes from the log line unless the logger is reconfigured with
   * `pino.stdSerializers.errWithCause`, which `config/logger.ts` does not do. A
   * plain assigned field is enumerable, so the serializer walks it and emits the
   * upstream `type`, `message` and `stack`. Verified against pino 9.14.0 and
   * pinned by the serialization test in `error.test.ts`; the standard-looking
   * option is the one that silently loses the diagnosis.
   */
  logCause?: unknown;
}

/** A typed application error carrying an HTTP status and a stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;
  readonly retryAfterSeconds: number | null;
  readonly logCause: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    expose = true,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.logCause = options.logCause;
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (code = 'unauthorized', msg = 'Unauthorized') =>
  new AppError(401, code, msg);
export const forbidden = (code = 'forbidden', msg = 'Forbidden') => new AppError(403, code, msg);
export const notFound = (code = 'not_found', msg = 'Not found') => new AppError(404, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
/**
 * A dependency this request needed is temporarily unreachable — distinct from a
 * 500, which says the server itself faulted. Pass `retryAfterSeconds` when the
 * caller can be given an honest cooldown; omit it when recovery time is unknown.
 * Pass `logCause` with the upstream failure so the log says *which* dependency
 * and *why*, since `msg` here is a client-safe literal by design.
 */
export const serviceUnavailable = (code: string, msg: string, options: AppErrorOptions = {}) =>
  new AppError(503, code, msg, true, options);

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId: req.id,
    });
    return;
  }

  if (err instanceof AppError) {
    // The cause rides along inside `err` — it is an own enumerable field on
    // `AppError`, so pino's error serializer emits it as `err.logCause` with the
    // upstream type, message and stack. It is deliberately NOT also passed as a
    // sibling key: pino applies the error serializer only to `err`, so a
    // top-level `cause` would serialize as bare own properties — `{}` for a plain
    // `Error`, whose message and stack are non-enumerable — i.e. a duplicate that
    // holds strictly less than the copy already in `err`.
    if (err.status >= 500) logger.error({ err, requestId: req.id }, err.message);
    if (err.retryAfterSeconds != null) res.setHeader('Retry-After', String(err.retryAfterSeconds));
    res.status(err.status).json({
      error: { code: err.code, message: err.expose ? err.message : 'Internal server error' },
      requestId: req.id,
    });
    return;
  }

  logger.error({ err, requestId: req.id }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error' },
    requestId: req.id,
  });
}

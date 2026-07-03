import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

/** A typed application error carrying an HTTP status and a stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, expose = true) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (code = 'unauthorized', msg = 'Unauthorized') =>
  new AppError(401, code, msg);
export const forbidden = (code = 'forbidden', msg = 'Forbidden') => new AppError(403, code, msg);
export const notFound = (code = 'not_found', msg = 'Not found') => new AppError(404, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);

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
    if (err.status >= 500) logger.error({ err, requestId: req.id }, err.message);
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

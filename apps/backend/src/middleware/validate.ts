import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates and replaces req.body with the parsed result. Throws a ZodError
 * (handled centrally by errorHandler) on failure. Returns a typed handler
 * wrapper so downstream code gets a fully-typed, trusted body.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req.body);
    req.body = parsed as z.infer<S>;
    next();
  };
}

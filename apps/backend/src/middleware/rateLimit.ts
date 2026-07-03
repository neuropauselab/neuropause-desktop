import type { NextFunction, Request, Response } from 'express';
import { redis } from '../cache/redis';
import { AppError } from './error';

interface RateLimitOptions {
  /** Window length in seconds. */
  windowSeconds: number;
  /** Max requests per key per window. */
  max: number;
  /** Distinguishes limiter buckets, e.g. 'login'. */
  bucket: string;
}

/**
 * Fixed-window limiter backed by Redis (INCR + EXPIRE). Keyed by bucket + IP.
 * Fails open if Redis is unavailable so an outage never locks everyone out.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? 'unknown';
    const key = `rl:${opts.bucket}:${ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSeconds);
      const remaining = Math.max(0, opts.max - count);
      res.setHeader('x-ratelimit-limit', String(opts.max));
      res.setHeader('x-ratelimit-remaining', String(remaining));
      if (count > opts.max) {
        throw new AppError(429, 'rate_limited', 'Too many requests, please slow down');
      }
      next();
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      // Redis down -> fail open.
      next();
    }
  };
}

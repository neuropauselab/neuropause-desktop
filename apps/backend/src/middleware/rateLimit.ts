import type { NextFunction, Request, Response } from 'express';
import { redis } from '../cache/redis';
import { logger } from '../config/logger';
import { recordRateLimitFallback } from '../observability/metrics';
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
 * In-process fixed-window fallback state, engaged ONLY when Redis is
 * unavailable (TD-3). Previously the limiter failed fully open on a Redis
 * outage, disabling brute-force protection on login/registration/password-reset.
 * Now a per-process limiter keeps enforcing during the outage.
 *
 * Trade-off (documented, honest): this state is per backend instance, not
 * shared. With N instances an attacker can get at most N× the window budget —
 * bounded and small, versus UNBOUNDED when failing fully open. Entries
 * self-expire at the window boundary; the map is capped to bound memory under
 * an IP-spray.
 */
interface FallbackWindow {
  count: number;
  resetAt: number;
}
const fallbackStore = new Map<string, FallbackWindow>();
const FALLBACK_MAX_KEYS = 50_000;

function fallbackHit(
  key: string,
  windowMs: number,
  max: number,
  now: number,
): { limited: boolean; remaining: number } {
  let win = fallbackStore.get(key);
  if (!win || now >= win.resetAt) {
    // Opportunistically prune expired entries when the map grows large, so a
    // burst of distinct IPs during an outage cannot grow memory without bound.
    if (fallbackStore.size >= FALLBACK_MAX_KEYS) {
      for (const [k, v] of fallbackStore) if (now >= v.resetAt) fallbackStore.delete(k);
    }
    win = { count: 0, resetAt: now + windowMs };
    fallbackStore.set(key, win);
  }
  win.count += 1;
  return { limited: win.count > max, remaining: Math.max(0, max - win.count) };
}

/**
 * Throttled degradation warning — at most once per bucket per window (capped at
 * 60s) so a Redis outage does not flood the logs on every request.
 */
const lastWarnedAt = new Map<string, number>();
function warnDegraded(bucket: string, windowMs: number, now: number): void {
  const last = lastWarnedAt.get(bucket) ?? 0;
  if (now - last >= Math.min(windowMs, 60_000)) {
    lastWarnedAt.set(bucket, now);
    logger.warn(
      { bucket },
      'Rate limiter degraded to in-process fallback (Redis unavailable) — per-instance enforcement in effect',
    );
  }
}

/**
 * Fixed-window limiter backed by Redis (INCR + EXPIRE), keyed by bucket + IP.
 * On a Redis outage it does NOT fail open: it engages the in-process fallback
 * limiter above and emits an alertable metric + throttled warning (TD-3).
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
      // Redis unavailable -> engage the in-process fallback limiter instead of
      // failing open, so brute-force protection stays on during the outage.
      const now = Date.now();
      recordRateLimitFallback(opts.bucket);
      warnDegraded(opts.bucket, opts.windowSeconds * 1000, now);
      const { limited, remaining } = fallbackHit(key, opts.windowSeconds * 1000, opts.max, now);
      res.setHeader('x-ratelimit-limit', String(opts.max));
      res.setHeader('x-ratelimit-remaining', String(remaining));
      res.setHeader('x-ratelimit-mode', 'fallback');
      if (limited) {
        next(new AppError(429, 'rate_limited', 'Too many requests, please slow down'));
        return;
      }
      next();
    }
  };
}

/** Test helper — clears the in-process fallback state. */
export function resetRateLimitFallback(): void {
  fallbackStore.clear();
  lastWarnedAt.clear();
}

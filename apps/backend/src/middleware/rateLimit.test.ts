import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * TD-3 regression: the auth rate limiter must NOT fail fully open when Redis is
 * unavailable. Previously a Redis outage disabled brute-force protection on
 * login/registration/password-reset entirely. Now an in-process fixed-window
 * fallback keeps enforcing per instance, and an alertable metric is emitted.
 */

// Controllable Redis mock: flip `redisDown` to simulate an outage.
let redisDown = false;
const redisStore = new Map<string, number>();
vi.mock('../cache/redis', () => ({
  redis: {
    async incr(key: string): Promise<number> {
      if (redisDown) throw new Error('Redis unavailable');
      redisStore.set(key, (redisStore.get(key) ?? 0) + 1);
      return redisStore.get(key)!;
    },
    async expire(): Promise<number> {
      if (redisDown) throw new Error('Redis unavailable');
      return 1;
    },
  },
}));

// Keep the degradation warning out of test output.
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { rateLimit, resetRateLimitFallback } from './rateLimit';
import { renderMetrics, resetMetrics } from '../observability/metrics';
import { AppError } from './error';

function mockReqRes(ip: string) {
  const headers: Record<string, string> = {};
  const req = { ip } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = String(v);
    },
  } as unknown as Response;
  return { req, res, headers };
}

async function run(mw: ReturnType<typeof rateLimit>, ip: string) {
  const { req, res, headers } = mockReqRes(ip);
  let error: unknown = null;
  let passed = false;
  const next: NextFunction = ((err?: unknown) => {
    if (err) error = err;
    else passed = true;
  }) as NextFunction;
  await mw(req, res, next);
  return { headers, error, passed };
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    redisDown = false;
    redisStore.clear();
    resetRateLimitFallback();
    resetMetrics();
  });

  describe('Redis available (normal path)', () => {
    it('allows requests under the limit and sets headers', async () => {
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 3 });
      const r = await run(mw, '1.1.1.1');
      expect(r.passed).toBe(true);
      expect(r.error).toBeNull();
      expect(r.headers['x-ratelimit-limit']).toBe('3');
      expect(r.headers['x-ratelimit-remaining']).toBe('2');
      expect(r.headers['x-ratelimit-mode']).toBeUndefined();
    });

    it('returns 429 once over the limit', async () => {
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 2 });
      await run(mw, '2.2.2.2');
      await run(mw, '2.2.2.2');
      const r = await run(mw, '2.2.2.2'); // 3rd > max 2
      expect(r.passed).toBe(false);
      expect(r.error).toBeInstanceOf(AppError);
      expect((r.error as AppError).status).toBe(429);
      expect((r.error as AppError).code).toBe('rate_limited');
    });
  });

  describe('Redis unavailable (TD-3 fail-closed fallback)', () => {
    it('engages the in-process fallback (does not fail open) and marks the response', async () => {
      redisDown = true;
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 3 });
      const r = await run(mw, '3.3.3.3');
      expect(r.passed).toBe(true); // under the fallback limit -> allowed
      expect(r.headers['x-ratelimit-mode']).toBe('fallback'); // but via the fallback path
    });

    it('BLOCKS brute force during a Redis outage (429 over the fallback limit)', async () => {
      redisDown = true;
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 3 });
      for (let i = 0; i < 3; i++) await run(mw, '4.4.4.4'); // exhaust the window
      const r = await run(mw, '4.4.4.4'); // 4th > max 3 — previously this FAILED OPEN
      expect(r.passed).toBe(false);
      expect(r.error).toBeInstanceOf(AppError);
      expect((r.error as AppError).status).toBe(429);
    });

    it('is per-IP: a different IP is not penalised by another IP exhausting its window', async () => {
      redisDown = true;
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 2 });
      await run(mw, '5.5.5.5');
      await run(mw, '5.5.5.5'); // exhaust IP A
      const blockedA = await run(mw, '5.5.5.5');
      const freshB = await run(mw, '6.6.6.6');
      expect(blockedA.passed).toBe(false);
      expect(freshB.passed).toBe(true);
    });

    it('emits an alertable neuropause_ratelimit_fallback_total metric, by bucket', async () => {
      redisDown = true;
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 5 });
      await run(mw, '7.7.7.7');
      await run(mw, '7.7.7.8');
      const out = renderMetrics();
      expect(out).toContain('# TYPE neuropause_ratelimit_fallback_total counter');
      expect(out).toMatch(/neuropause_ratelimit_fallback_total\{bucket="login"\} 2/);
    });

    it('recovers the window after it expires (does not permanently lock an IP)', async () => {
      redisDown = true;
      const mw = rateLimit({ bucket: 'login', windowSeconds: 1, max: 1 });
      await run(mw, '9.9.9.9'); // uses the single allowed request
      const blocked = await run(mw, '9.9.9.9'); // 2nd blocked within the window
      expect(blocked.passed).toBe(false);
      await new Promise((r) => setTimeout(r, 1100)); // advance past the 1s window
      const afterReset = await run(mw, '9.9.9.9');
      expect(afterReset.passed).toBe(true);
    });

    it('resumes the normal Redis path once Redis recovers', async () => {
      const mw = rateLimit({ bucket: 'login', windowSeconds: 900, max: 2 });
      redisDown = true;
      const during = await run(mw, '8.8.8.8');
      expect(during.headers['x-ratelimit-mode']).toBe('fallback');
      redisDown = false;
      const after = await run(mw, '8.8.8.8');
      expect(after.passed).toBe(true);
      expect(after.headers['x-ratelimit-mode']).toBeUndefined(); // back on the Redis path
    });
  });
});

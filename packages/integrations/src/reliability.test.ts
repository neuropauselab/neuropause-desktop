import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { backoffDelay, withRetry, CircuitBreaker, withTimeout, TimeoutError, parseRetryAfter, DEFAULT_RETRY } from './reliability';

describe('reliability primitives', () => {
  it('computes bounded exponential backoff with deterministic jitter', () => {
    const rng = () => 0; // no jitter reduction
    expect(backoffDelay(1, DEFAULT_RETRY, rng)).toBe(200);
    expect(backoffDelay(2, DEFAULT_RETRY, rng)).toBe(400);
    expect(backoffDelay(3, DEFAULT_RETRY, rng)).toBe(800);
    expect(backoffDelay(20, DEFAULT_RETRY, rng)).toBe(DEFAULT_RETRY.maxDelayMs); // capped
    expect(backoffDelay(1, DEFAULT_RETRY, () => 1)).toBe(160); // full jitter: 200*(1-0.2)
  });

  it('retries then succeeds, and honors shouldRetry', async () => {
    let attempts = 0;
    const out = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      { sleep: async () => undefined },
    );
    expect(out).toBe('ok');
    expect(attempts).toBe(3);

    let tries = 0;
    await expect(
      withRetry(
        async () => {
          tries += 1;
          throw new Error('fatal');
        },
        { sleep: async () => undefined, shouldRetry: () => false },
      ),
    ).rejects.toThrow('fatal');
    expect(tries).toBe(1); // shouldRetry:false → no retry
  });

  it('circuit breaker opens, half-opens after cooldown, and re-opens on a failed trial', () => {
    const clock = new ManualClock(0);
    const cb = new CircuitBreaker(clock, { failureThreshold: 2, resetTimeoutMs: 1000 });
    expect(cb.allow()).toBe(true);
    cb.record(false);
    cb.record(false);
    expect(cb.state()).toBe('open');
    expect(cb.allow()).toBe(false);
    clock.advance(1000);
    expect(cb.state()).toBe('half-open');
    expect(cb.allow()).toBe(true);
    cb.record(false); // trial fails → re-open
    expect(cb.allow()).toBe(false);
    clock.advance(1000);
    cb.allow();
    cb.record(true); // trial succeeds → closed
    expect(cb.state()).toBe('closed');
  });

  it('withTimeout rejects slow work and clears its timer', async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 50)), 5)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve('fast'), 50)).resolves.toBe('fast');
  });

  it('parses Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('30', 0)).toBe(30_000);
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBeGreaterThanOrEqual(9000);
  });
});

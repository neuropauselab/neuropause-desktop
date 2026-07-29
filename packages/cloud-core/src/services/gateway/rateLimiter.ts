/**
 * Token-bucket rate limiter (NCEA 10.2) — REAL. Deterministic under a ManualClock:
 * each key gets a bucket that refills at `refillPerSec` up to `capacity`.
 */
import type { Clock } from '../../lib/clock';

export interface RateLimitOptions {
  capacity: number;
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  last: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly clock: Clock,
    private readonly opts: RateLimitOptions,
  ) {}

  allow(key: string, cost = 1): boolean {
    const now = this.clock.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.opts.capacity, last: now };
    const elapsedSec = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(this.opts.capacity, bucket.tokens + elapsedSec * this.opts.refillPerSec);
    bucket.last = now;
    const allowed = bucket.tokens >= cost;
    if (allowed) bucket.tokens -= cost;
    this.buckets.set(key, bucket);
    return allowed;
  }
}

/**
 * Enterprise reliability (NCEA 13.0, Phase 7). Deterministic, testable primitives
 * every adapter shares: exponential backoff with jitter, a retry driver, a
 * circuit breaker (closed → open → half-open), a timeout wrapper, and rate-limit
 * recovery (Retry-After). Everything takes an injected clock/rng/sleep so the
 * logic is VERIFIED without wall-clock flakiness. Adapters compose these; they do
 * not reimplement them.
 */
import type { Clock } from '@neuropause/cloud-core';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter fraction in [0,1]; the delay is scaled by (1 - jitter*rng). */
  jitter: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 200, maxDelayMs: 10_000, jitter: 0.2 };

/** Exponential backoff for a 1-based attempt number. `rng` in [0,1) is injectable. */
export function backoffDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY, rng: () => number = Math.random): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(exp * (1 - policy.jitter * rng()));
}

export interface RetryOptions {
  policy?: RetryPolicy;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

/** Run `fn`, retrying per policy while `shouldRetry` holds. `sleep` is injectable. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const policy = opts.policy ?? DEFAULT_RETRY;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts || !shouldRetry(error, attempt)) break;
      const delay = backoffDelay(attempt, policy, opts.rng ?? Math.random);
      opts.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

/** A circuit breaker: opens after N consecutive failures, half-opens after a cooldown. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;

  constructor(
    private readonly clock: Clock,
    private readonly opts: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 },
  ) {}

  state(): CircuitState {
    if (this.failures < this.opts.failureThreshold) return 'closed';
    if (this.clock.now() - this.openedAt >= this.opts.resetTimeoutMs) return 'half-open';
    return 'open';
  }

  /** True if a call may proceed (closed, or a single trial in half-open). */
  allow(): boolean {
    const s = this.state();
    if (s === 'open') return false;
    if (s === 'half-open') this.halfOpen = true;
    return true;
  }

  record(ok: boolean): void {
    if (ok) {
      this.failures = 0;
      this.halfOpen = false;
      return;
    }
    if (this.halfOpen) {
      // a failed trial re-opens the circuit
      this.halfOpen = false;
      this.openedAt = this.clock.now();
      this.failures = this.opts.failureThreshold;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) this.openedAt = this.clock.now();
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Reject with TimeoutError if `work` outlives `ms`. Clears its timer. */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parse a Retry-After header (seconds or HTTP-date) into a delay in ms. */
export function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

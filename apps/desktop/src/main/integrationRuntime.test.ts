import { describe, expect, it } from 'vitest';
import {
  canTransition,
  computeRetryDelay,
  shouldRetryIntegration,
  nextRetryAt,
  createRateLimitState,
  refillRateLimit,
  consumeRateLimit,
  rateLimitAvailableAt,
  selectSyncMode,
  computeSyncProgress,
  nextScheduledSyncAt,
  createCancellation,
} from '@neuropause/shared';

describe('integrationRuntime — lifecycle', () => {
  it('permits valid transitions only', () => {
    expect(canTransition('idle', 'connecting')).toBe(true);
    expect(canTransition('connected', 'syncing')).toBe(true);
    expect(canTransition('syncing', 'connected')).toBe(true);
    expect(canTransition('reauth_required', 'authenticating')).toBe(true);
    expect(canTransition('idle', 'syncing')).toBe(false);
    expect(canTransition('disconnected', 'syncing')).toBe(false);
  });
});

describe('integrationRuntime — retry/backoff', () => {
  it('computes deterministic capped exponential backoff', () => {
    expect(computeRetryDelay(1)).toBe(1000);
    expect(computeRetryDelay(2)).toBe(2000);
    expect(computeRetryDelay(3)).toBe(4000);
    expect(computeRetryDelay(10)).toBe(60_000);
    expect(computeRetryDelay(0)).toBe(0);
  });

  it('gates retries by policy + retryable', () => {
    expect(shouldRetryIntegration(1, true)).toBe(true);
    expect(shouldRetryIntegration(6, true)).toBe(false);
    expect(shouldRetryIntegration(1, false)).toBe(false);
  });

  it('computes the next retry time', () => {
    expect(nextRetryAt(0, 1000)).toBeNull();
    expect(nextRetryAt(2, 1000)).toBe(1000 + 2000);
    expect(nextRetryAt(6, 1000)).toBeNull();
  });
});

describe('integrationRuntime — token bucket rate limiting', () => {
  it('refills and consumes deterministically', () => {
    const rl = createRateLimitState({ requestsPerInterval: 10, intervalMs: 1000 }, 0);
    expect(rl.tokens).toBe(10);
    const c1 = consumeRateLimit(rl, 0, 4);
    expect(c1.ok).toBe(true);
    expect(c1.state.tokens).toBe(6);
    const empty = consumeRateLimit({ ...c1.state, tokens: 0 }, 0, 1);
    expect(empty.ok).toBe(false);
    const refilled = refillRateLimit({ ...c1.state, tokens: 0, lastRefillMs: 0 }, 500);
    expect(refilled.tokens).toBeCloseTo(5, 5);
  });

  it('computes availability time', () => {
    const rl = createRateLimitState({ requestsPerInterval: 10, intervalMs: 1000 }, 0);
    expect(rateLimitAvailableAt(rl, 0, 5)).toBe(0);
    const drained = { ...rl, tokens: 0, lastRefillMs: 0 };
    expect(rateLimitAvailableAt(drained, 0, 1)).toBe(100);
  });
});

describe('integrationRuntime — sync mode/progress/schedule', () => {
  it('selects sync mode by preference', () => {
    expect(selectSyncMode(['full', 'incremental'])).toBe('incremental');
    expect(selectSyncMode(['full', 'manual'], 'manual')).toBe('manual');
    expect(selectSyncMode(['manual'])).toBe('manual');
    expect(selectSyncMode([])).toBeNull();
  });

  it('computes progress', () => {
    expect(computeSyncProgress(50, 100, 2, false).percent).toBe(50);
    expect(computeSyncProgress(100, 100, 2, false).percent).toBe(99);
    expect(computeSyncProgress(0, 0, 0, true).percent).toBe(100);
    expect(computeSyncProgress(5, 0, 1, false).percent).toBe(0);
  });

  it('schedules next sync with a due-now clamp', () => {
    expect(nextScheduledSyncAt(1000, 5000, 2000)).toBe(6000);
    expect(nextScheduledSyncAt(1000, 5000, 10_000)).toBe(10_000);
    expect(nextScheduledSyncAt(null, 5000, 2000)).toBe(7000);
  });
});

describe('integrationRuntime — cancellation', () => {
  it('signals cancellation and throws on demand', () => {
    const c = createCancellation();
    expect(c.signal.cancelled).toBe(false);
    expect(() => c.signal.throwIfCancelled()).not.toThrow();
    c.cancel('stop');
    expect(c.signal.cancelled).toBe(true);
    expect(() => c.signal.throwIfCancelled()).toThrow('stop');
  });
});

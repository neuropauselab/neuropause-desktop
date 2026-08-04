import { describe, expect, it } from 'vitest';
import type { SemanticOutcome } from '@neuropause/shared';
import {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RESET_TIMEOUT_MS,
  RetrievalHealthTracker,
} from './retrievalHealth';

/** A manual clock — every breaker transition is tested without wall-clock flakiness. */
function clock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

function failure(over: Partial<Extract<SemanticOutcome, { state: 'failed' }>> = {}): SemanticOutcome {
  return {
    state: 'failed',
    kind: 'network',
    retryable: true,
    code: 'network_error',
    detail: 'fetch failed',
    latencyMs: 12,
    ...over,
  };
}

describe('RetrievalHealthTracker — breaker', () => {
  it('starts closed and admits calls', () => {
    const t = new RetrievalHealthTracker();
    expect(t.state()).toBe('closed');
    expect(t.allow()).toBe(true);
  });

  it('stays closed below the failure threshold', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 3 });
    t.record(failure());
    t.record(failure());
    expect(t.state()).toBe('closed');
    expect(t.allow()).toBe(true);
  });

  it('opens on the Nth consecutive tripping failure and refuses calls', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 3 });
    t.record(failure());
    t.record(failure());
    t.record(failure());
    expect(t.state()).toBe('open');
    expect(t.allow()).toBe(false);
  });

  it('a success resets the consecutive count, so failures must be consecutive', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 3 });
    t.record(failure());
    t.record(failure());
    t.record({ state: 'ok', hits: 4, latencyMs: 30 });
    t.record(failure());
    t.record(failure());
    expect(t.state()).toBe('closed');
    expect(t.snapshot().consecutiveFailures).toBe(2);
  });

  it('half-opens once the cooldown elapses and admits exactly one trial', () => {
    const c = clock();
    const t = new RetrievalHealthTracker({ failureThreshold: 2, resetTimeoutMs: 30_000, now: c.now });
    t.record(failure());
    t.record(failure());
    expect(t.state()).toBe('open');

    c.advance(29_999);
    expect(t.state()).toBe('open');
    c.advance(1);
    expect(t.state()).toBe('half_open');
    expect(t.allow()).toBe(true);
  });

  it('closes again when the trial call succeeds', () => {
    const c = clock();
    const t = new RetrievalHealthTracker({ failureThreshold: 2, resetTimeoutMs: 1_000, now: c.now });
    t.record(failure());
    t.record(failure());
    c.advance(1_000);
    expect(t.allow()).toBe(true);
    t.record({ state: 'ok', hits: 2, latencyMs: 40 });
    expect(t.state()).toBe('closed');
    expect(t.snapshot().consecutiveFailures).toBe(0);
  });

  it('re-opens for a fresh cooldown when the trial call fails', () => {
    const c = clock();
    const t = new RetrievalHealthTracker({ failureThreshold: 2, resetTimeoutMs: 1_000, now: c.now });
    t.record(failure());
    t.record(failure());
    c.advance(1_000);
    expect(t.allow()).toBe(true);
    t.record(failure());

    expect(t.state()).toBe('open');
    c.advance(999);
    expect(t.state()).toBe('open');
    c.advance(1);
    expect(t.state()).toBe('half_open');
  });

  it('does not trip on backend_error — one rejected query must not blind the process', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 2 });
    t.record(failure({ kind: 'backend_error', retryable: false, code: 'invalid_request' }));
    t.record(failure({ kind: 'backend_error', retryable: false, code: 'invalid_request' }));
    t.record(failure({ kind: 'backend_error', retryable: false, code: 'invalid_request' }));
    expect(t.state()).toBe('closed');
    expect(t.snapshot().consecutiveFailures).toBe(0);
    expect(t.snapshot().totals.failures).toBe(3);
  });

  it.each(['network', 'timeout', 'auth', 'dependency_down', 'malformed_response'] as const)(
    'trips on %s',
    (kind) => {
      const t = new RetrievalHealthTracker({ failureThreshold: 1 });
      t.record(failure({ kind }));
      expect(t.state()).toBe('open');
    },
  );

  it('never moves the breaker on a skip — no call was made', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 1 });
    t.record({ state: 'skipped', reason: 'no_org' });
    t.record({ state: 'skipped', reason: 'not_configured' });
    t.record({ state: 'skipped', reason: 'circuit_open' });
    expect(t.state()).toBe('closed');
    expect(t.snapshot().totals).toMatchObject({ attempts: 0, skipped: 3 });
  });

  it('clamps a nonsensical threshold to at least one failure', () => {
    const t = new RetrievalHealthTracker({ failureThreshold: 0 });
    t.record(failure());
    expect(t.state()).toBe('open');
  });
});

describe('RetrievalHealthTracker — snapshot', () => {
  it('is well-formed before anything has happened', () => {
    expect(new RetrievalHealthTracker().snapshot()).toEqual({
      breaker: 'closed',
      consecutiveFailures: 0,
      retryAt: null,
      lastOutcome: null,
      lastOutcomeAt: null,
      totals: { attempts: 0, successes: 0, failures: 0, skipped: 0 },
      avgSuccessLatencyMs: null,
    });
  });

  it('counts attempts as calls actually issued — skips are not attempts', () => {
    const t = new RetrievalHealthTracker();
    t.record({ state: 'ok', hits: 3, latencyMs: 10 });
    t.record(failure({ kind: 'backend_error', retryable: false, code: 'x' }));
    t.record({ state: 'skipped', reason: 'no_query_text' });
    expect(t.snapshot().totals).toEqual({ attempts: 2, successes: 1, failures: 1, skipped: 1 });
  });

  it('averages only successful latencies', () => {
    const t = new RetrievalHealthTracker();
    t.record({ state: 'ok', hits: 1, latencyMs: 100 });
    t.record({ state: 'ok', hits: 1, latencyMs: 51 });
    t.record(failure({ latencyMs: 5_000, kind: 'backend_error', retryable: false }));
    expect(t.snapshot().avgSuccessLatencyMs).toBe(76);
  });

  it('records the last outcome and when it happened', () => {
    const c = clock(Date.parse('2026-03-01T10:00:00.000Z'));
    const t = new RetrievalHealthTracker({ now: c.now });
    t.record({ state: 'ok', hits: 2, latencyMs: 20 });
    c.advance(5_000);
    const outcome = failure({ kind: 'timeout', code: 'timeout', detail: 'aborted after 4000ms' });
    t.record(outcome);

    const snap = t.snapshot();
    expect(snap.lastOutcome).toEqual(outcome);
    expect(snap.lastOutcomeAt).toBe('2026-03-01T10:00:05.000Z');
  });

  it('publishes retryAt only while the circuit is open', () => {
    const c = clock(Date.parse('2026-03-01T10:00:00.000Z'));
    const t = new RetrievalHealthTracker({ failureThreshold: 1, resetTimeoutMs: 30_000, now: c.now });
    expect(t.snapshot().retryAt).toBeNull();

    t.record(failure());
    expect(t.snapshot()).toMatchObject({ breaker: 'open', retryAt: '2026-03-01T10:00:30.000Z' });

    c.advance(30_000);
    expect(t.snapshot()).toMatchObject({ breaker: 'half_open', retryAt: null });
  });

  it('uses the documented defaults', () => {
    const c = clock();
    const t = new RetrievalHealthTracker({ now: c.now });
    for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD - 1; i++) t.record(failure());
    expect(t.state()).toBe('closed');
    t.record(failure());
    expect(t.state()).toBe('open');

    c.advance(DEFAULT_RESET_TIMEOUT_MS - 1);
    expect(t.state()).toBe('open');
    c.advance(1);
    expect(t.state()).toBe('half_open');
  });
});

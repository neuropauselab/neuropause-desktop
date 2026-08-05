/**
 * Retrieval-status presentation (A6).
 *
 * The contract under test is mostly about restraint: this helper must say
 * nothing when there is nothing to report (pre-A6 producers, by-design lexical
 * modes) and must say something visible exactly when retrieval degraded. Both
 * halves matter — a false alarm on every browse trains users to ignore the
 * notice, which costs us the one case it exists for.
 */
import { describe, expect, it } from 'vitest';
import type { RetrievalDiagnostics, SemanticFailureKind, SemanticSkipReason } from '@neuropause/shared';
import { describeRetrieval, retrievalStatusForIpcFailure, retrievalStatusLine } from './retrievalStatus';

const FAILURE_KINDS: SemanticFailureKind[] = [
  'network',
  'timeout',
  'auth',
  'dependency_down',
  'backend_error',
  'malformed_response',
];

const SKIP_REASONS: SemanticSkipReason[] = ['no_org', 'not_configured', 'no_query_text', 'circuit_open'];

function failed(kind: SemanticFailureKind, over: Partial<{ retryable: boolean; detail: string }> = {}): RetrievalDiagnostics {
  return {
    mode: 'degraded',
    semantic: {
      state: 'failed',
      kind,
      retryable: over.retryable ?? true,
      code: 'test_code',
      detail: over.detail ?? 'Backend returned 503.',
      latencyMs: 42,
    },
  };
}

describe('describeRetrieval', () => {
  it('returns null when no envelope is present, so pre-A6 producers stay silent', () => {
    // The backward-compatibility contract: `retrieval` is optional, and a result
    // without one must render exactly as it did before this increment.
    expect(describeRetrieval(undefined)).toBeNull();
  });

  it('reports a healthy hybrid recall as not degraded', () => {
    const status = describeRetrieval({
      mode: 'hybrid',
      semantic: { state: 'ok', hits: 5, latencyMs: 120 },
    });
    expect(status).toEqual({ degraded: false, message: 'Keyword and semantic search.' });
  });

  it('treats a by-design lexical mode as not degraded', () => {
    // `no_query_text` happens on every empty-query browse. If this reported a
    // degradation the Memory view would show a warning on first open, forever.
    const status = describeRetrieval({
      mode: 'lexical',
      semantic: { state: 'skipped', reason: 'no_query_text' },
    });
    expect(status?.degraded).toBe(false);
    expect(status?.message).toContain('needs a question');
  });

  it('treats an open circuit breaker as degraded even though it is a skip', () => {
    // The whole reason this reads `mode` instead of `semantic.state`:
    // `retrievalModeFor` classifies `circuit_open` — a *skipped* leg — as
    // degraded, because the user is getting a keyword-only approximation.
    const status = describeRetrieval({
      mode: 'degraded',
      semantic: { state: 'skipped', reason: 'circuit_open' },
    });
    expect(status).toMatchObject({ degraded: true, retryable: true, detail: null });
    expect(status?.message).toContain('paused after repeated failures');
  });

  it('carries the failure detail and retryability through', () => {
    const status = describeRetrieval(failed('dependency_down', { retryable: true, detail: 'HTTP 503.' }));
    expect(status).toEqual({
      degraded: true,
      message: expect.stringContaining('temporarily unavailable'),
      retryable: true,
      detail: 'HTTP 503.',
    });
  });

  it('preserves a non-retryable failure as non-retryable', () => {
    // `auth` is classified retryable:false upstream (semanticFailure.ts). The UI
    // must not invite a user to "try again" when retrying cannot help.
    const status = describeRetrieval(failed('auth', { retryable: false }));
    expect(status).toMatchObject({ degraded: true, retryable: false });
  });

  it('normalizes an empty detail to null rather than rendering a blank line', () => {
    const status = describeRetrieval(failed('network', { detail: '' }));
    expect(status).toMatchObject({ degraded: true, detail: null });
  });

  it('produces a distinct, non-empty message for every failure kind', () => {
    // Guards the exhaustive Record: a new kind in shared fails the typecheck,
    // and a copy-pasted duplicate string fails here.
    const messages = FAILURE_KINDS.map((kind) => {
      const status = describeRetrieval(failed(kind));
      expect(status?.degraded).toBe(true);
      return status?.message ?? '';
    });
    expect(new Set(messages).size).toBe(FAILURE_KINDS.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it('produces a distinct, non-empty message for every skip reason', () => {
    const messages = SKIP_REASONS.map((reason) => {
      const mode: RetrievalDiagnostics['mode'] = reason === 'circuit_open' ? 'degraded' : 'lexical';
      return describeRetrieval({ mode, semantic: { state: 'skipped', reason } })?.message ?? '';
    });
    expect(new Set(messages).size).toBe(SKIP_REASONS.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it('tells the user results are still shown whenever it reports a degradation', () => {
    // A warning that reads like "search is broken" while results sit below it is
    // worse than no warning. Every degraded message must say what they ARE seeing.
    const degraded = [
      ...FAILURE_KINDS.map((k) => failed(k)),
      { mode: 'degraded', semantic: { state: 'skipped', reason: 'circuit_open' } } as RetrievalDiagnostics,
    ];
    for (const d of degraded) {
      expect(describeRetrieval(d)?.message).toContain('keyword matches only');
    }
  });
});

describe('retrievalStatusForIpcFailure', () => {
  it('always reports a degradation, since semantic search provably did not run', () => {
    const status = retrievalStatusForIpcFailure(new Error('Sign in to continue.'));
    expect(status.degraded).toBe(true);
    expect(status.message).toContain('keyword matches only');
  });

  it('surfaces the bridge message as the detail', () => {
    // This is how an RBAC denial on memory:semanticRecall ('intelligence:read')
    // becomes visible instead of being swallowed by a bare catch.
    expect(retrievalStatusForIpcFailure(new Error('Sign in to continue.')).detail).toBe(
      'Sign in to continue.',
    );
  });

  it('accepts a thrown string', () => {
    expect(retrievalStatusForIpcFailure('channel unavailable').detail).toBe('channel unavailable');
  });

  it('drops a non-error rejection instead of rendering [object Object]', () => {
    expect(retrievalStatusForIpcFailure({ code: 'nope' }).detail).toBeNull();
    expect(retrievalStatusForIpcFailure(undefined).detail).toBeNull();
    expect(retrievalStatusForIpcFailure(new Error('   ')).detail).toBeNull();
  });

  it('truncates a very long message so one rejection cannot swamp the UI', () => {
    const status = retrievalStatusForIpcFailure(new Error('x'.repeat(500)));
    expect(status.detail).not.toBeNull();
    expect(status.detail?.length).toBe(200);
    expect(status.detail?.endsWith('…')).toBe(true);
  });

  it('claims retryable, which never overstates a permanent loss of access', () => {
    expect(retrievalStatusForIpcFailure(new Error('boom')).retryable).toBe(true);
  });
});

describe('retrievalStatusLine', () => {
  it('returns the message alone when there is no detail', () => {
    const status = describeRetrieval({ mode: 'hybrid', semantic: { state: 'ok', hits: 1, latencyMs: 5 } });
    expect(retrievalStatusLine(status!)).toBe('Keyword and semantic search.');
  });

  it('appends the detail when there is one', () => {
    const status = describeRetrieval(failed('timeout', { detail: 'Deadline 4000ms exceeded.' }));
    expect(retrievalStatusLine(status!)).toBe(
      'Semantic search took too long to answer. Showing keyword matches only. Deadline 4000ms exceeded.',
    );
  });

  it('returns the message alone for a degraded status carrying no detail', () => {
    const status = describeRetrieval({
      mode: 'degraded',
      semantic: { state: 'skipped', reason: 'circuit_open' },
    });
    expect(retrievalStatusLine(status!)).toBe(status!.message);
  });
});

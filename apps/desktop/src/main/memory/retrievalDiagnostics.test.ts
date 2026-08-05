import { describe, expect, it } from 'vitest';
import type { SemanticOutcome } from '@neuropause/shared';
import {
  buildRetrievalDiagnostics,
  retrievalModeFor,
  semanticSkipReason,
} from './retrievalDiagnostics';

const OK: SemanticOutcome = { state: 'ok', hits: 3, latencyMs: 42 };
const FAILED: SemanticOutcome = {
  state: 'failed',
  kind: 'dependency_down',
  retryable: true,
  code: 'qdrant_unavailable',
  detail: 'Vector store unreachable.',
  latencyMs: 4_000,
};

describe('semanticSkipReason', () => {
  it('runs semantic when a source, an org, and text are all present', () => {
    expect(semanticSkipReason({ hasSource: true, orgId: 'org-1', text: 'deck' })).toBeNull();
  });

  it('reports not_configured when no source is wired', () => {
    expect(semanticSkipReason({ hasSource: false, orgId: 'org-1', text: 'deck' })).toBe(
      'not_configured',
    );
  });

  it('reports no_org when a source exists but no org does', () => {
    expect(semanticSkipReason({ hasSource: true, orgId: undefined, text: 'deck' })).toBe('no_org');
  });

  it('treats an empty-string org as absent — semantic never runs on a guessed namespace', () => {
    expect(semanticSkipReason({ hasSource: true, orgId: '', text: 'deck' })).toBe('no_org');
  });

  it('reports no_query_text for text that is only whitespace', () => {
    expect(semanticSkipReason({ hasSource: true, orgId: 'org-1', text: '   \n\t ' })).toBe(
      'no_query_text',
    );
  });

  it('reports the broadest cause first, so the reason explains the others', () => {
    // Nothing is configured here at all; "not_configured" is the fact that makes
    // the missing org and the empty text irrelevant.
    expect(semanticSkipReason({ hasSource: false, orgId: undefined, text: '' })).toBe(
      'not_configured',
    );
    expect(semanticSkipReason({ hasSource: true, orgId: undefined, text: '' })).toBe('no_org');
  });
});

describe('retrievalModeFor', () => {
  it('calls a served semantic leg hybrid', () => {
    expect(retrievalModeFor(OK)).toBe('hybrid');
  });

  it('calls a failed semantic leg degraded', () => {
    expect(retrievalModeFor(FAILED)).toBe('degraded');
  });

  it('calls a by-design skip lexical, not degraded — nothing is broken', () => {
    expect(retrievalModeFor({ state: 'skipped', reason: 'not_configured' })).toBe('lexical');
    expect(retrievalModeFor({ state: 'skipped', reason: 'no_org' })).toBe('lexical');
    expect(retrievalModeFor({ state: 'skipped', reason: 'no_query_text' })).toBe('lexical');
  });

  it('calls an open circuit degraded even though it is a skip — the breaker opened because of failures', () => {
    expect(retrievalModeFor({ state: 'skipped', reason: 'circuit_open' })).toBe('degraded');
  });
});

describe('buildRetrievalDiagnostics', () => {
  it('carries the outcome and the measured pool size', () => {
    expect(buildRetrievalDiagnostics(OK, 17)).toEqual({
      mode: 'hybrid',
      semantic: OK,
      lexicalCandidates: 17,
    });
  });

  it('keeps a genuine zero — the lexical leg really did find nothing', () => {
    expect(buildRetrievalDiagnostics(OK, 0).lexicalCandidates).toBe(0);
  });

  it('omits the count entirely when the producer could not observe the pool', () => {
    const d = buildRetrievalDiagnostics(FAILED);
    expect('lexicalCandidates' in d).toBe(false);
    expect(d.mode).toBe('degraded');
  });

  it('omits rather than reports a count that is not a finite number', () => {
    expect('lexicalCandidates' in buildRetrievalDiagnostics(OK, Number.NaN)).toBe(false);
    expect('lexicalCandidates' in buildRetrievalDiagnostics(OK, Number.POSITIVE_INFINITY)).toBe(
      false,
    );
  });

  it('clamps a nonsensical count instead of publishing it', () => {
    expect(buildRetrievalDiagnostics(OK, -5).lexicalCandidates).toBe(0);
    expect(buildRetrievalDiagnostics(OK, 12.9).lexicalCandidates).toBe(12);
  });
});

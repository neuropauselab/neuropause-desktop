import { describe, expect, it } from 'vitest';
import { classifySemanticError, safeDetail, SemanticUnavailableError } from './semanticFailure';

/** Mirrors the shape `BackendSemanticError` throws, without importing it (no cycle). */
function statusError(status: number, code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { status, code });
}

describe('safeDetail', () => {
  it('falls back when there is no message', () => {
    expect(safeDetail(undefined, 'fallback')).toBe('fallback');
    expect(safeDetail('   ', 'fallback')).toBe('fallback');
  });

  it('redacts a bearer token', () => {
    expect(safeDetail('rejected Authorization: Bearer abc.def.ghi', 'x')).toBe(
      'rejected Authorization: Bearer [redacted]',
    );
  });

  it('redacts a URL query string but keeps the path', () => {
    expect(safeDetail('GET https://api.example.com/search?token=s3cret&q=hi failed', 'x')).toBe(
      'GET https://api.example.com/search?[redacted] failed',
    );
  });

  it('redacts a token-like run without eating ordinary words', () => {
    const detail = safeDetail(
      'session eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 rejected by the authorization service',
      'x',
    );
    expect(detail).toBe('session [redacted] rejected by the authorization service');
  });

  it('collapses whitespace and caps the length so an HTML error page cannot flood the UI', () => {
    const detail = safeDetail(`<html>\n  ${'a'.repeat(5_000)}\n</html>`, 'x');
    expect(detail).toHaveLength(300);
    expect(detail.endsWith('…')).toBe(true);
  });
});

describe('classifySemanticError', () => {
  it('classifies an aborted call as a retryable timeout', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(classifySemanticError(err, 4_000.4)).toMatchObject({
      state: 'failed',
      kind: 'timeout',
      retryable: true,
      code: 'timeout',
      latencyMs: 4_000,
    });
  });

  it('classifies an unparseable body as malformed_response — the HTML-502 case', () => {
    const err = new SyntaxError('Unexpected token < in JSON at position 0');
    expect(classifySemanticError(err, 12)).toMatchObject({
      kind: 'malformed_response',
      retryable: false,
      code: 'malformed_response',
    });
  });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [408, 'timeout', true],
    [429, 'dependency_down', true],
    [400, 'backend_error', false],
    [404, 'backend_error', false],
    [500, 'dependency_down', true],
    [502, 'dependency_down', true],
    [503, 'dependency_down', true],
    [0, 'network', true],
  ] as const)('maps HTTP %i to %s (retryable=%s)', (status, kind, retryable) => {
    expect(classifySemanticError(statusError(status, 'some_code'), 5)).toMatchObject({
      kind,
      retryable,
      code: 'some_code',
    });
  });

  it("keeps the backend's own error code rather than inventing one", () => {
    expect(classifySemanticError(statusError(503, 'search_failed', 'Qdrant unreachable'), 9)).toMatchObject({
      code: 'search_failed',
      detail: 'Qdrant unreachable',
    });
  });

  it('treats an unrecognised throw as a retryable network fault', () => {
    expect(classifySemanticError({ weird: true }, 3)).toMatchObject({
      kind: 'network',
      retryable: true,
      code: 'unknown_error',
      detail: 'Semantic search could not be reached.',
    });
  });

  it('reads a plain string throw', () => {
    expect(classifySemanticError('everything is on fire', 3).detail).toBe('everything is on fire');
  });

  it('never re-classifies an already-classified verdict', () => {
    const original = classifySemanticError(statusError(401, 'not_authenticated'), 7);
    const rethrown = classifySemanticError(new SemanticUnavailableError(original), 999);
    expect(rethrown).toEqual(original);
  });

  it('clamps a negative latency rather than publishing it', () => {
    expect(classifySemanticError(statusError(500, 'x'), -5).latencyMs).toBe(0);
  });
});

describe('SemanticUnavailableError', () => {
  it('describes a failure in its message and carries the outcome', () => {
    const outcome = classifySemanticError(statusError(503, 'search_failed', 'Qdrant unreachable'), 4);
    const err = new SemanticUnavailableError(outcome);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SemanticUnavailableError');
    expect(err.message).toContain('dependency_down');
    expect(err.outcome).toEqual(outcome);
  });

  it('describes a skip in its message', () => {
    const err = new SemanticUnavailableError({ state: 'skipped', reason: 'circuit_open' });
    expect(err.message).toContain('circuit_open');
  });
});

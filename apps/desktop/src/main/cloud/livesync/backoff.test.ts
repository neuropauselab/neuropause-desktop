import { describe, expect, it } from 'vitest';
import { classifyError, computeBackoff, isRetryable } from './backoff';

describe('computeBackoff', () => {
  it('returns 0 for non-positive attempts', () => {
    expect(computeBackoff(0)).toBe(0);
    expect(computeBackoff(-1)).toBe(0);
  });

  it('grows exponentially from the base', () => {
    const opts = { baseMs: 1000, capMs: 60000, factor: 2 };
    expect(computeBackoff(1, opts)).toBe(1000);
    expect(computeBackoff(2, opts)).toBe(2000);
    expect(computeBackoff(3, opts)).toBe(4000);
  });

  it('caps at capMs', () => {
    const opts = { baseMs: 1000, capMs: 5000, factor: 2 };
    expect(computeBackoff(10, opts)).toBe(5000);
  });
});

describe('classifyError', () => {
  it('classifies HTTP status ranges', () => {
    expect(classifyError({ status: 503 })).toBe('server');
    expect(classifyError({ status: 500 })).toBe('server');
    expect(classifyError({ status: 404 })).toBe('client');
    expect(classifyError({ status: 400 })).toBe('client');
  });

  it('treats an explicit network kind or unreachable transport as network', () => {
    expect(classifyError({ kind: 'network' })).toBe('network');
    expect(classifyError(new Error('fetch failed'))).toBe('network');
    expect(
      classifyError(
        Object.assign(new Error('boom'), { cause: new Error('ECONNREFUSED 127.0.0.1') }),
      ),
    ).toBe('network');
  });

  it('is unknown for anything else', () => {
    expect(classifyError(new Error('boom'))).toBe('unknown');
    expect(classifyError({ status: 302 })).toBe('unknown');
  });
});

describe('isRetryable', () => {
  it('retries network and server errors only', () => {
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('server')).toBe(true);
    expect(isRetryable('client')).toBe(false);
    expect(isRetryable('unknown')).toBe(false);
  });
});

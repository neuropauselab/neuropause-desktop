/**
 * P5 — Increment 1: the shared incremental-sync primitives.
 * Pure-node, no Electron: a tiny fake HttpClient stands in for the transport.
 */
import { describe, expect, it } from 'vitest';
import { conditionalGet, isExpiredCursorError } from './delta';
import { AuthError, HttpError, RateLimitError, type HttpClient, type HttpRequestOptions, type HttpResponse } from '../http';

/** A fake HttpClient whose `getJson` returns a programmed response and records the options it was called with. */
function fakeHttp(responder: (url: string, opts: HttpRequestOptions | undefined) => HttpResponse<unknown>) {
  const seen: HttpRequestOptions[] = [];
  const getJson = (url: string, opts?: HttpRequestOptions): Promise<HttpResponse<unknown>> => {
    seen.push(opts ?? {});
    return Promise.resolve(responder(url, opts));
  };
  return { http: { getJson } as unknown as HttpClient, seen };
}

describe('conditionalGet', () => {
  it('sends If-None-Match with the prior validator and returns the response ETag on a 200', async () => {
    const { http, seen } = fakeHttp(() => ({ data: [{ id: 1 }], headers: { etag: '"E2"', link: '' }, status: 200 }));
    const res = await conditionalGet<{ id: number }[]>(http, 'https://api/x', '"E1"', { query: { page: 1 } });
    expect(res.notModified).toBe(false);
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.etag).toBe('"E2"'); // the NEW head validator, to persist for next time
    // Carried the prior validator as a precondition; left the caller's query intact.
    expect(seen[0]?.headers?.['If-None-Match']).toBe('"E1"');
    expect(seen[0]?.query).toEqual({ page: 1 });
  });

  it('reports notModified with null data on a 304 and keeps the sent validator', async () => {
    const { http, seen } = fakeHttp(() => ({ data: null, headers: {}, status: 304 }));
    const res = await conditionalGet(http, 'https://api/x', '"E1"');
    expect(res.notModified).toBe(true);
    expect(res.data).toBeNull();
    expect(res.etag).toBe('"E1"'); // unchanged — reuse it next run
    expect(seen[0]?.headers?.['If-None-Match']).toBe('"E1"');
  });

  it('omits If-None-Match when there is no prior validator (first sync)', async () => {
    const { http, seen } = fakeHttp(() => ({ data: [], headers: { etag: '"E9"' }, status: 200 }));
    const res = await conditionalGet(http, 'https://api/x', null);
    expect(res.notModified).toBe(false);
    expect(res.etag).toBe('"E9"');
    expect(seen[0]?.headers?.['If-None-Match']).toBeUndefined();
  });
});

describe('isExpiredCursorError', () => {
  it('is true only for the configured expiry status(es) on an HttpError', () => {
    expect(isExpiredCursorError(new HttpError(410, 'Gone', false))).toBe(true); // default [410]
    expect(isExpiredCursorError(new HttpError(404, 'Not Found', false))).toBe(false); // 404 not in default set
    expect(isExpiredCursorError(new HttpError(404, 'Not Found', false), [404])).toBe(true); // Gmail historyId
    expect(isExpiredCursorError(new HttpError(410, 'Gone', false), [404, 410])).toBe(true);
    expect(isExpiredCursorError(new HttpError(500, 'Server', true))).toBe(false);
  });

  it('is false for non-HttpError failures (auth, rate limit, network, generic)', () => {
    expect(isExpiredCursorError(new AuthError('unauthorized', 401))).toBe(false);
    expect(isExpiredCursorError(new RateLimitError(1000))).toBe(false);
    expect(isExpiredCursorError(new Error('boom'))).toBe(false);
    expect(isExpiredCursorError(null)).toBe(false);
    expect(isExpiredCursorError(undefined)).toBe(false);
  });
});

/**
 * P6.7 — Cloudflare transport: the fixed-host guard (a bearer token is never sent to a non-Cloudflare host),
 * the `redirect: 'error'` egress guard, the connector-taxonomy error mapping, the `{success,result,result_info}`
 * envelope (incl. a `success:false` on an HTTP 2xx), page-based `cfList` pagination, cursor-based `cfListCursor`
 * (R2), and `cfMutate`. `fetch` is stubbed for the client; the helpers use a faked `send`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { CloudflareClient, cfGet, cfList, cfListCursor, cfMutate, cloudflareErrorMessage, errorFor } from './cloudflareClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const fakeResp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { forEach: (_cb: (v: string, k: string) => void) => undefined },
});
function fakeHttp(router: (req: DiscoveryRequest) => { status?: number; text: string }): DiscoveryHttp {
  return {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      const r = router(req);
      if (r.status && r.status >= 400) throw errorFor(r.status, {}, r.text);
      return { status: r.status ?? 200, headers: {}, text: r.text };
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('CloudflareClient — fixed-host bearer (SSRF hard stop)', () => {
  it('refuses a request to a non-Cloudflare host BEFORE attaching the token', async () => {
    let fetched = false;
    vi.stubGlobal('fetch', async () => { fetched = true; return fakeResp(200, '{}'); });
    const client = new CloudflareClient('tok', gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.example/client/v4/zones' })).rejects.toThrow(/non-Cloudflare host/);
    expect(fetched).toBe(false);
  });

  it('attaches Bearer + redirect:error against api.cloudflare.com', async () => {
    let seen: { url: string; init: { headers: Record<string, string>; redirect?: string } } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; redirect?: string }) => { seen = { url, init }; return fakeResp(200, JSON.stringify({ success: true, result: [] })); });
    const client = new CloudflareClient('my-token', gate);
    await client.getJson('/zones');
    expect(seen!.url).toBe('https://api.cloudflare.com/client/v4/zones');
    expect(seen!.init.headers.Authorization).toBe('Bearer my-token');
    expect(seen!.init.redirect).toBe('error');
  });

  it('maps a dropped connection to NetworkError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('connection reset'); });
    await expect(new CloudflareClient('t', gate).send({ method: 'GET', url: '/zones' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('maps a 403 to AuthError (so a scope-limited token degrades, not crashes)', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(403, '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}'));
    await expect(new CloudflareClient('t', gate).send({ method: 'GET', url: '/accounts/x/workers/scripts' })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('errorFor / cloudflareErrorMessage', () => {
  it('maps Cloudflare statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"errors":[{"code":10000,"message":"denied"}]}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '2' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '2' }, '') as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
  });

  it('reads the first errors[].message with its code', () => {
    expect(cloudflareErrorMessage('{"errors":[{"code":81044,"message":"record not found"}]}')).toBe('81044: record not found');
    expect(cloudflareErrorMessage('not json')).toBeNull();
    expect(cloudflareErrorMessage('{"errors":[]}')).toBeNull();
  });
});

describe('envelope helpers — pagination + mutate', () => {
  it('cfList follows result_info.total_pages to exhaustion', async () => {
    const seen: string[] = [];
    const http = fakeHttp((req) => {
      seen.push(req.url);
      if (req.url.includes('page=1')) return { text: JSON.stringify({ success: true, result: [{ id: 'a' }], result_info: { page: 1, total_pages: 2 } }) };
      return { text: JSON.stringify({ success: true, result: [{ id: 'b' }], result_info: { page: 2, total_pages: 2 } }) };
    });
    const items = await cfList(http, '/zones', 50);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(seen.some((u) => u.includes('page=1')) && seen.some((u) => u.includes('page=2'))).toBe(true);
  });

  it('cfList returns the single page for an endpoint with no result_info', async () => {
    const items = await cfList(fakeHttp(() => ({ text: JSON.stringify({ success: true, result: [{ id: 'x' }] }) })), '/accounts/a/workers/scripts');
    expect(items).toHaveLength(1);
  });

  it('cfListCursor follows result_info.cursor and unwraps the nested list key (R2 buckets)', async () => {
    const http = fakeHttp((req) => {
      if (req.url.includes('cursor=')) return { text: JSON.stringify({ success: true, result: { buckets: [{ name: 'b2' }] }, result_info: {} }) };
      return { text: JSON.stringify({ success: true, result: { buckets: [{ name: 'b1' }] }, result_info: { cursor: 'NEXT' } }) };
    });
    const items = await cfListCursor(http, '/accounts/a/r2/buckets', 'buckets');
    expect(items.map((i) => i.name)).toEqual(['b1', 'b2']);
  });

  it('a success:false envelope on an HTTP 2xx is surfaced as an error', async () => {
    await expect(cfList(fakeHttp(() => ({ text: JSON.stringify({ success: false, errors: [{ code: 10000, message: 'auth' }] }) })), '/zones')).rejects.toThrow(/auth/);
    expect(await cfGet(fakeHttp(() => ({ text: JSON.stringify({ success: true, result: { id: 'z1' } }) })), '/zones/z1')).toMatchObject({ id: 'z1' });
  });

  it('cfMutate returns result on success and throws on success:false', async () => {
    const ok = await cfMutate(fakeHttp(() => ({ text: JSON.stringify({ success: true, result: { id: 'rec-1' } }) })), 'POST', '/zones/z/dns_records', { type: 'A' });
    expect(ok.id).toBe('rec-1');
    await expect(cfMutate(fakeHttp(() => ({ text: JSON.stringify({ success: false, errors: [{ code: 1004, message: 'invalid record' }] }) })), 'POST', '/zones/z/dns_records', {})).rejects.toThrow(/invalid record/);
  });
});

/**
 * P6.4 — Kubernetes transport: the server-pin origin guard (a bearer token is never sent to a non-cluster
 * origin), relative-path resolution against the pinned API server, the connector-taxonomy error mapping, the
 * `metadata.continue` pagination, and NetworkError degradation on a TLS/connection failure. `fetch` is stubbed;
 * no live cluster.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { KubernetesClient, errorFor, k8sErrorMessage, k8sList } from './kubernetesClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const SERVER = 'https://cluster.example:6443';
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
      if (r.status && r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
      return { status: r.status ?? 200, headers: {}, text: r.text };
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('KubernetesClient — server pin (SSRF hard stop)', () => {
  it('refuses a request to a non-cluster origin', async () => {
    const client = new KubernetesClient(SERVER, 'tok', gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.com/api/v1/pods' })).rejects.toThrow(/non-cluster host/);
  });

  it('resolves a relative path against the pinned server and attaches the bearer token', async () => {
    let seen: { url: string; auth: string } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => { seen = { url, auth: init.headers.Authorization }; return fakeResp(200, JSON.stringify({ items: [] })); });
    const client = new KubernetesClient(SERVER, 'my-token', gate);
    await client.getJson('/api/v1/pods');
    expect(seen!.url).toBe('https://cluster.example:6443/api/v1/pods');
    expect(seen!.auth).toBe('Bearer my-token');
  });

  it('maps a dropped connection / TLS handshake failure to NetworkError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('unable to verify the first certificate'); });
    const client = new KubernetesClient(SERVER, 'tok', gate);
    await expect(client.send({ method: 'GET', url: '/api/v1/pods' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('maps a 403 response to AuthError', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(403, '{"kind":"Status","reason":"Forbidden"}'));
    const client = new KubernetesClient(SERVER, 'tok', gate);
    await expect(client.send({ method: 'GET', url: '/api/v1/pods' })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('errorFor / k8sErrorMessage', () => {
  it('maps Kubernetes statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"kind":"Status","reason":"Forbidden"}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    const rl = errorFor(429, { 'retry-after': '2' }, '');
    expect(rl).toBeInstanceOf(RateLimitError);
    expect((rl as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
  });
  it('reads the Status reason / message', () => {
    expect(k8sErrorMessage('{"kind":"Status","reason":"NotFound","message":"pods x not found"}')).toBe('NotFound');
    expect(k8sErrorMessage('not json')).toBeNull();
  });
});

describe('k8sList — metadata.continue pagination', () => {
  it('reads items + the continue token, and null-terminates on an empty continue', async () => {
    const p1 = await k8sList(fakeHttp(() => ({ text: JSON.stringify({ items: [{ metadata: { name: 'a' } }], metadata: { continue: 'TOK' } }) })), '/api/v1/pods');
    expect(p1.items).toHaveLength(1);
    expect(p1.continueToken).toBe('TOK');
    const end = await k8sList(fakeHttp(() => ({ text: JSON.stringify({ items: [], metadata: { continue: '' } }) })), '/api/v1/pods');
    expect(end.continueToken).toBeNull();
  });
});

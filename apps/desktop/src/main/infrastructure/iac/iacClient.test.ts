/**
 * P6.10 — the IaC transport: per-flavor auth (TFC `Bearer` + `vnd.api+json`, Pulumi `token` + `vnd.pulumi+8`), the
 * host pin (the API token is never sent to a non-backend origin, refused before attach), `redirect:'error'`, the
 * CREDENTIAL-FREE artifact fetch (https-only, no Authorization) for signed state/plan URLs, the 307 `Location`
 * capture, the error taxonomy, and the two pagination styles (TFC `links.next`, Pulumi `continuationToken`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { IacClient, errorFor, iacErrorMessage, iacGet, iacPost, pulumiList, tfcList } from './iacClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const TFC = { flavor: 'terraform' as const, host: 'https://app.terraform.io', token: 'tf-secret', organization: 'acme' };
const PULUMI = { flavor: 'pulumi' as const, host: 'https://api.pulumi.com', token: 'pul-secret', organization: 'acme' };

const fakeResp = (status: number, body: string, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { forEach: (cb: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => cb(v, k)), get: (k: string) => headers[k.toLowerCase()] ?? null },
});

type Rec = Record<string, unknown>;
function fakeHttp(router: (req: DiscoveryRequest) => Rec): { http: DiscoveryHttp; requests: DiscoveryRequest[] } {
  const requests: DiscoveryRequest[] = [];
  return {
    requests,
    http: {
      getJson: async () => ({ data: {}, status: 200, headers: {} }),
      send: async (req) => { requests.push(req); return { status: 200, headers: {}, text: JSON.stringify(router(req)) }; },
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('IacClient — per-flavor auth + host pin', () => {
  it('attaches Bearer + vnd.api+json for Terraform, against the pinned host, redirect:error', async () => {
    let seen: { url: string; init: { headers: Record<string, string>; redirect?: string } } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; redirect?: string }) => { seen = { url, init }; return fakeResp(200, '{}'); });
    await new IacClient(TFC, gate).send({ method: 'GET', url: '/api/v2/organizations/acme/workspaces' });
    expect(seen!.url).toBe('https://app.terraform.io/api/v2/organizations/acme/workspaces');
    expect(seen!.init.headers.Authorization).toBe('Bearer tf-secret');
    expect(seen!.init.headers.Accept).toBe('application/vnd.api+json');
    expect(seen!.init.redirect).toBe('error');
  });

  it('attaches token (NOT Bearer) + vnd.pulumi+8 for Pulumi', async () => {
    let seen: { init: { headers: Record<string, string> } } | null = null;
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => { seen = { init }; return fakeResp(200, '{}'); });
    await new IacClient(PULUMI, gate).send({ method: 'GET', url: '/api/user/stacks' });
    expect(seen!.init.headers.Authorization).toBe('token pul-secret');
    expect(seen!.init.headers.Accept).toBe('application/vnd.pulumi+8');
  });

  it('refuses a request to a non-backend host BEFORE attaching the token', async () => {
    let fetched = false;
    vi.stubGlobal('fetch', async () => { fetched = true; return fakeResp(200, '{}'); });
    await expect(new IacClient(TFC, gate).send({ method: 'GET', url: 'https://evil.example/x' })).rejects.toThrow(/non-IaC host/);
    expect(fetched).toBe(false);
  });

  it('maps a dropped connection to NetworkError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('reset'); });
    await expect(new IacClient(TFC, gate).send({ method: 'GET', url: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('IacClient — credential-free artifact + 307 location', () => {
  it('fetches a signed artifact WITHOUT the token, https-only, redirect handled manually', async () => {
    let seen: { url: string; init: { headers?: Record<string, string>; redirect?: string } } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers?: Record<string, string>; redirect?: string }) => { seen = { url, init }; return fakeResp(200, 'RAW_STATE'); });
    const text = await new IacClient(TFC, gate).getArtifact('https://archivist.terraform.io/v1/object/abc');
    expect(text).toBe('RAW_STATE');
    expect(seen!.init.headers).toBeUndefined(); // NO Authorization attached
    expect(seen!.init.redirect).toBe('manual'); // followed manually so every hop is re-validated
    expect(JSON.stringify(seen!.init)).not.toContain('tf-secret'); // token never travels off-host
  });

  it('refuses a non-https and a private/link-local artifact host (SSRF guard)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('should not fetch'); });
    const c = new IacClient(TFC, gate);
    await expect(c.getArtifact('http://insecure.example/x')).rejects.toThrow(/non-https/);
    await expect(c.getArtifact('https://127.0.0.1/x')).rejects.toThrow(/private/);
    await expect(c.getArtifact('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private/);
  });

  it('follows an https redirect but re-validates the hop and refuses a redirect to a private host', async () => {
    vi.stubGlobal('fetch', async (url: string) => url === 'https://archivist.terraform.io/a' ? fakeResp(307, '', { location: 'https://blob.example/b' }) : fakeResp(200, 'FINAL'));
    expect(await new IacClient(TFC, gate).getArtifact('https://archivist.terraform.io/a')).toBe('FINAL');
    // a 307 that redirects the CREDENTIAL-FREE fetch at cloud metadata is refused on the next hop
    vi.stubGlobal('fetch', async () => fakeResp(307, '', { location: 'https://169.254.169.254/latest/meta-data/' }));
    await expect(new IacClient(TFC, gate).getArtifact('https://archivist.terraform.io/a')).rejects.toThrow(/private/);
  });

  it('captures a 307 Location without following it (the json-output flow)', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(307, '', { location: 'https://archivist.terraform.io/plan.json' }));
    const r = await new IacClient(TFC, gate).getLocation('/api/v2/plans/plan-1/json-output');
    expect(r.location).toBe('https://archivist.terraform.io/plan.json');
    expect(r.text).toBeNull();
  });

  it('returns inline text when json-output responds 200', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(200, '{"format_version":"1.2"}'));
    const r = await new IacClient(TFC, gate).getLocation('/api/v2/plans/plan-1/json-output');
    expect(r.text).toBe('{"format_version":"1.2"}');
    expect(r.location).toBeNull();
  });
});

describe('errorFor / iacErrorMessage', () => {
  it('maps statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '2' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '2' }, '') as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
    expect((errorFor(422, {}, '') as HttpError).retryable).toBe(false);
  });

  it('reads a TFC JSON:API error and a Pulumi error body', () => {
    expect(iacErrorMessage('{"errors":[{"detail":"workspace locked"}]}')).toBe('workspace locked');
    expect(iacErrorMessage('{"message":"unauthorized"}')).toBe('unauthorized');
    expect(iacErrorMessage('not json')).toBeNull();
  });
});

describe('pagination helpers', () => {
  it('tfcList follows links.next to exhaustion', async () => {
    const { http, requests } = fakeHttp((req) => req.url.includes('page[number]=2') ? { data: [{ id: 'b' }], links: {} } : { data: [{ id: 'a' }], links: { next: 'https://app.terraform.io/api/v2/x?page[number]=2' } });
    const rows = await tfcList(http, '/api/v2/x');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(requests[1].url).toContain('page[number]=2');
  });

  it('pulumiList follows continuationToken to exhaustion', async () => {
    const { http, requests } = fakeHttp((req) => req.url.includes('continuationToken=t1') ? { stacks: [{ stackName: 'b' }] } : { stacks: [{ stackName: 'a' }], continuationToken: 't1' });
    const rows = await pulumiList(http, '/api/user/stacks', 'stacks');
    expect(rows.map((r) => r.stackName)).toEqual(['a', 'b']);
    expect(requests[1].url).toContain('continuationToken=t1');
  });

  it('iacGet returns the parsed object; iacPost sends a JSON body', async () => {
    const { http, requests } = fakeHttp(() => ({ data: { id: 'run-1' } }));
    expect((await iacGet(http, '/api/v2/x')).data).toMatchObject({ id: 'run-1' });
    const res = await iacPost(http, '/api/v2/runs', { data: { type: 'runs' } });
    expect((res.data as Rec).id).toBe('run-1');
    expect(requests[1].method).toBe('POST');
    expect(JSON.parse(requests[1].body ?? '{}')).toEqual({ data: { type: 'runs' } });
  });
});

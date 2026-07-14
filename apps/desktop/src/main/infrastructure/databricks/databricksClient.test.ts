/**
 * P6.9 — Databricks transport: the host pin (the PAT bearer is never sent to a non-Databricks host), the
 * `Authorization: Bearer <PAT>` + `redirect:'error'` egress guard, the connector-taxonomy error mapping, and the
 * request helpers — `dbxGet` (single un-enveloped object), `dbxList` (opaque `next_page_token` walk echoed as
 * `?page_token=`, and the Repos `?next_page_token=` variant), and `dbxPost` (JSON body). `fetch` is stubbed for
 * the client; the helpers use a faked `send`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { DatabricksClient, dbxGet, dbxList, dbxPost, databricksErrorMessage, errorFor } from './databricksClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const WORKSPACE_URL = 'https://dbc-1234abcd-5e6f.cloud.databricks.com';
const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const fakeResp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { forEach: (_cb: (v: string, k: string) => void) => undefined },
});

type Rec = Record<string, unknown>;
/** A `send`-based fake for the helpers: `router(url)` returns the JSON body for that GET, `urls` records order. */
function fakeHttp(router: (req: DiscoveryRequest) => Rec | string): { http: DiscoveryHttp; requests: DiscoveryRequest[] } {
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      return { status: 200, headers: {}, text: typeof r === 'string' ? r : JSON.stringify(r) };
    },
  };
  return { http, requests };
}
afterEach(() => vi.unstubAllGlobals());

describe('DatabricksClient — host pin + PAT bearer', () => {
  it('refuses a request to a non-Databricks host BEFORE attaching the PAT', async () => {
    let fetched = false;
    vi.stubGlobal('fetch', async () => { fetched = true; return fakeResp(200, '{}'); });
    const client = new DatabricksClient(WORKSPACE_URL, 'pat-secret', gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.example/api/2.1/clusters/list' })).rejects.toThrow(/non-Databricks host/);
    expect(fetched).toBe(false);
  });

  it('attaches the Bearer PAT + redirect:error against the workspace host', async () => {
    let seen: { url: string; init: { headers: Record<string, string>; redirect?: string } } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; redirect?: string }) => { seen = { url, init }; return fakeResp(200, '{}'); });
    const client = new DatabricksClient(WORKSPACE_URL, 'pat-secret', gate);
    await client.send({ method: 'GET', url: '/api/2.1/clusters/list' });
    expect(seen!.url).toBe('https://dbc-1234abcd-5e6f.cloud.databricks.com/api/2.1/clusters/list');
    expect(seen!.init.headers.Authorization).toBe('Bearer pat-secret');
    expect(seen!.init.redirect).toBe('error');
  });

  it('maps a dropped connection to NetworkError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('reset'); });
    await expect(new DatabricksClient(WORKSPACE_URL, 'pat', gate).send({ method: 'GET', url: '/api/2.1/clusters/list' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('errorFor / databricksErrorMessage', () => {
  it('maps Databricks statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"error_code":"PERMISSION_DENIED","message":"denied"}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '2' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '2' }, '') as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
    expect((errorFor(400, {}, '') as HttpError).retryable).toBe(false);
  });

  it('reads the Databricks {error_code,message} error body', () => {
    expect(databricksErrorMessage('{"error_code":"RESOURCE_DOES_NOT_EXIST","message":"Cluster not found"}')).toBe('RESOURCE_DOES_NOT_EXIST: Cluster not found');
    expect(databricksErrorMessage('not json')).toBeNull();
  });
});

describe('dbxGet / dbxList / dbxPost', () => {
  it('dbxGet returns the single un-enveloped object', async () => {
    const { http } = fakeHttp(() => ({ metastore_id: 'm-1', name: 'primary' }));
    const body = await dbxGet(http, '/api/2.1/unity-catalog/metastore_summary');
    expect(body).toMatchObject({ metastore_id: 'm-1', name: 'primary' });
  });

  it('dbxList drains all pages, echoing next_page_token as ?page_token=', async () => {
    const { http, requests } = fakeHttp((req) =>
      req.url.includes('page_token=t1')
        ? { clusters: [{ cluster_id: 'b' }] }
        : { clusters: [{ cluster_id: 'a' }], next_page_token: 't1' },
    );
    const rows = await dbxList(http, '/api/2.1/clusters/list', 'clusters');
    expect(rows.map((r) => r.cluster_id)).toEqual(['a', 'b']);
    expect(requests[1].url).toContain('page_token=t1');
    expect(requests[1].url).not.toContain('next_page_token');
  });

  it('dbxList honors a custom tokenParam (Repos ?next_page_token=)', async () => {
    const { http, requests } = fakeHttp((req) =>
      req.url.includes('next_page_token=t1')
        ? { repos: [{ id: 'r2' }] }
        : { repos: [{ id: 'r1' }], next_page_token: 't1' },
    );
    const rows = await dbxList(http, '/api/2.0/repos', 'repos', { tokenParam: 'next_page_token' });
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(requests[1].url).toContain('next_page_token=t1');
  });

  it('dbxPost sends a JSON body and returns the parsed response', async () => {
    const { http, requests } = fakeHttp(() => ({ run_id: 42 }));
    const res = await dbxPost(http, '/api/2.2/jobs/run-now', { job_id: 7 });
    expect(res.run_id).toBe(42);
    expect(requests[0].method).toBe('POST');
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ job_id: 7 });
    expect(requests[0].headers?.['Content-Type']).toBe('application/json');
  });

  it('dbxPost with no body sends no Content-Type (warehouse start/stop path-only POST)', async () => {
    const { http, requests } = fakeHttp(() => ({}));
    await dbxPost(http, '/api/2.0/sql/warehouses/wh-1/start');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toBeUndefined();
  });
});

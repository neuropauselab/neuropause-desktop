/**
 * P6.6 — VMware transport: the server-pin origin guard (the Basic credential / session id is never sent to a
 * non-vCenter origin), the lazy `POST /api/session` → `vmware-api-session-id` flow, the single re-auth on a 401,
 * the connector-taxonomy error mapping, the over-cap "too many matches" sentinel, the bare-string / `{value}`
 * session + list parsing, and NetworkError degradation. `fetch` is stubbed; no live vCenter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { VmwareClient, errorFor, isTooManyMatches, parseSessionId, vmwareErrorMessage, vmwareGet, vmwareList } from './vmwareClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const SERVER = 'https://vcenter.example.com';
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

describe('VmwareClient — session auth + server pin', () => {
  it('creates a session, then attaches vmware-api-session-id (never Basic) to each call against the pinned origin', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return url.endsWith('/api/session') ? fakeResp(201, '"sess-abc"') : fakeResp(200, '[]');
    });
    const client = new VmwareClient(SERVER, 'administrator@vsphere.local', 'pw', gate);
    await client.getJson('/api/vcenter/vm');
    const session = calls.find((c) => c.url.endsWith('/api/session'))!;
    expect(session.method).toBe('POST');
    expect(session.headers.Authorization).toBe(`Basic ${Buffer.from('administrator@vsphere.local:pw').toString('base64')}`);
    const data = calls.find((c) => c.url.includes('/api/vcenter/vm'))!;
    expect(data.url).toBe('https://vcenter.example.com/api/vcenter/vm');
    expect(data.headers['vmware-api-session-id']).toBe('sess-abc');
    expect(data.headers.Authorization).toBeUndefined(); // the Basic credential is used ONLY for /api/session
  });

  it('refuses a request to a non-vCenter origin BEFORE authenticating (SSRF hard stop)', async () => {
    let fetched = false;
    vi.stubGlobal('fetch', async () => { fetched = true; return fakeResp(200, '[]'); });
    const client = new VmwareClient(SERVER, 'admin', 'pw', gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.example/api/vcenter/vm' })).rejects.toThrow(/non-vCenter host/);
    expect(fetched).toBe(false); // neither the session POST nor the data call fired
  });

  it('re-authenticates ONCE on a 401 (expired session) then retries', async () => {
    let sessions = 0;
    let vmCalls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/api/session')) { sessions += 1; return fakeResp(201, `"sess-${sessions}"`); }
      vmCalls += 1;
      return vmCalls === 1 ? fakeResp(401, '{}') : fakeResp(200, '["ok"]');
    });
    const client = new VmwareClient(SERVER, 'admin', 'pw', gate);
    const r = await client.getJson<string[]>('/api/vcenter/vm');
    expect(sessions).toBe(2); // initial session + one re-auth
    expect(vmCalls).toBe(2);
    expect(r.data).toEqual(['ok']);
  });

  it('passes redirect:error to every fetch so a 3xx cannot carry the session id off-origin', async () => {
    const inits: Array<{ redirect?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { redirect?: string }) => {
      inits.push(init);
      return url.endsWith('/api/session') ? fakeResp(201, '"s"') : fakeResp(200, '[]');
    });
    const client = new VmwareClient(SERVER, 'admin', 'pw', gate);
    await client.getJson('/api/vcenter/vm');
    expect(inits.length).toBe(2); // the session POST + the data GET
    expect(inits.every((i) => i.redirect === 'error')).toBe(true);
  });

  it('maps a dropped connection to NetworkError', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/api/session')) return fakeResp(201, '"s"');
      throw new TypeError('connection refused');
    });
    const client = new VmwareClient(SERVER, 'admin', 'pw', gate);
    await expect(client.send({ method: 'GET', url: '/api/vcenter/vm' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('errorFor / parseSessionId / isTooManyMatches', () => {
  it('maps vCenter statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"messages":[{"default_message":"denied"}]}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '3' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '3' }, '') as RateLimitError).retryAfterMs).toBe(3000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
  });

  it('parseSessionId handles the /api bare string and the legacy /rest {value}', () => {
    expect(parseSessionId('"abc123"')).toBe('abc123');
    expect(parseSessionId('{"value":"xyz789"}')).toBe('xyz789');
    expect(parseSessionId('')).toBeNull();
  });

  it('isTooManyMatches detects the vSphere over-cap 400 (the fan-out signal), not a generic 400', () => {
    const capped = errorFor(400, {}, '{"messages":[{"default_message":"Too many virtual machines. Add more filter criteria."}]}');
    expect(isTooManyMatches(capped)).toBe(true);
    // Even with a LOCALIZED default_message (no "too many" text), the machine `error_type` still triggers fan-out.
    const localized = errorFor(400, {}, '{"error_type":"UNABLE_TO_ALLOCATE_RESOURCE","messages":[{"default_message":"Trop de machines virtuelles."}]}');
    expect(isTooManyMatches(localized)).toBe(true);
    expect(isTooManyMatches(errorFor(400, {}, '{"error_type":"INVALID_ARGUMENT","messages":[{"default_message":"invalid argument"}]}'))).toBe(false);
    expect(isTooManyMatches(errorFor(404, {}, ''))).toBe(false);
  });

  it('vmwareErrorMessage reads a vSphere error body, prepending the stable error_type token', () => {
    expect(vmwareErrorMessage('{"messages":[{"default_message":"no such vm"}]}')).toBe('no such vm');
    expect(vmwareErrorMessage('{"error_type":"NOT_FOUND","messages":[{"default_message":"no such vm"}]}')).toBe('NOT_FOUND: no such vm');
    expect(vmwareErrorMessage('{"error_type":"ALREADY_IN_DESIRED_STATE"}')).toBe('ALREADY_IN_DESIRED_STATE');
    expect(vmwareErrorMessage('not json')).toBeNull();
  });
});

describe('list / get helpers — no pagination, tolerant of the /rest envelope', () => {
  it('vmwareList reads a bare array and unwraps a legacy {value:[...]}', async () => {
    const bare = await vmwareList(fakeHttp(() => ({ text: JSON.stringify([{ vm: 'vm-1' }, { vm: 'vm-2' }]) })), '/api/vcenter/vm');
    expect(bare).toHaveLength(2);
    const wrapped = await vmwareList(fakeHttp(() => ({ text: JSON.stringify({ value: [{ vm: 'vm-3' }] }) })), '/api/vcenter/vm');
    expect(wrapped).toEqual([{ vm: 'vm-3' }]);
  });

  it('vmwareGet parses an object and unwraps a legacy {value:{...}}', async () => {
    const obj = await vmwareGet(fakeHttp(() => ({ text: JSON.stringify({ name: 'web01', power_state: 'POWERED_ON' }) })), '/api/vcenter/vm/vm-1');
    expect(obj).toMatchObject({ name: 'web01' });
    const wrapped = await vmwareGet(fakeHttp(() => ({ text: JSON.stringify({ value: { name: 'db01' } }) })), '/api/vcenter/vm/vm-2');
    expect(wrapped).toMatchObject({ name: 'db01' });
  });
});

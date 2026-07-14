/**
 * P6.8 — Snowflake transport: the host pin (a bearer JWT is never sent to a non-Snowflake host), the JWT +
 * `X-Snowflake-Authorization-Token-Type` header + `redirect:'error'` egress guard, the connector-taxonomy error
 * mapping, and the SQL-result parsing — rows keyed BY COLUMN NAME (lower-cased), partition draining, and 202 async
 * polling. `fetch` is stubbed for the client; the SQL helpers use a faked `send`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest } from '@neuropause/shared';
import { SnowflakeClient, errorFor, snowflakeErrorMessage, snowflakeExec, snowflakeQuery } from './snowflakeClient';
import { AuthError, HttpError, NetworkError, RateLimitError, type RateGate } from '../../unified/sync/http';

const ACCOUNT_URL = 'https://myorg-myacct.snowflakecomputing.com';
const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const token = async () => 'my-jwt';
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

describe('SnowflakeClient — host pin + key-pair JWT', () => {
  it('refuses a request to a non-Snowflake host BEFORE attaching the JWT', async () => {
    let fetched = false;
    vi.stubGlobal('fetch', async () => { fetched = true; return fakeResp(200, '{}'); });
    const client = new SnowflakeClient(ACCOUNT_URL, token, gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.example/api/v2/statements' })).rejects.toThrow(/non-Snowflake host/);
    expect(fetched).toBe(false);
  });

  it('attaches the JWT + KEYPAIR_JWT token-type header + redirect:error against the account host', async () => {
    let seen: { url: string; init: { headers: Record<string, string>; redirect?: string } } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; redirect?: string }) => { seen = { url, init }; return fakeResp(200, '{}'); });
    const client = new SnowflakeClient(ACCOUNT_URL, token, gate);
    await client.send({ method: 'POST', url: '/api/v2/statements', body: '{}' });
    expect(seen!.url).toBe('https://myorg-myacct.snowflakecomputing.com/api/v2/statements');
    expect(seen!.init.headers.Authorization).toBe('Bearer my-jwt');
    expect(seen!.init.headers['X-Snowflake-Authorization-Token-Type']).toBe('KEYPAIR_JWT');
    expect(seen!.init.redirect).toBe('error');
  });

  it('maps a dropped connection to NetworkError', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('reset'); });
    await expect(new SnowflakeClient(ACCOUNT_URL, token, gate).send({ method: 'GET', url: '/api/v2/statements/x' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('errorFor / snowflakeErrorMessage', () => {
  it('maps Snowflake statuses onto the connector taxonomy (422 SQL error is a non-retryable HttpError)', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"code":"390100","message":"denied"}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    expect(errorFor(429, { 'retry-after': '2' }, '')).toBeInstanceOf(RateLimitError);
    expect((errorFor(429, { 'retry-after': '2' }, '') as RateLimitError).retryAfterMs).toBe(2000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
    expect((errorFor(422, {}, '{"code":"002003","message":"Object does not exist"}') as HttpError).retryable).toBe(false);
  });

  it('reads the Snowflake {code,message} error body', () => {
    expect(snowflakeErrorMessage('{"code":"002003","message":"Object WH does not exist"}')).toBe('002003: Object WH does not exist');
    expect(snowflakeErrorMessage('not json')).toBeNull();
  });
});

describe('snowflakeQuery — parse by column name, drain partitions, poll 202', () => {
  it('maps rows to lower-cased-key objects by column name', async () => {
    const body = JSON.stringify({ resultSetMetaData: { rowType: [{ name: 'NAME' }, { name: 'STATE' }], partitionInfo: [{ rowCount: 1 }] }, data: [['COMPUTE_WH', 'STARTED']], statementHandle: 'h1' });
    const rows = await snowflakeQuery(fakeHttp(() => ({ text: body })), 'SHOW WAREHOUSES');
    expect(rows).toEqual([{ name: 'COMPUTE_WH', state: 'STARTED' }]);
  });

  it('drains partitions 1..N-1 via ?partition=N', async () => {
    const router = (req: DiscoveryRequest) => {
      if (req.method === 'POST') return { text: JSON.stringify({ resultSetMetaData: { rowType: [{ name: 'NAME' }], partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }] }, data: [['A']], statementHandle: 'h1' }) };
      return { text: JSON.stringify({ data: [['B']] }) }; // partition 1
    };
    const rows = await snowflakeQuery(fakeHttp(router), 'SHOW TABLES IN ACCOUNT');
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('polls a 202 (long statement) to completion before parsing', async () => {
    let posts = 0;
    const router = (req: DiscoveryRequest) => {
      if (req.method === 'POST') { posts += 1; return { status: 202, text: JSON.stringify({ statementHandle: 'h2' }) }; }
      return { status: 200, text: JSON.stringify({ resultSetMetaData: { rowType: [{ name: 'NAME' }], partitionInfo: [{ rowCount: 1 }] }, data: [['X']], statementHandle: 'h2' }) };
    };
    const rows = await snowflakeQuery(fakeHttp(router), 'SHOW WAREHOUSES');
    expect(posts).toBe(1);
    expect(rows.map((r) => r.name)).toEqual(['X']);
  });

  it('snowflakeExec returns the result body (message) for an ALTER statement', async () => {
    const res = await snowflakeExec(fakeHttp(() => ({ text: JSON.stringify({ message: 'Statement executed successfully.', statementHandle: 'h3' }) })), 'ALTER WAREHOUSE WH SUSPEND');
    expect(res.message).toContain('successfully');
  });
});

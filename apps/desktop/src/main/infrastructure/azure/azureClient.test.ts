/**
 * P6.2 — Azure transport: audience derivation, the connector-taxonomy error mapping, per-audience token caching,
 * and the SSRF / token-exfiltration hard stop in `AzureClient.send` (a bearer token is never attached to a
 * non-Azure host — critical because Azure follows response `nextLink` URLs). `fetch` is stubbed; no live Azure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARM_AUDIENCE,
  AzureClient,
  GRAPH_AUDIENCE,
  VAULT_AUDIENCE,
  audienceForHost,
  azureErrorMessage,
  cachedTokenProvider,
  errorFor,
  isAzureHost,
} from './azureClient';
import { AuthError, RateLimitError, type HttpError, type RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const fakeResp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { forEach: (_cb: (v: string, k: string) => void) => undefined },
});
afterEach(() => vi.unstubAllGlobals());

describe('audienceForHost / isAzureHost', () => {
  it('maps the three Azure planes and rejects non-Azure hosts', () => {
    expect(audienceForHost('management.azure.com')).toBe(ARM_AUDIENCE);
    expect(audienceForHost('graph.microsoft.com')).toBe(GRAPH_AUDIENCE);
    expect(audienceForHost('my-vault.vault.azure.net')).toBe(VAULT_AUDIENCE);
    expect(audienceForHost('evil.com')).toBeNull();
    expect(audienceForHost('management.azure.com.evil.com')).toBeNull(); // suffix-spoof
    expect(audienceForHost('vault.azure.net.attacker.com')).toBeNull();
    expect(isAzureHost('graph.microsoft.com')).toBe(true);
    expect(isAzureHost('evil.com')).toBe(false);
  });
});

describe('errorFor / azureErrorMessage', () => {
  it('maps Azure statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"error":{"code":"AuthorizationFailed"}}')).toBeInstanceOf(AuthError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    const rl = errorFor(429, { 'retry-after': '5' }, '');
    expect(rl).toBeInstanceOf(RateLimitError);
    expect((rl as RateLimitError).retryAfterMs).toBe(5000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
  });
  it('extracts the nested Azure error code', () => {
    expect(azureErrorMessage('{"error":{"code":"ResourceNotFound","message":"..."}}')).toBe('ResourceNotFound');
    expect(azureErrorMessage('not json')).toBeNull();
  });
});

describe('cachedTokenProvider', () => {
  it('caches per audience and refetches only after expiry', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const provider = cachedTokenProvider(async (aud) => { calls += 1; return { token: `tok-${aud}-${calls}`, expiresInSec: 3600 }; }, () => clock);
    const arm1 = await provider(ARM_AUDIENCE);
    const arm2 = await provider(ARM_AUDIENCE);
    expect(arm1).toBe(arm2); // cached
    expect(calls).toBe(1);
    await provider(GRAPH_AUDIENCE); // a different audience is a separate token
    expect(calls).toBe(2);
    clock += 3_600_000; // advance past expiry (beyond the 60s refresh buffer)
    await provider(ARM_AUDIENCE);
    expect(calls).toBe(3);
  });
});

describe('AzureClient.send — SSRF hard stop', () => {
  it('refuses a non-Azure host BEFORE acquiring or attaching a token', async () => {
    let tokenCalls = 0;
    const client = new AzureClient(async () => { tokenCalls += 1; return 'tok'; }, gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.com/x' })).rejects.toThrow(/non-Azure host/);
    expect(tokenCalls).toBe(0); // token never even requested for a bad host
  });

  it('attaches the audience-correct bearer token and parses JSON', async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, auth: init.headers.Authorization });
      return fakeResp(200, JSON.stringify({ value: [{ id: '/x' }] }));
    });
    const client = new AzureClient(async (aud) => `token-for-${aud}`, gate);
    const { data } = await client.getJson<{ value: unknown[] }>('https://management.azure.com/subscriptions/s/providers/x?api-version=1');
    expect(data.value).toHaveLength(1);
    expect(seen[0].auth).toBe(`Bearer token-for-${ARM_AUDIENCE}`); // ARM audience derived from host
  });

  it('routes a Key Vault host to the vault audience', async () => {
    let auth = '';
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => { auth = init.headers.Authorization; return fakeResp(200, '{}'); });
    const client = new AzureClient(async (aud) => `token-for-${aud}`, gate);
    await client.send({ method: 'POST', url: 'https://my-vault.vault.azure.net/secrets/x/rotate?api-version=7.4' });
    expect(auth).toBe(`Bearer token-for-${VAULT_AUDIENCE}`);
  });

  it('maps a 403 response to AuthError', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(403, '{"error":{"code":"AuthorizationFailed"}}'));
    const client = new AzureClient(async () => 'tok', gate);
    await expect(client.send({ method: 'GET', url: 'https://management.azure.com/x' })).rejects.toBeInstanceOf(AuthError);
  });
});

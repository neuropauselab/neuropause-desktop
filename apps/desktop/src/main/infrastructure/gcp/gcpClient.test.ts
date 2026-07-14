/**
 * P6.3 — GCP transport + auth: the *.googleapis.com SSRF host guard, the connector-taxonomy error mapping, the
 * per-scope token cache, selfLink normalization, and — the trust anchor for the whole platform — the RS256
 * service-account JWT signing (verified against a freshly generated public key). `fetch` is stubbed; no live GCP.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { GCP_SCOPE, GcpClient, cachedGcpToken, errorFor, gcpErrorMessage, isGcpHost, relName } from './gcpClient';
import { signServiceAccountJwt } from './gcpAdapter';
import { AuthError, HttpError, RateLimitError, type RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const fakeResp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { forEach: (_cb: (v: string, k: string) => void) => undefined },
});
afterEach(() => vi.unstubAllGlobals());

describe('isGcpHost', () => {
  it('accepts *.googleapis.com endpoints and rejects everything else', () => {
    expect(isGcpHost('compute.googleapis.com')).toBe(true);
    expect(isGcpHost('secretmanager.googleapis.com')).toBe(true);
    expect(isGcpHost('googleapis.com')).toBe(true);
    expect(isGcpHost('evil.com')).toBe(false);
    expect(isGcpHost('compute.googleapis.com.evil.com')).toBe(false); // suffix-spoof
    expect(isGcpHost('googleapis.com.attacker.com')).toBe(false);
  });
});

describe('errorFor / gcpErrorMessage', () => {
  it('maps GCP statuses onto the connector taxonomy', () => {
    expect(errorFor(401, {}, '')).toBeInstanceOf(AuthError);
    expect(errorFor(403, {}, '{"error":{"status":"PERMISSION_DENIED"}}')).toBeInstanceOf(AuthError);
    expect(errorFor(404, {}, '')).toBeInstanceOf(HttpError);
    expect((errorFor(404, {}, '') as HttpError).retryable).toBe(false);
    const rl = errorFor(429, { 'retry-after': '7' }, '');
    expect(rl).toBeInstanceOf(RateLimitError);
    expect((rl as RateLimitError).retryAfterMs).toBe(7000);
    expect((errorFor(500, {}, '') as HttpError).retryable).toBe(true);
  });
  it('extracts the GCP error status / message', () => {
    expect(gcpErrorMessage('{"error":{"status":"NOT_FOUND","message":"x"}}')).toBe('NOT_FOUND');
    expect(gcpErrorMessage('{"error":"invalid_grant","error_description":"bad"}')).toBe('invalid_grant');
    expect(gcpErrorMessage('not json')).toBeNull();
  });
});

describe('cachedGcpToken', () => {
  it('caches per scope and refetches only after expiry', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const provider = cachedGcpToken(async () => { calls += 1; return { token: `t${calls}`, expiresInSec: 3600 }; }, () => clock);
    const a = await provider(GCP_SCOPE);
    const b = await provider(GCP_SCOPE);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    clock += 3_600_000; // past expiry (beyond the 60s refresh buffer)
    await provider(GCP_SCOPE);
    expect(calls).toBe(2);
  });
});

describe('relName', () => {
  it('normalizes selfLinks / references to the relative resource name', () => {
    expect(relName('https://www.googleapis.com/compute/v1/projects/p/global/networks/default')).toBe('projects/p/global/networks/default');
    expect(relName('https://compute.googleapis.com/compute/v1/projects/p/regions/us/subnetworks/s')).toBe('projects/p/regions/us/subnetworks/s');
    expect(relName('projects/p/global/networks/default')).toBe('projects/p/global/networks/default');
    expect(relName(null)).toBeNull();
  });
});

describe('GcpClient.send — SSRF hard stop', () => {
  it('refuses a non-Google host BEFORE acquiring or attaching a token', async () => {
    let tokenCalls = 0;
    const client = new GcpClient(async () => { tokenCalls += 1; return 'tok'; }, gate);
    await expect(client.send({ method: 'GET', url: 'https://evil.com/x' })).rejects.toThrow(/non-Google host/);
    expect(tokenCalls).toBe(0);
  });

  it('attaches the bearer token and parses JSON', async () => {
    let auth = '';
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => { auth = init.headers.Authorization; return fakeResp(200, JSON.stringify({ items: [{ id: '1' }] })); });
    const client = new GcpClient(async () => 'my-token', gate);
    const { data } = await client.getJson<{ items: unknown[] }>('https://compute.googleapis.com/compute/v1/projects/p/global/networks');
    expect(data.items).toHaveLength(1);
    expect(auth).toBe('Bearer my-token');
  });

  it('maps a 403 response to AuthError', async () => {
    vi.stubGlobal('fetch', async () => fakeResp(403, '{"error":{"status":"PERMISSION_DENIED"}}'));
    const client = new GcpClient(async () => 'tok', gate);
    await expect(client.send({ method: 'GET', url: 'https://compute.googleapis.com/x' })).rejects.toBeInstanceOf(AuthError);
  });
});

describe('service-account JWT signing (RS256, from scratch)', () => {
  it('produces a verifiable RS256 assertion with the correct header + claims', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const creds = { clientEmail: 'sa@proj.iam.gserviceaccount.com', privateKey: pem, tokenUri: 'https://oauth2.googleapis.com/token' };
    const jwt = signServiceAccountJwt(creds, GCP_SCOPE, 1_700_000_000);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims.iss).toBe('sa@proj.iam.gserviceaccount.com');
    expect(claims.scope).toBe(GCP_SCOPE);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
    // The signature verifies against the matching public key — a bad key or tampered input would fail.
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    expect(ok).toBe(true);
  });
});

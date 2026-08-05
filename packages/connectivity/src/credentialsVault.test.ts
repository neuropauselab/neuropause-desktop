import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { KeyManager } from '@neuropause/security';
import { CredentialManager, FakeHttpClient, buildAuthorizeUrl, buildTokenExchangeRequest, buildRefreshRequest, parseTokenResponse, type OAuthConfig, type HttpResponse } from '@neuropause/integrations';
import { EncryptedSecretVault, CredentialService } from './credentials';
import { LIVE_VERIFIED_CONNECTORS, CONNECTIVITY_MATRIX } from './evidence';

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, body: JSON.stringify(body) });

describe('Module 2 — Secure Credentials (real envelope encryption + OAuth)', () => {
  it('envelope-encrypts every secret at rest — plaintext never stored (Vault Test)', async () => {
    const vault = new EncryptedSecretVault(new KeyManager(), new ManualClock(1000));
    await vault.put('acme:github', 'access_token', 'gho_supersecret_value');
    // reveal returns the original
    expect(await vault.reveal({ scope: 'acme:github', key: 'access_token' })).toBe('gho_supersecret_value');
    // the STORED form is a real AES-256-GCM envelope — never the plaintext
    const env = vault.ciphertext('acme:github', 'access_token')!;
    expect(env.ciphertext).toBeTruthy();
    expect(env.ciphertext).not.toContain('supersecret');
    expect(JSON.stringify(env)).not.toContain('gho_supersecret_value');
    expect(env.wrappedDek).toBeTruthy(); // DEK wrapped by the tenant KEK
    expect(vault.has('acme:github', 'access_token')).toBe(true);
  });

  it('rotates (version bumps) and revokes credentials', async () => {
    const clock = new ManualClock(0);
    const vault = new EncryptedSecretVault(new KeyManager(), clock);
    const ref = { scope: 'acme:slack', key: 'token' };
    await vault.put('acme:slack', 'token', 'xoxb-1');
    const meta = await vault.rotate('acme:slack', 'token', 'xoxb-2');
    expect(meta.version).toBe(2);
    expect(await vault.reveal(ref)).toBe('xoxb-2');
    expect(vault.list('acme:slack').length).toBe(1);
    await vault.revoke('acme:slack', 'token');
    expect(await vault.reveal(ref)).toBeUndefined();
    expect(vault.has('acme:slack', 'token')).toBe(false);
  });

  it('tracks credential kinds, expiry, and validation', async () => {
    const clock = new ManualClock(0);
    const creds = new CredentialService(new CredentialManager(new EncryptedSecretVault(new KeyManager(), clock), clock), clock);
    await creds.storeApiKey('acme', 'slack', 'xoxb-key');
    expect(await creds.validate('acme', 'slack', 'api_key')).toBe(true);
    expect(creds.status('acme', 'slack', 'api_key').kind).toBe('api_key');

    await creds.storePat('acme', 'github', 'ghp_x', { expiresAt: 500 });
    expect(await creds.validate('acme', 'github', 'pat')).toBe(true);
    clock.set(600); // past expiry
    expect(await creds.validate('acme', 'github', 'pat')).toBe(false);
    expect(creds.status('acme', 'github', 'pat').expired).toBe(true);
  });

  it('constructs OAuth authorize/exchange/refresh requests correctly (OAuth Test)', () => {
    const config: OAuthConfig = { provider: 'test', authorizeUrl: 'https://id.test/auth', tokenUrl: 'https://id.test/token', scopes: ['read', 'write'], pkce: false };
    const url = buildAuthorizeUrl(config, { clientId: 'cid', redirectUri: 'https://app/cb', state: 'st' });
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('scope=read+write');
    const exchange = buildTokenExchangeRequest(config, { code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://app/cb' });
    expect(exchange.url).toBe('https://id.test/token');
    expect(exchange.body).toContain('grant_type=authorization_code');
    expect(buildRefreshRequest(config, { refreshToken: 'r', clientId: 'cid' }).body).toContain('grant_type=refresh_token');
    expect(parseTokenResponse({ access_token: 'a', expires_in: 60 }).accessToken).toBe('a');
  });

  it('refreshes an OAuth token through the transport and re-encrypts it (OAuth + Vault)', async () => {
    const clock = new ManualClock(0);
    const vault = new EncryptedSecretVault(new KeyManager(), clock);
    const creds = new CredentialService(new CredentialManager(vault, clock), clock);
    await creds.storeOAuth('acme', 'jira', { accessToken: 'old-access', refreshToken: 'r1', expiresInSec: 3600, tokenType: 'Bearer' });
    expect(await creds.resolve('acme', 'jira', 'access_token')).toBe('old-access');

    const config: OAuthConfig = { provider: 'atlassian', authorizeUrl: 'https://id.test/auth', tokenUrl: 'https://id.test/token', scopes: ['read'], pkce: false };
    const http = new FakeHttpClient(() => ok({ access_token: 'new-access', refresh_token: 'r2', expires_in: 3600, token_type: 'Bearer' }));
    const tokens = await creds.refresh('acme', 'jira', http, config, { clientId: 'cid', clientSecret: 'sec' });
    expect(tokens.accessToken).toBe('new-access');
    expect(await creds.resolve('acme', 'jira', 'access_token')).toBe('new-access');
    // the refresh went to the token endpoint as a form POST — secret in body, not URL
    expect(http.lastRequest!.url).toBe('https://id.test/token');
    expect(http.lastRequest!.body).toContain('grant_type=refresh_token');
    // still encrypted at rest
    expect(JSON.stringify(vault.ciphertext('acme:jira', 'access_token'))).not.toContain('new-access');
  });

  it('enforces the anti-fabrication rule: only postgresql may claim live-verified', () => {
    for (const m of CONNECTIVITY_MATRIX) {
      if (m.live === 'verified') expect(LIVE_VERIFIED_CONNECTORS.has(m.id)).toBe(true);
    }
    expect([...LIVE_VERIFIED_CONNECTORS]).toEqual(['postgresql']);
    // every SaaS connector is honestly marked infra-pending for live execution
    expect(CONNECTIVITY_MATRIX.filter((m) => m.category === 'saas').every((m) => m.live === 'infra-pending')).toBe(true);
  });
});

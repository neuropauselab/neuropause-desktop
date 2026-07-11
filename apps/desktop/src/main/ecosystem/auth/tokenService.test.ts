/**
 * P3.0 Increment 3 — OAuth token service tests: client-credentials issuance (scope
 * narrowing + rejections), claims coercion, and unified identity resolution (API key
 * vs access token vs revoked vs unknown).
 */
import { describe, expect, it } from 'vitest';
import type { ApiKey, OAuthApplication } from '@neuropause/shared';
import { issueClientCredentialsToken, resolveApiIdentity, toAccessTokenClaims } from './tokenService';
import { verifyJwt } from './jwt';

const SECRET = 'svc-secret-0123456789';

function app(over: Partial<OAuthApplication> = {}): OAuthApplication {
  return {
    id: 'app1', developerId: 'dev1', name: 'svc', clientId: 'npc_x', secretLast4: '1234',
    redirectUris: [], scopes: ['records:read', 'graph:read'], grantTypes: ['client_credentials'],
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

describe('issueClientCredentialsToken', () => {
  it('mints a verifiable token narrowed to the requested (granted) scope', () => {
    const r = issueClientCredentialsToken({ app: app(), developerId: 'dev1', orgId: 'org1', requestedScope: 'records:read', secret: SECRET, nowMs: 1_000_000, jti: 'tok_1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.token_type).toBe('Bearer');
    expect(r.response.scope).toBe('records:read');
    expect(r.response.expires_in).toBe(3600);
    const claims = verifyJwt(r.response.access_token, SECRET, 1_000_000);
    expect(claims).toMatchObject({ sub: 'dev1', org: 'org1', jti: 'tok_1' });
  });

  it('defaults to all of the app scopes when none requested', () => {
    const r = issueClientCredentialsToken({ app: app(), developerId: 'dev1', orgId: 'org1', requestedScope: null, secret: SECRET, nowMs: 0, jti: 't' });
    expect(r.ok && r.response.scope).toBe('records:read graph:read');
  });

  it('rejects a scope the app was not granted', () => {
    const r = issueClientCredentialsToken({ app: app(), developerId: 'dev1', orgId: 'org1', requestedScope: 'records:write', secret: SECRET, nowMs: 0, jti: 't' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error).toBe('invalid_scope');
  });

  it('rejects a client not authorized for the grant', () => {
    const r = issueClientCredentialsToken({ app: app({ grantTypes: ['authorization_code'] }), developerId: 'dev1', orgId: 'org1', requestedScope: null, secret: SECRET, nowMs: 0, jti: 't' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error).toBe('unsupported_grant_type');
  });
});

describe('toAccessTokenClaims', () => {
  it('coerces valid payloads and rejects malformed', () => {
    expect(toAccessTokenClaims({ sub: 'd', org: 'o', scopes: ['records:read'], iat: 1, exp: 2, jti: 'j' })?.sub).toBe('d');
    expect(toAccessTokenClaims({ sub: 'd' })).toBeNull();
    expect(toAccessTokenClaims(null)).toBeNull();
  });
});

describe('resolveApiIdentity', () => {
  const validKey: ApiKey = { id: 'key1', developerId: 'dev1', name: 'k', prefix: '', last4: '', scopes: ['records:read'], createdAt: '', lastUsedAt: null, expiresAt: null, revokedAt: null };
  const resolvers = {
    verifyKey: (raw: string) => (raw === 'valid-key' ? validKey : null),
    developerOrg: () => 'org1',
    verifyToken: (raw: string) =>
      raw.startsWith('tok:') ? { sub: 'dev2', org: 'org2', scopes: ['graph:read'] as const, iat: 0, exp: 9_999_999_999, jti: 'jti9' } : null,
    isTokenRevoked: (jti: string) => jti === 'revoked-jti',
  };

  it('resolves an API key to an identity carrying the tenant', () => {
    expect(resolveApiIdentity('valid-key', resolvers)).toMatchObject({ kind: 'api_key', developerId: 'dev1', orgId: 'org1', credentialId: 'key1' });
  });

  it('resolves a bearer access token to an identity', () => {
    expect(resolveApiIdentity('tok:abc', resolvers)).toMatchObject({ kind: 'access_token', developerId: 'dev2', orgId: 'org2', credentialId: 'jti9' });
  });

  it('denies a revoked token, unknown credential, and empty input', () => {
    const revoked = resolveApiIdentity('tok:abc', {
      ...resolvers,
      verifyToken: () => ({ sub: 'd', org: 'o', scopes: [], iat: 0, exp: 9_999_999_999, jti: 'revoked-jti' }),
    });
    expect(revoked).toBeNull();
    expect(resolveApiIdentity('nope', resolvers)).toBeNull();
    expect(resolveApiIdentity(null, resolvers)).toBeNull();
  });
});

/**
 * OAuth 2.1 token service (P3.0, Increment 3) — pure.
 *
 * Two responsibilities, both dependency-injected so they unit-test without the store
 * or the clock:
 *   1. `issueClientCredentialsToken` — validate the requested scope against the app's
 *      granted scopes, then mint a signed HS256 access token (RFC 6749 §5.1 body).
 *   2. `resolveApiIdentity` — resolve a presented bearer credential (API key OR access
 *      token) to one `ApiIdentity` with developer + tenant + scopes.
 * No store access, no signing key material, no `Date.now()` here — the ecosystem
 * composition root injects the real key store, org lookup, secret, and clock.
 */
import type {
  AccessTokenClaims,
  ApiIdentity,
  ApiKey,
  ApiScope,
  OAuthApplication,
  OAuthTokenError,
  OAuthTokenResponse,
} from '@neuropause/shared';
import { signJwt } from './jwt';

export interface IssueTokenInput {
  app: OAuthApplication;
  developerId: string;
  orgId: string;
  /** Space-delimited requested scope (RFC 6749), or null for "all the app's scopes". */
  requestedScope: string | null;
  secret: string;
  nowMs: number;
  jti: string;
  ttlSec?: number;
}

export type IssueTokenResult =
  | { ok: true; response: OAuthTokenResponse; claims: AccessTokenClaims }
  | { ok: false; error: OAuthTokenError };

/** Mint a client-credentials access token, narrowing scope to what the app was granted. Pure. */
export function issueClientCredentialsToken(input: IssueTokenInput): IssueTokenResult {
  if (!input.app.grantTypes.includes('client_credentials')) {
    return { ok: false, error: { error: 'unsupported_grant_type', error_description: 'Client is not authorized for the client_credentials grant.' } };
  }
  const requested = input.requestedScope ? input.requestedScope.split(/\s+/).filter(Boolean) : null;
  let granted: ApiScope[];
  if (requested && requested.length > 0) {
    const invalid = requested.filter((s) => !input.app.scopes.includes(s as ApiScope));
    if (invalid.length > 0) {
      return { ok: false, error: { error: 'invalid_scope', error_description: `Scope(s) not granted to this client: ${invalid.join(', ')}` } };
    }
    granted = requested as ApiScope[];
  } else {
    granted = [...input.app.scopes];
  }
  const ttl = input.ttlSec ?? 3600;
  const iat = Math.floor(input.nowMs / 1000);
  const claims: AccessTokenClaims = { sub: input.developerId, org: input.orgId, scopes: granted, iat, exp: iat + ttl, jti: input.jti };
  const token = signJwt(claims as unknown as Record<string, unknown>, input.secret);
  return {
    ok: true,
    response: { access_token: token, token_type: 'Bearer', expires_in: ttl, scope: granted.join(' ') },
    claims,
  };
}

/** Coerce a decoded JWT payload to typed access-token claims, or null if malformed. Pure. */
export function toAccessTokenClaims(raw: Record<string, unknown> | null): AccessTokenClaims | null {
  if (!raw) return null;
  if (typeof raw.sub !== 'string' || typeof raw.org !== 'string' || typeof raw.jti !== 'string') return null;
  if (!Array.isArray(raw.scopes)) return null;
  const scopes = raw.scopes.filter((s): s is ApiScope => typeof s === 'string');
  return {
    sub: raw.sub,
    org: raw.org,
    scopes,
    iat: typeof raw.iat === 'number' ? raw.iat : 0,
    exp: typeof raw.exp === 'number' ? raw.exp : 0,
    jti: raw.jti,
  };
}

export interface IdentityResolvers {
  /** Resolve a raw API key to its record (already checks revoked + expired). */
  verifyKey: (raw: string) => ApiKey | null;
  /** The tenant (orgId) a developer belongs to. */
  developerOrg: (developerId: string) => string | null;
  /** Verify + decode a bearer access token to typed claims, or null. */
  verifyToken: (raw: string) => AccessTokenClaims | null;
  /** Whether a token jti has been revoked. */
  isTokenRevoked: (jti: string) => boolean;
}

/**
 * Resolve a presented credential (API key first, then access token) to one identity.
 * Returns null when neither resolves — the gateway then denies with 401. Pure.
 */
export function resolveApiIdentity(raw: string | null | undefined, r: IdentityResolvers): ApiIdentity | null {
  if (!raw) return null;
  const key = r.verifyKey(raw);
  if (key) {
    return {
      kind: 'api_key',
      developerId: key.developerId,
      orgId: r.developerOrg(key.developerId) ?? '',
      scopes: key.scopes,
      credentialId: key.id,
    };
  }
  const claims = r.verifyToken(raw);
  if (claims && !r.isTokenRevoked(claims.jti)) {
    return {
      kind: 'access_token',
      developerId: claims.sub,
      orgId: claims.org,
      scopes: claims.scopes,
      credentialId: claims.jti,
    };
  }
  return null;
}

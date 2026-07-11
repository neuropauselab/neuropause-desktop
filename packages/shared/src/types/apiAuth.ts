/**
 * API authentication shapes (P3.0, Increment 3).
 *
 * The platform authenticates a gateway caller by EITHER a hashed API key (already
 * shipped) OR an OAuth 2.1 client-credentials access token (added this increment).
 * Both resolve to one `ApiIdentity` carrying the developer, the tenant (orgId), and
 * the granted scopes — so downstream rate/quota/audit + RBAC all key off one shape.
 * Access tokens are HS256 JWTs signed with a locally-held secret; `jti` supports
 * explicit revocation. Types-only.
 */
import type { ApiScope } from './ecosystem';

/** The claims carried by an issued access token (JWT payload). */
export interface AccessTokenClaims {
  /** Subject — the developer id the token acts as. */
  sub: string;
  /** Tenant — the organization id (tenant isolation boundary). */
  org: string;
  scopes: ApiScope[];
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
  /** Unique token id — the revocation handle. */
  jti: string;
}

/** RFC 6749 §5.1 success body for the client-credentials grant. */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

/** RFC 6749 §5.2 error body. */
export interface OAuthTokenError {
  error: 'invalid_client' | 'unsupported_grant_type' | 'invalid_scope' | 'invalid_request';
  error_description: string;
}

export type ApiCredentialKind = 'api_key' | 'access_token';

/** The resolved caller identity behind a gateway request — always with a tenant. */
export interface ApiIdentity {
  kind: ApiCredentialKind;
  developerId: string;
  /** The tenant this credential belongs to. */
  orgId: string;
  scopes: ApiScope[];
  /** The API key id, or the access token's `jti`. */
  credentialId: string;
}

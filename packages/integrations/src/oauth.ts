/**
 * OAuth 2.0 (NCEA 13.0, Phase 2). Constructs the real authorize URL, token
 * exchange, and refresh requests for enterprise SaaS providers, and parses token
 * responses. This is request/response CONSTRUCTION — ADAPTER-VERIFIED to the byte
 * without a live IdP; the actual browser redirect + code exchange + refresh
 * against a real provider needs registered client credentials (INFRA-PENDING).
 * Secrets (client secret, refresh token) are passed at call time and belong in
 * the Secret Vault — never logged, never placed in the authorize URL.
 */
import type { HttpRequest } from './http';

export interface OAuthConfig {
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** PKCE recommended for public clients. */
  pkce: boolean;
  /** Extra params some providers require on the authorize step. */
  authParams?: Record<string, string>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  tokenType: string;
  scope?: string;
}

/** Build the authorize URL the user is redirected to. State + PKCE challenge included; NO secrets. */
export function buildAuthorizeUrl(
  config: OAuthConfig,
  params: { clientId: string; redirectUri: string; state: string; codeChallenge?: string },
): string {
  const u = new URL(config.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('scope', config.scopes.join(' '));
  u.searchParams.set('state', params.state);
  if (config.pkce && params.codeChallenge) {
    u.searchParams.set('code_challenge', params.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(config.authParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

function formBody(fields: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) p.set(k, v);
  return p.toString();
}

/** The authorization-code → token exchange request (secrets in the body, not the URL). */
export function buildTokenExchangeRequest(
  config: OAuthConfig,
  params: { code: string; clientId: string; clientSecret?: string; redirectUri: string; codeVerifier?: string },
): HttpRequest {
  return {
    method: 'POST',
    url: config.tokenUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  };
}

/** The refresh-token request. */
export function buildRefreshRequest(config: OAuthConfig, params: { refreshToken: string; clientId: string; clientSecret?: string }): HttpRequest {
  return {
    method: 'POST',
    url: config.tokenUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  };
}

export function parseTokenResponse(json: Record<string, unknown>): TokenSet {
  const accessToken = json.access_token as string | undefined;
  if (!accessToken) throw new Error('token response missing access_token');
  return {
    accessToken,
    ...(json.refresh_token ? { refreshToken: json.refresh_token as string } : {}),
    ...(json.expires_in ? { expiresInSec: Number(json.expires_in) } : {}),
    tokenType: (json.token_type as string) ?? 'Bearer',
    ...(json.scope ? { scope: json.scope as string } : {}),
  };
}

/** Canonical OAuth endpoint configs for the enterprise SaaS providers. */
export const OAUTH_PROVIDERS: Record<string, OAuthConfig> = {
  google: {
    provider: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    pkce: true,
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
  github: { provider: 'github', authorizeUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scopes: ['repo', 'read:org'], pkce: false },
  gitlab: { provider: 'gitlab', authorizeUrl: 'https://gitlab.com/oauth/authorize', tokenUrl: 'https://gitlab.com/oauth/token', scopes: ['api', 'read_api'], pkce: true },
  slack: { provider: 'slack', authorizeUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access', scopes: ['chat:write', 'channels:read'], pkce: false },
  microsoft: {
    provider: 'microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Mail.Read', 'Files.Read'],
    pkce: true,
  },
  atlassian: { provider: 'atlassian', authorizeUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token', scopes: ['read:jira-work', 'offline_access'], pkce: true, authParams: { audience: 'api.atlassian.com' } },
  notion: { provider: 'notion', authorizeUrl: 'https://api.notion.com/v1/oauth/authorize', tokenUrl: 'https://api.notion.com/v1/oauth/token', scopes: [], pkce: false, authParams: { owner: 'user' } },
  linear: { provider: 'linear', authorizeUrl: 'https://linear.app/oauth/authorize', tokenUrl: 'https://api.linear.app/oauth/token', scopes: ['read', 'write'], pkce: false },
  asana: { provider: 'asana', authorizeUrl: 'https://app.asana.com/-/oauth_authorize', tokenUrl: 'https://app.asana.com/-/oauth_token', scopes: ['default'], pkce: true },
  salesforce: { provider: 'salesforce', authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize', tokenUrl: 'https://login.salesforce.com/services/oauth2/token', scopes: ['api', 'refresh_token'], pkce: true },
  hubspot: { provider: 'hubspot', authorizeUrl: 'https://app.hubspot.com/oauth/authorize', tokenUrl: 'https://api.hubapi.com/oauth/v1/token', scopes: ['crm.objects.contacts.read'], pkce: false },
  shopify: { provider: 'shopify', authorizeUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize', tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token', scopes: ['read_products', 'read_orders'], pkce: false },
};

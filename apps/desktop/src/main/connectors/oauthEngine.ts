/**
 * The connector OAuth2 engine.
 *
 * Implements the RFC 8252 native-app flow for every OAuth connector: PKCE where
 * supported, an ephemeral loopback redirect, strict `state` verification, and a
 * standards-compliant token exchange/refresh. It is provider-agnostic — each
 * connector's endpoints, scopes, and client-auth style come from its manifest.
 *
 * The client secret (confidential connectors only) is read from configuration
 * and used solely at the token endpoint; it never reaches the renderer. Tokens
 * are returned to the connector service, which vaults them encrypted.
 *
 * Note: token *responses* are parsed against the OAuth2 standard fields
 * (access_token / refresh_token / expires_in / scope / token_type). Provider
 * identity enrichment (display name, avatar) is performed by each connector's
 * sync adapter in Stage 2; here we capture whatever identity the token response
 * itself carries.
 */
import { shell } from 'electron';
import type { ConnectorManifest, OAuthEndpointConfig } from '@neuropause/shared';
import { config } from '../config';
import { createLogger } from '../logger';
import { startLoopbackServer } from '../auth/loopbackServer';
import { createPkcePair, randomState } from './pkce';
import { computeExpiresAt } from './oauthTokens';
import type { ResolvedCredentials } from './credentials';

const log = createLogger('oauth-engine');

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms when the access token expires, or null if not provided. */
  expiresAt: number | null;
  scopes: string[];
  tokenType: string;
  /** Best-effort identity hints from the token response. */
  identity: { externalId: string | null; label: string | null };
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  // common identity fields some providers include
  id?: string | number;
  account_id?: string;
  sub?: string;
  workspace_name?: string;
  team?: { id?: string; name?: string };
}

function parseScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  // Split on commas OR whitespace. Providers are inconsistent about the delimiter in the token
  // response — notably GitHub returns comma-separated scopes even when the authorize request used
  // spaces — and no OAuth scope value contains an internal comma or space, so accepting both is
  // strictly more robust and never mis-splits a scope. (The request-side join still uses the
  // manifest's `scopeSeparator`.) Without this, a GitHub grant lands as one joined pseudo-scope and
  // breaks scope-gated capability discovery.
  return scope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeTokens(raw: RawTokenResponse, ttlSeconds: number | null = null): OAuthTokens {
  if (!raw.access_token) {
    throw new Error(
      raw.error_description || raw.error || 'Token endpoint returned no access token',
    );
  }
  const externalId =
    raw.account_id ??
    raw.sub ??
    (raw.id !== undefined ? String(raw.id) : null) ??
    raw.team?.id ??
    null;
  const label = raw.workspace_name ?? raw.team?.name ?? null;
  const expiresAt = computeExpiresAt(raw.expires_in, ttlSeconds, Date.now());
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt,
    scopes: parseScopes(raw.scope),
    tokenType: raw.token_type ?? 'Bearer',
    identity: { externalId, label },
  };
}

/** Builds the form body and headers for a token-endpoint request. */
function tokenRequestInit(
  oauth: OAuthEndpointConfig,
  creds: ResolvedCredentials,
  params: Record<string, string>,
): RequestInit {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    ...oauth.extraTokenParams,
    ...params,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (creds.clientSecret) {
    if (oauth.tokenAuthStyle === 'basic') {
      const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    } else {
      body.set('client_secret', creds.clientSecret);
    }
  }
  return { method: 'POST', headers, body };
}

async function postToken(url: string, init: RequestInit): Promise<RawTokenResponse> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: RawTokenResponse;
  try {
    json = JSON.parse(text) as RawTokenResponse;
  } catch {
    throw new Error(`Token endpoint returned a non-JSON response (${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return json;
}

export const oauthEngine = {
  /**
   * Runs the full interactive authorization for a connector and returns tokens.
   * Opens the system browser, catches the redirect on loopback, verifies state,
   * and exchanges the code. Always closes the loopback server.
   */
  async authorize(manifest: ConnectorManifest, creds: ResolvedCredentials): Promise<OAuthTokens> {
    const oauth = manifest.oauth;
    if (!oauth) throw new Error(`${manifest.name} is not an OAuth connector`);

    const pkce = oauth.usePkce ? createPkcePair() : null;
    const state = randomState();
    const loopback = await startLoopbackServer({
      port: oauth.loopbackPort,
      callbackPath: oauth.callbackPath,
    });

    try {
      const url = new URL(oauth.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', creds.clientId);
      url.searchParams.set('redirect_uri', loopback.redirectUri);
      if (oauth.scopes.length > 0)
        url.searchParams.set('scope', oauth.scopes.join(oauth.scopeSeparator));
      url.searchParams.set('state', state);
      if (pkce) {
        url.searchParams.set('code_challenge', pkce.challenge);
        url.searchParams.set('code_challenge_method', 'S256');
      }
      for (const [k, v] of Object.entries(oauth.extraAuthParams)) url.searchParams.set(k, v);

      await shell.openExternal(url.toString());
      const result = await loopback.waitForResult(config.oauthTimeoutMs);

      if (result.state !== state)
        throw new Error('State mismatch; sign-in was rejected for your safety');
      if (result.error) throw new Error(`Authorization failed: ${result.error}`);
      if (!result.code) throw new Error('No authorization code was returned');

      const params: Record<string, string> = {
        grant_type: 'authorization_code',
        code: result.code,
        redirect_uri: loopback.redirectUri,
      };
      if (pkce) params.code_verifier = pkce.verifier;

      const raw = await postToken(oauth.tokenUrl, tokenRequestInit(oauth, creds, params));
      const tokens = normalizeTokens(raw, oauth.accessTokenTtlSeconds ?? null);
      log.info('Authorization succeeded', { connector: manifest.id });
      return tokens;
    } finally {
      loopback.close();
    }
  },

  /** Exchanges a refresh token for a fresh access token. */
  async refresh(
    manifest: ConnectorManifest,
    creds: ResolvedCredentials,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const oauth = manifest.oauth;
    if (!oauth) throw new Error(`${manifest.name} is not an OAuth connector`);
    const params: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };
    if (oauth.scopes.length > 0) params.scope = oauth.scopes.join(oauth.scopeSeparator);
    const raw = await postToken(oauth.tokenUrl, tokenRequestInit(oauth, creds, params));
    const tokens = normalizeTokens(raw, oauth.accessTokenTtlSeconds ?? null);
    // Refresh responses frequently omit a new refresh token; keep the old one.
    if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
    return tokens;
  },

  /** Best-effort token revocation on disconnect. Never throws. */
  async revoke(
    manifest: ConnectorManifest,
    creds: ResolvedCredentials,
    token: string,
  ): Promise<void> {
    const oauth = manifest.oauth;
    if (!oauth?.revokeUrl) return;
    try {
      const body = new URLSearchParams({ token, client_id: creds.clientId });
      if (creds.clientSecret && oauth.tokenAuthStyle === 'body')
        body.set('client_secret', creds.clientSecret);
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (creds.clientSecret && oauth.tokenAuthStyle === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
      }
      await fetch(oauth.revokeUrl, { method: 'POST', headers, body });
    } catch (err) {
      log.warn('Token revoke failed (ignored)', { connector: manifest.id, err: String(err) });
    }
  },
};

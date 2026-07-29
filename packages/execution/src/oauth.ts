/**
 * Module 3 — OAuth Lifecycle Manager. Composes the integrations OAuth request builders
 * (authorize URL / token exchange / refresh, secrets in the body never the URL) and the
 * CredentialManager (encrypted token storage + expiry). Token exchange and refresh EXECUTE
 * over the transport — live-verified against a local token server in the validation suite;
 * live against a real provider is infra-pending on operator client secrets.
 */
import {
  buildAuthorizeUrl,
  buildTokenExchangeRequest,
  parseTokenResponse,
  type OAuthConfig,
  type TokenSet,
  type HttpClient,
  type CredentialManager,
} from '@neuropause/integrations';

export type OAuthState = 'unconfigured' | 'authorized' | 'expired' | 'revoked';

export class OAuthLifecycleManager {
  private readonly apps = new Map<string, OAuthConfig>();

  constructor(
    private readonly creds: CredentialManager,
    private readonly http: HttpClient,
  ) {}

  configure(connectorId: string, config: OAuthConfig): void {
    this.apps.set(connectorId, config);
  }
  config(connectorId: string): OAuthConfig | undefined {
    return this.apps.get(connectorId);
  }

  authorizeUrl(connectorId: string, params: { clientId: string; redirectUri: string; state: string; codeChallenge?: string }): string {
    const config = this.apps.get(connectorId);
    if (!config) throw new Error(`OAuth not configured for '${connectorId}'`);
    return buildAuthorizeUrl(config, params);
  }

  /** Exchange an authorization code for tokens — executes over the transport. */
  async exchange(connectorId: string, tenantId: string, params: { code: string; clientId: string; clientSecret?: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet> {
    const config = this.apps.get(connectorId);
    if (!config) throw new Error(`OAuth not configured for '${connectorId}'`);
    const res = await this.http.send(buildTokenExchangeRequest(config, params));
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    const tokens = parseTokenResponse(JSON.parse(res.body || '{}') as Record<string, unknown>);
    await this.creds.storeTokenSet(tenantId, connectorId, tokens);
    return tokens;
  }

  /** Refresh the access token — executes over the transport (reused manager flow). */
  async refresh(connectorId: string, tenantId: string, params: { clientId: string; clientSecret?: string }): Promise<TokenSet> {
    const config = this.apps.get(connectorId);
    if (!config) throw new Error(`OAuth not configured for '${connectorId}'`);
    return this.creds.refresh(tenantId, connectorId, this.http, config, params);
  }

  async state(connectorId: string, tenantId: string): Promise<OAuthState> {
    if (!this.apps.has(connectorId)) return 'unconfigured';
    const token = await this.creds.resolve(tenantId, connectorId, 'access_token');
    if (token === undefined) return 'revoked';
    return this.creds.needsRefresh(tenantId, connectorId) ? 'expired' : 'authorized';
  }
}

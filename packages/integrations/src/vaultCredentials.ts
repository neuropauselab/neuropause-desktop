/**
 * Secret Vault integration (NCEA 13.0, Phase 4). EVERY connector credential lives
 * in the one Secret Vault (from the connector platform) — never in config, logs,
 * or code. Scope is `${tenant}:${connector}` so tenants are isolated by
 * construction. Supports storing OAuth token sets, resolving them at use time,
 * rotation, revocation, and token refresh (build the refresh request, send it,
 * parse + re-store the new token set). The refresh LOGIC and vault handling are
 * VERIFIED; a live refresh against a real IdP is INFRA-PENDING.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SecretVault } from '@neuropause/connectors';
import type { HttpClient } from './http';
import { HttpError } from './http';
import { buildRefreshRequest, parseTokenResponse, type OAuthConfig, type TokenSet } from './oauth';

function scope(tenant: string, connector: string): string {
  return `${tenant}:${connector}`;
}

export class CredentialManager {
  /** Access-token expiry timestamps (not secret) — the vault holds the secrets. */
  private readonly expiries = new Map<string, number>();

  constructor(
    private readonly vault: SecretVault,
    private readonly clock: Clock,
  ) {}

  async store(tenant: string, connector: string, key: string, value: string): Promise<void> {
    await this.vault.put(scope(tenant, connector), key, value);
  }

  /** Resolve a credential at use time (the vault audits the reveal). */
  async resolve(tenant: string, connector: string, key: string): Promise<string | undefined> {
    return this.vault.reveal({ scope: scope(tenant, connector), key });
  }

  async rotate(tenant: string, connector: string, key: string, newValue: string): Promise<void> {
    await this.vault.rotate(scope(tenant, connector), key, newValue);
  }

  async revoke(tenant: string, connector: string, key: string): Promise<void> {
    await this.vault.revoke(scope(tenant, connector), key);
  }

  async storeTokenSet(tenant: string, connector: string, tokens: TokenSet): Promise<void> {
    const s = scope(tenant, connector);
    await this.vault.put(s, 'access_token', tokens.accessToken);
    if (tokens.refreshToken) await this.vault.put(s, 'refresh_token', tokens.refreshToken);
    if (tokens.expiresInSec !== undefined) this.expiries.set(s, this.clock.now() + tokens.expiresInSec * 1000);
  }

  /** True when the access token is missing or within `skewMs` of expiry. */
  needsRefresh(tenant: string, connector: string, skewMs = 60_000): boolean {
    const exp = this.expiries.get(scope(tenant, connector));
    if (exp === undefined) return false;
    return this.clock.now() + skewMs >= exp;
  }

  /**
   * Refresh the access token: reveal the refresh token from the vault, build +
   * send the refresh request, parse, and re-store the new token set. The HTTP
   * send is the only live-dependent step.
   */
  async refresh(
    tenant: string,
    connector: string,
    http: HttpClient,
    config: OAuthConfig,
    params: { clientId: string; clientSecret?: string },
  ): Promise<TokenSet> {
    const refreshToken = await this.resolve(tenant, connector, 'refresh_token');
    if (!refreshToken) throw new Error(`no refresh token for ${scope(tenant, connector)}`);
    const req = buildRefreshRequest(config, { refreshToken, clientId: params.clientId, ...(params.clientSecret ? { clientSecret: params.clientSecret } : {}) });
    const res = await http.send(req);
    if (!res.ok) throw new HttpError(res.status, res.body, 'token refresh failed');
    const tokens = parseTokenResponse(JSON.parse(res.body));
    // A provider may not re-issue a refresh token; keep the existing one.
    if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
    await this.storeTokenSet(tenant, connector, tokens);
    return tokens;
  }
}

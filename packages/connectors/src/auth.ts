/**
 * Authentication framework (NCEA 10.4, Phase 3). One abstraction over the
 * credential kinds (OAuth2/OIDC/PKCE/API-key/PAT/JWT/Bearer/Basic/service
 * account/refresh). It resolves an auth config into the header to attach,
 * fetching the raw value from the Secret Vault at USE time — credentials are
 * never stored on the config or logged. Real OAuth token-exchange flows are a
 * deployment concern; this is the strategy + rotation + validation layer.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SecretVault, SecretRef } from './vault';

export type AuthType =
  | 'oauth2'
  | 'oidc'
  | 'pkce'
  | 'api_key'
  | 'pat'
  | 'jwt'
  | 'bearer'
  | 'basic'
  | 'service_account'
  | 'none';

export interface AuthConfig {
  type: AuthType;
  /** secret references (never raw values). */
  secretRefs?: Record<string, SecretRef>;
  scopes?: string[];
  /** header name override for api_key (default X-API-Key). */
  header?: string;
}

export interface ResolvedCredential {
  type: AuthType;
  header?: { name: string; value: string };
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const BEARER_TYPES: AuthType[] = ['oauth2', 'oidc', 'pkce', 'pat', 'jwt', 'bearer', 'service_account'];

export class AuthFramework {
  constructor(
    private readonly vault: SecretVault,
    private readonly clock: Clock,
  ) {}

  /** Validate that the config has the secret refs its type requires. */
  validate(config: AuthConfig): { ok: boolean; missing: string[] } {
    const refs = config.secretRefs ?? {};
    const need: string[] =
      config.type === 'none' ? [] : config.type === 'basic' ? ['username', 'password'] : ['token'];
    const missing = need.filter((k) => !refs[k]);
    return { ok: missing.length === 0, missing };
  }

  /** Resolve to a header, revealing the secret from the vault at use time. */
  async resolve(config: AuthConfig): Promise<ResolvedCredential> {
    if (config.type === 'none') return { type: 'none' };
    const refs = config.secretRefs ?? {};
    if (config.type === 'basic') {
      const user = refs.username ? await this.vault.reveal(refs.username) : undefined;
      const pass = refs.password ? await this.vault.reveal(refs.password) : undefined;
      if (user === undefined || pass === undefined) throw new Error('basic auth secret unavailable');
      const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
      return { type: 'basic', header: { name: 'Authorization', value: `Basic ${encoded}` } };
    }
    const token = refs.token ? await this.vault.reveal(refs.token) : undefined;
    if (token === undefined) throw new Error(`${config.type} credential unavailable`);
    if (config.type === 'api_key') {
      return { type: 'api_key', header: { name: config.header ?? 'X-API-Key', value: token } };
    }
    if (BEARER_TYPES.includes(config.type)) {
      return { type: config.type, header: { name: 'Authorization', value: `Bearer ${token}` } };
    }
    return { type: config.type };
  }

  needsRefresh(tokens: TokenSet): boolean {
    return tokens.expiresAt <= this.clock.now();
  }

  /** Rotate the stored credential (token rotation). */
  async rotate(ref: SecretRef, newValue: string): Promise<void> {
    await this.vault.rotate(ref.scope, ref.key, newValue);
  }
}

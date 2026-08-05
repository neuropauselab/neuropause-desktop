/**
 * Module 2 — Secure Credentials. Two real pieces, both composing existing platform
 * primitives, satisfying "no secrets stored in plain text":
 *
 *  1. `EncryptedSecretVault` implements the connectors `SecretVault` interface but
 *     encrypts every value AT REST with the security package's `KeyManager`
 *     (AES-256-GCM envelope encryption, per-scope KEK wrapping a fresh DEK). The
 *     stored form is a ciphertext `Envelope`; plaintext exists only transiently
 *     inside `reveal()`. This replaces the connectors' in-memory PLAINTEXT stub.
 *  2. `CredentialService` layers credential KINDS (oauth / refresh / pat / api_key /
 *     secret), rotation, expiration, and validation on top of the integrations
 *     `CredentialManager` (which already scopes secrets `${tenant}:${connector}` and
 *     handles OAuth refresh through the transport).
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SecretVault, SecretRef, SecretMetadata } from '@neuropause/connectors';
import type { KeyManager, Envelope } from '@neuropause/security';
import type { CredentialManager, HttpClient, OAuthConfig, TokenSet } from '@neuropause/integrations';
import type { CredentialKind } from './constants';

type VaultAuditFn = (event: { action: 'put' | 'reveal' | 'rotate' | 'revoke'; scope: string; key: string }) => void;

interface StoredEnvelope {
  env: Envelope;
  meta: SecretMetadata;
}

/**
 * A `SecretVault` whose values are envelope-encrypted at rest by the one security
 * KeyManager. Scope doubles as the encryption tenant, so every (tenant:connector)
 * scope gets its own key-encryption key. Never returns a value except via reveal().
 */
export class EncryptedSecretVault implements SecretVault {
  private readonly store = new Map<string, StoredEnvelope>();

  constructor(
    private readonly keys: KeyManager,
    private readonly clock: Clock,
    private readonly onAudit?: VaultAuditFn,
  ) {}

  private k(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  async put(scope: string, key: string, value: string): Promise<SecretRef> {
    if (!value) throw new Error('refusing to store an empty secret');
    const env = this.keys.encrypt(scope, value);
    const existing = this.store.get(this.k(scope, key));
    const meta: SecretMetadata = {
      scope,
      key,
      version: existing ? existing.meta.version + 1 : 1,
      createdAt: existing ? existing.meta.createdAt : this.clock.now(),
      revoked: false,
    };
    this.store.set(this.k(scope, key), { env, meta });
    this.onAudit?.({ action: 'put', scope, key });
    return { scope, key };
  }

  async reveal(ref: SecretRef): Promise<string | undefined> {
    const s = this.store.get(this.k(ref.scope, ref.key));
    if (!s || s.meta.revoked) return undefined;
    this.onAudit?.({ action: 'reveal', scope: ref.scope, key: ref.key });
    return this.keys.decrypt(ref.scope, s.env);
  }

  has(scope: string, key: string): boolean {
    const s = this.store.get(this.k(scope, key));
    return !!s && !s.meta.revoked;
  }

  async rotate(scope: string, key: string, newValue: string): Promise<SecretMetadata> {
    const s = this.store.get(this.k(scope, key));
    if (!s) throw new Error(`no secret to rotate at ${scope}::${key}`);
    const env = this.keys.encrypt(scope, newValue);
    const meta: SecretMetadata = { ...s.meta, version: s.meta.version + 1, rotatedAt: this.clock.now() };
    this.store.set(this.k(scope, key), { env, meta });
    this.onAudit?.({ action: 'rotate', scope, key });
    return meta;
  }

  async revoke(scope: string, key: string): Promise<void> {
    const s = this.store.get(this.k(scope, key));
    if (s) {
      s.meta.revoked = true;
      this.onAudit?.({ action: 'revoke', scope, key });
    }
  }

  meta(scope: string, key: string): SecretMetadata | undefined {
    return this.store.get(this.k(scope, key))?.meta;
  }

  list(scope: string): SecretMetadata[] {
    return [...this.store.values()].map((s) => s.meta).filter((m) => m.scope === scope);
  }

  /** Proof of at-rest encryption: the stored ciphertext envelope (never plaintext). */
  ciphertext(scope: string, key: string): Envelope | undefined {
    return this.store.get(this.k(scope, key))?.env;
  }
}

export interface CredentialStatus {
  present: boolean;
  kind?: CredentialKind;
  expiresAt?: number;
  expired: boolean;
  needsRefresh: boolean;
}

/**
 * Kind-aware credential platform over the integrations CredentialManager. Adds
 * rotation, expiration tracking, and validation; delegates encrypted storage and
 * OAuth refresh to the reused manager + encrypted vault.
 */
export class CredentialService {
  /** expiry timestamps for non-OAuth credentials (OAuth expiry lives in CredentialManager). */
  private readonly expiries = new Map<string, { kind: CredentialKind; expiresAt?: number }>();

  constructor(
    private readonly creds: CredentialManager,
    private readonly clock: Clock,
  ) {}

  private ek(tenant: string, connector: string, key: string): string {
    return `${tenant}:${connector}:${key}`;
  }

  /** Store an OAuth access+refresh token set (records expiry inside the manager). */
  async storeOAuth(tenant: string, connector: string, tokens: TokenSet): Promise<void> {
    await this.creds.storeTokenSet(tenant, connector, tokens);
    this.expiries.set(this.ek(tenant, connector, 'access_token'), {
      kind: 'oauth',
      ...(tokens.expiresInSec ? { expiresAt: this.clock.now() + tokens.expiresInSec * 1000 } : {}),
    });
  }

  async storeApiKey(tenant: string, connector: string, apiKey: string, opts: { expiresAt?: number } = {}): Promise<void> {
    await this.creds.store(tenant, connector, 'api_key', apiKey);
    this.expiries.set(this.ek(tenant, connector, 'api_key'), { kind: 'api_key', ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}) });
  }

  async storePat(tenant: string, connector: string, pat: string, opts: { expiresAt?: number } = {}): Promise<void> {
    await this.creds.store(tenant, connector, 'pat', pat);
    this.expiries.set(this.ek(tenant, connector, 'pat'), { kind: 'pat', ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}) });
  }

  async storeSecret(tenant: string, connector: string, name: string, value: string): Promise<void> {
    await this.creds.store(tenant, connector, name, value);
    this.expiries.set(this.ek(tenant, connector, name), { kind: 'secret' });
  }

  resolve(tenant: string, connector: string, key: string): Promise<string | undefined> {
    return this.creds.resolve(tenant, connector, key);
  }

  async rotate(tenant: string, connector: string, key: string, newValue: string): Promise<void> {
    await this.creds.rotate(tenant, connector, key, newValue);
  }

  async revoke(tenant: string, connector: string, key: string): Promise<void> {
    await this.creds.revoke(tenant, connector, key);
    this.expiries.delete(this.ek(tenant, connector, key));
  }

  /** A credential is valid when it resolves to a value and is not past its expiry. */
  async validate(tenant: string, connector: string, key: string): Promise<boolean> {
    const value = await this.creds.resolve(tenant, connector, key);
    if (value === undefined) return false;
    const exp = this.expiries.get(this.ek(tenant, connector, key));
    if (exp?.expiresAt !== undefined && exp.expiresAt <= this.clock.now()) return false;
    return true;
  }

  status(tenant: string, connector: string, key: string): CredentialStatus {
    const exp = this.expiries.get(this.ek(tenant, connector, key));
    const present = exp !== undefined;
    const expired = exp?.expiresAt !== undefined && exp.expiresAt <= this.clock.now();
    const needsRefresh = exp?.kind === 'oauth' ? this.creds.needsRefresh(tenant, connector) : false;
    return {
      present,
      ...(exp?.kind ? { kind: exp.kind } : {}),
      ...(exp?.expiresAt !== undefined ? { expiresAt: exp.expiresAt } : {}),
      expired,
      needsRefresh,
    };
  }

  /** Refresh an OAuth access token through the transport (reused manager flow). */
  refresh(
    tenant: string,
    connector: string,
    http: HttpClient,
    config: OAuthConfig,
    params: { clientId: string; clientSecret?: string },
  ): Promise<TokenSet> {
    return this.creds.refresh(tenant, connector, http, config, params);
  }
}

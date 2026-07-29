/**
 * Secret Vault (NCEA 10.4, Phase 7). The SINGLE place connector credentials
 * live. Callers hold a `SecretRef` (a scope+key handle), never a value; only
 * `reveal()` returns a raw value (at use time, audited). `list()` returns
 * METADATA only. Supports rotation, revocation, and scoping. The in-memory store
 * is a stub; production is the OS keychain / KMS (encryption at rest is a
 * deployment concern). Never expose credentials in logs, config, or audit.
 */
import type { Clock } from '@neuropause/cloud-core';

export interface SecretRef {
  scope: string;
  key: string;
}

export interface SecretMetadata {
  scope: string;
  key: string;
  version: number;
  createdAt: number;
  rotatedAt?: number;
  revoked: boolean;
}

export type VaultAudit = (event: { action: 'put' | 'reveal' | 'rotate' | 'revoke'; scope: string; key: string }) => void;

export interface SecretVault {
  put(scope: string, key: string, value: string): Promise<SecretRef>;
  reveal(ref: SecretRef): Promise<string | undefined>;
  has(scope: string, key: string): boolean;
  rotate(scope: string, key: string, newValue: string): Promise<SecretMetadata>;
  revoke(scope: string, key: string): Promise<void>;
  meta(scope: string, key: string): SecretMetadata | undefined;
  list(scope: string): SecretMetadata[];
}

export class InMemorySecretVault implements SecretVault {
  private readonly store = new Map<string, { value: string; meta: SecretMetadata }>();

  constructor(
    private readonly clock: Clock,
    private readonly onAudit?: VaultAudit,
  ) {}

  private id(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  async put(scope: string, key: string, value: string): Promise<SecretRef> {
    if (value.length === 0) throw new Error('refusing to store an empty secret');
    const existing = this.store.get(this.id(scope, key));
    const meta: SecretMetadata = {
      scope,
      key,
      version: existing ? existing.meta.version + 1 : 1,
      createdAt: existing ? existing.meta.createdAt : this.clock.now(),
      revoked: false,
    };
    this.store.set(this.id(scope, key), { value, meta });
    this.onAudit?.({ action: 'put', scope, key });
    return { scope, key };
  }

  async reveal(ref: SecretRef): Promise<string | undefined> {
    const entry = this.store.get(this.id(ref.scope, ref.key));
    if (!entry || entry.meta.revoked) return undefined;
    this.onAudit?.({ action: 'reveal', scope: ref.scope, key: ref.key });
    return entry.value;
  }

  has(scope: string, key: string): boolean {
    const entry = this.store.get(this.id(scope, key));
    return !!entry && !entry.meta.revoked;
  }

  async rotate(scope: string, key: string, newValue: string): Promise<SecretMetadata> {
    const entry = this.store.get(this.id(scope, key));
    if (!entry) throw new Error(`no secret to rotate at ${scope}::${key}`);
    entry.value = newValue;
    entry.meta = { ...entry.meta, version: entry.meta.version + 1, rotatedAt: this.clock.now() };
    this.onAudit?.({ action: 'rotate', scope, key });
    return entry.meta;
  }

  async revoke(scope: string, key: string): Promise<void> {
    const entry = this.store.get(this.id(scope, key));
    if (entry) {
      entry.meta = { ...entry.meta, revoked: true };
      this.onAudit?.({ action: 'revoke', scope, key });
    }
  }

  meta(scope: string, key: string): SecretMetadata | undefined {
    return this.store.get(this.id(scope, key))?.meta;
  }

  /** Metadata only — never values. */
  list(scope: string): SecretMetadata[] {
    return [...this.store.values()].filter((e) => e.meta.scope === scope).map((e) => e.meta);
  }
}

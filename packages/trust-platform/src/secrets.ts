/**
 * EPIC 3 — Secrets & Key Management. A secret registry (REFERENCES only — a vault path or key id, never a
 * plaintext value), rotation policies, API-key governance, a certificate registry, an encryption-key
 * registry, and a secret audit trail. Encryption-key rotation/versioning/revocation REUSES the security
 * KeyManager (real, deterministic key versions). External secret stores (HashiCorp Vault, Azure Key
 * Vault, AWS Secrets Manager, Google Secret Manager) are ADAPTER-VERIFIED — represented until configured,
 * never contacted. No secret value is ever stored, logged, or fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { SECRET_STORES, type SecretKind, type SecretStore } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface SecretRef {
  id: string;
  name: string;
  kind: SecretKind;
  reference: string; // vault path / key id — NEVER a value
  store: SecretStore | 'in-process';
  rotationIntervalDays: number | null;
  active: boolean;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  reference: string;
  revoked: boolean;
}

export interface CertificateRecord {
  id: string;
  subject: string;
  reference: string;
  expiresAt: number;
}

export interface KeyRotationResult {
  tenant: string;
  newVersion: number | null;
  reusedKeyManager: boolean;
  note: string;
}

export class SecretsManagement {
  private readonly secrets = new Map<string, SecretRef>();
  private readonly apiKeys = new Map<string, ApiKeyRecord>();
  private readonly certificates = new Map<string, CertificateRecord>();
  private readonly keyVersions = new Map<string, number>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  externalStores(): readonly SecretStore[] {
    return SECRET_STORES;
  }

  /** Register a secret REFERENCE. The value stays at its source; only a pointer + metadata is stored. */
  async registerSecret(input: { name: string; kind: SecretKind; reference: string; store?: SecretStore }): Promise<SecretRef> {
    const secret: SecretRef = {
      id: randomId('sec'),
      name: input.name,
      kind: input.kind,
      reference: input.reference,
      store: input.store ?? 'in-process',
      rotationIntervalDays: null,
      active: true,
    };
    this.secrets.set(secret.id, secret);
    await this.gov.record({ actor: this.operator, environment: '_secrets', resource: input.name, policy: 'secret-registry', epic: 'E3', operation: 'register-secret', targetId: secret.id, evidence: input.store ? 'adapter-verified' : 'live-verified', decision: secret.store });
    return secret;
  }

  /** Attach a rotation policy to a secret (represented as an interval; enforced when a store is wired in). */
  async setRotationPolicy(secretId: string, intervalDays: number): Promise<SecretRef> {
    const secret = this.requireSecret(secretId);
    secret.rotationIntervalDays = intervalDays;
    await this.gov.record({ actor: this.operator, environment: '_secrets', resource: secret.name, policy: 'rotation-policy', epic: 'E3', operation: 'set-rotation', targetId: secretId, evidence: 'live-verified', decision: `${intervalDays}d` });
    return secret;
  }

  /** Rotate a tenant's encryption key — REUSES the security KeyManager's real rotation when wired in. */
  async rotateEncryptionKey(tenant: string): Promise<KeyRotationResult> {
    if (this.ctx.security) {
      const newVersion = this.ctx.security.keys().rotate(tenant);
      this.keyVersions.set(tenant, newVersion);
      await this.gov.record({ actor: this.operator, environment: tenant, resource: 'encryption-key', policy: 'key-rotation', epic: 'E3', operation: 'rotate-key', targetId: tenant, evidence: 'live-verified', decision: `v${newVersion}` });
      return { tenant, newVersion, reusedKeyManager: true, note: 'rotated via the reused security KeyManager' };
    }
    await this.gov.record({ actor: this.operator, environment: tenant, resource: 'encryption-key', policy: 'key-rotation', epic: 'E3', operation: 'rotate-key', targetId: tenant, evidence: 'infrastructure-pending', decision: 'no key manager' });
    return { tenant, newVersion: null, reusedKeyManager: false, note: 'no KeyManager wired in — rotation represented until configured' };
  }

  /** The latest encryption-key version this platform rotated to via the reused KeyManager (null if none). */
  currentKeyVersion(tenant: string): number | null {
    return this.keyVersions.get(tenant) ?? null;
  }

  /** Revoke a specific encryption-key version via the reused KeyManager. */
  async revokeEncryptionKey(tenant: string, version: number): Promise<{ revoked: boolean; reusedKeyManager: boolean }> {
    if (this.ctx.security) {
      this.ctx.security.keys().revoke(tenant, version);
      await this.gov.record({ actor: this.operator, environment: tenant, resource: 'encryption-key', policy: 'key-revocation', epic: 'E3', operation: 'revoke-key', targetId: `${tenant}:v${version}`, evidence: 'live-verified', decision: 'revoked' });
      return { revoked: true, reusedKeyManager: true };
    }
    return { revoked: false, reusedKeyManager: false };
  }

  /** API-key governance — register a key reference; the key material is never stored here. */
  async registerApiKey(input: { name: string; reference: string }): Promise<ApiKeyRecord> {
    const key: ApiKeyRecord = { id: randomId('apik'), name: input.name, reference: input.reference, revoked: false };
    this.apiKeys.set(key.id, key);
    await this.gov.record({ actor: this.operator, environment: '_secrets', resource: input.name, policy: 'api-key-governance', epic: 'E3', operation: 'register-api-key', targetId: key.id, evidence: 'live-verified', decision: 'registered' });
    return key;
  }

  async revokeApiKey(id: string): Promise<ApiKeyRecord> {
    const key = this.apiKeys.get(id);
    if (!key) throw new Error(`unknown api key: ${id}`);
    key.revoked = true;
    await this.gov.record({ actor: this.operator, environment: '_secrets', resource: key.name, policy: 'api-key-governance', epic: 'E3', operation: 'revoke-api-key', targetId: id, evidence: 'live-verified', decision: 'revoked' });
    return key;
  }

  /** Certificate registry — track a certificate reference + expiry (no private key is stored). */
  async registerCertificate(input: { subject: string; reference: string; expiresAt: number }): Promise<CertificateRecord> {
    const cert: CertificateRecord = { id: randomId('cert'), subject: input.subject, reference: input.reference, expiresAt: input.expiresAt };
    this.certificates.set(cert.id, cert);
    await this.gov.record({ actor: this.operator, environment: '_secrets', resource: input.subject, policy: 'certificate-registry', epic: 'E3', operation: 'register-certificate', targetId: cert.id, evidence: 'live-verified', decision: 'registered' });
    return cert;
  }

  secret(id: string): SecretRef | undefined {
    return this.secrets.get(id);
  }
  secretCount(): number {
    return this.secrets.size;
  }
  certificateCount(): number {
    return this.certificates.size;
  }

  private requireSecret(id: string): SecretRef {
    const secret = this.secrets.get(id);
    if (!secret) throw new Error(`unknown secret: ${id}`);
    return secret;
  }
}

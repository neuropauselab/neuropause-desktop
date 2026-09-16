/**
 * S112 harvest (H6) — envelope encryption + KEK/DEK lifecycle (AES-256-GCM).
 *
 * HARVESTED (adapted, not imported) from packages/security/src/keys.ts (`KeyManager`/`Envelope`/
 * `LocalKeyProvider`). The source package is unwired and on the parallel @neuropause/* spine, so
 * importing it would stand up a second security system. Only the pure crypto capability is harvested
 * here, re-implemented over node:crypto:
 *   - a fresh per-record DEK seals the data (AES-256-GCM);
 *   - the DEK is wrapped under the tenant's current KEK version;
 *   - rotation re-wraps the DEK under a newer KEK without touching the ciphertext;
 *   - a revoked KEK version can no longer decrypt.
 *
 * PURE + Electron-free. Keys are supplied by an injected `KekProvider`; this module NEVER stores a
 * key, NEVER touches the keychain, NEVER embeds key material. The durable KEK home is the existing
 * `secureStore`/`credentialStore` (OS keychain via Electron safeStorage) via `DurableKekProvider`
 * (durableKekProvider.ts) — no new secret store is invented.
 *
 * NOT AUTHORITY: this encrypts/decrypts data. It has no import path to authz/cst/command-bus/store;
 * possessing an envelope grants nothing. FAIL-CLOSED: a tampered ciphertext/tag, wrong/unknown/
 * revoked key version, or corrupted metadata throws (GCM auth failure or an explicit guard) — a
 * failed decrypt is NEVER silently a success, and NEVER returns plaintext.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface Envelope {
  keyVersion: number;
  /** data seal (AES-256-GCM under the DEK). */
  iv: string;
  tag: string;
  ciphertext: string;
  /** the DEK wrapped (AES-256-GCM) under the tenant KEK version. */
  wrappedDek: string;
  dekIv: string;
  dekTag: string;
}

/** Abstracts where KEKs live (in-memory for tests; durable OS-keychain in production). Sync accessors. */
export interface KekProvider {
  readonly kind: string;
  kek(tenant: string, version: number): Buffer | undefined;
  currentVersion(tenant: string): number;
  rotate(tenant: string): number;
  revoke(tenant: string, version: number): void;
  isRevoked(tenant: string, version: number): boolean;
  versions(tenant: string): number[];
}

interface KekVersion {
  version: number;
  key: Buffer;
  revoked: boolean;
}

/** In-memory KEK provider — real crypto, non-durable. For tests/authoring; production uses DurableKekProvider. */
export class InMemoryKekProvider implements KekProvider {
  readonly kind = 'in-memory';
  private readonly keks = new Map<string, KekVersion[]>();

  private ensure(tenant: string): KekVersion[] {
    let list = this.keks.get(tenant);
    if (!list) {
      list = [{ version: 1, key: randomBytes(32), revoked: false }];
      this.keks.set(tenant, list);
    }
    return list;
  }
  kek(tenant: string, version: number): Buffer | undefined {
    return this.ensure(tenant).find((k) => k.version === version && !k.revoked)?.key;
  }
  currentVersion(tenant: string): number {
    return this.ensure(tenant).filter((k) => !k.revoked).reduce((m, k) => Math.max(m, k.version), 0);
  }
  rotate(tenant: string): number {
    const list = this.ensure(tenant);
    const version = list.reduce((m, k) => Math.max(m, k.version), 0) + 1;
    list.push({ version, key: randomBytes(32), revoked: false });
    return version;
  }
  revoke(tenant: string, version: number): void {
    const k = this.ensure(tenant).find((v) => v.version === version);
    if (k) k.revoked = true;
  }
  isRevoked(tenant: string, version: number): boolean {
    return this.ensure(tenant).find((v) => v.version === version)?.revoked ?? true;
  }
  versions(tenant: string): number[] {
    return this.ensure(tenant).map((k) => k.version);
  }
}

function seal(key: Buffer, plaintext: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ct.toString('base64') };
}

function open(key: Buffer, iv: string, tag: string, ciphertext: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
}

/** Thrown for any envelope integrity/availability failure. Never leaks plaintext or key material. */
export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export class EnvelopeCipher {
  constructor(private readonly provider: KekProvider) {}

  /** Envelope-encrypt for a tenant: seal data under a fresh DEK; wrap the DEK under the current tenant KEK. */
  encrypt(tenant: string, plaintext: string): Envelope {
    const version = this.provider.currentVersion(tenant);
    const kek = this.provider.kek(tenant, version);
    if (!kek) throw new EnvelopeError(`no active key for tenant '${tenant}'`);
    const dek = randomBytes(32);
    const data = seal(dek, Buffer.from(plaintext, 'utf8'));
    const wrapped = seal(kek, dek);
    return { keyVersion: version, iv: data.iv, tag: data.tag, ciphertext: data.ciphertext, wrappedDek: wrapped.ciphertext, dekIv: wrapped.iv, dekTag: wrapped.tag };
  }

  /** Decrypt. FAIL-CLOSED: revoked/unknown version, tampered ciphertext/tag, or corrupt metadata → throw. */
  decrypt(tenant: string, env: Envelope): string {
    if (!env || typeof env.ciphertext !== 'string' || typeof env.wrappedDek !== 'string') throw new EnvelopeError('corrupt envelope metadata');
    if (this.provider.isRevoked(tenant, env.keyVersion)) throw new EnvelopeError(`key version ${env.keyVersion} for '${tenant}' is revoked`);
    const kek = this.provider.kek(tenant, env.keyVersion);
    if (!kek) throw new EnvelopeError(`key version ${env.keyVersion} for '${tenant}' unavailable`);
    try {
      const dek = open(kek, env.dekIv, env.dekTag, env.wrappedDek);
      return open(dek, env.iv, env.tag, env.ciphertext).toString('utf8');
    } catch {
      // GCM authentication failure (tampered ciphertext/tag, wrong key) — never a silent success.
      throw new EnvelopeError('decryption failed: integrity check did not pass');
    }
  }

  /** Re-wrap the DEK under the tenant's newest KEK (post-rotation) without touching the data. */
  rewrap(tenant: string, env: Envelope): Envelope {
    const kek = this.provider.kek(tenant, env.keyVersion);
    if (!kek) throw new EnvelopeError(`cannot rewrap: key version ${env.keyVersion} unavailable`);
    let dek: Buffer;
    try {
      dek = open(kek, env.dekIv, env.dekTag, env.wrappedDek);
    } catch {
      throw new EnvelopeError('cannot rewrap: DEK unwrap failed');
    }
    const version = this.provider.currentVersion(tenant);
    const newKek = this.provider.kek(tenant, version);
    if (!newKek) throw new EnvelopeError(`cannot rewrap: no active key for '${tenant}'`);
    const wrapped = seal(newKek, dek);
    return { ...env, keyVersion: version, wrappedDek: wrapped.ciphertext, dekIv: wrapped.iv, dekTag: wrapped.tag };
  }

  rotate(tenant: string): number {
    return this.provider.rotate(tenant);
  }
  revoke(tenant: string, version: number): void {
    this.provider.revoke(tenant, version);
  }
  providerKind(): string {
    return this.provider.kind;
  }
}

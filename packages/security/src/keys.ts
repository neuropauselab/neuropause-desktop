/**
 * Secret & Key Management (NCEA 14.0, Phase 6). Real envelope encryption:
 * per-tenant Key-Encryption-Keys (KEKs) wrap per-message Data-Encryption-Keys
 * (DEKs); data is sealed with AES-256-GCM. Supports key versioning, rotation
 * (re-wrap under the newest KEK), and revocation (a revoked version cannot
 * decrypt). Digital signatures use Ed25519 (asymmetric). A `KeyProvider`
 * abstracts the key store — a real in-process provider is used and VERIFIED here;
 * AWS KMS / CloudHSM implement the SAME interface in production (INFRA-PENDING).
 * All crypto is node:crypto; nothing is simulated.
 */
import { randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync, sign as edSign, verify as edVerify, timingSafeEqual } from 'node:crypto';
import { hmacHex } from '@neuropause/cloud-core';

export interface Signer {
  readonly algorithm: string;
  sign(data: string): string;
  verify(data: string, signature: string): boolean;
}

/** HMAC-SHA256 MAC (symmetric) — for internal integrity where a shared secret is fine. */
export function hmacSigner(secret: string): Signer {
  return {
    algorithm: 'HMAC-SHA256',
    sign: (data) => hmacHex(secret, data),
    verify: (data, sig) => {
      const expected = hmacHex(secret, data);
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

/** Ed25519 digital signature (asymmetric) — real signing keys for the audit chain. */
export function ed25519Signer(): Signer & { publicKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    algorithm: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (data) => edSign(null, Buffer.from(data), privateKey).toString('base64'),
    verify: (data, sig) => {
      try {
        return edVerify(null, Buffer.from(data), publicKey, Buffer.from(sig, 'base64'));
      } catch {
        return false;
      }
    },
  };
}

export interface Envelope {
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
  wrappedDek: string;
  dekIv: string;
  dekTag: string;
}

interface KekVersion {
  version: number;
  key: Buffer;
  revoked: boolean;
}

/** Abstracts where KEKs live. LocalKeyProvider is real + tested; KMS/HSM implement this. */
export interface KeyProvider {
  readonly kind: string;
  kek(tenant: string, version: number): Buffer | undefined;
  currentVersion(tenant: string): number;
  rotate(tenant: string): number;
  revoke(tenant: string, version: number): void;
  isRevoked(tenant: string, version: number): boolean;
  versions(tenant: string): number[];
}

export class LocalKeyProvider implements KeyProvider {
  readonly kind = 'local';
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

export class KeyManager {
  constructor(private readonly provider: KeyProvider = new LocalKeyProvider()) {}

  /** Envelope-encrypt plaintext for a tenant: seal data under a fresh DEK, wrap the DEK under the tenant KEK. */
  encrypt(tenant: string, plaintext: string): Envelope {
    const version = this.provider.currentVersion(tenant);
    const kek = this.provider.kek(tenant, version);
    if (!kek) throw new Error(`no active key for tenant '${tenant}'`);
    const dek = randomBytes(32);
    const data = seal(dek, Buffer.from(plaintext, 'utf8'));
    const wrapped = seal(kek, dek);
    return { keyVersion: version, iv: data.iv, tag: data.tag, ciphertext: data.ciphertext, wrappedDek: wrapped.ciphertext, dekIv: wrapped.iv, dekTag: wrapped.tag };
  }

  decrypt(tenant: string, env: Envelope): string {
    if (this.provider.isRevoked(tenant, env.keyVersion)) throw new Error(`key version ${env.keyVersion} for '${tenant}' is revoked`);
    const kek = this.provider.kek(tenant, env.keyVersion);
    if (!kek) throw new Error(`key version ${env.keyVersion} for '${tenant}' unavailable`);
    const dek = open(kek, env.dekIv, env.dekTag, env.wrappedDek);
    return open(dek, env.iv, env.tag, env.ciphertext).toString('utf8');
  }

  /** Re-wrap an envelope's DEK under the tenant's newest KEK (post-rotation), without touching the data. */
  rewrap(tenant: string, env: Envelope): Envelope {
    const kek = this.provider.kek(tenant, env.keyVersion);
    if (!kek) throw new Error(`cannot rewrap: key version ${env.keyVersion} unavailable`);
    const dek = open(kek, env.dekIv, env.dekTag, env.wrappedDek);
    const version = this.provider.currentVersion(tenant);
    const newKek = this.provider.kek(tenant, version)!;
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

/** Certificate management interface — validation of a PEM chain (production binds a real CA/PKI). */
export interface CertificateAuthority {
  validate(certPem: string, chainPem: string[]): { valid: boolean; reason?: string };
}

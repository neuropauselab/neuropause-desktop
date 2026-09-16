/**
 * S112 (H6) — durable KEK provider backed by the EXISTING secret store (OS keychain via Electron
 * safeStorage: `credentialStore`/`secureStore`). No new secret store is invented.
 *
 * KEKs are the root wrapping keys for envelope encryption. They must be durable across restarts and
 * MUST NEVER be persisted in plaintext or exposed to the renderer. This provider persists the KEK
 * set as a single JSON blob (base64 key bytes + version/revoked metadata) through an injected
 * async `SecretStore`, whose production binding is the safeStorage-backed keychain — so the KEK
 * material at rest is OS-encrypted, never plaintext on disk, never over IPC.
 *
 * Electron-free by injection: the `SecretStore` is passed in, so this is unit-testable with a fake
 * store that survives a new provider instance (a simulated restart). The provider loads once
 * (`load()`), serves the sync `KekProvider` accessors from the in-memory cache, and persists on
 * every mutation (rotate/revoke). Fail-closed: a missing/corrupt blob yields an empty set (no keys
 * ⇒ encrypt/decrypt fail closed), never a fabricated key.
 */
import { randomBytes } from 'node:crypto';
import type { KekProvider } from './envelopeCrypto';

/** The minimal durable secret API. Production: bind to credentialStore (safeStorage keychain). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
}

interface PersistedKek {
  version: number;
  keyB64: string;
  revoked: boolean;
}
type PersistedKeks = Record<string, PersistedKek[]>; // tenant → versions

const KEYCHAIN_ENTRY = 'neuropause.envelope.keks.v1';

export class DurableKekProvider implements KekProvider {
  readonly kind = 'durable-keychain';
  private cache: Map<string, Array<{ version: number; key: Buffer; revoked: boolean }>> = new Map();
  private loaded = false;

  constructor(private readonly store: SecretStore, private readonly entryKey = KEYCHAIN_ENTRY) {}

  /** Load persisted KEKs from the keychain into memory. Fail-closed on missing/corrupt data. */
  async load(): Promise<void> {
    this.cache = new Map();
    try {
      const raw = await this.store.get(this.entryKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedKeks;
        for (const [tenant, versions] of Object.entries(parsed)) {
          if (!Array.isArray(versions)) continue;
          this.cache.set(
            tenant,
            versions
              .filter((v) => typeof v.version === 'number' && typeof v.keyB64 === 'string')
              .map((v) => ({ version: v.version, key: Buffer.from(v.keyB64, 'base64'), revoked: Boolean(v.revoked) })),
          );
        }
      }
    } catch {
      // corrupt blob → start empty (fail-closed: no keys, never a fabricated one). Do not overwrite
      // the persisted blob here (avoid destroying recoverable material on a transient parse error).
      this.cache = new Map();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const out: PersistedKeks = {};
    for (const [tenant, versions] of this.cache.entries()) {
      out[tenant] = versions.map((v) => ({ version: v.version, keyB64: v.key.toString('base64'), revoked: v.revoked }));
    }
    await this.store.set(this.entryKey, JSON.stringify(out));
  }

  /** Ensure a tenant has at least one active KEK; mints + persists the first one. Async (mutating). */
  async ensureTenant(tenant: string): Promise<number> {
    if (!this.loaded) await this.load();
    const list = this.cache.get(tenant);
    if (list && list.some((k) => !k.revoked)) return this.currentVersion(tenant);
    const seed = list ?? [];
    const version = seed.reduce((m, k) => Math.max(m, k.version), 0) + 1;
    seed.push({ version, key: randomBytes(32), revoked: false });
    this.cache.set(tenant, seed);
    await this.persist();
    return version;
  }

  kek(tenant: string, version: number): Buffer | undefined {
    return this.cache.get(tenant)?.find((k) => k.version === version && !k.revoked)?.key;
  }
  currentVersion(tenant: string): number {
    return (this.cache.get(tenant) ?? []).filter((k) => !k.revoked).reduce((m, k) => Math.max(m, k.version), 0);
  }
  versions(tenant: string): number[] {
    return (this.cache.get(tenant) ?? []).map((k) => k.version);
  }
  isRevoked(tenant: string, version: number): boolean {
    return this.cache.get(tenant)?.find((k) => k.version === version)?.revoked ?? true;
  }

  /** Rotate: mint a new KEK version and persist. Sync signature (KekProvider) — persistence fired async. */
  rotate(tenant: string): number {
    const list = this.cache.get(tenant) ?? [];
    const version = list.reduce((m, k) => Math.max(m, k.version), 0) + 1;
    list.push({ version, key: randomBytes(32), revoked: false });
    this.cache.set(tenant, list);
    void this.persist();
    return version;
  }
  revoke(tenant: string, version: number): void {
    const k = this.cache.get(tenant)?.find((v) => v.version === version);
    if (k) {
      k.revoked = true;
      void this.persist();
    }
  }

  /** Durable variants that await persistence — prefer these on the mutating live path. */
  async rotateDurable(tenant: string): Promise<number> {
    const v = this.rotate(tenant);
    await this.persist();
    return v;
  }
  async revokeDurable(tenant: string, version: number): Promise<void> {
    this.revoke(tenant, version);
    await this.persist();
  }
}

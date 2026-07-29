/**
 * Encrypted persistence for the app's most sensitive values at rest: the
 * long-lived refresh token (`secureStore`) and per-provider credentials keyed by
 * id (`credentialStore`) — both in the same `vault.bin`, sharing one encryption
 * and refuse-plaintext policy.
 *
 * Encryption is delegated to Electron's safeStorage, which on macOS is backed
 * by the system Keychain. We persist only the ciphertext to a file in the
 * app's userData directory. If OS-level encryption is unavailable we refuse to
 * write rather than fall back to storing a value in plaintext. Secret values are
 * never logged, and are never returned except by an explicit decrypt call.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('secureStore');

interface VaultFile {
  /** base64-encoded ciphertext produced by safeStorage.encryptString. */
  refreshToken?: string;
  /** providerId -> base64-encoded ciphertext. Added by credentialStore; optional
   *  so older vaults (refreshToken only) read back unchanged. */
  secrets?: Record<string, string>;
}

function vaultPath(): string {
  return join(app.getPath('userData'), 'vault.bin');
}

async function readVault(): Promise<VaultFile> {
  try {
    const raw = await fs.readFile(vaultPath(), 'utf8');
    return JSON.parse(raw) as VaultFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    log.warn('Failed to read vault; treating as empty', err);
    return {};
  }
}

async function writeVault(vault: VaultFile): Promise<void> {
  const tmp = `${vaultPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(vault), { mode: 0o600 });
  await fs.rename(tmp, vaultPath()); // atomic replace
}

export const secureStore = {
  /** Returns the decrypted refresh token, or null if none is stored. */
  async getRefreshToken(): Promise<string | null> {
    const vault = await readVault();
    if (!vault.refreshToken) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; cannot decrypt stored token');
      return null;
    }
    try {
      const buf = Buffer.from(vault.refreshToken, 'base64');
      return safeStorage.decryptString(buf);
    } catch (err) {
      log.error('Failed to decrypt refresh token; clearing vault', err);
      await this.clear();
      return null;
    }
  },

  /** Encrypts and persists the refresh token. */
  async setRefreshToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Never persist the token unencrypted.
      log.warn('Encryption unavailable; refusing to persist refresh token');
      return;
    }
    const cipher = safeStorage.encryptString(token);
    const vault = await readVault();
    vault.refreshToken = cipher.toString('base64');
    await writeVault(vault);
  },

  /** Removes any stored refresh token. */
  async clear(): Promise<void> {
    try {
      await fs.unlink(vaultPath());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('Failed to clear vault', err);
      }
    }
  },
};

/** Rewrite the vault without one provider's secret, leaving all other state intact. */
async function removeProviderSecret(vault: VaultFile, providerId: string): Promise<void> {
  if (!vault.secrets || !(providerId in vault.secrets)) return;
  const next = { ...vault.secrets };
  delete next[providerId];
  vault.secrets = next;
  await writeVault(vault);
}

/**
 * CredentialStore — the same encrypted vault, generalised to hold many provider
 * secrets by id (e.g. an AI provider API key) alongside the refresh token. Reuses
 * the identical safeStorage encryption and refuse-plaintext policy. Reading or
 * deleting one provider's secret never disturbs the refresh token or any other
 * provider's secret. Secret values are never logged; only the (non-secret)
 * providerId appears in diagnostics.
 */
export const credentialStore = {
  /** Decrypted secret for a provider, or null if none is stored or it cannot be decrypted. */
  async getSecret(providerId: string): Promise<string | null> {
    const vault = await readVault();
    const cipher = vault.secrets?.[providerId];
    if (!cipher) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; cannot decrypt stored credential', { providerId });
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
    } catch {
      // Corrupt/undecryptable entry: drop just this one, keep everything else.
      log.error('Failed to decrypt credential; removing it', { providerId });
      await removeProviderSecret(vault, providerId);
      return null;
    }
  },

  /** Encrypt and persist a provider secret. Refuses (no-op) when OS encryption is unavailable. */
  async setSecret(providerId: string, secret: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Never persist a credential unencrypted.
      log.warn('Encryption unavailable; refusing to persist credential', { providerId });
      return;
    }
    const cipher = safeStorage.encryptString(secret).toString('base64');
    const vault = await readVault();
    vault.secrets = { ...(vault.secrets ?? {}), [providerId]: cipher };
    await writeVault(vault);
  },

  /** Remove a provider secret. Leaves the refresh token and other secrets untouched. */
  async deleteSecret(providerId: string): Promise<void> {
    const vault = await readVault();
    await removeProviderSecret(vault, providerId);
  },

  /** Whether a secret is stored for a provider (does not decrypt it). */
  async hasSecret(providerId: string): Promise<boolean> {
    const vault = await readVault();
    return Boolean(vault.secrets?.[providerId]);
  },

  /** Ids of providers that currently have a stored secret. */
  async listProviders(): Promise<string[]> {
    const vault = await readVault();
    return Object.keys(vault.secrets ?? {});
  },
};

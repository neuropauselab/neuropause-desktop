/**
 * Encrypted persistence for the single most sensitive value the desktop app
 * holds at rest: the long-lived refresh token.
 *
 * Encryption is delegated to Electron's safeStorage, which on macOS is backed
 * by the system Keychain. We persist only the ciphertext to a file in the
 * app's userData directory. If OS-level encryption is unavailable we refuse to
 * write rather than fall back to storing the token in plaintext.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('secureStore');

interface VaultFile {
  /** base64-encoded ciphertext produced by safeStorage.encryptString. */
  refreshToken?: string;
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

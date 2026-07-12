/**
 * The connector token vault.
 *
 * Generalises the app's single-token secureStore to many connectors, each with
 * many accounts. Only token material lives here, and it is encrypted per account
 * with Electron safeStorage (macOS Keychain). The on-disk file holds nothing but
 * ciphertext keyed by connector id and account id; if OS encryption is
 * unavailable we refuse to write rather than ever persist a token in plaintext.
 *
 * Tokens never leave the main process — no vault value is ever exposed to IPC.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { createLogger } from '../logger';

const log = createLogger('connector-vault');

/** Token material held for one connected account. */
export interface AccountTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms when the access token expires, or null if unknown/non-expiring. */
  expiresAt: number | null;
  scopes: string[];
  tokenType: string;
}

/** On disk: { [connectorId]: { [accountId]: base64Ciphertext } }. */
type VaultFile = Record<string, Record<string, string>>;

/** P4.1 — the encryption-scheme version. The rotation hook (`reencryptAll`) refreshes ciphertext in place. */
export const CONNECTOR_VAULT_KEY_VERSION = 1;

function vaultPath(): string {
  return join(app.getPath('userData'), 'connector-vault.bin');
}

async function readVault(): Promise<VaultFile> {
  try {
    const raw = await fs.readFile(vaultPath(), 'utf8');
    return JSON.parse(raw) as VaultFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    log.warn('Failed to read connector vault; treating as empty', err);
    return {};
  }
}

async function writeVault(vault: VaultFile): Promise<void> {
  const tmp = `${vaultPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(vault), { mode: 0o600 });
  await fs.rename(tmp, vaultPath());
}

export const connectorVault = {
  /** Returns decrypted tokens for an account, or null if absent/undecryptable. */
  async get(connectorId: string, accountId: string): Promise<AccountTokens | null> {
    const vault = await readVault();
    const cipher = vault[connectorId]?.[accountId];
    if (!cipher) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; cannot decrypt connector tokens');
      return null;
    }
    try {
      const plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'));
      return JSON.parse(plain) as AccountTokens;
    } catch (err) {
      log.error('Failed to decrypt connector tokens; dropping entry', err);
      await this.delete(connectorId, accountId);
      return null;
    }
  },

  /** Encrypts and persists tokens for an account. */
  async set(connectorId: string, accountId: string, tokens: AccountTokens): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; refusing to persist connector tokens');
      return;
    }
    const cipher = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64');
    const vault = await readVault();
    vault[connectorId] = { ...(vault[connectorId] ?? {}), [accountId]: cipher };
    await writeVault(vault);
  },

  /** Removes one account's tokens. */
  async delete(connectorId: string, accountId: string): Promise<void> {
    const vault = await readVault();
    if (vault[connectorId]) {
      delete vault[connectorId][accountId];
      if (Object.keys(vault[connectorId]).length === 0) delete vault[connectorId];
      await writeVault(vault);
    }
  },

  /** Removes all tokens for a connector, or the entire vault when no id given. */
  async clear(connectorId?: string): Promise<void> {
    if (!connectorId) {
      try {
        await fs.unlink(vaultPath());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Failed to clear vault', err);
      }
      return;
    }
    const vault = await readVault();
    if (vault[connectorId]) {
      delete vault[connectorId];
      await writeVault(vault);
    }
  },

  /**
   * P4.1 key-rotation hook — re-encrypt every stored token with the CURRENT safeStorage key. Used after an
   * OS key change (or a scheduled rotation) to refresh ciphertext in place. No plaintext is ever written;
   * undecryptable entries are skipped. Returns the number of entries re-encrypted.
   */
  async reencryptAll(): Promise<number> {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; skipping vault re-encryption');
      return 0;
    }
    const vault = await readVault();
    let count = 0;
    for (const [connectorId, accounts] of Object.entries(vault)) {
      for (const [accountId, cipher] of Object.entries(accounts)) {
        try {
          const plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'));
          vault[connectorId][accountId] = safeStorage.encryptString(plain).toString('base64');
          count += 1;
        } catch (err) {
          log.error('Skipping undecryptable entry during re-encryption', { connectorId, accountId, err });
        }
      }
    }
    if (count > 0) {
      await writeVault(vault);
      log.info('Re-encrypted connector vault under the current key', { count, keyVersion: CONNECTOR_VAULT_KEY_VERSION });
    }
    return count;
  },
};

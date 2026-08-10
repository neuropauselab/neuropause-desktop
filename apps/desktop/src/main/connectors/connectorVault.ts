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

/**
 * On disk.
 *
 * P10 — the WORKSPACE is now part of the key: `{ [workspaceId]: { [connectorId]:
 * { [accountId]: base64Ciphertext } } }`.
 *
 * It was two levels, `connectorId → accountId`, with no workspace anywhere in
 * the connectors directory at all. Switching workspace changed which records
 * you saw and nothing about which credentials you could spend — so a
 * connection set up in one workspace was usable from any other, and the file
 * held no information with which to refuse.
 *
 * `__unscoped__` holds entries written before this change. They are readable
 * only through `migrationRequired`, never through `get`. See the note there.
 */
type VaultFile = {
  schemaVersion?: number;
  workspaces?: Record<string, Record<string, Record<string, string>>>;
  /** Pre-P10 layout, retained verbatim until an operator claims each entry. */
  legacy?: Record<string, Record<string, string>>;
};

/** P4.1 — the encryption-scheme version. The rotation hook (`reencryptAll`) refreshes ciphertext in place. */
export const CONNECTOR_VAULT_KEY_VERSION = 1;

/** Bumped when the FILE SHAPE changes, which is not the same as the key version. */
export const CONNECTOR_VAULT_SCHEMA_VERSION = 2;

/** A credential whose owning workspace is unknown. Never spendable. */
export interface UnscopedCredential {
  connectorId: string;
  accountId: string;
}

function vaultPath(): string {
  return join(app.getPath('userData'), 'connector-vault.bin');
}

async function readVault(): Promise<VaultFile> {
  try {
    const raw = await fs.readFile(vaultPath(), 'utf8');
    const parsed = JSON.parse(raw) as VaultFile & Record<string, unknown>;
    /**
     * A v1 file is the OLD SHAPE at the top level: connector ids as keys.
     *
     * It is moved to `legacy`, not to a workspace. Assigning it to whichever
     * workspace happens to be active would be exactly the guess this scoping
     * exists to prevent — and it would silently hand one workspace's
     * credentials to another on first launch after an update.
     */
    if (parsed.workspaces === undefined && parsed.legacy === undefined) {
      const legacy: Record<string, Record<string, string>> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'schemaVersion') continue;
        if (value !== null && typeof value === 'object') {
          legacy[key] = value as Record<string, string>;
        }
      }
      return { schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION, workspaces: {}, legacy };
    }
    return { schemaVersion: parsed.schemaVersion, workspaces: parsed.workspaces ?? {}, legacy: parsed.legacy ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { workspaces: {}, legacy: {} };
    log.warn('Failed to read connector vault; treating as empty', err);
    return { workspaces: {}, legacy: {} };
  }
}

async function writeVault(vault: VaultFile): Promise<void> {
  const tmp = `${vaultPath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(vault), { mode: 0o600 });
  await fs.rename(tmp, vaultPath());
}

export const connectorVault = {
  /**
   * Decrypted tokens for an account IN A WORKSPACE, or null.
   *
   * `workspaceId` is required, and there is no overload without it. A default
   * would be a way to keep every existing caller compiling while leaving the
   * boundary un-enforced, which is the same as not having one.
   *
   * A credential whose owning workspace is unknown is NOT returned here at any
   * cost. See `migrationRequired`.
   */
  async get(workspaceId: string, connectorId: string, accountId: string): Promise<AccountTokens | null> {
    const vault = await readVault();
    const cipher = vault.workspaces?.[workspaceId]?.[connectorId]?.[accountId];
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
      await this.delete(workspaceId, connectorId, accountId);
      return null;
    }
  },

  /** Encrypts and persists tokens for an account within a workspace. */
  async set(
    workspaceId: string,
    connectorId: string,
    accountId: string,
    tokens: AccountTokens,
  ): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; refusing to persist connector tokens');
      return;
    }
    const cipher = safeStorage.encryptString(JSON.stringify(tokens)).toString('base64');
    const vault = await readVault();
    const workspaces = vault.workspaces ?? {};
    const forWorkspace = workspaces[workspaceId] ?? {};
    forWorkspace[connectorId] = { ...(forWorkspace[connectorId] ?? {}), [accountId]: cipher };
    workspaces[workspaceId] = forWorkspace;
    await writeVault({ ...vault, schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION, workspaces });
  },

  /** Removes one account's tokens from one workspace. */
  async delete(workspaceId: string, connectorId: string, accountId: string): Promise<void> {
    const vault = await readVault();
    const forWorkspace = vault.workspaces?.[workspaceId];
    if (!forWorkspace?.[connectorId]) return;
    delete forWorkspace[connectorId][accountId];
    if (Object.keys(forWorkspace[connectorId]).length === 0) delete forWorkspace[connectorId];
    if (Object.keys(forWorkspace).length === 0) delete vault.workspaces?.[workspaceId];
    await writeVault({ ...vault, schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION });
  },

  /**
   * Credentials whose owning workspace could not be determined.
   *
   * Written before the vault was scoped. They are listed — an operator has to
   * be able to see that they exist and reconnect — and they are NOT decrypted
   * here and NOT returned by `get` from any workspace. Assigning them to the
   * active workspace would silently give one workspace another's credentials
   * on the first launch after an update, which is precisely the boundary being
   * introduced.
   */
  async migrationRequired(): Promise<UnscopedCredential[]> {
    const vault = await readVault();
    const out: UnscopedCredential[] = [];
    for (const [connectorId, accounts] of Object.entries(vault.legacy ?? {})) {
      for (const accountId of Object.keys(accounts)) out.push({ connectorId, accountId });
    }
    return out;
  },

  /**
   * Discard an unscoped credential.
   *
   * The only safe resolution: the operator reconnects, which mints a fresh
   * credential in a known workspace. There is deliberately no "adopt this into
   * the current workspace" — that is the guess.
   */
  async discardUnscoped(connectorId: string, accountId: string): Promise<void> {
    const vault = await readVault();
    const legacy = vault.legacy ?? {};
    if (!legacy[connectorId]) return;
    delete legacy[connectorId][accountId];
    if (Object.keys(legacy[connectorId]).length === 0) delete legacy[connectorId];
    await writeVault({ ...vault, schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION, legacy });
  },

  /** Removes every token in one workspace, or the whole file when none given. */
  async clear(workspaceId?: string): Promise<void> {
    if (!workspaceId) {
      try {
        await fs.unlink(vaultPath());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Failed to clear vault', err);
      }
      return;
    }
    const vault = await readVault();
    if (vault.workspaces?.[workspaceId]) {
      delete vault.workspaces[workspaceId];
      await writeVault({ ...vault, schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION });
    }
  },

  /**
   * P4.1 key-rotation hook — re-encrypt every stored token with the CURRENT
   * safeStorage key. Used after an OS key change (or a scheduled rotation) to
   * refresh ciphertext in place. No plaintext is ever written; undecryptable
   * entries are skipped. Unscoped entries are rotated too: they are still
   * secrets on disk even though nothing may spend them.
   */
  async reencryptAll(): Promise<number> {
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('Encryption unavailable; skipping vault re-encryption');
      return 0;
    }
    const vault = await readVault();
    let count = 0;
    const rotate = (accounts: Record<string, string>): void => {
      for (const [accountId, cipher] of Object.entries(accounts)) {
        try {
          const plain = safeStorage.decryptString(Buffer.from(cipher, 'base64'));
          accounts[accountId] = safeStorage.encryptString(plain).toString('base64');
          count += 1;
        } catch {
          // An entry we cannot read is left exactly as it is. Dropping it here
          // would destroy a credential over a transient keychain problem.
        }
      }
    };
    for (const connectors of Object.values(vault.workspaces ?? {})) {
      for (const accounts of Object.values(connectors)) rotate(accounts);
    }
    for (const accounts of Object.values(vault.legacy ?? {})) rotate(accounts);
    if (count > 0) await writeVault({ ...vault, schemaVersion: CONNECTOR_VAULT_SCHEMA_VERSION });
    return count;
  },
};


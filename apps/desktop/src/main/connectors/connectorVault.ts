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
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'connector-vault',
  scope: 'WORKSPACE',
  persistence: 'keychain',
  authority: 'ORG_ROLE',
  classification: 'SECRET',
  /**
   * P13C ROUND 10. OWNER, and the one entry that is nobody's is stated rather
   * than averaged away.
   *
   * `delete` and `clear` both take the workspace as an explicit argument and can
   * only reach that workspace's subtree. `discardUnscoped` reaches the `legacy`
   * bucket, whose entries have NO owning workspace by construction: they are
   * returned by no `get` from any workspace, they are unspendable, and the only
   * thing lost by discarding one is the operator's reminder to reconnect. It is
   * also reachable from no IPC channel — `connectors/index.ts` calls
   * `migrationRequired()` at startup to log the count and nothing calls
   * `discardUnscoped` outside tests — so no caller of any kind can currently
   * cause it. Verified by reading, and named here so a future caller that wires
   * it to a channel has to reread this line.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap — nothing is ever evicted to make room, so no write can destroy a credential. ' +
    'Three removals exist and each names its reach: `delete` removes ONE account inside ONE ' +
    'workspace; `clear(workspaceId)` removes one workspace subtree; `discardUnscoped` removes one ' +
    'pre-P10 legacy entry. P13C ROUND 9 — F14: `clear()` with no resolved workspace used to ' +
    '`unlink` the whole vault file, so a caller that failed to resolve a workspace destroyed EVERY ' +
    "workspace's credentials. It now removes nothing. There is deliberately no whole-file wipe.",
  reason:
    'WHY WORKSPACE: the on-disk key is `workspaceId → connectorId → accountId`, and `get` takes the ' +
    'workspace as a required first argument with no defaulting overload, so a credential minted in ' +
    'one workspace cannot be spent from another. WHAT DATA: safeStorage (macOS Keychain) ciphertext ' +
    'of OAuth access/refresh tokens — no plaintext is ever written, and if OS encryption is ' +
    'unavailable the write is refused rather than downgraded. Pre-P10 entries whose owning workspace ' +
    'is unknown live under `legacy` and are readable only through `migrationRequired`, never through ' +
    '`get` from any workspace: adopting them into whichever workspace happened to be active is the ' +
    'guess this boundary exists to prevent.',
});

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

  /**
   * Removes every token in ONE workspace. P13C ROUND 9 — F14.
   *
   * THE FINDING: the workspace was optional and a missing one meant
   * `fs.unlink(vaultPath())` — the WHOLE FILE, every workspace's credentials,
   * plus the `legacy` entries an operator still has to reconnect. So the widest
   * possible destruction was what happened when the narrowest input was absent,
   * which is the failure mode a boundary must never have: an unresolved
   * workspace is the case where the code knows LEAST about whose data it is
   * holding, and it was the case that reached the MOST of it. A caller whose
   * `requireWorkspace()` returned '' — or a future caller that simply forgot the
   * argument — silently wiped the install.
   *
   * It now FAILS CLOSED: no resolved workspace, no removal. The parameter stays
   * optional so every existing call site still type-checks and so the refusal is
   * exercised rather than hidden behind a compile error somebody would fix by
   * passing something; `''` and `undefined` are treated identically, because an
   * empty id is an unresolved id wearing a string.
   *
   * There is deliberately NO replacement whole-file wipe. Nothing in the app
   * needed one — the only production caller of any vault removal is
   * `connectorService`, which always passes `this.requireWorkspace()` — and a
   * primitive that can delete every tenant's secrets is worth more to an
   * attacker than to this product.
   */
  async clear(workspaceId?: string): Promise<void> {
    if (workspaceId === undefined || workspaceId === '') {
      log.warn('Refusing to clear the connector vault: no workspace resolved, so nothing was removed');
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


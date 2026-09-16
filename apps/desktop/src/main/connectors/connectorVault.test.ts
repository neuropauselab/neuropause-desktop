/**
 * P13C GATE 11 — the connector vault must QUARANTINE a corrupt file, not reset it.
 *
 * Before this, a corrupt/unreadable `connector-vault.bin` was silently treated as
 * empty and the next connect/disconnect atomically overwrote it — destroying
 * every stored connector credential with no copy and no signal. This is the same
 * reset-on-corrupt class round 33 closed for the ordinary stores; the secret
 * vaults were the two that still had it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '' }));

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => mockState.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('decrypt failed');
      return s.slice(5);
    },
  },
}));

import { connectorVault } from './connectorVault';

const vaultPath = (): string => join(mockState.userDataDir, 'connector-vault.bin');
const WS = 'ws-1';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-cvault-'));
});
afterEach(async () => {
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('connector vault — corrupt file is quarantined, not reset', () => {
  it('preserves the corrupt bytes and does not destroy credentials on the next write', async () => {
    // Store a credential so the vault file exists with real content.
    await connectorVault.set(WS, 'google', 'acct-1', {
      accessToken: 'at-precious',
      refreshToken: 'rt-precious',
      expiresAt: null,
      scopes: [],
      tokenType: 'Bearer',
    });
    expect(await connectorVault.get(WS, 'google', 'acct-1')).not.toBeNull();

    // Corrupt the on-disk vault.
    await fs.writeFile(vaultPath(), 'not-valid-json{{{', 'utf8');

    // A read treats it as empty (the file genuinely cannot be parsed) but the
    // corrupt bytes are QUARANTINED, not discarded.
    expect(await connectorVault.get(WS, 'google', 'acct-1')).toBeNull();
    const quarantined = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.startsWith('connector-vault.bin.quarantined-'),
    );
    expect(quarantined).toHaveLength(1);
    expect(await fs.readFile(join(mockState.userDataDir, quarantined[0]!), 'utf8')).toBe(
      'not-valid-json{{{',
    );

    // A subsequent write starts a fresh vault WITHOUT having overwritten the
    // corrupt file in place — the reset-on-corrupt data-loss path is gone.
    await connectorVault.set(WS, 'google', 'acct-2', {
      accessToken: 'at-new',
      refreshToken: null,
      expiresAt: null,
      scopes: [],
      tokenType: 'Bearer',
    });
    expect(await connectorVault.get(WS, 'google', 'acct-2')).not.toBeNull();
    const still = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.startsWith('connector-vault.bin.quarantined-'),
    );
    expect(still).toHaveLength(1);
  });

  it('a missing vault is empty first-run, NOT quarantined', async () => {
    expect(await connectorVault.get(WS, 'google', 'acct-x')).toBeNull();
    const quarantined = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.includes('.quarantined-'),
    );
    expect(quarantined).toHaveLength(0);
  });
});

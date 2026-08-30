import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mutable state shared with the hoisted electron mock: the userData dir (so each
// test gets an isolated vault) and whether OS encryption is "available".
const mockState = vi.hoisted(() => ({ userDataDir: '', encAvailable: true }));

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => mockState.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => mockState.encAvailable,
    // Deterministic, reversible marker "encryption" for tests — NOT real crypto,
    // but enough to prove round-trips and that plaintext is never persisted.
    encryptString: (s: string) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('decrypt failed');
      return s.slice(5);
    },
  },
}));

import { secureStore, credentialStore } from './secureStore';

const vaultPath = (): string => join(mockState.userDataDir, 'vault.bin');
const fakeCipher = (plain: string): string => Buffer.from(`enc::${plain}`, 'utf8').toString('base64');

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-vault-'));
  mockState.encAvailable = true;
});
afterEach(async () => {
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('secureStore — refresh token (backward compatibility / regression)', () => {
  it('round-trips a refresh token and clears it', async () => {
    expect(await secureStore.getRefreshToken()).toBeNull();
    await secureStore.setRefreshToken('rt-fixture-123');
    expect(await secureStore.getRefreshToken()).toBe('rt-fixture-123');
    await secureStore.clear();
    expect(await secureStore.getRefreshToken()).toBeNull();
  });

  it('refuses to persist the token when encryption is unavailable', async () => {
    mockState.encAvailable = false;
    await secureStore.setRefreshToken('rt-should-not-persist');
    await fs.access(vaultPath()).then(
      () => Promise.reject(new Error('vault should not exist')),
      () => undefined,
    );
  });
});

describe('credentialStore — provider secrets', () => {
  it('encrypts, round-trips, reports presence, and lists providers', async () => {
    expect(await credentialStore.getSecret('anthropic')).toBeNull();
    expect(await credentialStore.hasSecret('anthropic')).toBe(false);

    await credentialStore.setSecret('anthropic', 'sk-fixture-abc');
    expect(await credentialStore.getSecret('anthropic')).toBe('sk-fixture-abc');
    expect(await credentialStore.hasSecret('anthropic')).toBe(true);
    expect(await credentialStore.listProviders()).toEqual(['anthropic']);
  });

  it('never persists the secret as plaintext', async () => {
    await credentialStore.setSecret('anthropic', 'sk-fixture-PLAINTEXTMARKER');
    const onDisk = await fs.readFile(vaultPath(), 'utf8');
    expect(onDisk).not.toContain('sk-fixture-PLAINTEXTMARKER');
  });

  it('updates (overwrites) an existing secret', async () => {
    await credentialStore.setSecret('anthropic', 'sk-old');
    await credentialStore.setSecret('anthropic', 'sk-new');
    expect(await credentialStore.getSecret('anthropic')).toBe('sk-new');
    expect(await credentialStore.listProviders()).toEqual(['anthropic']);
  });

  it('supports multiple providers independently', async () => {
    await credentialStore.setSecret('anthropic', 'sk-a');
    await credentialStore.setSecret('openai', 'sk-o');
    await credentialStore.setSecret('gemini', 'sk-g');
    expect((await credentialStore.listProviders()).sort()).toEqual(['anthropic', 'gemini', 'openai']);

    await credentialStore.deleteSecret('openai');
    expect(await credentialStore.hasSecret('openai')).toBe(false);
    expect(await credentialStore.getSecret('anthropic')).toBe('sk-a');
    expect(await credentialStore.getSecret('gemini')).toBe('sk-g');
    expect((await credentialStore.listProviders()).sort()).toEqual(['anthropic', 'gemini']);
  });

  it('deleteSecret on an absent provider is a no-op', async () => {
    await credentialStore.setSecret('anthropic', 'sk-a');
    await credentialStore.deleteSecret('never-set');
    expect(await credentialStore.getSecret('anthropic')).toBe('sk-a');
  });

  it('refuses to persist a credential when encryption is unavailable', async () => {
    mockState.encAvailable = false;
    await credentialStore.setSecret('anthropic', 'sk-should-not-persist');
    expect(await credentialStore.hasSecret('anthropic')).toBe(false);
  });

  it('returns null (no throw) when a stored secret cannot be decrypted, unavailable encryption', async () => {
    await credentialStore.setSecret('anthropic', 'sk-a');
    mockState.encAvailable = false;
    expect(await credentialStore.getSecret('anthropic')).toBeNull();
  });
});

describe('credentialStore — corruption recovery', () => {
  it('drops only the corrupt entry, preserving the refresh token and other secrets', async () => {
    // Hand-write a vault with a valid refresh token, one good secret, one corrupt secret.
    await fs.writeFile(
      vaultPath(),
      JSON.stringify({
        refreshToken: fakeCipher('rt-keepme'),
        secrets: {
          good: fakeCipher('sk-good'),
          bad: Buffer.from('not-encrypted-garbage', 'utf8').toString('base64'),
        },
      }),
      { mode: 0o600 },
    );

    // Reading the corrupt one self-heals to null...
    expect(await credentialStore.getSecret('bad')).toBeNull();
    // ...and removes only that entry.
    expect(await credentialStore.hasSecret('bad')).toBe(false);
    // The good secret and the refresh token are untouched.
    expect(await credentialStore.getSecret('good')).toBe('sk-good');
    expect(await secureStore.getRefreshToken()).toBe('rt-keepme');
  });
});

describe('vault coexistence — refresh token and credentials share one file safely', () => {
  it('credential operations preserve the refresh token, and vice versa', async () => {
    await secureStore.setRefreshToken('rt-shared');
    await credentialStore.setSecret('anthropic', 'sk-shared');

    // Both readable.
    expect(await secureStore.getRefreshToken()).toBe('rt-shared');
    expect(await credentialStore.getSecret('anthropic')).toBe('sk-shared');

    // Adding a second secret preserves the refresh token.
    await credentialStore.setSecret('openai', 'sk-two');
    expect(await secureStore.getRefreshToken()).toBe('rt-shared');

    // Deleting a secret preserves the refresh token.
    await credentialStore.deleteSecret('anthropic');
    expect(await secureStore.getRefreshToken()).toBe('rt-shared');

    // Rotating the refresh token preserves remaining secrets.
    await secureStore.setRefreshToken('rt-rotated');
    expect(await credentialStore.getSecret('openai')).toBe('sk-two');
    expect(await secureStore.getRefreshToken()).toBe('rt-rotated');
  });
});

describe('P13C GATE 11 — a corrupt vault is QUARANTINED, not reset', () => {
  it('preserves the corrupt bytes and does not destroy the token on the next write', async () => {
    // A good token exists…
    await secureStore.setRefreshToken('rt-precious');
    expect(await secureStore.getRefreshToken()).toBe('rt-precious');

    // …then the vault file is corrupted on disk (truncated/garbage — not valid JSON).
    await fs.writeFile(vaultPath(), '{ this is not json', 'utf8');

    // A read no longer throws and no longer silently returns the token, BUT the
    // corrupt bytes are preserved to a quarantine sibling rather than lost.
    expect(await secureStore.getRefreshToken()).toBeNull();
    const quarantined = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.startsWith('vault.bin.quarantined-'),
    );
    expect(quarantined).toHaveLength(1);
    expect(await fs.readFile(join(mockState.userDataDir, quarantined[0]!), 'utf8')).toBe(
      '{ this is not json',
    );

    // The subsequent write creates a fresh vault; it must NOT have overwritten the
    // corrupt file in place (that was the reset-on-corrupt data-loss bug).
    await secureStore.setRefreshToken('rt-new');
    expect(await secureStore.getRefreshToken()).toBe('rt-new');
    // still exactly one quarantine copy, its bytes intact.
    const still = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.startsWith('vault.bin.quarantined-'),
    );
    expect(still).toHaveLength(1);
  });

  it('a missing vault is first-run (empty), NOT quarantined', async () => {
    expect(await secureStore.getRefreshToken()).toBeNull();
    const quarantined = (await fs.readdir(mockState.userDataDir)).filter((n) =>
      n.includes('.quarantined-'),
    );
    expect(quarantined).toHaveLength(0);
  });
});

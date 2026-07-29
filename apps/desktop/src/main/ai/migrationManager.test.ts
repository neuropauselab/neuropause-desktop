import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockState = vi.hoisted(() => ({ userDataDir: '', enc: true }));
vi.mock('electron', () => ({
  app: { getPath: () => mockState.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => mockState.enc,
    encryptString: (s: string) => Buffer.from(`enc::${s}`, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc::')) throw new Error('decrypt failed');
      return s.slice(5);
    },
  },
}));

import { credentialStore } from '../security/secureStore';
import { loadAiConfig } from './aiConfigStore';
import { ANTHROPIC_CREDENTIAL_ID } from './providerManager';
import { migrationStatus, migrateFromEnv, resetToEnvironment } from './migrationManager';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-mig-'));
  mockState.enc = true;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
  vi.stubEnv('NEUROPAUSE_OLLAMA_URL', '');
  vi.stubEnv('NEUROPAUSE_OLLAMA_MODEL', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('MigrationManager', () => {
  it('reports nothing to migrate when no env settings exist', async () => {
    const s = await migrationStatus();
    expect(s.available).toBe(false);
    expect(s.migrated).toBe(false);
  });

  it('detects available env settings, then migrates them into store + vault (idempotently)', async () => {
    vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', 'claude');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-fixture');

    expect((await migrationStatus()).available).toBe(true);

    const first = await migrateFromEnv();
    expect(first.migrated).toContain('provider');
    expect(first.migrated).toContain('anthropicKey');
    expect(loadAiConfig().provider).toBe('claude');
    expect(loadAiConfig().migratedFromEnv).toBe(true);
    expect(await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)).toBe('sk-env-fixture');

    // No longer available; a second run is a no-op.
    expect((await migrationStatus()).available).toBe(false);
    expect((await migrateFromEnv()).migrated).toEqual([]);
  });

  it('does not offer migration once a stored key exists', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env');
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-already-stored');
    expect((await migrationStatus()).available).toBe(false);
  });

  it('resetToEnvironment clears the store and the vault key', async () => {
    vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', 'claude');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-fixture');
    await migrateFromEnv();
    await resetToEnvironment();
    expect(loadAiConfig().provider).toBeNull();
    expect(loadAiConfig().migratedFromEnv).toBe(false);
    expect(await credentialStore.hasSecret(ANTHROPIC_CREDENTIAL_ID)).toBe(false);
  });
});

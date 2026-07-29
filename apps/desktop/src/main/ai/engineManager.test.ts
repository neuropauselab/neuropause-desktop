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
import { saveAiConfig } from './aiConfigStore';
import { ANTHROPIC_CREDENTIAL_ID } from './providerManager';
import { engineManager } from './engineManager';
import { aiEngine } from './engineInstance';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-em-'));
  mockState.enc = true;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('EngineManager', () => {
  it('boots to needs-setup when no key is configured', async () => {
    const s = await engineManager.init();
    expect(s.provider).toBe('claude');
    expect(s.configured).toBe(false);
    expect(s.state).toBe('needs-setup');
  });

  it('becomes ready once a Vault key exists, and the engine reflects it', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture');
    const s = await engineManager.init();
    expect(s.configured).toBe(true);
    expect(s.state).toBe('ready');
    expect(aiEngine.isConfigured()).toBe(true);
  });

  it('hot-switches provider on reconfigure without a restart', async () => {
    saveAiConfig({ provider: 'ollama' });
    await engineManager.reconfigure();
    expect(engineManager.status().provider).toBe('ollama');
    expect(engineManager.status().configured).toBe(true); // ollama needs no key
  });

  it('serialises concurrent reconfigure calls', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture');
    await Promise.all([
      engineManager.reconfigure(),
      engineManager.reconfigure(),
      engineManager.reconfigure(),
    ]);
    expect(engineManager.status().state).toBe('ready');
  });
});

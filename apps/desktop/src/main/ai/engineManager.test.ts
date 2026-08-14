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
import { tenantAiPreferenceStore as prefSingleton } from './tenantAiPreferenceInstance';
import {
  announceTenantRecovery,
  resetTenantRecoveryListenersForTests,
} from '../tenancy/tenantRecoveryHub';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-em-'));
  mockState.enc = true;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  prefSingleton.bindScope(() => null);
  resetTenantRecoveryListenersForTests();
  // The preference singleton resolves its file path at import time (before the
  // mocked userData dir exists), so setMine writes into the cwd — same cleanup
  // the product journey performs.
  await fs.rm('tenant-ai-preference.json', { force: true }).catch(() => undefined);
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

  /**
   * P13C ROUND 39 — GATE 26. The live-restart race, reproduced: the engine's
   * boot reconfigure ran inside the tenant resolver's refused window (6ms
   * before RECOVERED in the app.log evidence), so the D-1 clamp saw no
   * preference row, the local candidate was dropped, and a local-only user
   * with a Connected Ollama got "No AI model" for the entire session. The
   * recovery announcement is the missing trigger — and this test proves the
   * ANNOUNCEMENT rebuilds the router, not some later manual reconfigure.
   */
  it('round 39 — a tenant-recovery announcement rebuilds the router with the recovered preference', async () => {
    // Boot inside the refused window: no scope resolves, no preference visible.
    prefSingleton.bindScope(() => null);
    await engineManager.init();
    expect(engineManager.status().configured).toBe(false); // parked needs-setup

    // Resolution recovers: the row onboarding wrote becomes readable.
    prefSingleton.bindScope(() => ({ tenantId: 'org-default', workspaceId: 'workspace-default' }));
    await prefSingleton.setMine('local_only', 1_700_000_000_000);
    announceTenantRecovery();

    // The listener fires reconfigure asynchronously — wait for the swap itself.
    await vi.waitFor(() => {
      expect(engineManager.status().configured).toBe(true);
    });
    expect(aiEngine.isConfigured()).toBe(true); // the local candidate entered the plan
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

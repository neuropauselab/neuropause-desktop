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
import { engineManager } from './engineManager';
import { ANTHROPIC_CREDENTIAL_ID } from './providerManager';
import { getConfig, getHealth, detectOllama } from './aiConfigIpc';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-aiipc-'));
  mockState.enc = true;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('aiConfig IPC — getConfig (secret-free)', () => {
  it('reports unconfigured with no stored key and no secret field', async () => {
    await engineManager.init();
    const dto = await getConfig();
    expect(dto.provider).toBe('claude');
    expect(dto.configured).toBe(false);
    expect(dto.hasStoredKey).toBe(false);
    expect(Object.keys(dto).sort()).toEqual([
      'configured',
      'externalConsent',
      'hasStoredKey',
      'mode',
      'model',
      'provider',
      'source',
      'state',
      'storedKeys',
    ]);
    // Round 34: the per-provider flags are BOOLEANS — the secret-free property
    // this test exists to pin extends to the new field.
    expect(dto.storedKeys).toEqual({ anthropic: false, openai: false });
  });

  it('reflects a stored key as a boolean, never the value', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture-secret');
    await engineManager.init();
    const dto = await getConfig();
    expect(dto.hasStoredKey).toBe(true);
    expect(dto.configured).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('sk-fixture-secret');
  });
});

describe('aiConfig IPC — getHealth', () => {
  it('claude health reflects key presence', async () => {
    await engineManager.init();
    expect((await getHealth()).status).toBe('down');
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture');
    await engineManager.init();
    expect((await getHealth()).status).toBe('ok');
  });
});

describe('aiConfig IPC — detectOllama', () => {
  it('lists installed models when the server is reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.1' }, { name: 'mistral' }] }),
      })),
    );
    const d = await detectOllama();
    expect(d.reachable).toBe(true);
    expect(d.models).toEqual(['llama3.1', 'mistral']);
  });

  it('reports unreachable on a connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    const d = await detectOllama();
    expect(d.reachable).toBe(false);
    expect(d.models).toEqual([]);
  });
});

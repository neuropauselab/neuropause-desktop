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
import {
  ANTHROPIC_CREDENTIAL_ID,
  assembleRouteCandidates,
  buildModelRouter,
  resolveProviderId,
} from './providerManager';
import { planRoute } from '@neuropause/shared';

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-pm-'));
  mockState.enc = true;
  // Clean, deterministic env baseline (no key, default provider).
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('resolveProviderId — precedence config > env > default', () => {
  it('defaults to claude', () => {
    expect(resolveProviderId()).toEqual({ provider: 'claude', source: 'default' });
  });
  it('honors env when no config is stored', () => {
    vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', 'ollama');
    expect(resolveProviderId()).toEqual({ provider: 'ollama', source: 'env' });
  });
  it('stored config overrides env', () => {
    vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', 'ollama');
    saveAiConfig({ provider: 'claude' });
    expect(resolveProviderId()).toEqual({ provider: 'claude', source: 'config' });
  });
});

describe('buildModelRouter — config + Vault aware', () => {
  it('uses the Vault key for claude (configured), and claude leads the plan', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture');
    const r = await buildModelRouter();
    // Every construction now routes through the Private First composite so the
    // execution can stamp routing metadata; the PLAN carries which provider
    // actually leads — for a claude install, the external route.
    expect(r.resolve().client.provider).toBe('private-first');
    expect(r.isConfigured()).toBe(true);
    const { mode, candidates } = await assembleRouteCandidates();
    expect(mode).toBe('external');
    const plan = planRoute(mode, candidates);
    expect(plan.attempts[0]).toMatchObject({ provider: 'anthropic', location: 'external' });
  });
  it('falls back to the env key when the Vault is empty', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-fixture');
    const r = await buildModelRouter();
    expect(r.isConfigured()).toBe(true);
  });
  it('is unconfigured for claude with neither Vault nor env key', async () => {
    // The legacy behaviour, preserved exactly: a default install with no key
    // reports needs-setup — it does NOT silently grow a localhost route.
    const r = await buildModelRouter();
    expect(r.isConfigured()).toBe(false);
  });
  it('honors a config-selected ollama provider — the local route leads', async () => {
    saveAiConfig({ provider: 'ollama' });
    const r = await buildModelRouter();
    expect(r.isConfigured()).toBe(true);
    const { mode, candidates } = await assembleRouteCandidates();
    expect(mode).toBe('private_first');
    const plan = planRoute(mode, candidates);
    expect(plan.attempts[0]).toMatchObject({ provider: 'ollama', location: 'local' });
  });
  it('applies a config model override across all tiers (claude)', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-fixture');
    saveAiConfig({ provider: 'claude', model: 'claude-custom-model' });
    const r = await buildModelRouter();
    expect(r.resolve('fast').model).toBe('claude-custom-model');
    expect(r.resolve('deep').model).toBe('claude-custom-model');
  });
});

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

/* ── P13C ROUND 34 — the tenant preference clamps the route plan (D-1) ────── */

import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { OPENAI_CREDENTIAL_ID } from './providerManager';
import { promises as fsp } from 'node:fs';

describe('round 34 — tenant AI preference reaches the router', () => {
  afterEach(async () => {
    // Unbind and remove the singleton's stray persistence from the test cwd.
    tenantAiPreferenceStore.bindScope(() => null);
    await fsp.rm('tenant-ai-preference.json', { force: true }).catch(() => undefined);
  });

  it('a tenant local_only choice clamps a platform-external install — the D-1 fix', async () => {
    // The exact reported failure: fresh install, env API key present, user
    // chose "On this device". Before round 34 this routed to api.anthropic.com.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-fixture');
    tenantAiPreferenceStore.bindScope(() => ({ tenantId: 'org-a', workspaceId: 'ws-a' }));
    await tenantAiPreferenceStore.setMine('local_only');

    const { mode, candidates } = await assembleRouteCandidates();
    expect(mode).toBe('local_only');
    const plan = planRoute(mode, candidates);
    // No attempt may be external — the law, observed at the router.
    for (const attempt of plan.attempts) expect(attempt.location).not.toBe('external');
    // And the external candidate is named as skipped, not silently absent.
    expect(plan.skipped.some((s) => s.provider === 'anthropic')).toBe(true);
  });

  it('with no preference row the platform mode stands — legacy installs unchanged', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env-fixture');
    const { mode } = await assembleRouteCandidates();
    expect(mode).toBe('external'); // documented pre-mode behaviour for claude-default
  });

  it('a tenant preference can never WIDEN the platform mode', async () => {
    saveAiConfig({ mode: 'local_only' });
    tenantAiPreferenceStore.bindScope(() => ({ tenantId: 'org-a', workspaceId: 'ws-a' }));
    await tenantAiPreferenceStore.setMine('private_first');
    const { mode } = await assembleRouteCandidates();
    expect(mode).toBe('local_only'); // min(platform, tenant)
  });
});

describe('round 34 — OpenAI provider routing', () => {
  it('an openai-selected install with a Vault key routes external with openai leading', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-fixture');
    saveAiConfig({ provider: 'openai' });
    const { mode, candidates } = await assembleRouteCandidates();
    expect(mode).toBe('external');
    const plan = planRoute(mode, candidates);
    expect(plan.attempts[0]).toMatchObject({ provider: 'openai', location: 'external' });
    // Anthropic (no key) is skipped as not configured, not silently dropped.
    expect(plan.skipped.some((s) => s.provider === 'anthropic')).toBe(true);
  });

  it('openai is a consented fallback candidate in private_first', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-fixture');
    saveAiConfig({ mode: 'private_first', externalConsent: true });
    const { mode, candidates } = await assembleRouteCandidates();
    const plan = planRoute(mode, candidates);
    expect(plan.attempts[0]?.provider).toBe('ollama'); // local leads
    expect(plan.attempts.some((a) => a.provider === 'openai')).toBe(true);
  });

  it('without consent, an openai key alone never becomes an eligible external route', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-fixture');
    saveAiConfig({ mode: 'private_first', externalConsent: false });
    const { mode, candidates } = await assembleRouteCandidates();
    const plan = planRoute(mode, candidates);
    expect(plan.attempts.every((a) => a.location !== 'external')).toBe(true);
  });

  it('a config model override applies to openai across all tiers', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-fixture');
    saveAiConfig({ provider: 'openai', model: 'gpt-4o-mini' });
    const r = await buildModelRouter();
    expect(r.isConfigured()).toBe(true);
    expect(r.resolve('fast').model).toBe('gpt-4o-mini');
  });
});

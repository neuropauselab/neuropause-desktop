/**
 * P13C ROUND 35 — GATE 8 LIVE-PROVIDER VERIFICATION (the live half).
 *
 * These tests call REAL providers through the REAL chain — ai-config → Vault →
 * consent → tenant clamp → planRoute → PrivateFirstClient → provider — with no
 * transport substitution at all. They are env-gated (the `NP_BENCH=1` idiom)
 * because they need something the CI box may not have: a running Ollama with a
 * chat model, or real vendor API keys. Run them deliberately:
 *
 *     NP_LIVE_AI=1 npx vitest run src/main/ai/liveProviderVerification.test.ts
 *
 * The cloud cases additionally require ANTHROPIC_API_KEY / OPENAI_API_KEY in
 * the environment and are skipped — never faked — without them. A skipped live
 * test is recorded as ABSENT evidence in the readiness matrix, not as a pass.
 */
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

import { saveAiConfig } from './aiConfigStore';
import { credentialStore } from '../security/secureStore';
import { ANTHROPIC_CREDENTIAL_ID, OPENAI_CREDENTIAL_ID, buildModelRouter } from './providerManager';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { AiEngine } from './aiEngine';
import { detectOllama } from './aiConfigIpc';

const LIVE = process.env['NP_LIVE_AI'] === '1';
const HAS_ANTHROPIC = Boolean(process.env['ANTHROPIC_API_KEY']);
const HAS_OPENAI = Boolean(process.env['OPENAI_API_KEY']);

const REQ = { worker: 'live-test', promptId: 'engineering.summary', variables: { subject: 'say ok' } } as const;

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-live-'));
});
afterEach(async () => {
  tenantAiPreferenceStore.bindScope(() => null);
  await fs.rm('tenant-ai-preference.json', { force: true }).catch(() => undefined);
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe.runIf(LIVE)('LIVE — local Ollama through the full Private-First chain', () => {
  it('completes a real local inference under local_only with a tenant clamp, external provenance impossible', async () => {
    const probe = await detectOllama();
    expect(probe.reachable, 'Ollama must be running (ollama serve) for the live gate').toBe(true);
    const model = probe.models.find((m) => !m.startsWith('nomic-embed')) ?? '';
    expect(model, 'a chat-capable local model must be installed').not.toBe('');

    // Platform says nothing; the TENANT chose "On this device" — the exact
    // first-run path. The clamp, not the config, is what forbids external.
    saveAiConfig({ provider: 'ollama', model });
    tenantAiPreferenceStore.bindScope(() => ({ tenantId: 'org-live', workspaceId: 'ws-live' }));
    await tenantAiPreferenceStore.setMine('local_only');

    const router = await buildModelRouter();
    expect(router.isConfigured()).toBe(true);
    const engine = new AiEngine({ router });
    const res = await engine.run(REQ);

    // A real model answered — non-empty text, real token counts, and the
    // provenance was stamped by execution, not configuration.
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.model).toBe(model);
    expect(res.routing).toMatchObject({ location: 'local', provider: 'ollama', mode: 'local_only' });
    expect(res.usage.outputTokens).toBeGreaterThan(0);
  }, 180_000);
});

describe.runIf(LIVE && HAS_ANTHROPIC)('LIVE — Anthropic through the full chain', () => {
  it('completes externally when selected, with external provenance', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, process.env['ANTHROPIC_API_KEY'] as string);
    saveAiConfig({ provider: 'claude' });
    const engine = new AiEngine({ router: await buildModelRouter() });
    const res = await engine.run(REQ);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.routing).toMatchObject({ location: 'external', provider: 'anthropic' });
  }, 120_000);
});

describe.runIf(LIVE && HAS_OPENAI)('LIVE — OpenAI through the full chain', () => {
  it('completes externally when selected, with external provenance', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, process.env['OPENAI_API_KEY'] as string);
    saveAiConfig({ provider: 'openai' });
    const engine = new AiEngine({ router: await buildModelRouter() });
    const res = await engine.run(REQ);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.routing).toMatchObject({ location: 'external', provider: 'openai' });
  }, 120_000);
});

describe.runIf(!LIVE)('live provider verification (gated off)', () => {
  it('is intentionally skipped without NP_LIVE_AI=1 — absence of evidence, never fabricated evidence', () => {
    expect(LIVE).toBe(false);
  });
});

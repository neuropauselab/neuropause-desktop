/**
 * P13C ROUND 35 — GATE 8 LIVE-PROVIDER ITEM, THE DETERMINISTIC HALF.
 *
 * Every prior AI test stubbed `fetch` per client. None drove the WHOLE chain —
 * ai-config file → Secure Vault keys → consent → tenant clamp → planRoute →
 * PrivateFirstClient → provider client → HTTP → provenance stamp — in one
 * piece. This suite does, over REAL localhost HTTP servers speaking the exact
 * vendor wire protocols (Anthropic /v1/messages, OpenAI /v1/chat/completions,
 * Ollama /api/chat). The only substitution is the transport origin: a
 * `fetchImpl` that rewrites api.anthropic.com / api.openai.com to the local
 * stub — bodies, headers, and parsing are the production code paths.
 *
 * What this deliberately is NOT: a live call to the vendors (that needs real
 * credentials — see liveProviderVerification.test.ts, env-gated). What it
 * proves that unit stubs could not: the policy holds at the WIRE — a
 * local_only install with cloud keys in the vault produces ZERO cloud
 * requests, counted at a real server socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

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
  OPENAI_CREDENTIAL_ID,
  buildModelRouter,
} from './providerManager';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { AiEngine } from './aiEngine';

/* ── the vendor-protocol stub, one server, path-keyed ─────────────────────── */

interface StubState {
  anthropicHits: number;
  openaiHits: number;
  ollamaHits: number;
  cloudStatus: number; // 200 or an error to return from cloud paths
}

function startStub(state: StubState): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      const reply = (obj: unknown, status = 200): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/v1/messages') {
        state.anthropicHits += 1;
        if (state.cloudStatus !== 200) return reply({ error: { message: 'stub says no' } }, state.cloudStatus);
        const parsed = JSON.parse(body) as { model: string };
        return reply({
          id: 'msg-stub',
          model: parsed.model,
          content: [{ type: 'text', text: 'anthropic wire answer' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        });
      }
      if (req.url === '/v1/chat/completions') {
        state.openaiHits += 1;
        if (state.cloudStatus !== 200) return reply({ error: { message: 'stub says no' } }, state.cloudStatus);
        const parsed = JSON.parse(body) as { model: string };
        return reply({
          id: 'chatcmpl-stub',
          model: parsed.model,
          choices: [{ message: { content: 'openai wire answer' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        });
      }
      if (req.url === '/api/chat') {
        state.ollamaHits += 1;
        const parsed = JSON.parse(body) as { model: string };
        return reply({
          model: parsed.model,
          message: { role: 'assistant', content: 'ollama wire answer' },
          prompt_eval_count: 5,
          eval_count: 3,
        });
      }
      reply({ error: 'unknown path' }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

/** Rewrites the vendors' origins to the stub; everything else passes through. */
function redirectingFetch(base: string): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const rewritten = u
      .replace('https://api.anthropic.com', base)
      .replace('https://api.openai.com', base);
    return fetch(rewritten, init);
  }) as typeof fetch;
}

const REQ = { worker: 'wire-test', promptId: 'engineering.summary', variables: { subject: 'hi' } } as const;

let state: StubState;
let stub: { server: Server; base: string };

beforeEach(async () => {
  mockState.userDataDir = await fs.mkdtemp(join(tmpdir(), 'np-wire-'));
  mockState.enc = true;
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('NEUROPAUSE_LLM_PROVIDER', '');
  vi.stubEnv('NEUROPAUSE_OLLAMA_URL', '');
  state = { anthropicHits: 0, openaiHits: 0, ollamaHits: 0, cloudStatus: 200 };
  stub = await startStub(state);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  tenantAiPreferenceStore.bindScope(() => null);
  await fs.rm('tenant-ai-preference.json', { force: true }).catch(() => undefined);
  await new Promise((r) => stub.server.close(r));
  await fs.rm(mockState.userDataDir, { recursive: true, force: true }).catch(() => undefined);
});

async function runOnce(): Promise<Awaited<ReturnType<AiEngine['run']>>> {
  const router = await buildModelRouter({ fetchImpl: redirectingFetch(stub.base) });
  const engine = new AiEngine({ router });
  return engine.run(REQ);
}

describe('wire integration — provider selection', () => {
  it('an openai-selected install completes through the OpenAI protocol with external provenance', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-wire');
    saveAiConfig({ provider: 'openai' });
    const res = await runOnce();
    expect(res.text).toContain('openai wire answer');
    expect(res.routing).toMatchObject({ location: 'external', provider: 'openai' });
    expect(state.openaiHits).toBe(1);
    expect(state.anthropicHits).toBe(0);
  });

  it('a claude-selected install completes through the Anthropic protocol', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-ant-wire');
    saveAiConfig({ provider: 'claude' });
    const res = await runOnce();
    expect(res.text).toContain('anthropic wire answer');
    expect(res.routing).toMatchObject({ location: 'external', provider: 'anthropic' });
    expect(state.anthropicHits).toBe(1);
    expect(state.openaiHits).toBe(0);
  });
});

describe('wire integration — the policy holds at the socket', () => {
  it('local_only with BOTH cloud keys in the vault produces zero cloud requests', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-ant-wire');
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-wire');
    saveAiConfig({ mode: 'local_only', ollamaUrl: stub.base });
    const res = await runOnce();
    expect(res.text).toContain('ollama wire answer');
    expect(res.routing).toMatchObject({ location: 'local', provider: 'ollama' });
    // The proof unit stubs could not give: counted at a real server socket.
    expect(state.anthropicHits).toBe(0);
    expect(state.openaiHits).toBe(0);
    expect(state.ollamaHits).toBe(1);
  });

  it('the tenant clamp holds at the wire: platform-external install, tenant local_only', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-ant-wire');
    saveAiConfig({ provider: 'claude', ollamaUrl: stub.base }); // platform resolves external
    tenantAiPreferenceStore.bindScope(() => ({ tenantId: 'org-a', workspaceId: 'ws-a' }));
    await tenantAiPreferenceStore.setMine('local_only');
    const res = await runOnce();
    expect(res.routing).toMatchObject({ location: 'local', provider: 'ollama' });
    expect(state.anthropicHits).toBe(0);
  });

  it('private_first with consent falls back local → cloud when the local route is down, and says so', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-ant-wire');
    // A port nothing listens on: the local attempt genuinely fails on the wire.
    saveAiConfig({ mode: 'private_first', externalConsent: true, ollamaUrl: 'http://127.0.0.1:9' });
    const res = await runOnce();
    expect(res.text).toContain('anthropic wire answer');
    expect(res.routing?.location).toBe('external');
    // Honest provenance: the failed local attempt is named, not erased.
    expect(res.routing?.attempted.some((a) => a.provider === 'ollama')).toBe(true);
  });

  it('private_first WITHOUT consent never escalates — fail-closed, zero cloud requests', async () => {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, 'sk-ant-wire');
    saveAiConfig({ mode: 'private_first', externalConsent: false, ollamaUrl: 'http://127.0.0.1:9' });
    const res = await runOnce();
    expect(res.model).toBe('none'); // deterministic fallback
    expect(res.routing?.location).toBe('none');
    expect(state.anthropicHits).toBe(0);
    expect(state.openaiHits).toBe(0);
  });
});

describe('wire integration — provider errors surface honestly', () => {
  it('a 401 from the provider reaches the fallback reason; the key never appears', async () => {
    await credentialStore.setSecret(OPENAI_CREDENTIAL_ID, 'sk-openai-secret');
    saveAiConfig({ provider: 'openai' });
    state.cloudStatus = 401;
    const res = await runOnce();
    expect(res.model).toBe('none'); // deterministic fallback, not a fake answer
    expect(res.routing?.reason).toMatch(/401|failed|no model/i);
    expect(JSON.stringify(res)).not.toContain('sk-openai-secret');
  });
});

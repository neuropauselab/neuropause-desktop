import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayError, assertNoAuthorityClaim, completeViaProvider, gatewayConfigFromEnv, gatewayConfigured, validateRequest, type GatewayConfig, type GatewayResponse } from './gateway';
import { createAiGatewayRouter } from './router';

const ollamaCfg: GatewayConfig = { provider: 'ollama', model: 'test-model', baseUrl: 'http://ollama.test', timeoutMs: 5000, maxMessages: 8, maxInputChars: 2000, maxOutputTokens: 256 };

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

describe('AI gateway — configuration and bounds', () => {
  it('is unconfigured by default and never exposes a key', () => {
    const cfg = gatewayConfigFromEnv({});
    expect(cfg.provider).toBe('none');
    expect(gatewayConfigured(cfg)).toBe(false);
    expect(gatewayConfigured({ ...ollamaCfg, provider: 'anthropic', anthropicApiKey: undefined })).toBe(false);
    expect(gatewayConfigured({ ...ollamaCfg, provider: 'anthropic', anthropicApiKey: 'k' })).toBe(true);
  });
  it('refuses when no provider is configured (fail closed, 503 ai_unavailable)', async () => {
    await expect(completeViaProvider({ ...ollamaCfg, provider: 'none' }, { messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'ai_unavailable', status: 503 });
  });
  it('bounds messages, input size, tool names and output tokens', () => {
    expect(() => validateRequest(ollamaCfg, { messages: [] })).toThrow(GatewayError);
    expect(() => validateRequest(ollamaCfg, { messages: Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' })) })).toThrow(/At most 8/);
    expect(() => validateRequest(ollamaCfg, { messages: [{ role: 'user', content: 'x'.repeat(2001) }] })).toThrow(/exceeds/);
    expect(() => validateRequest(ollamaCfg, { messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'Bad Name', description: '', parameters: {} }] })).toThrow(/tool names/);
    expect(validateRequest(ollamaCfg, { messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 99999 }).maxOutputTokens).toBe(256);
  });
});

describe('AI gateway — proposals are proposals', () => {
  it('maps an Ollama tool_call to a tool proposal and never executes or authorizes', async () => {
    const out = await completeViaProvider(ollamaCfg, { messages: [{ role: 'user', content: 'read it' }], tools: [{ name: 'read_file', description: 'r', parameters: {} }], maxOutputTokens: 64 }, fakeFetch({ model: 'test-model', message: { content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.txt', authorized: true } } }] }, prompt_eval_count: 5, eval_count: 7 }));
    expect(out.tool_proposals).toHaveLength(1);
    expect(out.tool_proposals[0].tool).toBe('read_file');
    expect(out.finish_reason).toBe('tool_proposal');
    expect(out.gateway).toEqual({ version: 'np.ai.gateway/v1', policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false });
    expect(Object.keys(out)).not.toContain('authorized');
    // The model may SAY authorized inside its arguments; that is data the policy engine sees, not authority.
    expect(out.tool_proposals[0].arguments.authorized).toBe(true);
    expect(assertNoAuthorityClaim(out)).toBe(out);
  });
  it('rejects a response that somehow carries an authority claim', () => {
    const bad = { id: 'x', provider: 'ollama', model: 'm', text: '', tool_proposals: [], finish_reason: 'stop', usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 1, gateway: { version: 'np.ai.gateway/v1', policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false }, authorized: true } as unknown as GatewayResponse;
    expect(() => assertNoAuthorityClaim(bad)).toThrow(/must not carry/);
  });
  it('surfaces provider errors and timeouts as gateway errors (no fabricated completion)', async () => {
    await expect(completeViaProvider(ollamaCfg, { messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 8 }, fakeFetch({ error: 'model not found' }, 404))).rejects.toMatchObject({ code: 'provider_error' });
    const hang: typeof fetch = ((_u: unknown, init: { signal: AbortSignal }) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); })) as unknown as typeof fetch;
    await expect(completeViaProvider({ ...ollamaCfg, timeoutMs: 30 }, { messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 8 }, hang)).rejects.toMatchObject({ code: 'provider_timeout', status: 504 });
  });
});

describe('AI gateway — HTTP surface', () => {
  let server: Server; let base = '';
  let calls = 0;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // Simulate requireAuth: header x-user sets req.userId; absent → unauthenticated.
    app.use((req, _res, next) => { const u = req.header('x-user'); if (u) (req as express.Request & { userId?: string }).userId = u; next(); });
    let t = 0;
    app.use('/ai', createAiGatewayRouter({ config: ollamaCfg, userRpm: 2, now: () => (t += 1), complete: async (_c, r) => { calls++; return { id: 'gw_1', provider: 'ollama', model: 'test-model', text: `echo:${r.messages[r.messages.length - 1].content}`, tool_proposals: [], finish_reason: 'stop', usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 1, gateway: { version: 'np.ai.gateway/v1', policy: 'AI_PROPOSES_ONLY', executes_tools: false, grants_authority: false } }; } }));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('GET /ai/status reports configuration without secrets', async () => {
    const j = (await (await fetch(`${base}/ai/status`)).json()) as { configured: boolean; provider: string };
    expect(j.configured).toBe(true); expect(j.provider).toBe('ollama'); expect(JSON.stringify(j)).not.toMatch(/apiKey|api_key/i);
  });
  it('POST /ai/chat requires an authenticated principal', async () => {
    const r = await fetch(`${base}/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(r.status).toBe(401); expect(calls).toBe(0);
  });
  it('POST /ai/chat answers, validates, and rate-limits per user', async () => {
    const h = { 'content-type': 'application/json', 'x-user': 'u1' };
    const ok = await fetch(`${base}/ai/chat`, { method: 'POST', headers: h, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(ok.status).toBe(200); expect(((await ok.json()) as { text: string }).text).toBe('echo:hi');
    const bad = await fetch(`${base}/ai/chat`, { method: 'POST', headers: h, body: JSON.stringify({ messages: [] }) });
    expect(bad.status).toBe(400);
    const limited = await fetch(`${base}/ai/chat`, { method: 'POST', headers: h, body: JSON.stringify({ messages: [{ role: 'user', content: 'again' }] }) });
    expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBeTruthy();
    const other = await fetch(`${base}/ai/chat`, { method: 'POST', headers: { ...h, 'x-user': 'u2' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
    expect(other.status).toBe(200);
  });
});

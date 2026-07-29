import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { FakeHttpClient, FetchHttpClient, type HttpResponse } from './http';
import { createProvider, HttpAiProvider, OPENAI_SPEC, ANTHROPIC_SPEC, GEMINI_SPEC, AZURE_OPENAI_SPEC } from './providers';

const OK = (body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status: 200, ok: true, headers, body: JSON.stringify(body) });
const openaiResponse = { choices: [{ message: { content: 'hello world' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } };
const req = { model: 'gpt-4o', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 64 };

describe('AI provider adapters — request construction + parsing (ADAPTER VERIFIED)', () => {
  it('OpenAI: builds the exact request and parses content + usage', async () => {
    const http = new FakeHttpClient(() => OK(openaiResponse));
    const p = new HttpAiProvider(OPENAI_SPEC, http, { apiKey: 'sk-test' });
    const result = await p.generate(req);
    const sent = http.lastRequest!;
    expect(sent.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent.headers?.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(sent.body!)).toMatchObject({ model: 'gpt-4o', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('hello world');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15 });
    expect(p.usage().calls).toBe(1);
  });

  it('OpenAI: parses an SSE stream into text deltas', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"he"}}]}\n', 'data: {"choices":[{"delta":{"content":"llo"}}]}\n', 'data: [DONE]\n'];
    const http = new FakeHttpClient(() => OK({}), () => chunks);
    const p = new HttpAiProvider(OPENAI_SPEC, http, { apiKey: 'sk-test' });
    const out: string[] = [];
    for await (const d of p.streamText(req)) out.push(d);
    expect(out.join('')).toBe('hello');
  });

  it('OpenAI: requests JSON for structured output and parses it', async () => {
    const http = new FakeHttpClient(() => OK({ choices: [{ message: { content: '{"ok":true}' } }], usage: {} }));
    const p = new HttpAiProvider(OPENAI_SPEC, http, { apiKey: 'sk-test' });
    const r = await p.generateStructured<{ ok: boolean }>(req);
    expect(JSON.parse(http.lastRequest!.body!).response_format).toEqual({ type: 'json_object' });
    expect(r.json).toEqual({ ok: true });
  });

  it('retries a 429 and then succeeds', async () => {
    let n = 0;
    const http = new FakeHttpClient(() => (++n === 1 ? { status: 429, ok: false, headers: {}, body: 'rate limited' } : OK(openaiResponse)));
    const p = new HttpAiProvider(OPENAI_SPEC, http, { apiKey: 'sk-test' }, { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 } });
    const result = await p.generate(req);
    expect(result.text).toBe('hello world');
    expect(n).toBe(2); // one retry
  });

  it('discovers models and reports health', async () => {
    const http = new FakeHttpClient(() => OK({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
    const p = new HttpAiProvider(OPENAI_SPEC, http, { apiKey: 'sk-test' });
    expect(await p.discoverModels()).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect((await p.health()).ok).toBe(true);
  });

  it('Anthropic: separates system, uses x-api-key, parses content blocks', async () => {
    const http = new FakeHttpClient(() => OK({ content: [{ text: 'claude reply' }], usage: { input_tokens: 5, output_tokens: 7 } }));
    const p = new HttpAiProvider(ANTHROPIC_SPEC, http, { apiKey: 'ak-test' });
    const result = await p.generate({ model: 'claude-3-5-sonnet-latest', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] });
    const sent = http.lastRequest!;
    expect(sent.headers?.['x-api-key']).toBe('ak-test');
    expect(sent.headers?.['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(sent.body!);
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('claude reply');
    expect(result.usage.totalTokens).toBe(12);
  });

  it('Gemini keeps the API key in a header (never the URL); Azure puts api-version in the query', () => {
    expect(GEMINI_SPEC.chatUrl(GEMINI_SPEC.defaultBaseUrl, 'gemini-1.5-pro')).not.toContain('key=');
    expect(GEMINI_SPEC.headers('g-key')['x-goog-api-key']).toBe('g-key');
    expect(AZURE_OPENAI_SPEC.chatUrl('https://r.openai.azure.com', 'gpt-4o', '2024-06-01')).toBe('https://r.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01');
    expect(AZURE_OPENAI_SPEC.headers('az-key')['api-key']).toBe('az-key');
  });

  it('requires an API key for keyed providers', async () => {
    const p = createProvider('openai', new FakeHttpClient(() => OK({})));
    await expect(p.generate(req)).rejects.toThrow(/API key/);
  });
});

describe('AI provider adapter over a REAL local HTTP server (real fetch path)', () => {
  it('round-trips a chat completion + an SSE stream over a real socket', async () => {
    const server: Server = createServer((req2, res) => {
      if (req2.url?.endsWith('/chat/completions')) {
        let body = '';
        req2.on('data', (c) => (body += c));
        req2.on('end', () => {
          const wantsStream = JSON.parse(body).stream === true;
          if (wantsStream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: {"choices":[{"delta":{"content":"live "}}]}\n');
            res.write('data: {"choices":[{"delta":{"content":"stream"}}]}\n');
            res.write('data: [DONE]\n');
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(openaiResponse));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const p = new HttpAiProvider(OPENAI_SPEC, new FetchHttpClient(), { apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${port}/v1` });
      const result = await p.generate(req);
      expect(result.text).toBe('hello world'); // real request → real response → parsed
      const out: string[] = [];
      for await (const d of p.streamText(req)) out.push(d);
      expect(out.join('')).toBe('live stream'); // real SSE over the socket
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/**
 * P13C ROUND 34 — OpenAI client on the shared ModelClient contract.
 *
 * Mirrors the Claude/Ollama client tests: request shape, result mapping, and
 * the rule that thrown messages are user-readable and never contain the key.
 */
import { describe, expect, it } from 'vitest';
import { OpenAiModelClient } from './openaiClient';

function fetchStub(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('OpenAiModelClient', () => {
  it('is unconfigured without a key and refuses to call', async () => {
    const c = new OpenAiModelClient({ apiKey: '' });
    expect(c.isConfigured()).toBe(false);
    await expect(
      c.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow(/not configured/);
  });

  it('sends the system prompt as a leading system message and maps the result', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'gpt-4o',
          choices: [{ message: { content: 'answer' } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const c = new OpenAiModelClient({ apiKey: 'sk-test', fetchImpl });
    const res = await c.complete({
      model: 'gpt-4o',
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 64,
    });

    expect(res).toEqual({ id: 'chatcmpl-1', model: 'gpt-4o', text: 'answer', inputTokens: 12, outputTokens: 7 });
    const sent = JSON.parse(String(captured!.init.body)) as {
      messages: Array<{ role: string; content: string }>;
      max_completion_tokens: number;
    };
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(sent.max_completion_tokens).toBe(64);
    // Bearer auth, and the key never appears in the body.
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(String(captured!.init.body)).not.toContain('sk-test');
  });

  it('names an auth failure without echoing the key', async () => {
    const c = new OpenAiModelClient({ apiKey: 'sk-secret', fetchImpl: fetchStub(401, { error: { message: 'bad key' } }) });
    await expect(
      c.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow(/401 Unauthorized/);
    await expect(
      c.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.not.toThrow(/sk-secret/);
  });

  it('names a rate limit as a rate limit, not as "offline"', async () => {
    const c = new OpenAiModelClient({ apiKey: 'sk-test', fetchImpl: fetchStub(429, {}) });
    await expect(
      c.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow(/Rate limited/);
  });

  it('surfaces the provider error message on other failures', async () => {
    const c = new OpenAiModelClient({
      apiKey: 'sk-test',
      fetchImpl: fetchStub(400, { error: { message: 'model not found' } }),
    });
    await expect(
      c.complete({ model: 'gpt-nope', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow(/model not found/);
  });
});

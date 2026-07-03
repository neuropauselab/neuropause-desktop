import { describe, expect, it, afterEach } from 'vitest';
import { OllamaModelClient } from './ollamaClient';
import { createModelRouter, resolveProvider } from './provider';

// --- Ollama client (stubbed fetch, no network) ------------------------------

describe('OllamaModelClient', () => {
  it('is always configured (local server, key-free)', () => {
    expect(new OllamaModelClient().isConfigured()).toBe(true);
  });

  it('builds the /api/chat request (system prepended) and parses the response', async () => {
    let captured: { url: unknown; init: { body?: string } } | null = null;
    const fetchImpl = (async (url: unknown, init: unknown) => {
      captured = { url, init: init as { body?: string } };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'llama3.1',
          message: { role: 'assistant', content: '{"summary":"ok","confidence":0.6}' },
          prompt_eval_count: 31,
          eval_count: 12,
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const c = new OllamaModelClient({ baseUrl: 'http://localhost:11434/', fetchImpl });
    const res = await c.complete({
      model: 'llama3.1',
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      maxOutputTokens: 128,
    });

    expect(captured!.url).toBe('http://localhost:11434/api/chat'); // trailing slash trimmed
    const body = JSON.parse(captured!.init.body ?? '{}');
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(128);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });

    expect(res.text).toBe('{"summary":"ok","confidence":0.6}');
    expect(res.inputTokens).toBe(31);
    expect(res.outputTokens).toBe(12);
  });

  it('raises a clear error when the server replies with an error', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 404, json: async () => ({ error: 'model "nope" not found' }) }) as unknown as Response) as unknown as typeof fetch;
    const c = new OllamaModelClient({ fetchImpl });
    await expect(
      c.complete({ model: 'nope', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow('not found');
  });

  it('explains when the server is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const c = new OllamaModelClient({ fetchImpl });
    await expect(
      c.complete({ model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 }),
    ).rejects.toThrow('is it running');
  });
});

// --- Provider switch (factory, env-driven) ----------------------------------

describe('createModelRouter (provider switch)', () => {
  afterEach(() => {
    delete process.env.NEUROPAUSE_LLM_PROVIDER;
    delete process.env.NEUROPAUSE_OLLAMA_MODEL;
    delete process.env.NEUROPAUSE_OLLAMA_URL;
  });

  it('defaults to the Claude provider', () => {
    delete process.env.NEUROPAUSE_LLM_PROVIDER;
    expect(resolveProvider()).toBe('claude');
    const r = createModelRouter();
    expect(r.resolve('balanced').client.provider).toBe('anthropic');
    expect(r.resolve('balanced').model).toBe('claude-sonnet-4-6');
  });

  it('switches to Ollama and maps all tiers to the configured local model', () => {
    process.env.NEUROPAUSE_LLM_PROVIDER = 'ollama';
    process.env.NEUROPAUSE_OLLAMA_MODEL = 'qwen2.5:7b';
    expect(resolveProvider()).toBe('ollama');
    const r = createModelRouter();
    expect(r.resolve('fast').client.provider).toBe('ollama');
    expect(r.resolve('balanced').model).toBe('qwen2.5:7b');
    expect(r.resolve('deep').model).toBe('qwen2.5:7b');
  });

  it('uses the default local model when none is set', () => {
    process.env.NEUROPAUSE_LLM_PROVIDER = 'ollama';
    const r = createModelRouter();
    expect(r.resolve('fast').model).toBe('llama3.1');
  });
});

/**
 * OpenAI model client. Talks to the Chat Completions API. The API key comes
 * from the Secure Vault (via providerManager) or OPENAI_API_KEY in the main
 * process and never leaves it — not the renderer, not the audit log. When no
 * key is set, isConfigured() is false and the engine falls back to its
 * deterministic path.
 *
 * Mirrors ClaudeModelClient exactly: same options shape (injectable fetch for
 * tests), same ModelResult mapping, same rule that thrown messages are
 * user-readable and never contain the key. The one API difference: OpenAI has
 * no top-level `system` field, so the system prompt is prepended as a
 * `role: 'system'` message — the same shape ollamaClient uses.
 */
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';
import { assertHeaderSafeApiKey, redactProviderError } from './apiKeyGuard';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { type?: string; message?: string };
}

export interface OpenAiClientOptions {
  apiKey?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OpenAiModelClient implements ModelClient {
  readonly provider = 'openai';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenAiClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(req: ModelRequest): Promise<ModelResult> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI client is not configured (no API key).');
    }
    const controller = new AbortController();
    assertHeaderSafeApiKey(this.apiKey);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const messages = [
        ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await this.fetchImpl(OPENAI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          max_completion_tokens: req.maxOutputTokens,
          messages,
        }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as OpenAiResponse;
      if (!res.ok || json.error) {
        // Surface the provider's error reason — never the key. Name the two
        // states a user can act on instead of collapsing them into one.
        const reason =
          res.status === 401
            ? 'Invalid API key (401 Unauthorized).'
            : res.status === 429
              ? 'Rate limited by OpenAI (429). Try again shortly.'
              : (json.error?.message ?? `HTTP ${res.status}`);
        throw new Error(`OpenAI request failed: ${reason}`);
      }
      const text = json.choices?.[0]?.message?.content ?? '';
      return {
        id: json.id ?? 'openai-unknown',
        model: json.model ?? req.model,
        text,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      // Second layer. The guard above stops the known shape; this stops the
      // next one. Any provider/SDK throw is re-raised with credential-shaped
      // material scrubbed, because this message is copied verbatim into the
      // routing envelope, rendered in the assistant, and persisted to disk.
      throw redactProviderError(err);
    } finally {
      clearTimeout(timer);
    }
  }
}

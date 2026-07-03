/**
 * Claude model client. Talks to the Anthropic Messages API. The API key is read
 * from the environment in the main process (ANTHROPIC_API_KEY) and never leaves
 * it — not the renderer, not the audit log. When no key is set, isConfigured()
 * is false and the engine falls back to its deterministic path.
 */
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicResponse {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

export interface ClaudeClientOptions {
  apiKey?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ClaudeModelClient implements ModelClient {
  readonly provider = 'anthropic';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ClaudeClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(req: ModelRequest): Promise<ModelResult> {
    if (!this.isConfigured()) {
      throw new Error('Claude client is not configured (no ANTHROPIC_API_KEY).');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });
      const json = (await res.json()) as AnthropicResponse;
      if (!res.ok || json.error) {
        // Surface the provider's error reason — never the key.
        const reason = json.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`Anthropic request failed: ${reason}`);
      }
      const text = (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
      return {
        id: json.id ?? 'anthropic-unknown',
        model: json.model ?? req.model,
        text,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

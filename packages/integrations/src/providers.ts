/**
 * AI provider adapters (NCEA 13.0, Phase 1). Production-capable adapters that
 * implement the EXISTING `AiProvider` interface from @neuropause/ai-runtime — so
 * they register into the one ProviderRegistry and stay governed by the runtime
 * (no duplicate provider framework). Each is a `ProviderSpec` describing the real
 * wire contract (URL, headers, request body, response + stream parsing) driven by
 * a shared `HttpAiProvider`. Request construction, response parsing, SSE
 * streaming, retries, timeout, cancellation, and usage accounting are
 * ADAPTER-VERIFIED against fakes and a real local server; LIVE invocation needs a
 * key + network (INFRA-PENDING).
 */
import type { AiMessage, AiProvider, AiRequest, AiResult, AiUsage } from '@neuropause/ai-runtime';
import type { Clock } from '@neuropause/cloud-core';
import { systemClock } from '@neuropause/cloud-core';
import { type HttpClient, HttpError, isRetryableStatus, sseData } from './http';
import { withRetry, withTimeout, DEFAULT_RETRY, type RetryPolicy } from './reliability';

export interface ProviderSpec {
  id: string;
  models: string[];
  defaultBaseUrl: string;
  /** No API key needed (e.g. a local Ollama). */
  keyless?: boolean;
  chatUrl(baseUrl: string, model: string, apiVersion?: string): string;
  headers(apiKey: string | undefined, extra?: Record<string, string>): Record<string, string>;
  body(request: AiRequest, stream: boolean, responseFormat?: 'json'): unknown;
  parseResult(json: Record<string, unknown>): { text: string; usage: AiUsage };
  /** A stream payload → text delta, or null to skip (e.g. `[DONE]`, non-text events). */
  parseStreamDelta(data: string): string | null;
  streamFormat: 'sse' | 'ndjson';
  modelsUrl?(baseUrl: string): string;
  parseModels?(json: Record<string, unknown>): string[];
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  extraHeaders?: Record<string, string>;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UsageLedger {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderHealth {
  ok: boolean;
  status: number;
  detail?: string;
}

function usageOf(u: { promptTokens?: number; completionTokens?: number }): AiUsage {
  const promptTokens = u.promptTokens ?? 0;
  const completionTokens = u.completionTokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export class HttpAiProvider implements AiProvider {
  readonly id: string;
  readonly models: string[];
  private readonly ledger: UsageLedger = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(
    private readonly spec: ProviderSpec,
    private readonly http: HttpClient,
    private readonly config: ProviderConfig = {},
    private readonly opts: { retry?: RetryPolicy; timeoutMs?: number; clock?: Clock } = {},
  ) {
    this.id = spec.id;
    this.models = spec.models;
  }

  private get baseUrl(): string {
    return this.config.baseUrl ?? this.spec.defaultBaseUrl;
  }

  private headers(): Record<string, string> {
    if (!this.spec.keyless && !this.config.apiKey) throw new Error(`provider '${this.id}' requires an API key`);
    return this.spec.headers(this.config.apiKey, this.config.extraHeaders);
  }

  /** Non-streaming generation — implements AiProvider.generate. */
  async generate(request: AiRequest, options: CallOptions = {}): Promise<AiResult> {
    const url = this.spec.chatUrl(this.baseUrl, request.model, this.config.apiVersion);
    const body = JSON.stringify(this.spec.body(request, false));
    const res = await withRetry(
      async () => {
        const r = await withTimeout(
          this.http.send({ method: 'POST', url, headers: this.headers(), body, ...(options.signal ? { signal: options.signal } : {}) }),
          options.timeoutMs ?? this.opts.timeoutMs ?? 60_000,
        );
        // Throw INSIDE the retry loop so a retryable status actually retries.
        if (!r.ok) throw new HttpError(r.status, r.body, `${this.id} generate failed`);
        return r;
      },
      {
        policy: this.opts.retry ?? DEFAULT_RETRY,
        shouldRetry: (e) => e instanceof HttpError && isRetryableStatus(e.status),
      },
    );
    const parsed = this.spec.parseResult(JSON.parse(res.body));
    this.account(parsed.usage);
    return { text: parsed.text, model: request.model, provider: this.id, usage: parsed.usage };
  }

  /** Streaming generation — yields text deltas as they arrive. */
  async *streamText(request: AiRequest, options: CallOptions = {}): AsyncIterable<string> {
    const url = this.spec.chatUrl(this.baseUrl, request.model, this.config.apiVersion);
    const body = JSON.stringify(this.spec.body(request, true));
    const stream = this.http.stream({ method: 'POST', url, headers: this.headers(), body, ...(options.signal ? { signal: options.signal } : {}) });
    if (this.spec.streamFormat === 'sse') {
      for await (const data of sseData(stream)) {
        const delta = this.spec.parseStreamDelta(data);
        if (delta) yield delta;
      }
    } else {
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of stream) {
        buf += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) {
            const delta = this.spec.parseStreamDelta(line);
            if (delta) yield delta;
          }
        }
      }
    }
  }

  /** Structured output: request JSON and parse it (falls back to raw text on non-JSON). */
  async generateStructured<T = unknown>(request: AiRequest, options: CallOptions = {}): Promise<{ json?: T; text: string; usage: AiUsage }> {
    const url = this.spec.chatUrl(this.baseUrl, request.model, this.config.apiVersion);
    const body = JSON.stringify(this.spec.body(request, false, 'json'));
    const res = await this.http.send({ method: 'POST', url, headers: this.headers(), body, ...(options.signal ? { signal: options.signal } : {}) });
    if (!res.ok) throw new HttpError(res.status, res.body, `${this.id} structured generate failed`);
    const parsed = this.spec.parseResult(JSON.parse(res.body));
    this.account(parsed.usage);
    let json: T | undefined;
    try {
      json = JSON.parse(parsed.text) as T;
    } catch {
      json = undefined;
    }
    return { ...(json !== undefined ? { json } : {}), text: parsed.text, usage: parsed.usage };
  }

  async discoverModels(): Promise<string[]> {
    if (!this.spec.modelsUrl || !this.spec.parseModels) return this.models;
    const res = await this.http.send({ method: 'GET', url: this.spec.modelsUrl(this.baseUrl), headers: this.headers() });
    if (!res.ok) throw new HttpError(res.status, res.body, `${this.id} model discovery failed`);
    return this.spec.parseModels(JSON.parse(res.body));
  }

  async health(): Promise<ProviderHealth> {
    const clock = this.opts.clock ?? systemClock;
    const url = this.spec.modelsUrl ? this.spec.modelsUrl(this.baseUrl) : this.spec.chatUrl(this.baseUrl, this.models[0] ?? 'model');
    try {
      void clock.now();
      const res = await this.http.send({ method: this.spec.modelsUrl ? 'GET' : 'OPTIONS', url, headers: this.headers() });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  usage(): UsageLedger {
    return { ...this.ledger };
  }

  private account(usage: AiUsage): void {
    this.ledger.calls += 1;
    this.ledger.promptTokens += usage.promptTokens;
    this.ledger.completionTokens += usage.completionTokens;
    this.ledger.totalTokens += usage.totalTokens;
  }
}

// ── provider specs ─────────────────────────────────────────────────────────

const openaiFamily = (id: string, defaultBaseUrl: string, models: string[], auth: (k?: string) => Record<string, string>): ProviderSpec => ({
  id,
  models,
  defaultBaseUrl,
  chatUrl: (base) => `${base}/chat/completions`,
  headers: (apiKey, extra) => ({ ...auth(apiKey), 'Content-Type': 'application/json', ...extra }),
  body: (request, stream, responseFormat) => ({
    model: request.model,
    messages: request.messages,
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
    ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
  }),
  parseResult: (json) => {
    const choice = (json.choices as Array<{ message?: { content?: string } }>)?.[0];
    const u = (json.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    return { text: choice?.message?.content ?? '', usage: usageOf({ promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 }) };
  },
  parseStreamDelta: (data) => {
    if (data === '[DONE]') return null;
    try {
      const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      return j.choices?.[0]?.delta?.content ?? null;
    } catch {
      return null;
    }
  },
  streamFormat: 'sse',
  modelsUrl: (base) => `${base}/models`,
  parseModels: (json) => (json.data as Array<{ id: string }>)?.map((m) => m.id) ?? [],
});

/** OpenAI (Chat Completions). */
export const OPENAI_SPEC = openaiFamily('openai', 'https://api.openai.com/v1', ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], (k) => ({
  Authorization: `Bearer ${k}`,
}));

/** OpenRouter (OpenAI-compatible aggregator). */
export const OPENROUTER_SPEC = openaiFamily('openrouter', 'https://openrouter.ai/api/v1', ['openrouter/auto'], (k) => ({ Authorization: `Bearer ${k}` }));

/** Anthropic (Messages API) — system is separated; auth via x-api-key. */
export const ANTHROPIC_SPEC: ProviderSpec = {
  id: 'anthropic',
  models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  chatUrl: (base) => `${base}/messages`,
  headers: (apiKey, extra) => ({ 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...extra }),
  body: (request, stream) => {
    const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const messages = request.messages.filter((m) => m.role !== 'system').map((m: AiMessage) => ({ role: m.role, content: m.content }));
    return { model: request.model, max_tokens: request.maxTokens ?? 1024, messages, ...(system ? { system } : {}), ...(stream ? { stream: true } : {}) };
  },
  parseResult: (json) => {
    const block = (json.content as Array<{ text?: string }>)?.[0];
    const u = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
    return { text: block?.text ?? '', usage: usageOf({ promptTokens: u.input_tokens ?? 0, completionTokens: u.output_tokens ?? 0 }) };
  },
  parseStreamDelta: (data) => {
    try {
      const j = JSON.parse(data) as { type?: string; delta?: { text?: string } };
      return j.type === 'content_block_delta' ? (j.delta?.text ?? null) : null;
    } catch {
      return null;
    }
  },
  streamFormat: 'sse',
};

/** Google Gemini (generateContent) — key via x-goog-api-key header (never the URL). */
export const GEMINI_SPEC: ProviderSpec = {
  id: 'google-gemini',
  models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  chatUrl: (base, model) => `${base}/models/${model}:generateContent`,
  headers: (apiKey, extra) => ({ 'x-goog-api-key': apiKey ?? '', 'Content-Type': 'application/json', ...extra }),
  body: (request) => ({
    contents: request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    ...(request.maxTokens !== undefined ? { generationConfig: { maxOutputTokens: request.maxTokens } } : {}),
  }),
  parseResult: (json) => {
    const text = (json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>)?.[0]?.content?.parts?.[0]?.text ?? '';
    const u = (json.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number };
    return { text, usage: usageOf({ promptTokens: u.promptTokenCount ?? 0, completionTokens: u.candidatesTokenCount ?? 0 }) };
  },
  parseStreamDelta: (data) => {
    try {
      const j = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return j.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch {
      return null;
    }
  },
  streamFormat: 'sse',
};

/** Azure OpenAI — deployment in the path, api-version in the query, key via api-key header. */
export const AZURE_OPENAI_SPEC: ProviderSpec = {
  id: 'azure-openai',
  models: ['gpt-4o', 'gpt-4o-mini'],
  defaultBaseUrl: 'https://YOUR-RESOURCE.openai.azure.com',
  chatUrl: (base, model, apiVersion) => `${base}/openai/deployments/${model}/chat/completions?api-version=${apiVersion ?? '2024-06-01'}`,
  headers: (apiKey, extra) => ({ 'api-key': apiKey ?? '', 'Content-Type': 'application/json', ...extra }),
  body: OPENAI_SPEC.body,
  parseResult: OPENAI_SPEC.parseResult,
  parseStreamDelta: OPENAI_SPEC.parseStreamDelta,
  streamFormat: 'sse',
};

/** Ollama (local, keyless) — NDJSON streaming. */
export const OLLAMA_SPEC: ProviderSpec = {
  id: 'ollama',
  models: ['llama3.1', 'qwen2.5', 'mistral'],
  defaultBaseUrl: 'http://localhost:11434',
  keyless: true,
  chatUrl: (base) => `${base}/api/chat`,
  headers: (_apiKey, extra) => ({ 'Content-Type': 'application/json', ...extra }),
  body: (request, stream) => ({ model: request.model, messages: request.messages, stream }),
  parseResult: (json) => {
    const u = json as { prompt_eval_count?: number; eval_count?: number; message?: { content?: string } };
    return { text: u.message?.content ?? '', usage: usageOf({ promptTokens: u.prompt_eval_count ?? 0, completionTokens: u.eval_count ?? 0 }) };
  },
  parseStreamDelta: (line) => {
    try {
      const j = JSON.parse(line) as { message?: { content?: string } };
      return j.message?.content ?? null;
    } catch {
      return null;
    }
  },
  streamFormat: 'ndjson',
  modelsUrl: (base) => `${base}/api/tags`,
  parseModels: (json) => (json.models as Array<{ name: string }>)?.map((m) => m.name) ?? [],
};

/** Every AI provider spec, keyed by id — the canonical, de-duplicated set. */
export const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  openai: OPENAI_SPEC,
  anthropic: ANTHROPIC_SPEC,
  'google-gemini': GEMINI_SPEC,
  'azure-openai': AZURE_OPENAI_SPEC,
  ollama: OLLAMA_SPEC,
  openrouter: OPENROUTER_SPEC,
};

export function createProvider(id: string, http: HttpClient, config?: ProviderConfig, opts?: { retry?: RetryPolicy; timeoutMs?: number; clock?: Clock }): HttpAiProvider {
  const spec = PROVIDER_SPECS[id];
  if (!spec) throw new Error(`unknown provider '${id}'`);
  return new HttpAiProvider(spec, http, config ?? {}, opts ?? {});
}

/**
 * Ollama model client. Talks to a local Ollama server (default
 * http://localhost:11434) over its native /api/chat endpoint. No API key, no
 * billing, no network beyond the machine — the model runs on-device. Token
 * counts come back from Ollama (prompt_eval_count / eval_count), so the Token
 * Tracker still works; cost is $0 because there is no per-token charge.
 *
 * Pure: no Electron, only fetch + types. Reachability is a call-time concern —
 * if the server isn't running, complete() throws a clear message and the engine
 * falls back deterministically.
 */
import type { ModelClient, ModelRequest, ModelResult } from './modelClient';

const DEFAULT_URL = 'http://localhost:11434';

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaResponse {
  model?: string;
  message?: { role?: string; content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export interface OllamaClientOptions {
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OllamaModelClient implements ModelClient {
  readonly provider = 'ollama';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OllamaClientOptions = {}) {
    const url = opts.baseUrl ?? process.env.NEUROPAUSE_OLLAMA_URL ?? DEFAULT_URL;
    this.baseUrl = url.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 120_000; // local models can be slow to load
  }

  /** Local server has no key; assume present and check reachability at call time. */
  isConfigured(): boolean {
    return true;
  }

  async complete(req: ModelRequest): Promise<ModelResult> {
    const messages: OllamaMessage[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const res = await this.post(req.model, messages, req.maxOutputTokens);
    const json = (await res.json()) as OllamaResponse;
    if (!res.ok || json.error) {
      throw new Error(`Ollama request failed: ${json.error ?? `HTTP ${res.status}`}`);
    }
    return {
      id: `ollama-${Date.now()}`,
      model: json.model ?? req.model,
      text: json.message?.content ?? '',
      inputTokens: json.prompt_eval_count ?? 0,
      outputTokens: json.eval_count ?? 0,
    };
  }

  private async post(model: string, messages: OllamaMessage[], maxOutputTokens: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, options: { num_predict: maxOutputTokens } }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new Error(`Ollama timed out after ${this.timeoutMs}ms (the model may be loading or too large).`);
      }
      throw new Error(`Could not reach Ollama at ${this.baseUrl} — is it running? Try: ollama serve`);
    } finally {
      clearTimeout(timer);
    }
  }
}

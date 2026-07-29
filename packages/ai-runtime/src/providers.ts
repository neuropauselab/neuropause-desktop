/**
 * Provider framework (NCEA 10.3, Phase 2). Providers are pluggable adapters that
 * register dynamically. This module ships the interface + a DETERMINISTIC FAKE
 * provider for tests. Real adapters (OpenAI, Anthropic, Google, Azure OpenAI,
 * Ollama, LM Studio, vLLM, OpenRouter) implement `AiProvider` but require API
 * keys + network and are NOT included here.
 */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  model: string;
  messages: AiMessage[];
  /** Explicit provider id; otherwise routed by model. */
  provider?: string;
  maxTokens?: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiResult {
  text: string;
  model: string;
  provider: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: string;
  readonly models: string[];
  generate(request: AiRequest): Promise<AiResult>;
}

/** Rough token estimate (chars/4) — real providers report exact usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Provider registry + model router (Phase 1: Model Router). */
export class ProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();

  register(provider: AiProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`provider '${provider.id}' already registered`);
    this.providers.set(provider.id, provider);
  }
  get(id: string): AiProvider | undefined {
    return this.providers.get(id);
  }
  list(): AiProvider[] {
    return [...this.providers.values()];
  }

  /** Route a request to a provider: explicit id, else first serving the model. */
  route(model: string, providerId?: string): AiProvider {
    if (providerId) {
      const p = this.providers.get(providerId);
      if (!p) throw new Error(`provider '${providerId}' is not registered`);
      return p;
    }
    for (const p of this.providers.values()) {
      if (p.models.includes(model)) return p;
    }
    throw new Error(`no registered provider serves model '${model}'`);
  }
}

/**
 * Deterministic fake provider for tests and offline development. It never calls a
 * network. Reply defaults to an echo; token usage is estimated from lengths.
 */
export class FakeProvider implements AiProvider {
  readonly id: string;
  readonly models: string[];
  private readonly reply: (request: AiRequest) => string;

  constructor(
    id = 'fake',
    models: string[] = ['fake-1'],
    reply?: (request: AiRequest) => string,
  ) {
    this.id = id;
    this.models = models;
    this.reply = reply ?? ((r) => `echo: ${r.messages[r.messages.length - 1]?.content ?? ''}`);
  }

  async generate(request: AiRequest): Promise<AiResult> {
    const text = this.reply(request);
    const promptTokens = estimateTokens(request.messages.map((m) => m.content).join(' '));
    const completionTokens = estimateTokens(text);
    return {
      text,
      model: request.model,
      provider: this.id,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }
}

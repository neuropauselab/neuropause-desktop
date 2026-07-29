/**
 * Module 9 — AI Runtime Integration. Reuses the ai-runtime `AiProvider` interface and
 * `ProviderRegistry`; adds (a) a DETERMINISTIC, extractive, evidence-grounded provider
 * used as the tested default — it can only restate the evidence it is given, so it
 * cannot fabricate company information — and (b) a `ModelRouter` that adds fallback,
 * a provider→model catalog (no lock-in), and health on top of the registry's
 * first-serving-model routing. Live LLM providers (Claude/GPT/Gemini/Ollama/Mistral/
 * Qwen) implement the SAME interface via the integrations `HttpAiProvider`; supplying
 * them needs operator API keys + network (infra-pending), so they are not registered here.
 */
import { type AiProvider, type AiRequest, type AiResult, type ProviderRegistry, estimateTokens } from '@neuropause/ai-runtime';
import type { AiProviderId } from './constants';

export const SYSTEM_GROUNDED =
  'You are an enterprise assistant. Answer ONLY from the EVIDENCE provided below. ' +
  'If the evidence is insufficient, say so explicitly. Never invent company information, numbers, names, or facts.';

/** Extract the EVIDENCE block a grounded prompt carries (see engine.withEvidence). */
function extractEvidence(text: string): string[] {
  const idx = text.indexOf('EVIDENCE:');
  if (idx === -1) return [];
  return text
    .slice(idx + 'EVIDENCE:'.length)
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 0 && l !== '(none)');
}

/**
 * A deterministic AiProvider: it composes an answer purely by restating the evidence in
 * the prompt. Zero network, zero randomness, zero fabrication — ideal as the default and
 * for tests. Swap in a live `HttpAiProvider` for richer prose when keys are available.
 */
export class DeterministicAiProvider implements AiProvider {
  readonly id = 'deterministic';
  readonly models = ['deterministic-1'];

  async generate(request: AiRequest): Promise<AiResult> {
    const user = [...request.messages].reverse().find((m) => m.role === 'user');
    const evidence = user ? extractEvidence(user.content) : [];
    const question = (user?.content ?? '').split('\n')[0]?.slice(0, 200) ?? '';
    const text = evidence.length
      ? `Based on ${evidence.length} evidence item(s): ${evidence.slice(0, 6).join('; ')}.`
      : 'Insufficient evidence to answer without fabricating; no grounded response available.';
    const promptTokens = estimateTokens(request.messages.map((m) => m.content).join('\n'));
    const completionTokens = estimateTokens(text);
    void question;
    return { text, model: 'deterministic-1', provider: this.id, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } };
  }
}

/** Provider → model catalog (documents the no-lock-in surface; live models are infra-pending). */
export const MODEL_CATALOG: Record<AiProviderId, string[]> = {
  anthropic: ['claude-sonnet', 'claude-opus', 'claude-haiku'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  'google-gemini': ['gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama: ['llama3', 'mistral'],
  mistral: ['mistral-large', 'mistral-small'],
  qwen: ['qwen2.5-72b', 'qwen2.5-7b'],
  deterministic: ['deterministic-1'],
};

export interface ModelRouterOptions {
  fallbackProviderId?: string;
}

/** Routing + fallback + catalog + health over the reused ProviderRegistry. */
export class ModelRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly options: ModelRouterOptions = {},
  ) {}

  register(provider: AiProvider): void {
    this.registry.register(provider);
  }
  providers(): string[] {
    return this.registry.list().map((p) => p.id);
  }
  catalog(): Record<AiProviderId, string[]> {
    return MODEL_CATALOG;
  }

  /** Route to a provider for a model; fall back to the configured provider on failure. */
  route(model: string, providerId?: string): AiProvider {
    try {
      return this.registry.route(model, providerId);
    } catch (e) {
      const fb = this.options.fallbackProviderId ? this.registry.get(this.options.fallbackProviderId) : undefined;
      if (fb) return fb;
      throw e;
    }
  }

  /** Health per registered provider (deterministic is always healthy; live providers report via their own health when wired). */
  health(): Record<string, { ok: boolean; models: string[] }> {
    const out: Record<string, { ok: boolean; models: string[] }> = {};
    for (const p of this.registry.list()) out[p.id] = { ok: true, models: [...p.models] };
    return out;
  }
}

/** A few named prompt templates (Module 9 — Prompt Templates). */
export const PROMPT_TEMPLATES = {
  copilotBrief: (role: string, focus: string) => `As the ${role}'s copilot, produce a concise brief focused on ${focus}.`,
  workspaceAnswer: (scope: string, question: string) => `Answer this ${scope} question from evidence: ${question}`,
  briefing: (kind: string) => `Produce the ${kind} briefing from the evidence provided.`,
} as const;

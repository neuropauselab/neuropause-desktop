/**
 * Provider factory. The single place the LLM provider is chosen, so the rest of
 * the app never names a model or a provider. Selection is by environment
 * variable:
 *
 *   NEUROPAUSE_LLM_PROVIDER = 'claude' (default) | 'ollama'
 *   NEUROPAUSE_OLLAMA_MODEL = local model tag (default 'llama3.1')
 *   NEUROPAUSE_OLLAMA_URL   = Ollama base URL (default http://localhost:11434)
 *   ANTHROPIC_API_KEY       = required when provider is 'claude'
 *
 * Adding GPT/Gemini later is one more branch here plus one adapter — the engine,
 * the workers, and every other module are untouched.
 */
import { ModelRouter } from './modelRouter';
import { ClaudeModelClient } from './claudeClient';
import { OllamaModelClient } from './ollamaClient';

export type LlmProvider = 'claude' | 'ollama';

export function resolveProvider(): LlmProvider {
  return process.env.NEUROPAUSE_LLM_PROVIDER === 'ollama' ? 'ollama' : 'claude';
}

export function createModelRouter(): ModelRouter {
  if (resolveProvider() === 'ollama') {
    const model = process.env.NEUROPAUSE_OLLAMA_MODEL ?? 'llama3.1';
    // All tiers map to the one local model; override per-tier here later if wanted.
    return new ModelRouter({
      client: new OllamaModelClient(),
      models: { fast: model, balanced: model, deep: model },
    });
  }
  return new ModelRouter({ client: new ClaudeModelClient() });
}

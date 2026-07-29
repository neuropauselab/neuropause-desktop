/**
 * ProviderManager — the single place a ModelClient/ModelRouter is constructed.
 * It resolves "which provider, which model, with which key" from one precedence
 * order: stored config (AiConfigStore) > environment > built-in default. The
 * Anthropic key is read from the Secure Vault (credentialStore), falling back to
 * the environment. Secrets are passed straight into the client and never logged.
 *
 * Backward compatibility: with no stored config and no Vault key, every path here
 * reproduces the historical env-only behaviour of provider.ts exactly.
 */
import { credentialStore } from '../security/secureStore';
import { loadAiConfig, type AiConfig, type AiProviderId } from './aiConfigStore';
import { ModelRouter } from './modelRouter';
import { ClaudeModelClient } from './claudeClient';
import { OllamaModelClient } from './ollamaClient';

const DEFAULT_OLLAMA_MODEL = 'llama3.1';

/** Vault key under which the Anthropic API key is stored. */
export const ANTHROPIC_CREDENTIAL_ID = 'anthropic';

export type ProviderSource = 'config' | 'env' | 'default';

/** Effective provider id with precedence stored-config > env > default('claude'). */
export function resolveProviderId(): { provider: AiProviderId; source: ProviderSource } {
  const cfg = loadAiConfig();
  if (cfg.provider) return { provider: cfg.provider, source: 'config' };
  if (process.env.NEUROPAUSE_LLM_PROVIDER === 'ollama') return { provider: 'ollama', source: 'env' };
  return { provider: 'claude', source: 'default' };
}

function ollamaRouter(cfg: AiConfig): ModelRouter {
  const model = cfg.model ?? process.env.NEUROPAUSE_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const baseUrl = cfg.ollamaUrl ?? process.env.NEUROPAUSE_OLLAMA_URL ?? null;
  return new ModelRouter({
    client: new OllamaModelClient(baseUrl ? { baseUrl } : {}),
    models: { fast: model, balanced: model, deep: model },
  });
}

function claudeRouter(cfg: AiConfig, apiKey: string): ModelRouter {
  // A user-selected model overrides all tiers; otherwise the tiered defaults stand.
  const models = cfg.model ? { fast: cfg.model, balanced: cfg.model, deep: cfg.model } : undefined;
  return new ModelRouter({ client: new ClaudeModelClient({ apiKey }), models });
}

/**
 * Full router — ASYNC, config + Vault aware. This is the single construction site
 * the EngineManager uses to (re)configure the running engine. Precedence: stored
 * config > env > default; the Anthropic key is Vault > env.
 */
export async function buildModelRouter(): Promise<ModelRouter> {
  const cfg = loadAiConfig();
  const { provider } = resolveProviderId();
  if (provider === 'ollama') return ollamaRouter(cfg);
  const apiKey = (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ?? process.env.ANTHROPIC_API_KEY ?? '';
  return claudeRouter(cfg, apiKey);
}

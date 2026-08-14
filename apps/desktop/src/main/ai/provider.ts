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
 * This module is deliberately PURE (no Electron): it is the synchronous, env-only
 * boot path used at engine construction. Config- and Vault-aware construction (the
 * runtime path) lives in providerManager.buildModelRouter().
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

/**
 * P13C ROUND 35 — D-4. THE BOOT ROUTER FAILS CLOSED.
 *
 * The engine singleton is constructed at module import, before the config file,
 * the Secure Vault, the consent flag, or the tenant preference have been read —
 * so NOTHING the routing policy depends on is knowable yet. The old boot router
 * was `createModelRouter()` above: a BARE cloud client reading the env key
 * directly. For a Private First product that made the designed boot failure
 * mode "unbounded external routing with no mode, no consent, and no plan" —
 * and a failed reconfigure kept it for the life of the process.
 *
 * This router is the fail-closed replacement. Its client is never configured,
 * so `AiEngine.run()` takes its EXISTING deterministic-fallback path (audit
 * outcome 'fallback', routing stamped 'none'): no request leaves the machine,
 * nothing invents a tenant or a policy, and the answer says why. The window
 * closes when `engineManager.init()` swaps in the real config/Vault/preference-
 * aware router from `providerManager.buildModelRouter()` — after which behavior
 * is exactly what it was before this change.
 *
 * `createModelRouter()` above is kept for the manual smoke script and its
 * tests; it is no longer the boot path.
 */
export function createBootRouter(): ModelRouter {
  return new ModelRouter({
    client: {
      provider: 'booting',
      isConfigured: () => false,
      complete: () => {
        // Defense in depth: unreachable through AiEngine.run (which checks
        // isConfigured first), and fail-closed for any future direct caller.
        return Promise.reject(
          new Error('AI routing is still initializing. Try again in a moment.'),
        );
      },
    },
  });
}

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
import type { AiRouteCandidate } from '@neuropause/shared';
import { classifyEndpointLocation, planRoute, resolveEffectiveAiMode } from '@neuropause/shared';
import { credentialStore } from '../security/secureStore';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { loadAiConfig, resolveAiMode, type AiConfig, type AiProviderId } from './aiConfigStore';
import { ModelRouter } from './modelRouter';
import { ClaudeModelClient } from './claudeClient';
import { OpenAiModelClient } from './openaiClient';
import { OllamaModelClient } from './ollamaClient';
import { PrivateFirstClient, type BoundRoute } from './privateFirstClient';

const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

/** Vault key under which the Anthropic API key is stored. */
export const ANTHROPIC_CREDENTIAL_ID = 'anthropic';
/** Vault key under which the OpenAI API key is stored (round 34). */
export const OPENAI_CREDENTIAL_ID = 'openai';

/** The stored cloud key for a provider, falling back to its env variable. */
async function cloudKeyFor(provider: 'anthropic' | 'openai'): Promise<string> {
  if (provider === 'openai') {
    return (await credentialStore.getSecret(OPENAI_CREDENTIAL_ID)) ?? process.env.OPENAI_API_KEY ?? '';
  }
  return (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ?? process.env.ANTHROPIC_API_KEY ?? '';
}

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
 * Legacy single-provider construction, kept verbatim for the `external` mode
 * path (a user whose provider IS the cloud) and for tests that exercise it.
 */
export async function buildSingleProviderRouter(): Promise<ModelRouter> {
  const cfg = loadAiConfig();
  const { provider } = resolveProviderId();
  if (provider === 'ollama') return ollamaRouter(cfg);
  if (provider === 'openai') {
    const key = await cloudKeyFor('openai');
    const models = cfg.model
      ? { fast: cfg.model, balanced: cfg.model, deep: cfg.model }
      : { fast: DEFAULT_OPENAI_MODEL, balanced: DEFAULT_OPENAI_MODEL, deep: DEFAULT_OPENAI_MODEL };
    return new ModelRouter({ client: new OpenAiModelClient({ apiKey: key }), models });
  }
  const apiKey = await cloudKeyFor('anthropic');
  return claudeRouter(cfg, apiKey);
}

/* ── Private First ─────────────────────────────────────────────────────────── */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function ollamaEndpoint(cfg: AiConfig): string {
  return cfg.ollamaUrl ?? process.env.NEUROPAUSE_OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
}

function ollamaModel(cfg: AiConfig): string {
  return cfg.model ?? process.env.NEUROPAUSE_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}

/**
 * The candidate routes THIS install could take, from real configuration:
 * the Ollama endpoint (classified local vs private infrastructure by where it
 * points) and Anthropic (external; a candidate only when a key exists, enabled
 * only under explicit consent or explicit `external` mode).
 *
 * One assembly site, used by BOTH the router construction and the Settings /
 * routing-status surface — so what Settings shows and what a request does can
 * never be two different computations.
 */
export async function assembleRouteCandidates(): Promise<{
  cfg: AiConfig;
  mode: AiModeResolved;
  candidates: AiRouteCandidate[];
}> {
  const cfg = loadAiConfig();
  const { provider } = resolveProviderId();
  const platformMode = resolveAiMode(cfg, provider);
  /**
   * P13C ROUND 34 — THE TENANT PREFERENCE FINALLY REACHES THE ROUTER (D-1).
   *
   * `resolveEffectiveAiMode` — `min(platform, tenant)`, the law proven
   * exhaustively by round17TenantAiPreference.test.ts — existed for seventeen
   * rounds while nothing on the REQUEST path ever called it: onboarding wrote
   * the row, Settings displayed it, and every completion routed on the
   * platform mode alone. A fresh install with an env API key routed to
   * api.anthropic.com after the user chose "On this device".
   *
   * The clamp lives HERE because this function is the single assembly site
   * shared by the router construction AND the Settings/routing-status surface
   * (see the header above) — so what Settings shows and what a request does
   * remain one computation, now including the tenant's choice. `mine()` reads
   * the ambient tenant scope; with no resolved tenant or no row it is null
   * and the platform mode stands, exactly as before D-5 existed.
   *
   * Freshness: the engine reconfigures on `ai:preference.set` and on every
   * workspace switch (engineManager), so the clamp follows the active tenant.
   */
  const pref = tenantAiPreferenceStore.mine();
  const mode = pref === null ? platformMode : resolveEffectiveAiMode(platformMode, pref.mode);
  const endpoint = ollamaEndpoint(cfg);
  const anthropicKey = await cloudKeyFor('anthropic');
  const openaiKey = await cloudKeyFor('openai');

  const externalEnabled = mode === 'external' ? true : cfg.externalConsent;
  // The Ollama route is a candidate only when there is EVIDENCE the user means
  // to have one: they selected the provider, set an endpoint, set the env vars,
  // or made an explicit mode choice — the first-run privacy step, whether it
  // landed in the platform config (`cfg.mode`) or, since Round 34, in the
  // tenant preference row. Without any of that, a legacy claude-only install
  // keeps its exact pre-mode behaviour — no key still means "needs setup",
  // not a surprise localhost attempt.
  const ollamaIntended =
    cfg.provider === 'ollama' ||
    cfg.ollamaUrl !== null ||
    cfg.mode !== null ||
    pref !== null ||
    process.env.NEUROPAUSE_LLM_PROVIDER === 'ollama' ||
    Boolean(process.env.NEUROPAUSE_OLLAMA_URL);
  const anthropicCandidate: AiRouteCandidate = {
    provider: 'anthropic',
    location: 'external',
    // Explicit model override only applies to the provider the user chose it
    // for; the external fallback uses the balanced default otherwise.
    model: cfg.provider === 'claude' && cfg.model ? cfg.model : 'claude-sonnet-4-6',
    endpoint: 'api.anthropic.com',
    configured: anthropicKey.length > 0,
    enabled: externalEnabled,
  };
  const openaiCandidate: AiRouteCandidate = {
    provider: 'openai',
    location: 'external',
    model: cfg.provider === 'openai' && cfg.model ? cfg.model : DEFAULT_OPENAI_MODEL,
    endpoint: 'api.openai.com',
    configured: openaiKey.length > 0,
    enabled: externalEnabled,
  };
  // In `external` mode planRoute's sort is stable within a location, so array
  // order decides WHICH cloud provider leads: the user's explicit selection
  // first, the other as fallback. Everywhere else the locals lead anyway.
  const externals =
    cfg.provider === 'openai' ? [openaiCandidate, anthropicCandidate] : [anthropicCandidate, openaiCandidate];
  const candidates: AiRouteCandidate[] = [
    {
      provider: 'ollama',
      location: classifyEndpointLocation(endpoint),
      model: ollamaModel(cfg),
      endpoint,
      // Address-configured when intended; reachability is an execution-time
      // question the composite answers by trying it.
      configured: ollamaIntended,
      enabled: true,
    },
    ...externals,
  ];
  return { cfg, mode, candidates };
}

export type AiModeResolved = ReturnType<typeof resolveAiMode>;

/**
 * Full router — ASYNC, config + Vault aware. The single construction site the
 * EngineManager uses to (re)configure the running engine.
 *
 * Every mode now routes through the Private First composite so that EVERY
 * completion carries execution-stamped routing metadata:
 *   • `private_first` — local → private infrastructure → external-with-consent.
 *   • `local_only`    — the external candidate is excluded by the planner; a
 *                       request with no private route FAILS on this device.
 *   • `external`      — the user's explicit provider leads (their pre-mode
 *                       behaviour, preserved exactly), locals as fallback.
 */
export async function buildModelRouter(): Promise<ModelRouter> {
  const { cfg, mode, candidates } = await assembleRouteCandidates();
  const plan = planRoute(mode, candidates);

  // Each cloud client is bound with its own real key; Ollama needs none.
  const anthropicKey = await cloudKeyFor('anthropic');
  const openaiKey = await cloudKeyFor('openai');
  const routes: BoundRoute[] = plan.attempts.map((candidate) => {
    if (candidate.provider === 'anthropic') {
      return { candidate, client: new ClaudeModelClient({ apiKey: anthropicKey }) };
    }
    if (candidate.provider === 'openai') {
      return { candidate, client: new OpenAiModelClient({ apiKey: openaiKey }) };
    }
    return {
      candidate,
      client: new OllamaModelClient({ baseUrl: candidate.endpoint ?? DEFAULT_OLLAMA_URL }),
    };
  });

  const composite = new PrivateFirstClient({ routes, mode, refusal: plan.refusal });
  // Tier→model mapping is owned per-route by the composite (each candidate
  // carries its own model), so the router maps every tier to the first
  // candidate's model purely for display/audit defaults.
  const model = plan.attempts[0]?.model ?? cfg.model ?? 'none';
  return new ModelRouter({
    client: composite,
    models: { fast: model, balanced: model, deep: model },
  });
}

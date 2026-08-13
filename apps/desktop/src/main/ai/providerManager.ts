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
import { classifyEndpointLocation, planRoute } from '@neuropause/shared';
import { credentialStore } from '../security/secureStore';
import { loadAiConfig, resolveAiMode, type AiConfig, type AiProviderId } from './aiConfigStore';
import { ModelRouter } from './modelRouter';
import { ClaudeModelClient } from './claudeClient';
import { OllamaModelClient } from './ollamaClient';
import { PrivateFirstClient, type BoundRoute } from './privateFirstClient';

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
 * Legacy single-provider construction, kept verbatim for the `external` mode
 * path (a user whose provider IS the cloud) and for tests that exercise it.
 */
export async function buildSingleProviderRouter(): Promise<ModelRouter> {
  const cfg = loadAiConfig();
  const { provider } = resolveProviderId();
  if (provider === 'ollama') return ollamaRouter(cfg);
  const apiKey = (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ?? process.env.ANTHROPIC_API_KEY ?? '';
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
  const mode = resolveAiMode(cfg, provider);
  const endpoint = ollamaEndpoint(cfg);
  const apiKey = (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ?? process.env.ANTHROPIC_API_KEY ?? '';

  const externalEnabled = mode === 'external' ? true : cfg.externalConsent;
  // The Ollama route is a candidate only when there is EVIDENCE the user means
  // to have one: they selected the provider, set an endpoint, set the env vars,
  // or made an explicit mode choice (the first-run privacy step). Without any
  // of that, a legacy claude-only install keeps its exact pre-mode behaviour —
  // no key still means "needs setup", not a surprise localhost attempt.
  const ollamaIntended =
    cfg.provider === 'ollama' ||
    cfg.ollamaUrl !== null ||
    cfg.mode !== null ||
    process.env.NEUROPAUSE_LLM_PROVIDER === 'ollama' ||
    Boolean(process.env.NEUROPAUSE_OLLAMA_URL);
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
    {
      provider: 'anthropic',
      location: 'external',
      // Explicit model override only applies to the provider the user chose it
      // for; the external fallback uses the balanced default otherwise.
      model: cfg.provider === 'claude' && cfg.model ? cfg.model : 'claude-sonnet-4-6',
      endpoint: 'api.anthropic.com',
      configured: apiKey.length > 0,
      enabled: externalEnabled,
    },
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

  const bind = (candidate: AiRouteCandidate): BoundRoute => ({
    candidate,
    client:
      candidate.provider === 'ollama'
        ? new OllamaModelClient({ baseUrl: candidate.endpoint ?? DEFAULT_OLLAMA_URL })
        : new ClaudeModelClient({ apiKey: '' }),
  });

  // The Anthropic client needs the real key; rebuild its binding with it.
  const apiKey = (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ?? process.env.ANTHROPIC_API_KEY ?? '';
  const routes: BoundRoute[] = plan.attempts.map((candidate) =>
    candidate.provider === 'anthropic'
      ? { candidate, client: new ClaudeModelClient({ apiKey }) }
      : bind(candidate),
  );

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

/**
 * AI configuration IPC — read-only surface (M5). Exposes the current, NON-SECRET
 * AI runtime state to the renderer: the effective provider/model, whether the
 * engine is configured, whether a key is stored (never the key itself), provider
 * health, and local-Ollama detection. Follows the standard SecureHandlerDef
 * registration pattern; writes (set provider/model/credential, test) arrive in M6.
 */
import {
  EmptyRequest,
  IpcChannel,
  AiPreferenceSetRequest,
  AiSetProviderRequest,
  AiSetModelRequest,
  AiSetCredentialRequest,
  AiClearCredentialRequest,
  AiSetExternalConsentRequest,
  AiSetModeRequest,
  AiTestRequest,
  planRoute,
} from '@neuropause/shared';
import type {
  AiConfigDto,
  AiHealthDto,
  AiRouteStatus,
  AiRoutingStatusView,
  AiRoutingUsage,
  OllamaDetectDto,
  AiTestResultDto,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { withAiAuthz } from './aiAuthzGate';
import { tenantAiPreferenceStore } from './tenantAiPreferenceInstance';
import { aiPreferenceView } from './tenantAiPreferenceView';
import { declareChannelResource } from '../ipc/channelResource';

/**
 * CHANNEL → STORE. P13C ROUND 17.
 *
 * The mechanism landed in Round 13 and shipped with no production declarations
 * — the "coverage partial" line in five consecutive reports. These are the
 * first two, and they are the right pair to open with: a channel reaching a
 * CUSTOMER_DERIVED, TENANT-scoped store is exactly the shape the rule set was
 * written to police.
 */
declareChannelResource({
  channel: IpcChannel.AiPreferenceGet,
  store: 'tenant-ai-preference',
  effect: 'read',
  reason:
    "Returns the active organization's own AI preference composed against platform policy. " +
    'Ambient scope is the only selector; the channel accepts no target id.',
});
declareChannelResource({
  channel: IpcChannel.AiPreferenceSet,
  store: 'tenant-ai-preference',
  effect: 'mutate',
  reason:
    "Upserts the active organization's own preference row. It cannot widen platform policy: " +
    "the request enum has no 'external' member.",
});
import { engineManager } from './engineManager';
import { loadAiConfig, resolveAiMode, saveAiConfig } from './aiConfigStore';
import { credentialStore } from '../security/secureStore';
import { assembleRouteCandidates, resolveProviderId, ANTHROPIC_CREDENTIAL_ID } from './providerManager';
import { routingUsageStore } from './routingUsageInstance';
import { validateClaudeKey, validateOllama } from './connectionValidator';
import { migrationStatus, migrateFromEnv, resetToEnvironment } from './migrationManager';
import { ollamaProbe } from '../platform/aiHealthProbes';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function ollamaBaseUrl(): string {
  return loadAiConfig().ollamaUrl ?? process.env.NEUROPAUSE_OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
}

/** Current AI configuration — secret-free (only whether a key is stored). */
export async function getConfig(): Promise<AiConfigDto> {
  const cfg = loadAiConfig();
  const { provider, source } = resolveProviderId();
  const status = engineManager.status();
  // The renderer's question is "is a cloud key stored?", which does not depend
  // on which provider is currently selected — the Private First fallback uses
  // the key regardless of the selected provider.
  const hasStoredKey = await credentialStore.hasSecret(ANTHROPIC_CREDENTIAL_ID);
  return {
    provider,
    model: cfg.model,
    configured: status.configured,
    hasStoredKey,
    state: status.state,
    source,
    mode: resolveAiMode(cfg, provider),
    externalConsent: cfg.externalConsent,
  };
}

/** Persist the AI mode and hot-reconfigure routing. */
async function setMode(req: AiSetModeRequest): Promise<AiConfigDto> {
  saveAiConfig({ mode: req.mode });
  await engineManager.reconfigure();
  return getConfig();
}

/** Record external-processing consent and hot-reconfigure routing. */
async function setExternalConsent(req: AiSetExternalConsentRequest): Promise<AiConfigDto> {
  saveAiConfig({ externalConsent: req.consent });
  await engineManager.reconfigure();
  return getConfig();
}

/**
 * The live routing picture, computed by the SAME candidate assembly and the
 * SAME planner a request uses — so what Settings shows and what a request does
 * can never be two different computations. The Ollama route's `connected` /
 * `unreachable` state is a real probe, not the configuration's opinion.
 */
export async function routingStatus(): Promise<AiRoutingStatusView> {
  const { cfg, mode, candidates } = await assembleRouteCandidates();
  const plan = planRoute(mode, candidates);

  const routes: AiRouteStatus[] = [];
  for (const candidate of candidates) {
    let state: AiRouteStatus['state'];
    let detail: string;
    if (!candidate.configured) {
      state = 'not_configured';
      detail =
        candidate.provider === 'anthropic'
          ? 'No API key stored. Add one in Settings → AI to make this route available.'
          : 'Not configured.';
    } else if (!candidate.enabled && candidate.location === 'external') {
      state = 'disabled';
      detail = 'Configured, but external processing is not enabled. Requests will not use this route.';
    } else if (candidate.provider === 'ollama') {
      const probe = await detectOllama();
      state = probe.reachable ? 'connected' : 'unreachable';
      detail = probe.reachable
        ? `Reachable · ${probe.models.length} model${probe.models.length === 1 ? '' : 's'} installed`
        : 'Not reachable right now. Start it with: ollama serve';
    } else {
      state = 'connected';
      detail = 'API key stored in the Secure Vault.';
    }
    routes.push({
      location: candidate.location,
      provider: candidate.provider,
      label: candidate.provider === 'ollama' ? 'Ollama' : 'Anthropic Claude',
      state,
      detail,
      model: candidate.model,
      endpoint: candidate.endpoint,
    });
  }

  return { mode, externalConsent: cfg.externalConsent, routes, plan };
}

/** Measured routing usage. Counts only — the UI derives any percentages. */
export async function routingUsage(): Promise<AiRoutingUsage> {
  await routingUsageStore.load();
  return routingUsageStore.snapshot();
}

/** Passive provider health (no network for Claude; a reachability probe for Ollama). */
export async function getHealth(): Promise<AiHealthDto> {
  const { provider } = resolveProviderId();
  if (provider === 'ollama') {
    const check = await ollamaProbe({ baseUrl: ollamaBaseUrl() })();
    return {
      status: check.status as AiHealthDto['status'],
      detail: check.detail ?? '',
      latencyMs: check.latencyMs ?? null,
    };
  }
  const configured = engineManager.status().configured;
  return configured
    ? { status: 'ok', detail: 'Anthropic API key configured', latencyMs: null }
    : { status: 'down', detail: 'No Anthropic API key configured', latencyMs: null };
}

/** Detect a local Ollama server and list its installed models (best-effort, time-boxed). */
export async function detectOllama(): Promise<OllamaDetectDto> {
  const baseUrl = ollamaBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { reachable: false, models: [] };
    const body = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string }> };
    const models = Array.isArray(body.models)
      ? body.models.map((m) => m.name ?? '').filter((n): n is string => n.length > 0)
      : [];
    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Persist the provider choice and hot-reconfigure the engine. Returns the secret-free DTO. */
async function setProvider(req: AiSetProviderRequest): Promise<AiConfigDto> {
  saveAiConfig({ provider: req.provider });
  await engineManager.reconfigure();
  return getConfig();
}

/** Persist a model override ('' clears it) and hot-reconfigure. */
async function setModel(req: AiSetModelRequest): Promise<AiConfigDto> {
  const model = req.model.trim();
  saveAiConfig({ model: model.length > 0 ? model : null });
  await engineManager.reconfigure();
  return getConfig();
}

/** Store a provider API key in the Secure Vault and hot-reconfigure. The key is never logged. */
async function setCredential(req: AiSetCredentialRequest): Promise<AiConfigDto> {
  await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, req.secret);
  await engineManager.reconfigure();
  return getConfig();
}

/** Remove a provider API key from the Vault and hot-reconfigure. */
async function clearCredential(_req: AiClearCredentialRequest): Promise<AiConfigDto> {
  await credentialStore.deleteSecret(ANTHROPIC_CREDENTIAL_ID);
  await engineManager.reconfigure();
  return getConfig();
}

/** Validate a candidate provider/key WITHOUT persisting it (Settings "Test" button). */
async function testConnection(req: AiTestRequest): Promise<AiTestResultDto> {
  if (req.provider === 'ollama') return validateOllama(ollamaBaseUrl());
  const key =
    req.secret ||
    (await credentialStore.getSecret(ANTHROPIC_CREDENTIAL_ID)) ||
    process.env.ANTHROPIC_API_KEY ||
    '';
  return validateClaudeKey(key);
}

export interface AiConfigSubsystem {
  handlers: SecureHandlerDef[];
}

export function initAiConfig(): AiConfigSubsystem {
  /**
   * P13C ROUND 9 — F21. Authority is stamped from `AI_CHANNEL_AUTHORITY`, which
   * throws for any `aiConfig:*` / `ai:config.*` / `ai:routing.*` channel it does
   * not classify. The resource behind the writes is ONE install-wide config file
   * plus ONE vault entry, so the writes take `cloud:operate` — an authority no
   * organization role can hold — and the posture reads stay open.
   */
  return {
    handlers: withAiAuthz([
      { channel: IpcChannel.AiConfigGet, schema: EmptyRequest, handler: () => getConfig() },
      /**
       * P13C ROUND 17 · D-5 — the ORGANISATION's preference, beside the
       * platform's config on purpose: the contrast is the point. Everything
       * else in this array that writes takes `cloud:operate`. These two take
       * `org:read` / `org:manage`, because a tenant preference can only narrow
       * what the platform already permits and therefore is not a platform act.
       *
       * Neither accepts a target id, so ambient scope is the only selector and
       * organization B has no parameter with which to address organization A.
       */
      { channel: IpcChannel.AiPreferenceGet, schema: EmptyRequest, handler: () => aiPreferenceView() },
      {
        channel: IpcChannel.AiPreferenceSet,
        schema: AiPreferenceSetRequest,
        audit: true,
        handler: async (p) => {
          await tenantAiPreferenceStore.setMine((p as AiPreferenceSetRequest).mode);
          return aiPreferenceView();
        },
      },
      { channel: IpcChannel.AiConfigHealth, schema: EmptyRequest, handler: () => getHealth() },
      { channel: IpcChannel.AiConfigDetectOllama, schema: EmptyRequest, handler: () => detectOllama() },
      {
        channel: IpcChannel.AiConfigSetProvider,
        schema: AiSetProviderRequest,
        handler: (p) => setProvider(p as AiSetProviderRequest),
      },
      {
        channel: IpcChannel.AiConfigSetModel,
        schema: AiSetModelRequest,
        handler: (p) => setModel(p as AiSetModelRequest),
      },
      {
        channel: IpcChannel.AiConfigSetCredential,
        schema: AiSetCredentialRequest,
        audit: true,
        handler: (p) => setCredential(p as AiSetCredentialRequest),
      },
      {
        channel: IpcChannel.AiConfigClearCredential,
        schema: AiClearCredentialRequest,
        audit: true,
        handler: (p) => clearCredential(p as AiClearCredentialRequest),
      },
      { channel: IpcChannel.AiConfigTest, schema: AiTestRequest, handler: (p) => testConnection(p as AiTestRequest) },
      {
        // Mode changes are audited: "when did requests start being allowed to
        // leave the device" is a question the audit trail must answer.
        channel: IpcChannel.AiConfigSetMode,
        schema: AiSetModeRequest,
        audit: true,
        handler: (p) => setMode(p as AiSetModeRequest),
      },
      {
        channel: IpcChannel.AiConfigSetExternalConsent,
        schema: AiSetExternalConsentRequest,
        audit: true,
        handler: (p) => setExternalConsent(p as AiSetExternalConsentRequest),
      },
      { channel: IpcChannel.AiRoutingStatus, schema: EmptyRequest, handler: () => routingStatus() },
      { channel: IpcChannel.AiRoutingUsage, schema: EmptyRequest, handler: () => routingUsage() },
      { channel: IpcChannel.AiConfigMigrationStatus, schema: EmptyRequest, handler: () => migrationStatus() },
      { channel: IpcChannel.AiConfigMigrate, schema: EmptyRequest, handler: () => migrateFromEnv().then(() => getConfig()) },
      {
        channel: IpcChannel.AiConfigResetToEnv,
        schema: EmptyRequest,
        audit: true,
        handler: () => resetToEnvironment().then(() => getConfig()),
      },
    ]),
  };
}

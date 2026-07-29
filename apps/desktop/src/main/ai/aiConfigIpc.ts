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
  AiSetProviderRequest,
  AiSetModelRequest,
  AiSetCredentialRequest,
  AiClearCredentialRequest,
  AiTestRequest,
} from '@neuropause/shared';
import type { AiConfigDto, AiHealthDto, OllamaDetectDto, AiTestResultDto } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { engineManager } from './engineManager';
import { loadAiConfig, saveAiConfig } from './aiConfigStore';
import { credentialStore } from '../security/secureStore';
import { resolveProviderId, ANTHROPIC_CREDENTIAL_ID } from './providerManager';
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
  const hasStoredKey =
    provider === 'claude' ? await credentialStore.hasSecret(ANTHROPIC_CREDENTIAL_ID) : false;
  return { provider, model: cfg.model, configured: status.configured, hasStoredKey, state: status.state, source };
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
  return {
    handlers: [
      { channel: IpcChannel.AiConfigGet, schema: EmptyRequest, handler: () => getConfig() },
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
      { channel: IpcChannel.AiConfigMigrationStatus, schema: EmptyRequest, handler: () => migrationStatus() },
      { channel: IpcChannel.AiConfigMigrate, schema: EmptyRequest, handler: () => migrateFromEnv().then(() => getConfig()) },
      {
        channel: IpcChannel.AiConfigResetToEnv,
        schema: EmptyRequest,
        audit: true,
        handler: () => resetToEnvironment().then(() => getConfig()),
      },
    ],
  };
}

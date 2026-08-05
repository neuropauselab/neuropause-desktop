/**
 * AI runtime configuration — the NON-SECRET shapes shared between the main process
 * and the renderer. A secret (API key) is NEVER part of any DTO here: the renderer
 * only ever learns whether a key is stored (`hasStoredKey`), never its value.
 */

export type AiProviderId = 'claude' | 'ollama';

export type AiRuntimeState = 'booting' | 'loading' | 'ready' | 'needs-setup' | 'error';

/** Where the effective provider selection came from (diagnostic only). */
export type AiConfigSource = 'config' | 'env' | 'default';

/** The renderer's view of the current AI configuration. Secret-free by construction. */
export interface AiConfigDto {
  provider: AiProviderId;
  /** Effective model tag, or null for the provider default. */
  model: string | null;
  /** Whether the active provider can make real calls (never the key itself). */
  configured: boolean;
  /** Whether an API key for the active provider is stored in the Secure Vault. */
  hasStoredKey: boolean;
  /** Runtime lifecycle state of the engine. */
  state: AiRuntimeState;
  /** Provenance of the effective provider selection. */
  source: AiConfigSource;
}

/** Provider reachability/health for the Settings + Operations indicators. */
export interface AiHealthDto {
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  detail: string;
  latencyMs: number | null;
}

/** Result of probing a local Ollama server. */
export interface OllamaDetectDto {
  reachable: boolean;
  models: string[];
}

/** Result of a connection/credential test. Never echoes the secret that was tested. */
export interface AiTestResultDto {
  ok: boolean;
  detail: string;
  latencyMs: number | null;
}

/** Whether environment-variable AI settings can be imported into the editable store. */
export interface MigrationStatusDto {
  /** True when env settings exist that have not yet been migrated and no stored config exists. */
  available: boolean;
  /** True once a migration has run (idempotency flag). */
  migrated: boolean;
  /** Provider selected via env, if any. */
  envProvider: AiProviderId | null;
  /** Whether an ANTHROPIC_API_KEY is present in the environment. */
  envHasKey: boolean;
}

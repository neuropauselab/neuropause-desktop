/**
 * AI runtime configuration — the NON-SECRET shapes shared between the main process
 * and the renderer. A secret (API key) is NEVER part of any DTO here: the renderer
 * only ever learns whether a key is stored (`hasStoredKey`), never its value.
 */

export type AiProviderId = 'claude' | 'ollama' | 'openai';

export type AiRuntimeState = 'booting' | 'loading' | 'ready' | 'needs-setup' | 'error';

/** Where the effective provider selection came from (diagnostic only). */
export type AiConfigSource = 'config' | 'env' | 'default';

import type { AiMode } from './aiRouting';

/** The renderer's view of the current AI configuration. Secret-free by construction. */
export interface AiConfigDto {
  provider: AiProviderId;
  /** Effective model tag, or null for the provider default. */
  model: string | null;
  /** Whether the active provider can make real calls (never the key itself). */
  configured: boolean;
  /** Whether an API key for the active provider is stored in the Secure Vault. */
  hasStoredKey: boolean;
  /**
   * Per-cloud-provider stored-key flags (never the keys). `hasStoredKey` above
   * predates the second cloud provider and answers "is ANY cloud key stored";
   * this answers it per provider so the Settings key field can tell the user
   * which provider the stored key belongs to.
   */
  storedKeys: { anthropic: boolean; openai: boolean };
  /** Runtime lifecycle state of the engine. */
  state: AiRuntimeState;
  /** Provenance of the effective provider selection. */
  source: AiConfigSource;
  /**
   * The effective AI mode. For installs configured before modes existed the
   * stored value is null and the effective mode preserves their behaviour
   * exactly (see `resolveAiMode` in the main process): a working cloud setup
   * keeps working, and only an explicit choice changes routing.
   */
  mode: AiMode;
  /** Whether the user has consented to external processing as a fallback. */
  externalConsent: boolean;
}

/** Provider reachability/health for the Settings + Operations indicators. */
export interface AiHealthDto {
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  detail: string;
  latencyMs: number | null;
}

/** Result of probing a local Ollama server. */
export interface OllamaDetectDto {
  /**
   * Whether the `ollama` binary is on this machine's PATH. Distinct from
   * `reachable`: installed-but-not-running tells the user to START it, while
   * not-installed tells them to INSTALL it — two different actions the UI must
   * not collapse into one "offline". Null when the probe itself failed.
   */
  installed: boolean | null;
  /** Installed version string from `ollama --version`, when installed. */
  version: string | null;
  /** Whether the Ollama HTTP service answered at the configured endpoint. */
  reachable: boolean;
  models: string[];
  /** The endpoint probed, for display. */
  endpoint: string;
}

/** Result of asking the local Ollama service to pull a model (user-approved). */
export interface OllamaPullResultDto {
  ok: boolean;
  /** Human-readable outcome; never contains credentials. */
  detail: string;
  /** Models installed after the pull completed (fresh list). */
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

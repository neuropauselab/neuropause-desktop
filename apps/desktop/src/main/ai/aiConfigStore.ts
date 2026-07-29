/**
 * AiConfigStore — persisted, NON-SECRET runtime AI configuration (provider choice,
 * model tag, Ollama URL, and a one-time migration flag). Mirrors the runtime-
 * preferences pattern: a small JSON file in userData, read/written safely, never
 * throwing into the runtime.
 *
 * Secrets NEVER live here — API keys go to the Secure Vault (credentialStore). A
 * null field means "unset": callers fall back to the environment, then to built-in
 * defaults. Precedence across the AI runtime is: stored config > environment > default.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export type AiProviderId = 'claude' | 'ollama';

export interface AiConfig {
  /** Selected provider, or null to defer to env/default. */
  provider: AiProviderId | null;
  /** Model tag override, or null for the provider default. */
  model: string | null;
  /** Ollama base URL override, or null for the default. */
  ollamaUrl: string | null;
  /** True once env→vault migration has run (idempotency guard, used by M8). */
  migratedFromEnv: boolean;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: null,
  model: null,
  ollamaUrl: null,
  migratedFromEnv: false,
};

function configPath(): string {
  return join(app.getPath('userData'), 'ai-config.json');
}

/** Normalise unknown/partial input to a valid AiConfig (unset → null). */
function coerce(raw: Partial<AiConfig> | null | undefined): AiConfig {
  const provider = raw?.provider === 'claude' || raw?.provider === 'ollama' ? raw.provider : null;
  return {
    provider,
    model: typeof raw?.model === 'string' && raw.model.length > 0 ? raw.model : null,
    ollamaUrl: typeof raw?.ollamaUrl === 'string' && raw.ollamaUrl.length > 0 ? raw.ollamaUrl : null,
    migratedFromEnv: raw?.migratedFromEnv === true,
  };
}

/** Load the persisted config, falling back to safe defaults on any error. */
export function loadAiConfig(): AiConfig {
  try {
    if (!existsSync(configPath())) return { ...DEFAULT_AI_CONFIG };
    return coerce(JSON.parse(readFileSync(configPath(), 'utf-8')) as Partial<AiConfig>);
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

/** Merge a patch into the persisted config and return the result. Best-effort write. */
export function saveAiConfig(patch: Partial<AiConfig>): AiConfig {
  const next = coerce({ ...loadAiConfig(), ...patch });
  try {
    writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  } catch {
    /* best-effort; a failed write must never crash the runtime */
  }
  return next;
}

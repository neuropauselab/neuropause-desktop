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
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — F21. THE STORE AT THE CENTRE OF THE ROUND 7 EXPOSURE, DECLARED.
 *
 * It had no declaration and the structural detector does not catch it: the gate
 * in `tenancy/storeScopeGate.test.ts` requires a write AND a retained collection,
 * and this file is a pair of functions over one JSON object, so it matched only
 * half the test. An undeclared store is exactly the class Round 8 built that gate
 * for, so the omission is worth more than the file: it is reported alongside the
 * two others the same regex misses (`registry/registry.ts`,
 * `ai/routingUsageStore.ts`).
 *
 * PLATFORM_OPERATOR is a true statement as of this round, not an aspiration:
 * every channel that writes this file — setProvider, setModel, setCredential,
 * clearCredential, setMode, setExternalConsent, resetToEnv and (F21) migrate —
 * requires `cloud:operate`, which no organization role can hold.
 */
declareStoreScope({
  name: 'ai-config',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  authority: 'PLATFORM_OPERATOR',
  classification: 'INSTALL_METADATA',
  retention:
    'No cap; one object. `resetToEnv` clears provider/model/ollamaUrl for the WHOLE install and ' +
    'deletes the shared vault credential, so removal reaches every tenant — which is why it, and ' +
    'every other write here, requires cloud:operate.',
  reason:
    'WHY GLOBAL: one `ai-config.json` per machine and one shared engine; `AiConfig` has no tenant ' +
    'field and two tenants cannot hold different destinations. WHAT DATA: provider choice, model ' +
    'tag, Ollama URL, routing mode, external-processing consent — machine configuration, never ' +
    'customer content (secrets live in the Secure Vault). CROSS-TENANT COST: this object decides ' +
    'WHERE retrieved records are sent, so an organization role over it would let one tenant’s ' +
    'administrator redirect every other tenant’s records off the device — the Round 7 finding.',
});

export type AiProviderId = 'claude' | 'ollama';

/** The persisted AI mode. Null = "never chosen" — see `resolveAiMode`. */
export type StoredAiMode = 'private_first' | 'local_only' | 'external' | null;

export interface AiConfig {
  /** Selected provider, or null to defer to env/default. */
  provider: AiProviderId | null;
  /** Model tag override, or null for the provider default. */
  model: string | null;
  /** Ollama base URL override, or null for the default. */
  ollamaUrl: string | null;
  /** True once env→vault migration has run (idempotency guard, used by M8). */
  migratedFromEnv: boolean;
  /**
   * The AI routing mode, or null when the user has never chosen one.
   *
   * Null is meaningful and is NOT defaulted away at load: an install that was
   * set up with a Claude key before modes existed must keep its behaviour
   * until the user decides otherwise. `resolveAiMode` maps null onto the mode
   * that reproduces the pre-mode behaviour exactly.
   */
  mode: StoredAiMode;
  /**
   * Explicit consent for external processing as a FALLBACK under Private
   * First. Distinct from choosing `external` mode: consent says "cloud may be
   * used when nothing private can serve this", mode `external` says "cloud is
   * my provider". Default false — external fallback is opt-in, never assumed.
   */
  externalConsent: boolean;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: null,
  model: null,
  ollamaUrl: null,
  migratedFromEnv: false,
  mode: null,
  externalConsent: false,
};

function configPath(): string {
  return join(app.getPath('userData'), 'ai-config.json');
}

/** Normalise unknown/partial input to a valid AiConfig (unset → null). */
function coerce(raw: Partial<AiConfig> | null | undefined): AiConfig {
  const provider = raw?.provider === 'claude' || raw?.provider === 'ollama' ? raw.provider : null;
  const mode =
    raw?.mode === 'private_first' || raw?.mode === 'local_only' || raw?.mode === 'external'
      ? raw.mode
      : null;
  return {
    provider,
    model: typeof raw?.model === 'string' && raw.model.length > 0 ? raw.model : null,
    ollamaUrl: typeof raw?.ollamaUrl === 'string' && raw.ollamaUrl.length > 0 ? raw.ollamaUrl : null,
    migratedFromEnv: raw?.migratedFromEnv === true,
    mode,
    externalConsent: raw?.externalConsent === true,
  };
}

/**
 * The effective AI mode for a config whose `mode` may be null.
 *
 * Null resolves to the mode that reproduces this install's PRE-MODE behaviour:
 * a config that effectively selects Claude was already sending AI work to an
 * external provider by the user's own setup, so it resolves to `external` —
 * anything else would silently break a working configuration. A config that
 * selects Ollama (or nothing) resolves to `private_first`, which prefers the
 * local route it was already using.
 */
export function resolveAiMode(cfg: AiConfig, effectiveProvider: AiProviderId): AiConfig['mode'] & {} {
  if (cfg.mode) return cfg.mode;
  return effectiveProvider === 'claude' ? 'external' : 'private_first';
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

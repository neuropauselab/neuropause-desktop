/**
 * Runtime configuration + modes (NCEA 10.2C, Phase 6).
 * Centralizes environment resolution, feature flags, platform/cloud settings,
 * and runtime modes. Secrets are read through an injected provider and are
 * NEVER stored on the config object or logged (Principle 5).
 */
export const RUNTIME_MODES = [
  'development',
  'testing',
  'production',
  'air_gapped',
  'private_cloud',
] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export interface SecretProvider {
  get(key: string): string | undefined;
}

/** A secret provider backed by an injected env record (never process.env directly). */
export function envSecretProvider(env: Record<string, string | undefined>): SecretProvider {
  return { get: (key) => env[key] };
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  flags: Record<string, boolean>;
  settings: Record<string, string>;
}

export interface ConfigInput {
  mode?: RuntimeMode;
  /** Injected environment (for mode resolution); defaults to empty. */
  env?: Record<string, string | undefined>;
  flags?: Record<string, boolean>;
  settings?: Record<string, string>;
}

function resolveMode(value: string | undefined): RuntimeMode | null {
  return value && (RUNTIME_MODES as readonly string[]).includes(value) ? (value as RuntimeMode) : null;
}

export function loadConfig(input: ConfigInput = {}): RuntimeConfig {
  const env = input.env ?? {};
  const mode = input.mode ?? resolveMode(env.NP_RUNTIME_MODE) ?? 'development';
  return {
    mode,
    flags: { ...input.flags },
    settings: { ...input.settings },
  };
}

export function isFlagEnabled(config: RuntimeConfig, flag: string): boolean {
  return config.flags[flag] === true;
}

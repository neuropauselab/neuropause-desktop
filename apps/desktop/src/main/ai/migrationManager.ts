/**
 * MigrationManager — one-time, idempotent import of environment-variable AI config
 * into the editable store + Secure Vault, plus a reset-to-environment rollback.
 *
 * Precedence stays config > env > default throughout, so migration never changes
 * behaviour — it only makes env settings editable and lets the user drop the env
 * vars afterwards. The `migratedFromEnv` flag guards against running twice.
 */
import { loadAiConfig, saveAiConfig, type AiConfig, type AiProviderId } from './aiConfigStore';
import { credentialStore } from '../security/secureStore';
import { engineManager } from './engineManager';
import { ANTHROPIC_CREDENTIAL_ID } from './providerManager';
import type { MigrationStatusDto } from '@neuropause/shared';

function envProvider(): AiProviderId | null {
  const p = process.env.NEUROPAUSE_LLM_PROVIDER;
  return p === 'ollama' ? 'ollama' : p === 'claude' ? 'claude' : null;
}

function hasEnvSettings(): boolean {
  return (
    envProvider() !== null ||
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.NEUROPAUSE_OLLAMA_URL) ||
    Boolean(process.env.NEUROPAUSE_OLLAMA_MODEL)
  );
}

export async function migrationStatus(): Promise<MigrationStatusDto> {
  const cfg = loadAiConfig();
  const hasStored = cfg.provider !== null || (await credentialStore.hasSecret(ANTHROPIC_CREDENTIAL_ID));
  return {
    available: hasEnvSettings() && !cfg.migratedFromEnv && !hasStored,
    migrated: cfg.migratedFromEnv,
    envProvider: envProvider(),
    envHasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

/** Import env settings into the store + Vault. Idempotent (no-op once migrated). */
export async function migrateFromEnv(): Promise<{ migrated: string[] }> {
  const cfg = loadAiConfig();
  if (cfg.migratedFromEnv) return { migrated: [] };
  const migrated: string[] = [];
  const patch: Partial<AiConfig> = { migratedFromEnv: true };
  const ep = envProvider();
  if (ep && cfg.provider === null) {
    patch.provider = ep;
    migrated.push('provider');
  }
  if (process.env.NEUROPAUSE_OLLAMA_URL && cfg.ollamaUrl === null) {
    patch.ollamaUrl = process.env.NEUROPAUSE_OLLAMA_URL;
    migrated.push('ollamaUrl');
  }
  if (process.env.NEUROPAUSE_OLLAMA_MODEL && cfg.model === null) {
    patch.model = process.env.NEUROPAUSE_OLLAMA_MODEL;
    migrated.push('model');
  }
  saveAiConfig(patch);
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && !(await credentialStore.hasSecret(ANTHROPIC_CREDENTIAL_ID))) {
    await credentialStore.setSecret(ANTHROPIC_CREDENTIAL_ID, envKey);
    migrated.push('anthropicKey');
  }
  await engineManager.reconfigure();
  return { migrated };
}

/** Roll back: clear stored config + Vault key so the environment fallback resumes. */
export async function resetToEnvironment(): Promise<void> {
  saveAiConfig({ provider: null, model: null, ollamaUrl: null, migratedFromEnv: false });
  await credentialStore.deleteSecret(ANTHROPIC_CREDENTIAL_ID);
  await engineManager.reconfigure();
}

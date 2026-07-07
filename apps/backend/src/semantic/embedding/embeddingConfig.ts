/**
 * Embedding configuration (V8.2 Part 1) — provider selection is config-driven.
 *
 * `loadEmbeddingConfig` reads the environment and produces a validated config, or
 * throws a structured `EmbeddingError('config_invalid')`. Provider keys live in the
 * environment and never in code; the desktop never sees them (backend-only).
 */
import { EmbeddingError } from './embeddingTypes';

export type EmbeddingProviderName = 'ollama' | 'openai' | 'voyage';

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  model: string;
  baseUrl: string;
  /** Required for openai/voyage; unused for local ollama. */
  apiKey?: string;
  dimensions: number;
  timeoutMs: number;
  /** Retry attempts *after* the first try (so 2 ⇒ up to 3 total). */
  retries: number;
  /** Base backoff in ms, doubled per attempt. */
  backoffMs: number;
}

const PROVIDERS: readonly EmbeddingProviderName[] = ['ollama', 'openai', 'voyage'];

/** Per-provider defaults. Chosen to match each provider's standard small model. */
const DEFAULTS: Record<
  EmbeddingProviderName,
  { model: string; baseUrl: string; dimensions: number; needsKey: boolean }
> = {
  ollama: { model: 'nomic-embed-text', baseUrl: 'http://127.0.0.1:11434', dimensions: 768, needsKey: false },
  openai: { model: 'text-embedding-3-small', baseUrl: 'https://api.openai.com/v1', dimensions: 1536, needsKey: true },
  voyage: { model: 'voyage-3', baseUrl: 'https://api.voyageai.com/v1', dimensions: 1024, needsKey: true },
};

function intFromEnv(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new EmbeddingError('config_invalid', `${label} must be a positive integer, got "${raw}"`);
  }
  return n;
}

export function loadEmbeddingConfig(env: Record<string, string | undefined>): EmbeddingConfig {
  const providerRaw = (env.EMBEDDING_PROVIDER ?? 'ollama').toLowerCase();
  if (!PROVIDERS.includes(providerRaw as EmbeddingProviderName)) {
    throw new EmbeddingError(
      'config_invalid',
      `EMBEDDING_PROVIDER must be one of ${PROVIDERS.join(', ')}, got "${providerRaw}"`,
    );
  }
  const provider = providerRaw as EmbeddingProviderName;
  const d = DEFAULTS[provider];

  const apiKey = env.EMBEDDING_API_KEY;
  if (d.needsKey && (!apiKey || apiKey.trim() === '')) {
    throw new EmbeddingError(
      'config_invalid',
      `EMBEDDING_API_KEY is required for provider "${provider}"`,
    );
  }

  return {
    provider,
    model: env.EMBEDDING_MODEL?.trim() || d.model,
    baseUrl: (env.EMBEDDING_BASE_URL?.trim() || d.baseUrl).replace(/\/+$/, ''),
    apiKey: d.needsKey ? apiKey : undefined,
    dimensions: intFromEnv(env.EMBEDDING_DIMENSIONS, d.dimensions, 'EMBEDDING_DIMENSIONS'),
    timeoutMs: intFromEnv(env.EMBEDDING_TIMEOUT_MS, 15000, 'EMBEDDING_TIMEOUT_MS'),
    retries: intFromEnv(env.EMBEDDING_RETRIES, 2, 'EMBEDDING_RETRIES'),
    backoffMs: intFromEnv(env.EMBEDDING_BACKOFF_MS, 250, 'EMBEDDING_BACKOFF_MS'),
  };
}

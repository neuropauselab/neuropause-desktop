/**
 * Qdrant configuration (V8.2 Part 1) — config-driven, mirrors loadEmbeddingConfig.
 * Reads QDRANT_* from the environment; dimensions/distance must match the
 * collection and the embedding provider's output.
 */
import { QdrantError, type QdrantConfig } from './qdrantTypes';

function intFromEnv(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new QdrantError('config_invalid', `${label} must be a positive integer, got "${raw}"`);
  }
  return n;
}

const DISTANCES = ['Cosine', 'Dot', 'Euclid'] as const;

export function loadQdrantConfig(env: Record<string, string | undefined>): QdrantConfig {
  const distanceRaw = env.QDRANT_DISTANCE ?? 'Cosine';
  if (!DISTANCES.includes(distanceRaw as (typeof DISTANCES)[number])) {
    throw new QdrantError('config_invalid', `QDRANT_DISTANCE must be one of ${DISTANCES.join(', ')}`);
  }
  return {
    baseUrl: (env.QDRANT_URL?.trim() || 'http://127.0.0.1:6333').replace(/\/+$/, ''),
    apiKey: env.QDRANT_API_KEY?.trim() || undefined,
    collection: env.QDRANT_COLLECTION?.trim() || 'memories',
    dimensions: intFromEnv(env.QDRANT_DIMENSIONS, 768, 'QDRANT_DIMENSIONS'),
    distance: distanceRaw as QdrantConfig['distance'],
    timeoutMs: intFromEnv(env.QDRANT_TIMEOUT_MS, 10000, 'QDRANT_TIMEOUT_MS'),
    retries: intFromEnv(env.QDRANT_RETRIES, 2, 'QDRANT_RETRIES'),
    backoffMs: intFromEnv(env.QDRANT_BACKOFF_MS, 250, 'QDRANT_BACKOFF_MS'),
  };
}

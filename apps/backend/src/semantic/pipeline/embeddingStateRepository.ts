/**
 * Postgres EmbeddingStateRepository (V8.2 Part 1) — persistence for the embedding
 * pipeline's idempotency/resume state. Mirrors createPgSubscriptionRepository:
 * module-level `query`, snake_case row, COLS constant, mapper, factory.
 *
 * Delivered file (imports '../../db/pool' + 'pg'), verified by the backend gate;
 * the pipeline decision logic it feeds is unit-tested in embeddingPipeline.test.ts.
 */
import { query } from '../../db/pool';
import type { EmbeddingState, EmbeddingStateRepository } from './embeddingPipeline';

interface EmbeddingStateRow {
  memory_id: string;
  org_id: string;
  content_hash: string;
  embedding_version: string;
  embedded_at: Date;
}

const COLS = 'memory_id, org_id, content_hash, embedding_version, embedded_at';

const toState = (r: EmbeddingStateRow): EmbeddingState => ({
  memoryId: r.memory_id,
  orgId: r.org_id,
  contentHash: r.content_hash,
  embeddingVersion: r.embedding_version,
  embeddedAt: r.embedded_at.toISOString(),
});

export function createPgEmbeddingStateRepository(): EmbeddingStateRepository {
  return {
    async getMany(memoryIds: string[]): Promise<Map<string, EmbeddingState>> {
      const map = new Map<string, EmbeddingState>();
      if (memoryIds.length === 0) return map;
      const { rows } = await query<EmbeddingStateRow>(
        `SELECT ${COLS} FROM embedding_state WHERE memory_id = ANY($1)`,
        [memoryIds],
      );
      for (const r of rows) map.set(r.memory_id, toState(r));
      return map;
    },

    async record(s: EmbeddingState): Promise<void> {
      // Upsert so re-recording (idempotent pipeline) never conflicts.
      await query(
        `INSERT INTO embedding_state (memory_id, org_id, content_hash, embedding_version, embedded_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (memory_id)
         DO UPDATE SET org_id = $2, content_hash = $3, embedding_version = $4, embedded_at = $5`,
        [s.memoryId, s.orgId, s.contentHash, s.embeddingVersion, s.embeddedAt],
      );
    },
  };
}

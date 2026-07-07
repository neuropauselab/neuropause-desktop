/**
 * Background embedding pipeline (V8.2 Part 1) — orchestration core.
 *
 * Idempotent and resumable, per requirement:
 *  - Idempotent: each memory's `content_hash` (content + embedding version) is
 *    compared to stored state; an unchanged memory is skipped, so re-running over
 *    the same data does no work and never re-embeds.
 *  - Resumable: state is persisted per memory immediately after a successful
 *    upsert, so a crash mid-run leaves completed memories recorded — the next run
 *    skips them and continues from the remainder. Work is done in batches.
 *  - Resilient: an embed failure on one memory is isolated (counted, not fatal);
 *    the run continues. Retries/timeouts live in the provider/vector clients.
 *
 * Pure and dependency-injected (repo, provider, vector store are interfaces), so
 * the whole decision logic unit-tests without Postgres, a provider, or Qdrant.
 */
import { createHash } from 'node:crypto';
import type { Embedding, EmbeddingVersion } from '../embedding/embeddingTypes';
import type { VectorRecord } from '../qdrant/qdrantTypes';

export interface EmbeddingState {
  memoryId: string;
  orgId: string;
  contentHash: string;
  embeddingVersion: string;
  embeddedAt: string;
}

export interface MemorySource {
  id: string;
  orgId: string;
  content: string;
}

export interface EmbeddingStateRepository {
  getMany(memoryIds: string[]): Promise<Map<string, EmbeddingState>>;
  record(state: EmbeddingState): Promise<void>;
}

export interface EmbeddingPipelineDeps {
  embeddingProvider: { version: EmbeddingVersion; embed(text: string): Promise<Embedding> };
  vectorStore: { batchUpsert(records: VectorRecord[]): Promise<void> };
  stateRepo: EmbeddingStateRepository;
}

export interface PipelineOptions {
  batchSize?: number;
  onProgress?: (p: PipelineProgress) => void;
}

export interface PipelineProgress {
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export interface PipelineResult extends PipelineProgress {
  errors: Array<{ memoryId: string; message: string }>;
}

/** Version key that participates in the hash — bump the provider revision to force re-embed. */
export function embeddingVersionKey(version: EmbeddingVersion): string {
  return `${version.model}@${version.revision}`;
}

/** Deterministic content hash. Same content + version ⇒ same hash ⇒ skip. */
export function embeddingContentHash(content: string, versionKey: string): string {
  return createHash('sha256').update(versionKey).update('\u0000').update(content).digest('hex');
}

function* chunk<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

export async function runEmbeddingPipeline(
  deps: EmbeddingPipelineDeps,
  memories: readonly MemorySource[],
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const batchSize = Math.max(1, options.batchSize ?? 32);
  const versionKey = embeddingVersionKey(deps.embeddingProvider.version);

  let processed = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ memoryId: string; message: string }> = [];

  for (const batch of chunk(memories, batchSize)) {
    const states = await deps.stateRepo.getMany(batch.map((m) => m.id));

    // Decide + embed the changed/new ones; unchanged are skipped (idempotency).
    const records: VectorRecord[] = [];
    const toRecord: EmbeddingState[] = [];
    for (const m of batch) {
      processed += 1;
      const hash = embeddingContentHash(m.content, versionKey);
      const existing = states.get(m.id);
      if (existing && existing.contentHash === hash && existing.embeddingVersion === versionKey) {
        skipped += 1;
        continue;
      }
      try {
        const vector = await deps.embeddingProvider.embed(m.content);
        records.push({ id: m.id, orgId: m.orgId, vector, payload: { memoryId: m.id } });
        toRecord.push({
          memoryId: m.id,
          orgId: m.orgId,
          contentHash: hash,
          embeddingVersion: versionKey,
          embeddedAt: new Date().toISOString(),
        });
      } catch (err) {
        failed += 1;
        errors.push({ memoryId: m.id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    // Upsert the batch, then persist state ONLY after a successful upsert (so a
    // failed upsert leaves nothing recorded and the memories retry next run).
    if (records.length > 0) {
      try {
        await deps.vectorStore.batchUpsert(records);
        for (const s of toRecord) await deps.stateRepo.record(s);
        embedded += records.length;
      } catch (err) {
        failed += records.length;
        const message = err instanceof Error ? err.message : String(err);
        for (const r of records) errors.push({ memoryId: r.id, message: `upsert failed: ${message}` });
      }
    }

    options.onProgress?.({ processed, embedded, skipped, failed });
  }

  return { processed, embedded, skipped, failed, errors };
}

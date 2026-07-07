/**
 * Memory backfill driver (V8.2 Part 2 inc3b). Desktop-side: walks the local
 * memory store, batches embeddable memories, and posts each batch to the backend
 * backfill endpoint (which embeds them into org-scoped Qdrant vectors). Local-first
 * holds — content lives on the desktop and is embedded in-flight, never persisted
 * backend-side.
 *
 * Pure and dependency-injected so the enumerate/filter/batch/aggregate logic is
 * unit-testable. Org comes from runtimeIdentity (same trustworthy source as recall
 * + sync); with no active org there is nothing org-scoped to back up, so it no-ops.
 */
import type { MemoryItem } from '@neuropause/shared';

export interface BackfillBatchResult {
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export interface MemoryBackfillDeps {
  /** memoryStore.allItems() — the local memories. */
  listItems: () => MemoryItem[];
  /** runtimeIdentity.getCurrent()?.organizationId. */
  getOrgId: () => string | undefined;
  /** POST the batch to the backend /backfill endpoint. */
  backfill: (orgId: string, memories: Array<{ memoryId: string; content: string }>) => Promise<BackfillBatchResult>;
  batchSize?: number;
  onProgress?: (p: { sent: number; total: number }) => void;
}

export interface MemoryBackfillSummary {
  orgId: string | null;
  total: number;
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
  batches: number;
  /** Set when nothing ran (no active org). */
  skippedReason?: 'no_active_org';
}

const MAX_BATCH = 500;

function* chunk<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

export async function runMemoryBackfill(deps: MemoryBackfillDeps): Promise<MemoryBackfillSummary> {
  const orgId = deps.getOrgId();
  if (!orgId) {
    // No org ⇒ personal/pre-login memory that never leaves the device.
    return { orgId: null, total: 0, processed: 0, embedded: 0, skipped: 0, failed: 0, batches: 0, skippedReason: 'no_active_org' };
  }

  // Embeddable = not tombstoned, non-empty content.
  const items = deps.listItems().filter((it) => !it.sync?.deleted && it.content.trim() !== '');
  const batchSize = Math.min(Math.max(1, deps.batchSize ?? 100), MAX_BATCH);

  let processed = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let batches = 0;
  let sent = 0;

  for (const batch of chunk(items, batchSize)) {
    const memories = batch.map((it) => ({ memoryId: it.id, content: it.content }));
    const res = await deps.backfill(orgId, memories);
    processed += res.processed;
    embedded += res.embedded;
    skipped += res.skipped;
    failed += res.failed;
    batches += 1;
    sent += batch.length;
    deps.onProgress?.({ sent, total: items.length });
  }

  return { orgId, total: items.length, processed, embedded, skipped, failed, batches };
}

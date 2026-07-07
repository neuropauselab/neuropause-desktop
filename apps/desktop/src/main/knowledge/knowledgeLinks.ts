/**
 * Knowledge links (V8.3 inc1) — the first derived-knowledge layer.
 *
 * Memory remains the source of truth; this adds NO store and copies NO data. It
 * derives memory-to-memory relatedness purely from the `entityRefs` every
 * MemoryItem already carries (the projector stamps them back to the UDM/graph).
 * Two memories are related when they reference overlapping entities; the more
 * shared entities (and the rarer those entities are across the corpus), the
 * stronger the link.
 *
 * Pure and I/O-free, so it unit-tests from synthetic memories and composes with
 * the existing graph/recall layers without touching them.
 */
import type { MemoryItem } from '@neuropause/shared';

export interface RelatedMemory {
  memoryId: string;
  /** Relatedness score in (0, 1]; higher = more/rarer shared entities. */
  score: number;
  /** The entity refs the two memories share (why they're linked). */
  sharedEntities: string[];
}

export interface RelatedMemoriesOptions {
  /** Max related memories to return per source. Default 10. */
  limit?: number;
  /** Ignore entity refs shared by more than this fraction of the corpus (too generic). Default 0.5. */
  maxEntityFrequency?: number;
}

/**
 * Inverse-document-frequency weight for an entity: rare entities (few memories)
 * carry more signal than ubiquitous ones. Returns a positive weight.
 */
function idf(entityFreq: number, total: number): number {
  // +1 smoothing so a singleton entity still has finite, meaningful weight.
  return Math.log((total + 1) / (entityFreq + 1)) + 1;
}

/** Build entity → count over the corpus (how many memories reference each entity). */
function entityFrequencies(memories: readonly MemoryItem[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const m of memories) {
    for (const ref of new Set(m.entityRefs)) {
      freq.set(ref, (freq.get(ref) ?? 0) + 1);
    }
  }
  return freq;
}

/**
 * Related memories for one source memory, ranked by shared-entity overlap weighted
 * by entity rarity. Excludes the source itself and tombstoned memories. Generic
 * entities (referenced by more than `maxEntityFrequency` of the corpus) are ignored
 * so everything doesn't link to everything.
 */
export function relatedMemories(
  sourceId: string,
  memories: readonly MemoryItem[],
  options: RelatedMemoriesOptions = {},
): RelatedMemory[] {
  const limit = Math.max(1, options.limit ?? 10);
  const maxFreq = options.maxEntityFrequency ?? 0.5;

  const source = memories.find((m) => m.id === sourceId);
  if (!source || source.sync?.deleted) return [];

  const total = memories.length;
  const freq = entityFrequencies(memories);
  // An entity shared by just 2 memories is always a legitimate pairwise link;
  // only entities shared by 3+ can be filtered as too generic (hub entities).
  const freqCap = Math.max(2, Math.floor(total * maxFreq));

  // The source's discriminating entities (rare enough to be meaningful).
  const sourceEntities = new Set(source.entityRefs.filter((ref) => (freq.get(ref) ?? 0) <= freqCap));
  if (sourceEntities.size === 0) return [];

  const results: RelatedMemory[] = [];
  for (const m of memories) {
    if (m.id === sourceId || m.sync?.deleted) continue;
    const shared: string[] = [];
    let score = 0;
    for (const ref of new Set(m.entityRefs)) {
      if (sourceEntities.has(ref)) {
        shared.push(ref);
        score += idf(freq.get(ref) ?? 1, total);
      }
    }
    if (shared.length > 0) results.push({ memoryId: m.id, score, sharedEntities: shared });
  }

  // Normalize scores to (0, 1] against the top score for stable, comparable output.
  const max = results.reduce((mx, r) => Math.max(mx, r.score), 0);
  if (max > 0) for (const r of results) r.score = Number((r.score / max).toFixed(4));

  results.sort((a, b) => b.score - a.score || b.sharedEntities.length - a.sharedEntities.length);
  return results.slice(0, limit);
}

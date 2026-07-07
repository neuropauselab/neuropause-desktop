/**
 * Recall re-ranking glue — activates the hybrid ranking engine (V6.7.0) and the
 * retrieval merge (V6.7.1) inside the live recall path.
 *
 * `memoryStore.recall()` currently orders text-query hits by the lexical
 * retriever's raw TF-IDF score alone. This maps the store's `MemoryItem`s and the
 * retriever's hits into the EXISTING ranking pipeline, so recall ordering also
 * reflects recency decay, authored importance, and pinned state — reusing
 * `mergeRetrievalCandidates` and `rankMemories` unchanged. `rankMemories` stays the
 * single ranking authority; this only shapes its input and unwraps its output.
 *
 * Semantic (vector) hits are intentionally omitted here — that path depends on
 * Qdrant + embeddings (V6.9) and is wired in a later increment. The vector weight
 * is zeroed so the 0..100 score uses its full range in the lexical-only case; when
 * semantic lands, callers pass real weights and `semanticHits` and nothing else
 * about this seam changes.
 *
 * Pure and deterministic: no I/O, no Electron, no sync deps — unit-testable in
 * plain Node against the real ranking modules.
 */
import type {
  MemoryHit,
  MemoryItem,
  MemoryRecallQuery,
} from "@neuropause/shared";
import {
  rankMemories,
  type MemoryScopeKind,
  type RankingWeights,
} from "./memoryRanking";
import {
  mergeRetrievalCandidates,
  type CandidateMetadata,
  type RetrievalHit,
} from "./memoryHybridSearch";

/**
 * Lexical-only blend: vector zeroed (renormalized away), leaving keyword dominant
 * with recency / importance / pinned as boosts. Passed to `rankMemories`, which
 * merges it over the defaults and normalizes.
 */
export const LEXICAL_RANKING_WEIGHTS: Partial<RankingWeights> = { vector: 0 };

type MemoryMeta = MemoryItem["metadata"];

function metaNumber(meta: MemoryMeta, key: string): number | undefined {
  const v = meta[key];
  return typeof v === "number" ? v : undefined;
}

function metaString(meta: MemoryMeta, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Project a stored `MemoryItem` onto the `CandidateMetadata` the ranker consumes.
 *  - scope / orgId / deleted come from the item's sync state (synced ⇒ organization,
 *    otherwise personal; a tombstoned synced item reports deleted so the ranker
 *    filters it out);
 *  - importance / pinned / project come from metadata, where executive memories
 *    encode them (absent on plain projected memories, which is fine — treated as
 *    no boost);
 *  - timestamp is the recency anchor: occurredAt ?? updatedAt ?? createdAt.
 */
export function memoryCandidateMetadata(item: MemoryItem): CandidateMetadata {
  const scope: MemoryScopeKind = item.sync ? "organization" : "personal";
  return {
    timestamp: item.occurredAt ?? item.updatedAt ?? item.createdAt,
    scope,
    orgId: item.sync?.orgId,
    deleted: item.sync?.deleted ?? false,
    importance: metaNumber(item.metadata, "importance"),
    pinned: item.metadata.pinned === true,
    tags: item.tags,
    project: metaString(item.metadata, "project"),
  };
}

export interface RecallRankingInput {
  /** The recall query — only `limit` is read here. */
  query: Pick<MemoryRecallQuery, "limit">;
  /** Lexical hits from the existing retriever (memoryId + normalized 0..1 score). */
  lexicalHits: readonly RetrievalHit[];
  /**
   * Resolve a memoryId to its stored item. Return `undefined` for ids the caller
   * wants excluded (unknown, tombstoned, or failing recall's kind/entity/tag/time
   * filters) — those hits are dropped, so all existing filter semantics are
   * preserved by the caller without duplicating them here.
   */
  getItem: (memoryId: string) => MemoryItem | undefined;
  /** Reference time for recency decay; defaults to Date.now() inside the ranker. */
  now?: string;
}

/**
 * Re-rank lexical recall hits through the hybrid ranking engine and return
 * `MemoryHit`s with the score normalized back to 0..1 (the recall contract).
 * Ordering and scoring come entirely from `rankMemories`.
 */
export function rankRecallHits(input: RecallRankingInput): MemoryHit[] {
  const lookup = (memoryId: string): CandidateMetadata | null => {
    const item = input.getItem(memoryId);
    return item ? memoryCandidateMetadata(item) : null;
  };

  const candidates = mergeRetrievalCandidates(input.lexicalHits, [], lookup);
  const ranked = rankMemories(
    {
      weights: LEXICAL_RANKING_WEIGHTS,
      now: input.now,
      limit: input.query.limit,
    },
    candidates,
  );

  const hits: MemoryHit[] = [];
  for (const r of ranked) {
    const item = input.getItem(r.memoryId);
    if (!item) continue; // resolvable at merge time but not now — skip defensively
    hits.push({ item, score: Math.round((r.score / 100) * 1000) / 1000 });
  }
  return hits;
}

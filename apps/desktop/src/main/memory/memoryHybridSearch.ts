/**
 * Hybrid retrieval merge + related memories (V6.7.1, pure core).
 *
 * The ranking engine (V6.7.0) ranks candidates; these functions BUILD those
 * candidates by merging lexical hits (from the existing TF-IDF retriever) with
 * semantic hits (from a vector retriever — Qdrant, once it exists), and compute
 * related memories from semantic neighbors. All pure, deterministic, no I/O: the
 * SOURCE of semantic hits is wired separately, but the merge and related logic are
 * source-agnostic, so semantic candidates from anywhere drop straight in.
 *
 * `rankMemories` remains the single ranking authority — this only shapes its input.
 */
import type { MemoryScopeKind, RankingCandidate } from './memoryRanking';

export interface RetrievalHit {
  memoryId: string;
  /** Relevance 0..1 — lexical score, or cosine similarity for semantic hits. */
  score: number;
}

/** The per-memory metadata the merge needs to build a full RankingCandidate. */
export interface CandidateMetadata {
  timestamp: string;
  scope: MemoryScopeKind;
  orgId?: string;
  deleted: boolean;
  importance?: number;
  pinned?: boolean;
  tags?: string[];
  project?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Merge lexical + semantic hits into ranking candidates. Deduplicates by memoryId
 * (a memory found by both carries both scores), attaches each memory's metadata via
 * `memoryLookup`, and drops any memory the lookup can't resolve (purged/unknown).
 * `vectorScore` is left undefined for lexical-only hits, so ranking counts it as
 * absent rather than a real zero. The result feeds straight into rankMemories.
 */
export function mergeRetrievalCandidates(
  lexicalHits: readonly RetrievalHit[],
  semanticHits: readonly RetrievalHit[],
  memoryLookup: (memoryId: string) => CandidateMetadata | null,
): RankingCandidate[] {
  const lexById = new Map(lexicalHits.map((h) => [h.memoryId, h.score]));
  const semById = new Map(semanticHits.map((h) => [h.memoryId, h.score]));
  const ids = new Set<string>([...lexById.keys(), ...semById.keys()]);

  const candidates: RankingCandidate[] = [];
  for (const memoryId of ids) {
    const meta = memoryLookup(memoryId);
    if (!meta) continue; // unresolvable memory — skip
    candidates.push({
      memoryId,
      keywordScore: lexById.get(memoryId) ?? 0,
      vectorScore: semById.has(memoryId) ? semById.get(memoryId) : undefined,
      timestamp: meta.timestamp,
      scope: meta.scope,
      orgId: meta.orgId,
      deleted: meta.deleted,
      importance: meta.importance,
      pinned: meta.pinned,
      tags: meta.tags,
      project: meta.project,
    });
  }
  return candidates;
}

export interface RelatedMemory {
  memoryId: string;
  /** Cosine similarity 0..1. */
  similarity: number;
  /** Rounded 0..100 for display. */
  similarityPercent: number;
  reason: string;
}

export interface RelatedMemoryOptions {
  /** Drop neighbors below this similarity. Default 0.5. */
  minSimilarity?: number;
  limit?: number;
  /** Resolve metadata to exclude deleted / enforce org scope. Optional. */
  memoryLookup?: (memoryId: string) => CandidateMetadata | null;
  /** When set (with memoryLookup), only same-org memories are related. */
  organizationId?: string;
}

function similarityReason(score: number): string {
  if (score >= 0.9) return 'very strong semantic similarity';
  if (score >= 0.75) return 'strong semantic similarity';
  if (score >= 0.6) return 'moderate semantic similarity';
  return 'related content';
}

/**
 * Compute related memories for a target from its semantic neighbors. Pure: excludes
 * the target itself, drops neighbors below `minSimilarity`, optionally filters
 * deleted/cross-org via `memoryLookup`, and returns a deterministic, similarity-
 * ordered list with a human reason. Relationships are computed dynamically — nothing
 * is persisted (no graph edges yet).
 */
export function relatedMemories(
  targetId: string,
  neighbors: readonly RetrievalHit[],
  options: RelatedMemoryOptions = {},
): RelatedMemory[] {
  const minSimilarity = options.minSimilarity ?? 0.5;
  const limit = options.limit ?? 5;
  const lookup = options.memoryLookup;

  return neighbors
    .filter((n) => n.memoryId !== targetId && n.score >= minSimilarity)
    .filter((n) => {
      if (!lookup) return true;
      const meta = lookup(n.memoryId);
      if (!meta || meta.deleted) return false;
      if (options.organizationId && meta.orgId !== options.organizationId) return false;
      return true;
    })
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.memoryId < b.memoryId ? -1 : 1))
    .slice(0, limit)
    .map((n) => ({
      memoryId: n.memoryId,
      similarity: round2(n.score),
      similarityPercent: Math.round(n.score * 100),
      reason: similarityReason(n.score),
    }));
}

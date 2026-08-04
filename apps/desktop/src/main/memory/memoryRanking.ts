/**
 * Hybrid memory ranking engine (V6.7.0) — a PURE, deterministic re-ranking layer
 * over candidates the existing retriever already produces. No I/O, no Qdrant, no
 * LiveSync, no dependency on the sync layer: given per-candidate signals it returns
 * a stable ordering with an explainable 0..100 score and a 0..1 confidence.
 *
 * It composes with what exists: the lexical retriever yields a keyword score per
 * memory; this blends that with an optional vector score (wired to Qdrant in a
 * later increment — omit it for now), recency decay, and importance/pinned boosts.
 * Because it's pure and fully tested, it's a safe foundation for semantic
 * retrieval, related-memories, duplicate detection, and context packs — none of
 * which change the synchronization layer.
 *
 * Deleted (tombstoned) memories are NEVER returned, and scope/org filters are
 * applied before scoring so unauthorized memories can't leak into results.
 */

export interface RankingWeights {
  keyword: number;
  vector: number;
  recency: number;
  importance: number;
  pinned: number;
}

/** Default blend. Weights are normalized before use, so relative size is what matters. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  keyword: 0.45,
  vector: 0.35,
  recency: 0.1,
  importance: 0.05,
  pinned: 0.05,
};

export type MemoryScopeKind = 'organization' | 'personal';

export interface RankingCandidate {
  memoryId: string;
  /** Lexical relevance 0..1, from the existing retriever. */
  keywordScore: number;
  /** Semantic relevance 0..1, from Qdrant (V6.7.1). Omit until then. */
  vectorScore?: number;
  /** Time used for recency decay (occurredAt ?? updatedAt ?? createdAt), ISO-8601. */
  timestamp: string;
  scope: MemoryScopeKind;
  orgId?: string;
  /** Tombstone — a deleted memory is never ranked in. */
  deleted: boolean;
  /** 0..1 authored/derived importance. */
  importance?: number;
  pinned?: boolean;
  tags?: string[];
  project?: string;
}

export interface RankingFilters {
  organizationId?: string;
  scope?: MemoryScopeKind;
  project?: string;
  tag?: string;
  since?: string;
  until?: string;
}

export interface RankingQuery {
  weights?: Partial<RankingWeights>;
  filters?: RankingFilters;
  /** Reference time for recency decay; defaults to Date.now(). */
  now?: string;
  /** Recency half-life in days — the score halves for every half-life of age. Default 30. */
  recencyHalfLifeDays?: number;
  limit?: number;
}

export type RankingFactor = 'keyword' | 'semantic' | 'recency' | 'importance' | 'pinned';

export interface RankingReason {
  factor: RankingFactor;
  /** Points (of the 0..100 score) this factor contributed. */
  contribution: number;
  label: string;
}

export interface RankedMemory {
  memoryId: string;
  /** Overall relevance, 0..100. */
  score: number;
  /**
   * 0..1 — how corroborated the match is across the relevance signals the query
   * expected. A signal that was expected but never observed (semantic degraded,
   * or simply no vector hit for this candidate) lowers it; supplying one can only
   * raise it. Deliberately *not* comparable to `score`: a keyword-only match can
   * rank first and still be poorly corroborated.
   */
  confidence: number;
  /** Why it ranked, strongest factor first. */
  reasons: RankingReason[];
}

const FACTOR_LABELS: Record<RankingFactor, string> = {
  keyword: 'keyword match',
  semantic: 'semantic similarity',
  recency: 'recent edit',
  importance: 'high importance',
  pinned: 'pinned',
};

const DAY_MS = 86_400_000;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeWeights(w: RankingWeights): RankingWeights {
  const sum = w.keyword + w.vector + w.recency + w.importance + w.pinned;
  if (!(sum > 0)) return { ...DEFAULT_RANKING_WEIGHTS };
  return {
    keyword: w.keyword / sum,
    vector: w.vector / sum,
    recency: w.recency / sum,
    importance: w.importance / sum,
    pinned: w.pinned / sum,
  };
}

/** Exponential recency: 1 at age 0, 0.5 at one half-life, decaying toward 0. */
function recencyScore(timestamp: string, now: number, halfLifeMs: number): number {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return 0;
  const age = Math.max(0, now - t);
  return Math.pow(0.5, age / halfLifeMs);
}

function passesFilters(c: RankingCandidate, f: RankingFilters | undefined): boolean {
  if (c.deleted) return false; // never surface a tombstoned memory
  if (!f) return true;
  if (f.organizationId && c.orgId !== f.organizationId) return false;
  if (f.scope && c.scope !== f.scope) return false;
  if (f.project && c.project !== f.project) return false;
  if (f.tag && !(c.tags ?? []).includes(f.tag)) return false;
  if (f.since && Date.parse(c.timestamp) < Date.parse(f.since)) return false;
  if (f.until && Date.parse(c.timestamp) > Date.parse(f.until)) return false;
  return true;
}

/**
 * Confidence — how corroborated the match is, over the relevance signals this
 * query *expected*, not merely the ones that arrived.
 *
 * A6 replaced a mean of the present signals. A mean is invariant to how many
 * terms it has, which inverted the meaning of the number in the one situation
 * where it matters most. The lexical retriever normalizes against the best hit
 * in the set (`memoryRetriever.ts:87-91`, `raw / max`), so the top lexical
 * candidate scores exactly `1.0` *by construction* — however thin the underlying
 * match. Under the mean:
 *
 *   - semantic unavailable → `mean([1.0])            = 1.00`
 *   - semantic healthy     → `mean([1.0, 0.8])       = 0.90`
 *
 * so losing the vector store *raised* confidence, and the top hit of every
 * degraded recall was guaranteed to clear the renderer's "High Confidence"
 * threshold (`memoryExplanation.ts:12`, 0.8). Exactly backwards, and reliably so.
 *
 * The fix keeps the missing signal in the denominator: an unobserved signal
 * contributes no evidence, rather than being excluded from the average as if it
 * had never been expected. The two relevance weights supply the ratio, so the
 * penalty is proportional to how much this query actually relied on semantic —
 * a caller that sets `vector: 0` is not asking for corroboration and is not
 * docked for its absence. Reusing the ranking weights also keeps this in step
 * with the score automatically; a second table of constants would drift.
 *
 * Monotone by construction: supplying a vector score can only raise confidence
 * (by `w_v · vector / (w_k + w_v)`, which is never negative), and can never
 * lower it. That single property is what the old formula violated.
 */
function computeConfidence(c: RankingCandidate, weights: RankingWeights): number {
  const expected = weights.keyword + weights.vector;
  // Both relevance weights zeroed — the query ranks purely on recency/importance/
  // pinned, so no relevance evidence was sought and none can be claimed.
  if (!(expected > 0)) return 0;
  const observed =
    weights.keyword * clamp01(c.keywordScore) +
    (c.vectorScore != null ? weights.vector * clamp01(c.vectorScore) : 0);
  return round2(observed / expected);
}

interface Scored {
  candidate: RankingCandidate;
  ranked: RankedMemory;
}

/** Deterministic order: score desc, then pinned, then newer, then memoryId asc. */
function compareScored(a: Scored, b: Scored): number {
  if (a.ranked.score !== b.ranked.score) return b.ranked.score - a.ranked.score;
  const ap = a.candidate.pinned ? 1 : 0;
  const bp = b.candidate.pinned ? 1 : 0;
  if (ap !== bp) return bp - ap;
  const at = Date.parse(a.candidate.timestamp) || 0;
  const bt = Date.parse(b.candidate.timestamp) || 0;
  if (at !== bt) return bt - at;
  return a.candidate.memoryId < b.candidate.memoryId
    ? -1
    : a.candidate.memoryId > b.candidate.memoryId
      ? 1
      : 0;
}

/**
 * Rank candidates for a query. Pure and deterministic: same inputs → same order.
 * Filters (deleted, org, scope, project, tag, date) are applied before scoring.
 */
export function rankMemories(query: RankingQuery, candidates: RankingCandidate[]): RankedMemory[] {
  const weights = normalizeWeights({ ...DEFAULT_RANKING_WEIGHTS, ...query.weights });
  const now = query.now ? Date.parse(query.now) : Date.now();
  const halfLifeMs = (query.recencyHalfLifeDays ?? 30) * DAY_MS;

  const scored: Scored[] = candidates
    .filter((c) => passesFilters(c, query.filters))
    .map((c) => {
      const parts: Array<[RankingFactor, number]> = [
        ['keyword', clamp01(c.keywordScore) * weights.keyword],
        ['semantic', clamp01(c.vectorScore ?? 0) * weights.vector],
        ['recency', recencyScore(c.timestamp, now, halfLifeMs) * weights.recency],
        ['importance', clamp01(c.importance ?? 0) * weights.importance],
        ['pinned', (c.pinned ? 1 : 0) * weights.pinned],
      ];
      const score = round1(parts.reduce((s, [, v]) => s + v, 0) * 100);
      const reasons: RankingReason[] = parts
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([factor, v]) => ({
          factor,
          contribution: round1(v * 100),
          label: FACTOR_LABELS[factor],
        }));
      return {
        candidate: c,
        ranked: {
          memoryId: c.memoryId,
          score,
          confidence: computeConfidence(c, weights),
          reasons,
        },
      };
    });

  scored.sort(compareScored);
  const limited = query.limit != null ? scored.slice(0, query.limit) : scored;
  return limited.map((s) => s.ranked);
}

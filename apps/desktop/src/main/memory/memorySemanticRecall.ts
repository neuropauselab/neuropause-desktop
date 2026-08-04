/**
 * Hybrid recall orchestrator (V8.2). The async seam that live semantic recall
 * runs through: it fetches semantic hits from the existing `semanticSearch`
 * (embed → vector search, both injected) and blends them with already-retrieved
 * lexical hits via the existing `rankRecallHits` (V8.2 increment 1). It adds NO
 * ranking or retrieval logic of its own — it wires the two existing sources into
 * the one existing ranker.
 *
 * Semantic is strictly optional: with no semantic deps, no orgId, or empty text,
 * it degrades to exactly the lexical-only result `rankRecallHits` already produces
 * — so callers (and the store's sync `recall`) are unaffected until an embedding
 * provider + vector store are wired by DI. Pure and Electron-free: it takes the
 * lexical hits and an item resolver as inputs, so it unit-tests with the in-memory
 * vector store + a stub embedder, no live provider required.
 */
import type { MemoryHit, MemoryItem, SemanticOutcome } from '@neuropause/shared';
import { rankRecallHits } from './memoryRecallRanking';
import { semanticSkipReason } from './retrievalDiagnostics';
import { semanticSearch, type SemanticRetrieverDeps } from './semanticRetriever';
import type { RankingWeights } from './memoryRanking';
import type { RetrievalHit } from './memoryHybridSearch';

/** A query for a semantic source: text + org namespace + how many to fetch. */
export interface SemanticSearchRequest {
  text: string;
  orgId: string;
  topK: number;
}

/**
 * Per-call controls for a semantic source (A6). Every field is optional and the
 * whole argument is optional, so a `SemanticSearchFn` written before A6 — a
 * one-parameter function such as `localSemanticSearch` — stays assignable and
 * every existing call site keeps compiling unchanged.
 */
export interface SemanticSearchOptions {
  /** Aborted when the caller's deadline elapses; implementations forward it to fetch. */
  signal?: AbortSignal;
  /**
   * Report what the semantic leg actually did. The source reports it rather than
   * the caller because only the source has the latency and the classified cause;
   * `hybridRecall` reports only the skips it decides itself.
   */
  onOutcome?: (outcome: SemanticOutcome) => void;
}

/**
 * Provider-agnostic semantic source (V8.2 A1): text → hits. The local path wraps
 * `semanticSearch` (embed + local vector store); the backend path is a client
 * calling the authenticated semantic API. `hybridRecall` blends whatever hits it
 * returns — it doesn't care where they came from.
 */
export type SemanticSearchFn = (
  query: SemanticSearchRequest,
  options?: SemanticSearchOptions,
) => Promise<RetrievalHit[]>;

export interface HybridRecallDeps {
  /** Semantic hit source. When absent, recall stays purely lexical. */
  searchSemantic?: SemanticSearchFn;
}

/** Local adapter: embed + search a local vector store, as a SemanticSearchFn. */
export function localSemanticSearch(deps: SemanticRetrieverDeps): SemanticSearchFn {
  return (query) => semanticSearch(deps, query);
}

export interface HybridRecallInput {
  /** The query text (already trimmed by the caller is fine; re-checked here). */
  text: string;
  /** Org namespace for vector search. Semantic is skipped when absent (personal-only). */
  orgId?: string;
  limit: number;
  /** Lexical hits from the existing retriever — the caller runs the retriever. */
  lexicalHits: readonly RetrievalHit[];
  /** Resolve + filter a memoryId to its item (preserves recall's filter semantics). */
  getItem: (memoryId: string) => MemoryItem | undefined;
  /** Vector search breadth; defaults to max(limit*2, 20). */
  semanticTopK?: number;
  /** Ranking weight override; defaults handled by rankRecallHits. */
  weights?: Partial<RankingWeights>;
  now?: string;
  /**
   * Observe what the semantic leg did (A6). Called exactly once per `hybridRecall`:
   * with the skip reason when one of the three guards below declines to run it, or
   * with whatever the source itself reports. Optional — omitting it restores the
   * pre-A6 behaviour exactly.
   */
  onSemanticOutcome?: (outcome: SemanticOutcome) => void;
}

export async function hybridRecall(
  deps: HybridRecallDeps,
  input: HybridRecallInput,
): Promise<MemoryHit[]> {
  let semanticHits: RetrievalHit[] = [];
  // The three conditions under which the semantic leg is skipped by design. They
  // are reported rather than silently collapsed to a lexical result, because a
  // caller cannot otherwise tell them apart from a failure (A6).
  const skip = semanticSkipReason({
    hasSource: Boolean(deps.searchSemantic),
    orgId: input.orgId,
    text: input.text,
  });

  if (skip) {
    input.onSemanticOutcome?.({ state: 'skipped', reason: skip });
  } else if (deps.searchSemantic && input.orgId) {
    const startedAt = Date.now();
    let reported = false;
    const onOutcome = (outcome: SemanticOutcome): void => {
      reported = true;
      input.onSemanticOutcome?.(outcome);
    };

    semanticHits = await deps.searchSemantic(
      {
        text: input.text,
        orgId: input.orgId,
        topK: input.semanticTopK ?? Math.max(input.limit * 2, 20),
      },
      { onOutcome },
    );

    // A source written before A6 reports nothing. It still returned, and the
    // count and the elapsed time are both known here, so the "exactly once"
    // contract above holds for every source rather than only the hardened one.
    if (!reported) {
      onOutcome({
        state: 'ok',
        hits: semanticHits.length,
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    }
  }

  return rankRecallHits({
    query: { limit: input.limit },
    lexicalHits: input.lexicalHits,
    semanticHits,
    weights: input.weights,
    getItem: input.getItem,
    now: input.now,
  });
}

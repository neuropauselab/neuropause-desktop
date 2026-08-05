/**
 * Semantic recall IPC handler logic (V8.2 Part 2 inc2; hardened in A6).
 * Framework-free so the org-resolution + fallback behaviour is unit-testable.
 *
 * Two jobs, both of which are really about not lying to the caller:
 *
 *   1. **Supply the org.** It comes from `runtimeIdentity` — the same trustworthy
 *      source the sync bridge uses — and is passed straight through, including
 *      when it is absent. Absence is *not* special-cased here any more: the store
 *      gates on it through the shared `semanticSkipReason` (`memoryStore.ts:429`)
 *      and returns the lexical answer labelled `no_org`. Pre-A6 this function
 *      short-circuited to `deps.recall(q)` first, which meant the invariant
 *      "never query semantic against a guessed org" was written in two places and
 *      the caller got an *unlabelled* result — indistinguishable from a semantic
 *      search that ran and matched nothing.
 *   2. **Backstop.** A6 made `recallSemantic` total with respect to the semantic
 *      leg: a dead backend, a lapsed deadline, or an open breaker no longer
 *      escapes it. So a throw arriving here is something else — a ranking or
 *      store defect — and the try/catch stays as a genuine last line rather than
 *      dead code. The answer still degrades to lexical, because memory search
 *      always returns something as long as the lexical retriever works, but it is
 *      now *labelled* degraded instead of being passed off as a clean result.
 */
import type { MemoryRecallQuery, MemoryRecallResult } from '@neuropause/shared';
import { buildRetrievalDiagnostics } from './retrievalDiagnostics';
import { classifySemanticError } from './semanticFailure';

export interface SemanticRecallHandlerDeps {
  /** memoryStore.recallSemantic bound. Receives the org verbatim, `undefined` included. */
  recallSemantic: (q: MemoryRecallQuery, orgId?: string) => Promise<MemoryRecallResult>;
  /** memoryStore.recall bound — the lexical fallback for the backstop path only. */
  recall: (q: MemoryRecallQuery) => MemoryRecallResult;
  /** Active org from runtimeIdentity.getCurrent()?.organizationId (undefined ⇒ none). */
  getOrgId: () => string | undefined;
  /** Observe a failure (logging / health), before falling back. */
  onSemanticError?: (err: unknown) => void;
  /** Injected clock (epoch ms) for the fallback's measured latency. Defaults to `Date.now`. */
  now?: () => number;
}

export async function handleSemanticRecall(
  deps: SemanticRecallHandlerDeps,
  q: MemoryRecallQuery,
): Promise<MemoryRecallResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();

  try {
    return await deps.recallSemantic(q, deps.getOrgId());
  } catch (err) {
    deps.onSemanticError?.(err);
    const lexical = deps.recall(q);
    return {
      ...lexical,
      // The envelope overwrites anything the sync lexical path may carry: only
      // this frame knows the semantic-aware attempt failed, so its verdict is the
      // more complete one. `classifySemanticError` is reused rather than a second
      // opinion being derived here — it already passes an
      // already-classified `SemanticUnavailableError` through untouched, and its
      // catch-all `network` / `unknown_error` is the deliberately conservative
      // reading of a throw nothing can identify. That label is coarse for a local
      // defect, but the real message travels in `detail`, and a parallel taxonomy
      // for a path that should never fire would be the worse trade.
      //
      // `lexicalCandidates` is omitted, not zeroed: this frame did not run the
      // retriever and cannot see the pool `recall` drew from, and `0` would claim
      // the lexical leg found nothing — a different and far more alarming fact.
      retrieval: buildRetrievalDiagnostics(classifySemanticError(err, now() - startedAt)),
    };
  }
}

/**
 * Resilient semantic search (A6) — a decorator around an existing
 * `SemanticSearchFn`, not a new retrieval path.
 *
 * `memoryStore.configureSemantic(fn)` is already the repository's dependency-
 * injection seam for the semantic source (`memoryStore.ts:401`, wired at
 * `memory/index.ts:88`). Hardening therefore attaches *there*: this returns a
 * `SemanticSearchFn` with the same signature, so nothing downstream —
 * `hybridRecall`, the ranker, the handler, the channel — changes shape, and the
 * unhardened function stays perfectly usable on its own.
 *
 * What the decorator adds, and nothing else:
 *
 *   - **A deadline.** The pre-A6 chain had no timeout anywhere: no
 *     `AbortSignal` in `backendSemanticClient`, and `hybridRecall` awaits the
 *     search unguarded, so a black-holed connection stalled recall until the
 *     30 s IPC timeout at `secureBridge.ts:26` fired. The signal is passed to
 *     the wrapped function *and* raced, so the deadline holds even if an
 *     implementation ignores it.
 *   - **A breaker.** `MemoryView` debounces at 200 ms; without one, a dead
 *     backend is re-dialled on every keystroke and each keystroke waits the
 *     full deadline.
 *   - **Classification.** Failures are turned into a typed `SemanticOutcome`
 *     and rethrown as `SemanticUnavailableError`. Rethrowing — rather than
 *     swallowing and returning `[]` — is deliberate: returning no hits would
 *     look identical to "the vector index legitimately matched nothing", and
 *     the existing boundary at `semanticRecallHandler.ts:34` already knows how
 *     to degrade to lexical. The verdict travels *with* the throw so the store
 *     can label the result honestly instead of guessing.
 */
import type { RetrievalHealthSnapshot, SemanticOutcome } from '@neuropause/shared';
import type {
  SemanticSearchFn,
  SemanticSearchOptions,
  SemanticSearchRequest,
} from './memorySemanticRecall';
import type { RetrievalHit } from './memoryHybridSearch';
import { RetrievalHealthTracker, type RetrievalHealthOptions } from './retrievalHealth';
import { classifySemanticError, SemanticUnavailableError } from './semanticFailure';

export interface ResilientSemanticOptions extends RetrievalHealthOptions {
  /** Deadline for one semantic call, ms. Default 4 s — well inside the 30 s IPC timeout. */
  timeoutMs?: number;
  /** Shared health tracker. Supply one to have several sources report into the same breaker. */
  tracker?: RetrievalHealthTracker;
  /**
   * Observe every outcome this wrapper records, for logging (A6). The composition
   * root needs this because the store now *absorbs* semantic failures to serve a
   * degraded answer: without a sink here, a failing backend would leave no trace
   * in the logs at all. This is the one point every outcome passes through, and
   * the breaker bounds how often a failure can be reported.
   */
  onOutcome?: (outcome: SemanticOutcome) => void;
}

/** Default semantic deadline. Chosen against `DEFAULT_TIMEOUT_MS = 30_000` (`secureBridge.ts:26`)
 *  and the renderer's `DEFAULT_SEARCH_TIMEOUT_MS = 8_000` (`searchPipeline.ts:48`): a semantic
 *  leg that has not answered in 4 s should yield to lexical rather than spend the user's budget. */
export const DEFAULT_SEMANTIC_TIMEOUT_MS = 4_000;

export interface ResilientSemanticSearch {
  /** Hand this to `memoryStore.configureSemantic`. */
  search: SemanticSearchFn;
  /** Live breaker + counters, for the diagnostics probe. */
  health(): RetrievalHealthSnapshot;
}

export function createResilientSemanticSearch(
  inner: SemanticSearchFn,
  options: ResilientSemanticOptions = {},
): ResilientSemanticSearch {
  const tracker = options.tracker ?? new RetrievalHealthTracker(options);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS);
  const now = options.now ?? Date.now;

  const search: SemanticSearchFn = async (
    query: SemanticSearchRequest,
    callerOptions?: SemanticSearchOptions,
  ): Promise<RetrievalHit[]> => {
    /**
     * The single place an outcome is published, so the tracker, the subsystem's
     * log sink and the caller can never end up with different accounts of the
     * same call. The subsystem sink is isolated because it is diagnostics: it is
     * invoked from inside the success path's `try`, so an exception there would
     * otherwise be classified as a retrieval failure and throw away good hits.
     */
    const report = (outcome: SemanticOutcome): void => {
      tracker.record(outcome);
      if (options.onOutcome) {
        try {
          options.onOutcome(outcome);
        } catch {
          // A diagnostics sink must never be able to fail a retrieval.
        }
      }
      callerOptions?.onOutcome?.(outcome);
    };

    if (!tracker.allow()) {
      const outcome = { state: 'skipped', reason: 'circuit_open' } as const;
      report(outcome);
      throw new SemanticUnavailableError(outcome);
    }

    const started = now();
    const controller = new AbortController();
    const abortCaller = (): void => controller.abort();
    callerOptions?.signal?.addEventListener('abort', abortCaller);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(`Semantic search exceeded its ${timeoutMs}ms deadline.`);
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });

    try {
      const hits = await Promise.race([inner(query, { signal: controller.signal }), deadline]);
      report({
        state: 'ok',
        hits: hits.length,
        latencyMs: Math.max(0, Math.round(now() - started)),
      });
      return hits;
    } catch (err) {
      const outcome = classifySemanticError(err, now() - started);
      report(outcome);
      throw new SemanticUnavailableError(outcome);
    } finally {
      if (timer) clearTimeout(timer);
      callerOptions?.signal?.removeEventListener('abort', abortCaller);
    }
  };

  return { search, health: () => tracker.snapshot() };
}

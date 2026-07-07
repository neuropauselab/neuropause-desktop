/**
 * Semantic recall IPC handler logic (V8.2 Part 2 inc2). Framework-free so the
 * org-resolution + fallback behavior is unit-testable.
 *
 * Org comes from `runtimeIdentity` (the same trustworthy source the sync bridge
 * uses): if there's no active org, recall stays lexical — org-scoped semantic
 * search never runs against a guessed org. And if the semantic path throws (backend
 * or Qdrant unreachable, auth expired), it degrades to the lexical `recall` result
 * rather than surfacing an error — memory search always returns something.
 */
import type { MemoryRecallQuery, MemoryRecallResult } from '@neuropause/shared';

export interface SemanticRecallHandlerDeps {
  /** memoryStore.recallSemantic bound. */
  recallSemantic: (q: MemoryRecallQuery, orgId?: string) => Promise<MemoryRecallResult>;
  /** memoryStore.recall bound — the lexical fallback. */
  recall: (q: MemoryRecallQuery) => MemoryRecallResult;
  /** Active org from runtimeIdentity.getCurrent()?.organizationId (undefined ⇒ none). */
  getOrgId: () => string | undefined;
  /** Observe a semantic failure (logging / health), before falling back. */
  onSemanticError?: (err: unknown) => void;
}

export async function handleSemanticRecall(
  deps: SemanticRecallHandlerDeps,
  q: MemoryRecallQuery,
): Promise<MemoryRecallResult> {
  const orgId = deps.getOrgId();
  // No active org → lexical only (never query semantic against a guessed/empty org).
  if (!orgId) return deps.recall(q);

  try {
    return await deps.recallSemantic(q, orgId);
  } catch (err) {
    // Backend/Qdrant/auth failure → graceful degradation to lexical recall.
    deps.onSemanticError?.(err);
    return deps.recall(q);
  }
}

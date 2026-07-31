/**
 * Phase 6 Stage 3 — one-shot query hand-off into the Search section.
 *
 * A tiny module-level mailbox so the command palette and Mission Control can
 * launch the full search experience with a pre-filled query WITHOUT touching
 * any Stage 1/2 provider: the caller sets the pending query and navigates to
 * the `search` section; the search host consumes it exactly once on mount.
 */
let pending: string | null = null;

export function setPendingSearchQuery(query: string): void {
  const q = query.trim();
  pending = q.length > 0 ? q : null;
}

/** Read-and-clear (one-shot). */
export function consumePendingSearchQuery(): string | null {
  const q = pending;
  pending = null;
  return q;
}

/** Test/inspection helper — does not clear. */
export function peekPendingSearchQuery(): string | null {
  return pending;
}

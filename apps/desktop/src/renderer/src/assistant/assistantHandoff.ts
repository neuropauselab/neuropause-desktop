/**
 * One-shot hand-off mailbox for launching the Workspace Assistant with a
 * pre-filled request from another surface (⌘K, Mission Control) WITHOUT
 * touching any provider — the exact pattern Stage 3's searchHandoff proved.
 * The pending value is consumed (read-and-clear) by AssistantHost on mount.
 */
let pending: string | null = null;

export function setPendingAssistantQuery(query: string): void {
  pending = query.trim() || null;
}

/** Read and clear (one-shot). */
export function consumePendingAssistantQuery(): string | null {
  const value = pending;
  pending = null;
  return value;
}

export function peekPendingAssistantQuery(): string | null {
  return pending;
}

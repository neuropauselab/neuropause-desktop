/**
 * Wave-2 Slice-13 — one-shot hand-off mailbox for an assistant-detected mail.send candidate.
 *
 * `AssistantHost` writes the intent params here (read from `envelope.mailIntent`) and navigates to the Connector
 * Center; `EntraConnectorPanel` consumes it EXACTLY ONCE on mount and feeds it into the existing `M365WritePanel`
 * through the Slice-12 propose feed (one surface, one confirmation). It is READ-AND-CLEAR so a remount or a
 * back-navigation cannot re-fire the propose call or refill the panel from a stale intent — one user instruction
 * yields at most one proposal on screen (Slice-13 amendment 3). Mirrors the proven `assistantHandoff`/`searchHandoff`
 * pattern: a renderer-only module-level mailbox, no provider dependency.
 */
export interface PendingMailIntent {
  to: string[];
  subject: string;
  body: string;
}

let pending: PendingMailIntent | null = null;

export function setPendingMailProposal(intent: PendingMailIntent): void {
  // Copy so a later mutation of the caller's object cannot change what the panel will consume.
  pending = { to: [...intent.to], subject: intent.subject, body: intent.body };
}

/** Read and clear (one-shot). A second call returns null — the guarantee behind amendment 3. */
export function consumePendingMailProposal(): PendingMailIntent | null {
  const value = pending;
  pending = null;
  return value;
}

export function peekPendingMailProposal(): PendingMailIntent | null {
  return pending;
}

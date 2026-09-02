/**
 * ERP Session 44 — map a crash-orphaned governed COMMAND INTENT (S40 HOLD) onto the existing
 * `raiseHold` input. PURE and non-frozen: no store, no IPC, no effect. Mirrors `m365UnknownHold.ts`
 * exactly — the same shape of ambiguity, the same canonical Hold/Decision mechanism.
 *
 * WHAT A HELD INTENT IS (S39/S40). The intent-first journal reserves a durable IN_FLIGHT marker
 * BEFORE the domain effect. An unclean shutdown between reservation and the journal commit leaves it
 * orphaned — a prior process's `bootEpoch`, no committed record — and boot reconciliation transitions
 * it to HOLD so the command is NEVER silently re-executed. That is a genuinely AMBIGUOUS command
 * execution: the domain effect MAY or MAY NOT have run, and the journal cannot tell.
 *
 * Honesty rules encoded here:
 *  - reason is `verification_unavailable` ("Cannot verify the outcome") — the exact ABSENCE semantics.
 *    It is NOT a failure and NOT a success.
 *  - the intent stores only { idempotencyKey, reservedAt, reason } — NOT the command type or aggregate.
 *    So `known` states exactly that, and `unknown` names the command type AND whether the effect ran.
 *    Presenting a command type we do not have would be a fabrication.
 *  - `subject` is the idempotency key (the reconstructable identity), so a repeated surfacing dedupes
 *    to ONE hold via `HoldStore.open`'s per-subject idempotency. The tenant prefix is dropped because
 *    the HoldStore is already tenant-scoped; the key is a client-generated opaque id, never a secret.
 *  - the resolution text FORBIDS blind retry: the journal HOLD permanently blocks silent replay of this
 *    exact key, and any legitimate follow-up is a NEW governed command (a new key), never a re-run here.
 *  - no secrets, tokens, tenant ids, or file paths are placed on the hold.
 */
import type { RaiseHoldInput } from './raiseHold';

/** The held-intent shape as read from the journal (`DurableCommandJournal.heldIntents`). */
export interface HeldCommandIntent {
  readonly idempotencyKey: string;
  readonly reservedAt: string;
  readonly reason?: string;
}

/** Build the `raiseHold` input for a crash-orphaned governed command intent. Pure. */
export function buildHeldCommandHoldInput(intent: HeldCommandIntent): RaiseHoldInput {
  return {
    reason: 'verification_unavailable',
    why: 'A governed command was interrupted by an unclean shutdown and could not be confirmed — it was NOT re-executed.',
    known: [
      `Command reference: ${intent.idempotencyKey}`,
      `Reserved at: ${intent.reservedAt}`,
      ...(intent.reason ? [`Journal state: ${intent.reason}`] : []),
    ],
    unknown: [
      'Which command this was (the interrupted attempt left no committed record).',
      'Whether the underlying business effect actually took place.',
    ],
    resolution:
      'Check the affected records for the reference above and record what you find. Do NOT re-run the command — this reference is permanently blocked from silent replay; any legitimate follow-up must be a NEW governed action.',
    ifProceeding: '',
    title: `Reconcile an interrupted governed command (${intent.idempotencyKey})`,
    subject: `command-hold:${intent.idempotencyKey}`,
    requestedAction: `Reconcile interrupted command ${intent.idempotencyKey}`,
    executed: 'Nothing confirmed — the command was interrupted and its outcome is unknown.',
  };
}

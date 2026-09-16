/**
 * D-16 · The CANONICAL verification-terminal vocabulary — the SINGLE classification authority.
 *
 * `ActionRecord.verification.terminal` is typed `string`. It is PRODUCED by two paths:
 *   - the send read-back oracle `verifyEffect` (VerifyState):
 *       VERIFIED_SUCCESS | VERIFY_FAILED | VERIFY_PENDING | UNKNOWN | HOLD | EXECUTED_ACK
 *   - the data-import path `importTransition` (outcomeClass):
 *       VERIFIED_SUCCESS | VERIFIED_FAILURE | VERIFIED_NOOP
 *
 * Every CONSUMER that interprets a stored terminal MUST classify it through this module and MUST
 * NOT hardcode terminal strings (pinned by an anti-re-entry invariant: no consumer file outside
 * this one may contain a raw terminal literal). Producers keep their own state unions — this is
 * the consumer-side interpretation authority.
 *
 * Deny-by-default (§2#9 — uncertainty is never success): an UNRECOGNISED terminal is UNRESOLVED,
 * never "settled". `VERIFIED_NOOP` (import authorized but wrote nothing) is likewise UNRESOLVED here
 * by deny-by-default — it is neither a corroborated effect nor a failure; a dedicated benign-no-op
 * class can be added if the import path ever feeds a consumer that needs to distinguish it.
 *
 * This module is PURE: no side effects, no store/Electron import, no path into governance or
 * execution — so it is safe to value-import from the observation layers (L6) without giving them reach.
 */
export type TerminalClass = 'success' | 'failure' | 'unresolved';

/** The ONE definition of each vocabulary set. Consumers import these; none redefine them. */
export const SUCCESS_TERMINALS: ReadonlySet<string> = new Set(['VERIFIED_SUCCESS']);
export const FAILURE_TERMINALS: ReadonlySet<string> = new Set(['VERIFY_FAILED', 'VERIFIED_FAILURE']);

/** Classify a NON-NULL terminal string. Deny-by-default: anything unrecognised → 'unresolved'. */
export function classifyTerminal(terminal: string): TerminalClass {
  if (SUCCESS_TERMINALS.has(terminal)) return 'success';
  if (FAILURE_TERMINALS.has(terminal)) return 'failure';
  return 'unresolved'; // HOLD | UNKNOWN | VERIFY_PENDING | EXECUTED_ACK | VERIFIED_NOOP | unrecognised
}

/** True only for an independently-corroborated success terminal (null/undefined → false). */
export function isSuccessTerminal(terminal: string | null | undefined): boolean {
  return terminal != null && SUCCESS_TERMINALS.has(terminal);
}

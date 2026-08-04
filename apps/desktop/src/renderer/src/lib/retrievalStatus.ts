/**
 * Retrieval-status presentation helper (A6).
 *
 * Turns the structured `RetrievalDiagnostics` envelope that the semantic recall
 * path now attaches to every `MemoryRecallResult` into short, human-facing
 * wording. All UI strings live HERE, in the renderer — the retrieval engine and
 * the shared contracts stay presentation-free, exactly as `memoryExplanation.ts`
 * does for ranking metadata.
 *
 * It lives in `lib/` rather than in `search/` or `views/` because BOTH consume
 * it — Universal Search (`search/searchPipeline.ts`) and the Memory view
 * (`views/MemoryView.tsx`) must describe a degraded retrieval identically, and
 * `searchPipeline.ts` is explicitly "self-contained; no imports from other
 * feature modules". `lib/` is this app's established cross-cutting leaf home
 * (`format.ts` is imported by views and by enterprise/).
 *
 * Pure and deterministic; no React, so it unit-tests in plain Node. (The
 * renderer has no component-test infrastructure — no testing-library, no jsdom —
 * so any logic that must be tested has to be React-free.)
 *
 * IT DOES NOT DECIDE WHAT "DEGRADED" MEANS. `retrieval.mode` is computed once,
 * in the main process (`main/memory/retrievalDiagnostics.ts#retrievalModeFor`),
 * and that is the single source of truth — notably `circuit_open` is a *skip*
 * that still counts as degraded. This module reads `mode` and supplies words.
 */
import type {
  RetrievalDiagnostics,
  SemanticFailureKind,
  SemanticSkipReason,
} from '@neuropause/shared';

/**
 * What to tell the user about the retrieval behind a set of results.
 *
 * `degraded: false` still carries a message so a caller that wants to show the
 * retrieval mode always can; callers that only surface problems check `degraded`
 * and ignore the rest.
 */
export type RetrievalStatus =
  | { degraded: false; message: string }
  | {
      degraded: true;
      message: string;
      /** Whether trying again could plausibly work — drives "try again" wording. */
      retryable: boolean;
      /** Sanitized upstream detail, when the producer had one. Safe to display. */
      detail: string | null;
    };

/** Shown alongside a degradation so the user knows the results are not empty, just narrower. */
const KEYWORD_ONLY = 'Showing keyword matches only.';

/**
 * Wording for a state this build does not recognize.
 *
 * The tables below are exhaustive over today's unions — that is a compile-time
 * guarantee, and it is the point of writing them as `Record<Union, string>`. It
 * is NOT a runtime guarantee: these values arrive over IPC, and rendering the
 * literal text `undefined` at a user is a worse failure than being vague. The
 * fallback keeps the honest half of the message (retrieval was impaired) and
 * drops only the specifics.
 */
const UNKNOWN_STATE = `Semantic search could not complete. ${KEYWORD_ONLY}`;

/**
 * Look a value up in an exhaustive table without losing the runtime fallback.
 *
 * `noUncheckedIndexedAccess` is off repo-wide, so `TABLE[key]` types as `string`
 * and a `??` on it reads as dead code. Widening to `Record<string, string>` and
 * annotating `string | undefined` makes the fallback both reachable and legible.
 */
function lookup(table: Record<string, string>, key: string): string {
  const message: string | undefined = table[key];
  return message ?? UNKNOWN_STATE;
}

/**
 * Failure kind → wording. Exhaustive `Record` on purpose: adding a kind to
 * `SemanticFailureKind` in shared must break this build rather than silently
 * render a generic string. (Same guarantee as `memoryExplanation.ts`'s
 * `FACTOR_DISPLAY`.)
 */
const FAILURE_MESSAGE: Record<SemanticFailureKind, string> = {
  network: `Semantic search could not be reached. ${KEYWORD_ONLY}`,
  timeout: `Semantic search took too long to answer. ${KEYWORD_ONLY}`,
  auth: `Sign in again to use semantic search. ${KEYWORD_ONLY}`,
  dependency_down: `Semantic search is temporarily unavailable. ${KEYWORD_ONLY}`,
  backend_error: `Semantic search returned an error. ${KEYWORD_ONLY}`,
  malformed_response: `Semantic search returned a response this version cannot read. ${KEYWORD_ONLY}`,
};

/**
 * Skip reason → wording. Only `circuit_open` is a degradation (see
 * `retrievalModeFor`); the rest are by-design states and are reported as such,
 * so an empty-query browse does not shout at the user.
 */
const SKIP_MESSAGE: Record<SemanticSkipReason, string> = {
  no_org: 'Keyword search only — no organization is selected.',
  not_configured: 'Keyword search only — semantic search is not configured.',
  no_query_text: 'Keyword search only — semantic search needs a question to match against.',
  circuit_open: `Semantic search is paused after repeated failures. ${KEYWORD_ONLY}`,
};

/**
 * Describe a retrieval envelope.
 *
 * Returns `null` when there is no envelope, which means "not reported" — a
 * producer written before A6, or the purely lexical `memory:recall` channel that
 * has no semantic leg. Callers must treat `null` as "say nothing", which is what
 * keeps pre-A6 behaviour intact.
 */
export function describeRetrieval(
  retrieval: RetrievalDiagnostics | undefined,
): RetrievalStatus | null {
  if (!retrieval) return null;
  const { mode, semantic } = retrieval;

  if (semantic.state === 'failed') {
    const message = lookup(FAILURE_MESSAGE, semantic.kind);
    // `retrievalModeFor` maps every `failed` leg to `degraded`, so the second
    // branch is unreachable today. It exists because this module reads the mode
    // rather than re-deriving it: if that mapping ever changes, the wording
    // follows it instead of contradicting it.
    if (mode !== 'degraded') return { degraded: false, message };
    return {
      degraded: true,
      message,
      retryable: semantic.retryable,
      detail: semantic.detail || null,
    };
  }

  if (semantic.state === 'skipped') {
    const message = lookup(SKIP_MESSAGE, semantic.reason);
    return mode === 'degraded'
      ? { degraded: true, message, retryable: true, detail: null }
      : { degraded: false, message };
  }

  // state === 'ok'. Hybrid worked; nothing to warn about.
  return { degraded: false, message: 'Keyword and semantic search.' };
}

/**
 * Describe a recall that failed *before* the main process could classify it.
 *
 * This is deliberately NOT a second failure taxonomy. Electron's IPC serializes
 * only an error's message — custom properties such as a `code` do not survive
 * the trip — so the renderer cannot re-derive `SemanticFailureKind` from a
 * rejected `invoke`, and string-matching the message is exactly what
 * `main/memory/semanticFailure.ts` exists to prevent. The failures that land
 * here are the ones the main-process classifier never sees at all: the RBAC
 * denial on `memory:semanticRecall` ('intelligence:read'), a request the secure
 * bridge rejected, a bridge timeout, or the channel being unavailable. In every
 * one of those cases the honest thing to say is that semantic search did not
 * run, plus whatever the bridge told us.
 */
export function retrievalStatusForIpcFailure(
  err: unknown,
): Extract<RetrievalStatus, { degraded: true }> {
  return {
    degraded: true,
    message: `Semantic search is unavailable. ${KEYWORD_ONLY}`,
    // Unknowable from here, and "you may retry" is the safer of the two claims:
    // it never tells a user their access is permanently gone when it is not.
    retryable: true,
    detail: ipcErrorDetail(err),
  };
}

/** Cap on a borrowed upstream string, so one long message cannot swamp the UI. */
const MAX_DETAIL = 200;

/**
 * Pull a displayable detail out of an unknown rejection value.
 *
 * The secure bridge deliberately replaces internal failures with a clean
 * `IpcError` message before they cross the boundary (`secureBridge.ts`: "Surface
 * a clean message to the renderer (never internal stack detail)"), so the
 * message we get here is already caller-safe. Anything that is not a string-ish
 * error is dropped rather than stringified into `[object Object]`.
 */
function ipcErrorDetail(err: unknown): string | null {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : null;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL - 1)}…` : trimmed;
}

/**
 * Compose a status into one line — the message, plus the detail when it adds
 * something the message does not already say.
 *
 * Shared so the search pipeline's source reason and the Memory view's notice
 * cannot drift apart. Callers that render the two parts separately (the Memory
 * view does, on two lines) do not use this.
 */
export function retrievalStatusLine(status: RetrievalStatus): string {
  if (!status.degraded || !status.detail) return status.message;
  return `${status.message} ${status.detail}`;
}

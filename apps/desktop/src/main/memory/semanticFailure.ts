/**
 * Semantic retrieval failure taxonomy (A6).
 *
 * One place that turns an arbitrary thrown value into a `SemanticOutcome`, so
 * every consumer branches on a typed `kind` instead of string-matching messages.
 * Before A6 the whole chain collapsed to `catch (err) { …use lexical }` at
 * `semanticRecallHandler.ts:36` — a dead Qdrant, an expired session, and a
 * rejected query were indistinguishable to the app and to the user.
 *
 * It lives in its own module (rather than inside the resilient wrapper) because
 * both the wrapper and `hybridRecall` need it, and the wrapper imports
 * `SemanticSearchFn` from `hybridRecall`'s module — a shared leaf keeps that a
 * type-only edge and avoids a runtime import cycle.
 *
 * Deliberately structural, not nominal: `BackendSemanticError` lives in
 * `main/backendsemantic/`, which already imports from `main/memory/`, so
 * importing the class back for an `instanceof` would create a real cycle. The
 * contract is instead the *shape* a semantic client throws — a numeric `status`
 * and a string `code` — which `BackendSemanticError` satisfies and any future
 * client can satisfy without depending on this module.
 */
import type { SemanticFailureKind, SemanticOutcome } from '@neuropause/shared';

type FailedOutcome = Extract<SemanticOutcome, { state: 'failed' }>;
type SkippedOutcome = Extract<SemanticOutcome, { state: 'skipped' }>;

/**
 * Thrown by the resilient wrapper so the classified outcome survives the trip up
 * through `hybridRecall` to the store, which needs it to build the recall
 * envelope. It extends `Error` and is thrown from the same place the raw error
 * was, so every pre-A6 `catch` keeps behaving exactly as it did.
 */
export class SemanticUnavailableError extends Error {
  constructor(readonly outcome: FailedOutcome | SkippedOutcome) {
    super(
      outcome.state === 'failed'
        ? `semantic retrieval failed (${outcome.kind}): ${outcome.detail}`
        : `semantic retrieval skipped (${outcome.reason})`,
    );
    this.name = 'SemanticUnavailableError';
  }
}

/** The shape a semantic client throws for an HTTP-level failure. */
interface StatusCodedError {
  status: number;
  code: string;
  message?: string;
}

function isStatusCoded(err: unknown): err is StatusCodedError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; code?: unknown };
  return typeof e.status === 'number' && typeof e.code === 'string';
}

/**
 * Was this throw a cancellation rather than a fault? Exported because a semantic
 * *client* has to know the difference too: an aborted body read must be allowed
 * to propagate as a cancellation instead of being relabelled a network fault.
 * Kept here so there is exactly one definition of "aborted" in the retrieval path.
 */
export function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

const MAX_DETAIL_LENGTH = 300;
/** A run long enough to be a token/id, mixing letters and digits — never an English word. */
const TOKEN_LIKE = /\b(?=[A-Za-z0-9_.-]*\d)(?=[A-Za-z0-9_.-]*[A-Za-z])[A-Za-z0-9_.-]{24,}\b/g;

/**
 * Make an error message safe to store and show. `SemanticOutcome.detail` is
 * surfaced in the UI and written to the health snapshot, so it must not carry a
 * bearer token, a signed URL, or an unbounded HTML error page.
 */
export function safeDetail(message: string | undefined, fallback: string): string {
  const raw = (message ?? '').trim();
  if (!raw) return fallback;
  const redacted = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    // NP-013: wss too — a Slack Socket Mode ticket URL (`wss://…?ticket=…`)
    // is a bearer-ish one-time credential and shorter than TOKEN_LIKE's floor.
    .replace(/((?:https?|wss?):\/\/[^\s?#]+)[?#]\S*/gi, '$1?[redacted]')
    .replace(TOKEN_LIKE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted) return fallback;
  return redacted.length > MAX_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : redacted;
}

/**
 * HTTP status → failure kind. `retryable` answers "could an identical retry
 * succeed without anyone intervening", which is why `auth` is not retryable
 * (the user must sign in again) while a 503 is.
 */
function classifyStatus(status: number): { kind: SemanticFailureKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 408) return { kind: 'timeout', retryable: true };
  // 429 is throttling rather than an outage, but the correct response is identical
  // to an outage: stop calling for a cooldown, which is exactly what the breaker does.
  if (status === 429) return { kind: 'dependency_down', retryable: true };
  if (status >= 500) return { kind: 'dependency_down', retryable: true };
  if (status <= 0) return { kind: 'network', retryable: true };
  return { kind: 'backend_error', retryable: false };
}

/**
 * Classify anything a `SemanticSearchFn` threw. Already-classified errors pass
 * through unchanged so a wrapper never re-classifies its own verdict.
 */
export function classifySemanticError(err: unknown, latencyMs: number): FailedOutcome {
  if (err instanceof SemanticUnavailableError && err.outcome.state === 'failed') {
    return err.outcome;
  }

  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined;
  const round = Math.max(0, Math.round(latencyMs));

  if (isAbortError(err)) {
    return {
      state: 'failed',
      kind: 'timeout',
      retryable: true,
      code: 'timeout',
      detail: safeDetail(message, 'The semantic search deadline elapsed.'),
      latencyMs: round,
    };
  }

  // A response body that would not parse — an HTML 502 page from a proxy, say.
  if (err instanceof SyntaxError) {
    return {
      state: 'failed',
      kind: 'malformed_response',
      retryable: false,
      code: 'malformed_response',
      detail: safeDetail(message, 'The semantic API returned a response this build cannot read.'),
      latencyMs: round,
    };
  }

  if (isStatusCoded(err)) {
    const { kind, retryable } = classifyStatus(err.status);
    return {
      state: 'failed',
      kind,
      retryable,
      code: err.code,
      detail: safeDetail(err.message ?? message, `Semantic search failed (HTTP ${err.status}).`),
      latencyMs: round,
    };
  }

  // Nothing recognisable: assume the request never landed. `network` is retryable
  // and trips the breaker, which is the safe reading of an unknown transport fault.
  return {
    state: 'failed',
    kind: 'network',
    retryable: true,
    code: 'unknown_error',
    detail: safeDetail(message, 'Semantic search could not be reached.'),
    latencyMs: round,
  };
}

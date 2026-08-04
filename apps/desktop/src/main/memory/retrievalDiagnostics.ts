/**
 * Retrieval diagnostics (A6) — the one place that decides *how* a recall ran.
 *
 * Before A6 a caller could not tell a hybrid result from a degraded one: both
 * came back as a plain `MemoryRecallResult`, and `semanticRecallHandler.ts:37`
 * returned the lexical fallback with no trace that anything had failed. The
 * renderer's `searchPipeline.runSemantic` already reads `retriever` and reports
 * it (`searchPipeline.ts:285`), so the surface for an honest answer exists and
 * was simply starved of information.
 *
 * This is a leaf: it imports nothing but shared types, so `memorySemanticRecall`,
 * `memoryStore` and `semanticRecallHandler` can all depend on it without any of
 * them depending on each other. That matters because the gate precedence and the
 * mode derivation must be identical everywhere — three copies of "is semantic
 * skipped, and what does that make this result" is exactly the duplication that
 * lets a degraded recall quietly claim to be a healthy one.
 */
import type { RetrievalDiagnostics, SemanticOutcome, SemanticSkipReason } from '@neuropause/shared';

/**
 * The skips a *caller* decides before the semantic source is ever invoked, as
 * opposed to `circuit_open`, which only the source itself can report.
 */
export type SemanticGateReason = Exclude<SemanticSkipReason, 'circuit_open'>;

/** The facts the gate needs; deliberately not a `HybridRecallInput`, so the store can ask too. */
export interface SemanticGate {
  /** Is a semantic source wired at all? */
  hasSource: boolean;
  /** Vector namespace. Semantic never runs against a guessed or empty org. */
  orgId?: string;
  /** Query text; whitespace-only counts as absent. */
  text: string;
}

/**
 * Why the semantic leg will not run, or `null` when it will. The precedence is
 * broadest-cause-first: a missing source explains everything else, so it is
 * reported ahead of a missing org, which in turn explains more than empty text.
 */
export function semanticSkipReason(gate: SemanticGate): SemanticGateReason | null {
  if (!gate.hasSource) return 'not_configured';
  if (!gate.orgId) return 'no_org';
  if (!gate.text.trim()) return 'no_query_text';
  return null;
}

/**
 * What the retrieval as a whole should be called, given what its semantic leg did.
 *
 * `lexical` and `degraded` are deliberately distinct. Both return lexical hits,
 * but only `degraded` means the user is seeing less than this build can normally
 * offer — which is the difference between "semantic isn't set up here" and
 * "semantic is down right now". `circuit_open` counts as degraded even though it
 * is a skip: the breaker only opens *because* the source was failing.
 */
export function retrievalModeFor(semantic: SemanticOutcome): RetrievalDiagnostics['mode'] {
  if (semantic.state === 'ok') return 'hybrid';
  if (semantic.state === 'failed') return 'degraded';
  return semantic.reason === 'circuit_open' ? 'degraded' : 'lexical';
}

/**
 * Assemble the envelope. `lexicalCandidates` is clamped to a sane integer when
 * given and left off entirely when the producer could not observe the pool —
 * reporting `0` there would claim lexical found nothing, which is a different
 * and much more alarming fact than "nobody counted".
 */
export function buildRetrievalDiagnostics(
  semantic: SemanticOutcome,
  lexicalCandidates?: number,
): RetrievalDiagnostics {
  const counted =
    typeof lexicalCandidates === 'number' && Number.isFinite(lexicalCandidates)
      ? Math.max(0, Math.trunc(lexicalCandidates))
      : undefined;
  return {
    mode: retrievalModeFor(semantic),
    semantic,
    ...(counted === undefined ? {} : { lexicalCandidates: counted }),
  };
}

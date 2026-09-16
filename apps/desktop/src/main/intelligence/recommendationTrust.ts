/**
 * S108 (H2) — live adapter: assess the ADVISORY trust of an AI recommendation from its OWN
 * evidence, honestly (no fabricated signals). Pure, read-only, tenant-safe (operates only on the
 * single recommendation the caller passes — reads no store, no cross-tenant data). Never touches
 * authority: the returned assessment is display-only intelligence about evidence quality.
 *
 * Enterprise context (Phase 7): a caller MAY pass evidence items it resolved from the existing
 * relationship graph / memory / search (single-tenant, upstream-scoped) to enrich freshness /
 * verification signals — the adapter does NOT build a second graph; it consumes what the caller
 * supplies. With no resolved items it falls back to the recommendation's own shape, producing an
 * honest low/moderate assessment with explicit caveats rather than inventing signals.
 */
import type { TrustAssessment, TrustEvidenceItem, TrustSignals } from './trustModel';
import { assessTrust, assessEvidenceTrust } from './trustModel';

/** The minimal slice of a Recommendation this adapter reads — no authority fields. */
export interface RecommendationTrustInput {
  /** cited evidence refs (count feeds completeness). */
  evidence: ReadonlyArray<{ kind: string; id: string }>;
  /** the rule's self-reported confidence, if any → aiConfidence (weighted low). */
  confidence?: number;
}

/**
 * Assess a recommendation's evidence-quality trust.
 * - `resolved`: optional evidence items the caller pulled from the live enterprise context
 *   (relationship graph / memory), already tenant-scoped. When present, freshness + verification
 *   come from real records via `assessEvidenceTrust`.
 * - otherwise: completeness is derived from the count of cited evidence refs, aiConfidence from
 *   the rule's own confidence; all other signals are honestly ABSENT (each yields a caveat).
 */
export function assessRecommendationTrust(
  rec: RecommendationTrustInput,
  resolved?: TrustEvidenceItem[],
  options: { now?: number } = {},
): TrustAssessment {
  const extra: TrustSignals = rec.confidence !== undefined ? { aiConfidence: rec.confidence } : {};
  if (resolved && resolved.length > 0) {
    return assessEvidenceTrust(resolved, extra, options);
  }
  const signals: TrustSignals = {
    completeness: clamp01(rec.evidence.length / 3), // ≥3 cited pieces ≈ complete (same heuristic as evidence trust)
    ...extra,
  };
  return assessTrust(signals, options);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

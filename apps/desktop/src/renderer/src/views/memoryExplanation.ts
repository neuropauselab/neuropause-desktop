/**
 * Explainable-search presentation helper (V7.5).
 *
 * Turns the structured ranking metadata carried on a MemoryHit into short,
 * human-facing labels for the Memory view. All UI strings live HERE, in the
 * renderer — the ranking engine and shared contracts stay presentation-free.
 * Pure and deterministic; no React, so it unit-tests in plain Node.
 */
import type { MemoryRankingMetadata, RankingFactor } from '@neuropause/shared';

/** Confidence at or above this reads as "High Confidence" in the UI. Presentation-only. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;

/** Cap on chips shown per result, keeping the secondary line compact. */
export const MAX_EXPLANATION_LABELS = 3;

/** Factor → display label. The only place these human strings are defined. */
const FACTOR_DISPLAY: Record<RankingFactor, string> = {
  keyword: 'Keyword Match',
  semantic: 'Semantic Match',
  recency: 'Recent',
  importance: 'Important',
  pinned: 'Pinned',
};

/**
 * Derive short explanation labels from a hit's ranking metadata. Prepends
 * "High Confidence" when the confidence signal is strong, then maps each computed
 * factor (already strongest-first) to its display label. Returns [] for hits with
 * no ranking (e.g. browse results). Deduped and capped for a compact single line.
 */
export function explanationLabels(ranking: MemoryRankingMetadata | undefined): string[] {
  if (!ranking) return [];
  const labels: string[] = [];
  if (ranking.confidence >= HIGH_CONFIDENCE_THRESHOLD) labels.push('High Confidence');
  for (const reason of ranking.reasons) {
    const label = FACTOR_DISPLAY[reason.factor];
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, MAX_EXPLANATION_LABELS);
}

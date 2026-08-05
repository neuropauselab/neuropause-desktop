/** Small pure numeric helpers shared across the layer. Kept explainable — no ML. */

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Weighted average of {value, weight} pairs; returns 0 when total weight is 0. */
export function weightedAverage(parts: Array<{ value: number; weight: number }>): number {
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) return 0;
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

/** Simple keyword-overlap similarity in [0,1] — a deterministic stand-in for
 *  embeddings (real semantic similarity is infra-pending). Explainable by design. */
export function keywordSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap / Math.max(ta.size, tb.size);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

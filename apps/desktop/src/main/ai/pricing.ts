/**
 * Model pricing — USD per token, derived from Anthropic's published per-MTok
 * rates (verified June 2026 from the Anthropic pricing docs: Opus 4.8 $5/$25,
 * Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per MTok). Output is billed separately from
 * input. Update here when rates change; the Cost Tracker reads only from this
 * table, so prices live in exactly one place.
 */

export interface ModelPrice {
  /** USD per input token. */
  input: number;
  /** USD per output token. */
  output: number;
}

const PER_MTOK = 1_000_000;

/** Standard (non-batch, non-cached) rates, per MTok → per token. */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-opus-4-8': { input: 5 / PER_MTOK, output: 25 / PER_MTOK },
  'claude-sonnet-4-6': { input: 3 / PER_MTOK, output: 15 / PER_MTOK },
  'claude-haiku-4-5-20251001': { input: 1 / PER_MTOK, output: 5 / PER_MTOK },
  // OpenAI (round 34) — standard Chat Completions rates.
  'gpt-4o': { input: 2.5 / PER_MTOK, output: 10 / PER_MTOK },
  'gpt-4o-mini': { input: 0.15 / PER_MTOK, output: 0.6 / PER_MTOK },
};

/** USD cost for a call. Unknown models cost 0 (and should be added above). */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return inputTokens * p.input + outputTokens * p.output;
}

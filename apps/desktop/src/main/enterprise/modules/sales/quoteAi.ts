/**
 * Quote AI runner — the bridge from a quote to the EXISTING AI pipeline. It hands
 * the deterministic facts + margin + discount risk + win probability + approval
 * needs to the model and asks only for narrative (summary, pricing/margin
 * framing, approval recommendation, executive explanation); the model never
 * changes the numbers or the health band. Returns null when no model is
 * configured or the call is empty → deterministic fallback.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  QuoteSignals,
  SalesQuote,
} from '@neuropause/shared';
import { calculateQuoteTotal, quoteStatusLabel, recommendPricing } from '@neuropause/shared';
import type { QuoteAiNarrative } from './quoteModule';

export interface QuoteAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runQuoteAi(
  engine: QuoteAiEngine,
  quote: SalesQuote,
  signals: QuoteSignals,
): Promise<QuoteAiNarrative | null> {
  const facts = [
    `Quote number: ${quote.quoteNumber}`,
    `Customer: ${quote.customer || '(none)'}`,
    `Status: ${quoteStatusLabel(quote.status)}`,
    `Currency: ${quote.currency}`,
    `Subtotal: ${quote.subtotal}`,
    `Discount: ${quote.discount}`,
    `Tax: ${quote.tax}`,
    `Cost of goods: ${quote.cost}`,
    `Total: ${calculateQuoteTotal(quote)}`,
    `Expiry: ${quote.expiryDate || '(none)'}`,
    `Sales rep: ${quote.salesRep || '(unassigned)'}`,
    `Last updated: ${quote.updatedAt}`,
    `Deterministic margin: ${signals.margin.amount} (${signals.margin.percent}%)`,
    `Deterministic discount risk: ${signals.discountRisk}/100`,
    `Deterministic win probability: ${Math.round(signals.winProbability * 100)}%`,
    `Deterministic health: ${signals.health.level} — ${signals.health.reason}`,
    `Deterministic approval: ${signals.approval.needsApproval ? signals.approval.reasons.join(' ') : 'not required'}`,
    `Deterministic pricing recommendation: ${recommendPricing(quote)}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'finance',
    promptId: 'sales.quote-summary',
    tier: 'fast',
    variables: {
      quote: facts,
      margin: String(signals.margin.percent),
      discountRisk: String(signals.discountRisk),
      winProbability: String(Math.round(signals.winProbability * 100)),
      health: signals.health.level,
    },
    maxOutputTokens: 450,
  });

  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation =
    typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}

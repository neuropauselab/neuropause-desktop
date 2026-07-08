/**
 * Sales → Quotes — Quote domain types + pure deterministic business logic.
 *
 * A Quote is a typed *projection* of the framework's flat `EnterpriseEntity` —
 * the Enterprise Module Framework owns persistence, CRUD, RBAC, audit, timeline,
 * and UI. This file adds the quote-specific typing and the DETERMINISTIC pricing
 * rules (`calculateQuoteMargin`, `calculateDiscountRisk`, `estimateWinProbability`,
 * `calculateQuoteHealth`, `recommendPricing`, `identifyApprovalNeeds`) the AI
 * explains but never replaces, plus the aggregate insights the Executive Center
 * surfaces. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

export type QuoteStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'cancelled'
  | 'converted';
export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'sent',
  'accepted',
  'expired',
  'cancelled',
  'converted',
];

/** Open (in-flight) statuses — the live pipeline. */
export const OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
];

/** Deterministic approval flag stamped onto every quote. */
export type QuoteApprovalStatus = 'not_required' | 'required';

export type QuotePaymentTerms = 'prepaid' | 'net15' | 'net30' | 'net45' | 'net60';

/** The Quotes module id + record kind (the framework store key). */
export const QUOTES_MODULE_ID = 'sales-quotes';
export const QUOTE_KIND = 'quote';

/** A typed view over a quote record's flat fields (+ envelope timestamps). */
export interface SalesQuote {
  id: string;
  quoteNumber: string;
  customer: string;
  contact: string;
  opportunity: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  cost: number;
  total: number;
  salesRep: string;
  paymentTerms: string;
  version: number;
  convertedOrder: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent: 'Sent',
  accepted: 'Accepted',
  expired: 'Expired',
  cancelled: 'Cancelled',
  converted: 'Converted',
};
export function quoteStatusLabel(status: QuoteStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStatus(v: unknown): QuoteStatus {
  const s = str(v);
  return (QUOTE_STATUSES as readonly string[]).includes(s) ? (s as QuoteStatus) : 'draft';
}

/** Project a framework record into a typed quote. */
export function quoteFromRecord(record: EnterpriseEntity): SalesQuote {
  const f = record.fields;
  return {
    id: record.id,
    quoteNumber: str(f.quoteNumber) || record.title,
    customer: str(f.customer),
    contact: str(f.contact),
    opportunity: str(f.opportunity),
    status: asStatus(f.status),
    issueDate: str(f.issueDate),
    expiryDate: str(f.expiryDate),
    currency: str(f.currency) || 'USD',
    subtotal: num(f.subtotal),
    discount: num(f.discount),
    tax: num(f.tax),
    cost: num(f.cost),
    total: num(f.total),
    salesRep: str(f.salesRep),
    paymentTerms: str(f.paymentTerms),
    version: num(f.version) || 1,
    convertedOrder: str(f.convertedOrder),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ───────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Authoritative total: subtotal − discount + tax (never negative). Deterministic. */
export function calculateQuoteTotal(quote: SalesQuote): number {
  return Math.max(0, Math.round(quote.subtotal - quote.discount + quote.tax));
}

/** Discount as a percentage of subtotal. Deterministic. */
export function calculateDiscountPercent(quote: SalesQuote): number {
  return quote.subtotal > 0 ? (quote.discount / quote.subtotal) * 100 : 0;
}

export interface QuoteMargin {
  amount: number;
  percent: number;
}

/**
 * Gross margin on net revenue (subtotal − discount − cost). Tax is pass-through
 * and excluded. Deterministic.
 */
export function calculateQuoteMargin(quote: SalesQuote): QuoteMargin {
  const netRevenue = Math.max(0, quote.subtotal - quote.discount);
  const amount = Math.round(netRevenue - quote.cost);
  const percent = netRevenue > 0 ? Math.round((amount / netRevenue) * 100) : 0;
  return { amount, percent };
}

/**
 * Discount risk 0..100 — rises with the discount depth and thin/negative margin.
 * Deterministic.
 */
export function calculateDiscountRisk(quote: SalesQuote): number {
  let risk = clamp(calculateDiscountPercent(quote), 0, 100) * 2;
  const margin = calculateQuoteMargin(quote);
  if (margin.percent < 0) risk += 40;
  else if (margin.percent < 15) risk += 20;
  return clamp(Math.round(risk), 0, 100);
}

/**
 * Deterministic win probability 0..1 from status, discount depth, and expiry
 * pressure. Terminal states pin to 1 (won) or 0 (lost).
 */
export function estimateWinProbability(quote: SalesQuote, nowMs: number): number {
  if (quote.status === 'accepted' || quote.status === 'converted') return 1;
  if (quote.status === 'rejected' || quote.status === 'cancelled' || quote.status === 'expired') {
    return 0;
  }
  const base: Record<string, number> = {
    draft: 0.2,
    pending_approval: 0.35,
    approved: 0.55,
    sent: 0.65,
  };
  let p = base[quote.status] ?? 0.4;
  const discountPct = calculateDiscountPercent(quote);
  if (discountPct >= 5 && discountPct <= 20) p += 0.1;
  else if (discountPct > 35) p -= 0.1;
  if (quote.expiryDate) {
    const expiry = Date.parse(quote.expiryDate);
    if (Number.isFinite(expiry) && expiry < nowMs) p -= 0.15;
  }
  return clamp(Number(p.toFixed(2)), 0, 1);
}

export interface QuoteHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic quote health — combines status, margin, discount, and expiry. */
export function calculateQuoteHealth(quote: SalesQuote, nowMs: number): QuoteHealth {
  if (quote.status === 'rejected' || quote.status === 'cancelled') {
    return { level: 'low', reason: 'Closed — no longer active.' };
  }
  if (quote.status === 'accepted' || quote.status === 'converted') {
    return { level: 'low', reason: 'Won.' };
  }
  if (quote.status === 'expired') return { level: 'medium', reason: 'Expired — re-issue to revive.' };
  const margin = calculateQuoteMargin(quote);
  if (margin.percent < 0) return { level: 'high', reason: 'Loss-making — priced below cost.' };
  const discountRisk = calculateDiscountRisk(quote);
  if (discountRisk >= 70) return { level: 'high', reason: `High discount risk (${discountRisk}/100).` };
  if (quote.expiryDate) {
    const expiry = Date.parse(quote.expiryDate);
    if (Number.isFinite(expiry) && expiry < nowMs) {
      return { level: 'high', reason: 'Past expiry, still open.' };
    }
  }
  if (margin.percent < 15) return { level: 'medium', reason: 'Thin margin.' };
  if (quote.status === 'pending_approval') return { level: 'medium', reason: 'Awaiting approval.' };
  return { level: 'low', reason: 'Healthy quote.' };
}

/** Deterministic pricing recommendation. */
export function recommendPricing(quote: SalesQuote): string {
  const margin = calculateQuoteMargin(quote);
  if (margin.percent < 0) return 'Reprice — the quote is below cost.';
  if (calculateDiscountPercent(quote) > 25) return 'Trim the discount to protect margin.';
  if (margin.percent < 15) return 'Raise price or reduce cost — margin is thin.';
  return 'Pricing is within healthy bounds.';
}

export interface QuoteApprovalNeeds {
  needsApproval: boolean;
  reasons: string[];
}

/** Deterministic approval gate — deep discount, thin margin, or high value. */
export function identifyApprovalNeeds(quote: SalesQuote): QuoteApprovalNeeds {
  const reasons: string[] = [];
  if (calculateDiscountPercent(quote) > 20) reasons.push('Discount exceeds 20%.');
  if (calculateQuoteMargin(quote).percent < 15) reasons.push('Margin below 15%.');
  if (calculateQuoteTotal(quote) >= 100_000) reasons.push('Contract value ≥ 100,000.');
  return { needsApproval: reasons.length > 0, reasons };
}

/** The deterministic approval flag stamped onto the record. */
export function quoteApprovalStatus(quote: SalesQuote): QuoteApprovalStatus {
  return identifyApprovalNeeds(quote).needsApproval ? 'required' : 'not_required';
}

export interface QuoteSignals {
  health: QuoteHealth;
  winProbability: number;
  margin: QuoteMargin;
  discountRisk: number;
  approval: QuoteApprovalNeeds;
}

/** Compute every deterministic signal for a quote at once. */
export function computeQuoteSignals(quote: SalesQuote, nowMs: number): QuoteSignals {
  return {
    health: calculateQuoteHealth(quote, nowMs),
    winProbability: estimateWinProbability(quote, nowMs),
    margin: calculateQuoteMargin(quote),
    discountRisk: calculateDiscountRisk(quote),
    approval: identifyApprovalNeeds(quote),
  };
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic summary + pricing/approval framing — the no-model fallback. */
export function quoteSummaryFallback(
  quote: SalesQuote,
  signals: QuoteSignals,
): { summary: string; executiveExplanation: string } {
  const total = calculateQuoteTotal(quote);
  const win = Math.round(signals.winProbability * 100);
  const summary =
    `${quote.quoteNumber} for ${quote.customer || 'a customer'} is ${quoteStatusLabel(quote.status).toLowerCase()} ` +
    `at ${money(total)} (${signals.margin.percent}% margin, ${win}% win probability). ` +
    `${signals.health.reason} ${recommendPricing(quote)}` +
    (signals.approval.needsApproval ? ` Approval needed: ${signals.approval.reasons.join(' ')}` : '');
  const executiveExplanation =
    signals.health.level === 'high'
      ? `${quote.quoteNumber} is at risk (${signals.discountRisk}/100 discount risk, ${signals.margin.percent}% margin) on ${money(total)}.`
      : `${quote.quoteNumber} is a ${money(total)} quote at ${win}% win probability.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface QuoteModuleInsights {
  totalQuotes: number;
  pipelineValue: number;
  averageQuoteValue: number;
  approvalQueue: number;
  averageWinProbability: number;
  highDiscountRisk: number;
  conversionRate: number;
}

/** Roll a set of active quotes into the Sales pipeline KPIs. Pure. */
export function deriveQuoteInsights(quotes: SalesQuote[], nowMs: number): QuoteModuleInsights {
  let pipeline = 0;
  let totalSum = 0;
  let approval = 0;
  let winSum = 0;
  let openCount = 0;
  let highRisk = 0;
  let won = 0;
  let closed = 0;
  for (const q of quotes) {
    const total = calculateQuoteTotal(q);
    totalSum += total;
    const isOpen = (OPEN_QUOTE_STATUSES as readonly string[]).includes(q.status);
    if (isOpen) {
      pipeline += total;
      winSum += estimateWinProbability(q, nowMs);
      openCount += 1;
    }
    const inQueue =
      q.status === 'pending_approval' ||
      (q.status === 'draft' && identifyApprovalNeeds(q).needsApproval);
    if (inQueue) approval += 1;
    if (calculateDiscountRisk(q) >= 70) highRisk += 1;
    if (q.status === 'accepted' || q.status === 'converted') {
      won += 1;
      closed += 1;
    } else if (q.status === 'rejected' || q.status === 'cancelled' || q.status === 'expired') {
      closed += 1;
    }
  }
  return {
    totalQuotes: quotes.length,
    pipelineValue: Math.round(pipeline),
    averageQuoteValue: quotes.length === 0 ? 0 : Math.round(totalSum / quotes.length),
    approvalQueue: approval,
    averageWinProbability: openCount === 0 ? 0 : Math.round((winSum / openCount) * 100),
    highDiscountRisk: highRisk,
    conversionRate: closed === 0 ? 0 : Math.round((won / closed) * 100),
  };
}

/** Map quote insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function quoteInsightsToKpis(insights: QuoteModuleInsights): ExecutiveKpi[] {
  const approvalBand: ExecutiveKpi['band'] =
    insights.approvalQueue === 0 ? 'healthy' : insights.approvalQueue <= 3 ? 'watch' : 'at-risk';
  const winBand: ExecutiveKpi['band'] =
    insights.averageWinProbability >= 60
      ? 'healthy'
      : insights.averageWinProbability >= 35
        ? 'watch'
        : 'at-risk';
  const discountBand: ExecutiveKpi['band'] =
    insights.highDiscountRisk === 0 ? 'healthy' : insights.highDiscountRisk <= 3 ? 'watch' : 'at-risk';
  return [
    { key: 'quote-total', label: 'Total Quotes', value: null, display: String(insights.totalQuotes), deepLink: 'enterprise/modules' },
    { key: 'quote-pipeline', label: 'Pipeline Value', value: null, display: money(insights.pipelineValue), deepLink: 'enterprise/modules' },
    { key: 'quote-avg-value', label: 'Avg Quote Value', value: null, display: money(insights.averageQuoteValue), deepLink: 'enterprise/modules' },
    {
      key: 'quote-approval-queue',
      label: 'Approval Queue',
      value: null,
      display: `${insights.approvalQueue} pending`,
      band: approvalBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'quote-win-prob',
      label: 'Avg Win Probability',
      value: insights.averageWinProbability,
      display: `${insights.averageWinProbability}%`,
      band: winBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'quote-discount-risk',
      label: 'High Discount Risk',
      value: null,
      display: `${insights.highDiscountRisk} at risk`,
      band: discountBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'quote-conversion', label: 'Quote Conversion', value: insights.conversionRate, display: `${insights.conversionRate}%`, deepLink: 'enterprise/modules' },
  ];
}

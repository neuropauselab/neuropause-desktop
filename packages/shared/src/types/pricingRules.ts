/**
 * Sales → Pricing Rules — discount-policy domain types + the pure,
 * deterministic DISCOUNT ENGINE.
 *
 * A Pricing Rule is a typed *projection* of the framework's flat
 * `EnterpriseEntity` — the Enterprise Module Framework owns persistence, CRUD,
 * RBAC, audit, timeline, and UI. Rules are CONFIGURATION records (like ledger
 * accounts): freely editable, no lifecycle markers.
 *
 * The engine (`evaluatePricingRules`) turns the rule book into POLICY for a
 * quote context: which single rule applies and what discount it grants.
 * Deterministic resolution — no stacking: among applicable rules the LARGEST
 * discount wins, ties broken by lowest `priority` number, then rule name. Date
 * windows are evaluated against the quote's OWN issue date (never the wall
 * clock, so validation stays reproducible); a quote without an issue date
 * matches only rules without a date window.
 *
 * The Quotes module consumes this as a POLICY CEILING: the granted discount is
 * stamped read-only (`policyDiscount`), and a manual discount beyond it forces
 * `approvalStatus = required` — policy can only ever TIGHTEN approval, never
 * loosen the existing risk-based rule.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Pricing Rules module id + record kind (the framework store key). */
export const PRICING_RULES_MODULE_ID = 'sales-pricing-rules';
export const PRICING_RULE_KIND = 'pricingRule';

/** Who a rule applies to. */
export type PricingRuleScope = 'global' | 'customer';
/** How a rule discounts. */
export type PricingRuleType = 'percentage' | 'fixed';

/** A typed view over a pricing-rule record's flat fields. */
export interface PricingRule {
  id: string;
  ruleName: string;
  scope: PricingRuleScope;
  /** Exact customer name the rule targets (scope 'customer' only). */
  customerName: string;
  ruleType: PricingRuleType;
  /** Percentage (0..100] for 'percentage', absolute amount for 'fixed'. */
  value: number;
  /** The quote subtotal at or above which the rule applies (volume threshold). */
  minSubtotal: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  /** Tie-breaker among equal discounts — lower number wins. */
  priority: number;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/** Project a framework record into a typed pricing rule. */
export function pricingRuleFromRecord(record: EnterpriseEntity): PricingRule {
  const f = record.fields;
  const scope = str(f.scope) === 'customer' ? 'customer' : 'global';
  const ruleType = str(f.ruleType) === 'fixed' ? 'fixed' : 'percentage';
  return {
    id: record.id,
    ruleName: str(f.ruleName) || record.title,
    scope,
    customerName: str(f.customerName),
    ruleType,
    value: num(f.value),
    minSubtotal: num(f.minSubtotal),
    effectiveFrom: str(f.effectiveFrom) || null,
    effectiveTo: str(f.effectiveTo) || null,
    active: str(f.active) !== 'no',
    priority: num(f.priority) || 100,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The quote context the engine evaluates against. */
export interface PricingContext {
  /** Exact customer name on the quote ('' matches only global rules). */
  customer: string;
  subtotal: number;
  /** The quote's issue date (YYYY-MM-DD) or null — never the wall clock. */
  issueDate: string | null;
}

/** Round to cents — the shared money rule. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whether a single rule applies to the context. Pure. */
export function pricingRuleApplies(rule: PricingRule, ctx: PricingContext): boolean {
  if (!rule.active) return false;
  if (rule.value <= 0) return false;
  if (rule.scope === 'customer' && rule.customerName !== ctx.customer) return false;
  if (ctx.subtotal < rule.minSubtotal) return false;
  if (rule.effectiveFrom || rule.effectiveTo) {
    // Date-windowed rules need the quote's own issue date to be judged.
    if (!ctx.issueDate) return false;
    const issue = Date.parse(ctx.issueDate);
    if (!Number.isFinite(issue)) return false;
    if (rule.effectiveFrom) {
      const from = Date.parse(rule.effectiveFrom);
      if (Number.isFinite(from) && issue < from) return false;
    }
    if (rule.effectiveTo) {
      const to = Date.parse(rule.effectiveTo);
      if (Number.isFinite(to) && issue > to) return false;
    }
  }
  return true;
}

/** The discount a single rule grants on the context's subtotal. Pure. */
export function pricingRuleDiscount(rule: PricingRule, ctx: PricingContext): number {
  if (ctx.subtotal <= 0) return 0;
  const raw = rule.ruleType === 'percentage' ? (ctx.subtotal * rule.value) / 100 : rule.value;
  return round2(Math.min(raw, ctx.subtotal)); // a discount never exceeds the subtotal
}

export interface PricingPolicy {
  /** The policy-granted discount (0 when no rule applies). */
  discount: number;
  /** The winning rule's name, or null. */
  ruleName: string | null;
  /** Deterministic one-line explanation of the decision. */
  explanation: string;
}

/**
 * The discount engine: the single best applicable rule wins (largest discount;
 * ties → lowest priority number, then name). No stacking — deterministic.
 */
export function evaluatePricingRules(rules: PricingRule[], ctx: PricingContext): PricingPolicy {
  let winner: PricingRule | null = null;
  let winnerDiscount = 0;
  for (const rule of rules) {
    if (!pricingRuleApplies(rule, ctx)) continue;
    const discount = pricingRuleDiscount(rule, ctx);
    if (discount <= 0) continue;
    const beats =
      !winner ||
      discount > winnerDiscount ||
      (discount === winnerDiscount &&
        (rule.priority < winner.priority ||
          (rule.priority === winner.priority && rule.ruleName < winner.ruleName)));
    if (beats) {
      winner = rule;
      winnerDiscount = discount;
    }
  }
  if (!winner) {
    return { discount: 0, ruleName: null, explanation: 'No pricing rule applies — list price.' };
  }
  const how =
    winner.ruleType === 'percentage' ? `${winner.value}% of subtotal` : `fixed ${winner.value}`;
  return {
    discount: winnerDiscount,
    ruleName: winner.ruleName,
    explanation: `Rule "${winner.ruleName}" grants ${winnerDiscount} (${how}); best of the applicable rules, no stacking.`,
  };
}

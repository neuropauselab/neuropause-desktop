/**
 * Billing & Licensing — the plan catalog and the pure money math. Invoices are
 * computed deterministically from a plan, the period's metered request count, and
 * the marketplace purchase ledger. No charging, no I/O; the store holds
 * subscriptions, seats, licenses, and purchases.
 */
import type {
  BillingSummary,
  Invoice,
  InvoiceLine,
  License,
  MarketplacePurchase,
  Plan,
  PlanTier,
  Subscription,
} from '@neuropause/shared';

export const PLAN_CATALOG: Record<PlanTier, Plan> = {
  free: {
    tier: 'free',
    name: 'Free',
    priceMonthly: 0,
    currency: 'USD',
    includedRequests: 1_000,
    overagePer1k: 0,
    rateLimit: { windowMs: 60_000, max: 60 },
    quota: { period: 'month', limit: 1_000 },
    seats: 1,
    marketplaceFeePct: 0.3,
    features: [
      { label: '1,000 API requests / month', included: true },
      { label: '60 requests / minute', included: true },
      { label: 'Publish to the marketplace', included: true },
      { label: 'Community support', included: true },
      { label: 'Usage-based overage', included: false },
      { label: 'Organization licensing', included: false },
    ],
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    priceMonthly: 49,
    currency: 'USD',
    includedRequests: 100_000,
    overagePer1k: 0.5,
    rateLimit: { windowMs: 60_000, max: 600 },
    quota: { period: 'month', limit: 100_000 },
    seats: 5,
    marketplaceFeePct: 0.2,
    features: [
      { label: '100,000 API requests / month', included: true },
      { label: '600 requests / minute', included: true },
      { label: 'Usage-based overage at $0.50 / 1k', included: true },
      { label: '5 seats included', included: true },
      { label: 'Priority review queue', included: true },
      { label: 'Lower 20% marketplace fee', included: true },
    ],
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 499,
    currency: 'USD',
    includedRequests: 2_000_000,
    overagePer1k: 0.25,
    rateLimit: { windowMs: 60_000, max: 6_000 },
    quota: { period: 'month', limit: 2_000_000 },
    seats: -1,
    marketplaceFeePct: 0.15,
    features: [
      { label: '2,000,000 API requests / month', included: true },
      { label: '6,000 requests / minute', included: true },
      { label: 'Usage-based overage at $0.25 / 1k', included: true },
      { label: 'Unlimited seats', included: true },
      { label: 'Organization & seat licensing', included: true },
      { label: 'Lowest 15% marketplace fee', included: true },
    ],
  },
};

export function planFor(tier: PlanTier): Plan {
  return PLAN_CATALOG[tier];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute an invoice for a billing period. */
export function computeInvoice(
  orgId: string,
  plan: Plan,
  periodRequests: number,
  purchases: MarketplacePurchase[],
  period: string,
  now = new Date().toISOString(),
): Invoice {
  const lines: InvoiceLine[] = [];

  lines.push({ kind: 'subscription', description: `${plan.name} plan`, quantity: 1, unitPrice: plan.priceMonthly, amount: plan.priceMonthly });

  const overage = Math.max(0, periodRequests - plan.includedRequests);
  if (overage > 0 && plan.overagePer1k > 0) {
    const units = Math.ceil(overage / 1_000);
    lines.push({ kind: 'usage', description: `API overage (${overage.toLocaleString()} over included)`, quantity: units, unitPrice: plan.overagePer1k, amount: round2(units * plan.overagePer1k) });
  }

  for (const p of purchases) {
    if (p.purchasedAt.slice(0, 7) === period) {
      lines.push({ kind: 'marketplace', description: `Marketplace: ${p.listingName}`, quantity: 1, unitPrice: p.amount, amount: p.amount });
    }
  }

  const subtotal = round2(lines.reduce((n, l) => n + l.amount, 0));
  return {
    id: `inv_${period}_${orgId}`,
    orgId,
    period,
    planTier: plan.tier,
    lines,
    subtotal,
    total: subtotal,
    currency: plan.currency,
    status: 'draft',
    issuedAt: now,
  };
}

export function billingSummary(
  plan: Plan,
  subscription: Subscription,
  periodRequests: number,
  licenses: License[],
  purchases: MarketplacePurchase[],
  period: string,
): BillingSummary {
  const overage = Math.max(0, periodRequests - plan.includedRequests);
  const overageUnits = Math.ceil(overage / 1_000);
  const overageCost = plan.overagePer1k > 0 ? round2(overageUnits * plan.overagePer1k) : 0;
  const marketplaceSpend = round2(purchases.filter((p) => p.purchasedAt.slice(0, 7) === period).reduce((n, p) => n + p.amount, 0));
  return {
    subscription,
    plan,
    periodRequests,
    includedRequests: plan.includedRequests,
    overageRequests: overage,
    estimatedCost: round2(plan.priceMonthly + overageCost + marketplaceSpend),
    currency: plan.currency,
    seatsUsed: subscription.seatsUsed,
    seats: subscription.seats,
    activeLicenses: licenses.filter((l) => l.status === 'active').length,
    marketplaceSpend,
  };
}

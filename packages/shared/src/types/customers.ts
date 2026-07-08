/**
 * CRM → Customers — Customer domain types + pure deterministic business logic.
 *
 * A Customer is a typed *projection* of the framework's flat `EnterpriseEntity` —
 * the Enterprise Module Framework owns persistence, CRUD, RBAC, audit, timeline,
 * and UI. This file adds the customer-specific typing and the DETERMINISTIC
 * account rules (`calculateCustomerHealth`, `calculatePaymentRisk`,
 * `calculateLifetimeValue`, `calculateCustomerTier`, `recommendNextEngagement`,
 * `identifyAtRiskCustomers`) the AI explains but never replaces, plus the
 * aggregate insights the Executive Center surfaces. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

export type CustomerStatus = 'active' | 'onboarding' | 'preferred' | 'inactive' | 'blocked' | 'archived';
export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  'active',
  'onboarding',
  'preferred',
  'inactive',
  'blocked',
  'archived',
];

export type CustomerTier = 'standard' | 'silver' | 'gold' | 'platinum' | 'enterprise';
export const CUSTOMER_TIERS: readonly CustomerTier[] = [
  'standard',
  'silver',
  'gold',
  'platinum',
  'enterprise',
];

export type PaymentTerms = 'prepaid' | 'net15' | 'net30' | 'net45' | 'net60';

/** The Customers module id + record kind (the framework store key). */
export const CUSTOMERS_MODULE_ID = 'crm-customers';
export const CUSTOMER_KIND = 'customer';

/** A typed view over a customer record's flat fields (+ envelope timestamps). */
export interface CrmCustomer {
  id: string;
  name: string;
  customerCode: string;
  company: string;
  primaryContact: string;
  email: string;
  status: CustomerStatus;
  tier: CustomerTier;
  accountManager: string;
  creditLimit: number;
  outstandingBalance: number;
  lifetimeRevenue: number;
  paymentTerms: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<CustomerStatus, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  preferred: 'Preferred',
  inactive: 'Inactive',
  blocked: 'Blocked',
  archived: 'Archived',
};
export function customerStatusLabel(status: CustomerStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const TIER_LABELS: Record<CustomerTier, string> = {
  standard: 'Standard',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  enterprise: 'Enterprise',
};
export function customerTierLabel(tier: CustomerTier): string {
  return TIER_LABELS[tier] ?? tier;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStatus(v: unknown): CustomerStatus {
  const s = str(v);
  return (CUSTOMER_STATUSES as readonly string[]).includes(s) ? (s as CustomerStatus) : 'onboarding';
}
function asTier(v: unknown): CustomerTier {
  const s = str(v);
  return (CUSTOMER_TIERS as readonly string[]).includes(s) ? (s as CustomerTier) : 'standard';
}

/** Project a framework record into a typed customer. */
export function customerFromRecord(record: EnterpriseEntity): CrmCustomer {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    customerCode: str(f.customerCode),
    company: str(f.company),
    primaryContact: str(f.primaryContact),
    email: str(f.email),
    status: asStatus(f.status),
    tier: asTier(f.customerTier),
    accountManager: str(f.accountManager),
    creditLimit: num(f.creditLimit),
    outstandingBalance: num(f.outstandingBalance),
    lifetimeRevenue: num(f.lifetimeRevenue),
    paymentTerms: str(f.paymentTerms),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ───────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Lifetime value of a customer — the recorded lifetime revenue (normalized). */
export function calculateLifetimeValue(customer: CrmCustomer): number {
  return Math.max(0, Math.round(customer.lifetimeRevenue));
}

/** Suggested tier from lifetime revenue. Deterministic thresholds. */
export function calculateCustomerTier(lifetimeRevenue: number): CustomerTier {
  if (lifetimeRevenue >= 1_000_000) return 'enterprise';
  if (lifetimeRevenue >= 250_000) return 'platinum';
  if (lifetimeRevenue >= 50_000) return 'gold';
  if (lifetimeRevenue >= 10_000) return 'silver';
  return 'standard';
}

/**
 * Payment risk 0..100 — rises with credit utilization, longer terms, and
 * inactive/blocked status. Deterministic.
 */
export function calculatePaymentRisk(customer: CrmCustomer): number {
  const utilization =
    customer.creditLimit > 0
      ? customer.outstandingBalance / customer.creditLimit
      : customer.outstandingBalance > 0
        ? 1
        : 0;
  let risk = clamp(utilization, 0, 1.5) * 60;
  if (customer.status === 'blocked') risk += 30;
  else if (customer.status === 'inactive') risk += 15;
  if (customer.paymentTerms === 'net60') risk += 10;
  else if (customer.paymentTerms === 'net45') risk += 5;
  return clamp(Math.round(risk), 0, 100);
}

export interface CustomerHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic relationship health — combines status + payment risk. */
export function calculateCustomerHealth(customer: CrmCustomer, _nowMs: number): CustomerHealth {
  if (customer.status === 'blocked') return { level: 'high', reason: 'Account is blocked.' };
  if (customer.status === 'archived') return { level: 'low', reason: 'Archived.' };
  const paymentRisk = calculatePaymentRisk(customer);
  if (paymentRisk >= 70) return { level: 'high', reason: `High payment risk (${paymentRisk}/100).` };
  if (customer.status === 'inactive') return { level: 'medium', reason: 'Inactive account.' };
  if (paymentRisk >= 40) return { level: 'medium', reason: `Elevated payment risk (${paymentRisk}/100).` };
  if (customer.status === 'onboarding') return { level: 'low', reason: 'Onboarding in progress.' };
  return { level: 'low', reason: 'Healthy account.' };
}

/** Map a health band to a 0..100 score (for averaging). */
export function customerHealthScore(level: EnterpriseRiskLevel): number {
  return level === 'low' ? 90 : level === 'medium' ? 60 : 25;
}

/** The next best engagement for an account, given its state. Deterministic. */
export function recommendNextEngagement(customer: CrmCustomer, health: CustomerHealth): string {
  if (customer.status === 'blocked') return 'Resolve the block and settle outstanding balance.';
  if (customer.status === 'onboarding') return 'Complete onboarding and confirm success criteria.';
  if (health.level === 'high') return 'Escalate — schedule an account review this week.';
  if (customer.status === 'inactive') return 'Re-engage with a check-in or offer.';
  if (calculateCustomerTier(customer.lifetimeRevenue) !== customer.tier) {
    return 'Review tier — lifetime revenue suggests a different tier.';
  }
  return 'Maintain the relationship; explore cross-sell opportunities.';
}

/** Active customers whose health is high risk. */
export function identifyAtRiskCustomers(customers: CrmCustomer[], nowMs: number): CrmCustomer[] {
  return customers.filter((c) => calculateCustomerHealth(c, nowMs).level === 'high');
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic summary + revenue/risk framing — the no-model fallback. */
export function customerSummaryFallback(
  customer: CrmCustomer,
  health: CustomerHealth,
): { summary: string; executiveExplanation: string } {
  const paymentRisk = calculatePaymentRisk(customer);
  const ltv = calculateLifetimeValue(customer);
  const summary =
    `${customer.name} is a ${customerTierLabel(customer.tier).toLowerCase()} ${customerStatusLabel(customer.status).toLowerCase()} account ` +
    `with ${money(ltv)} lifetime revenue and ${money(customer.outstandingBalance)} outstanding. ` +
    `${health.reason} Next: ${recommendNextEngagement(customer, health).toLowerCase()}`;
  const executiveExplanation =
    health.level === 'high'
      ? `${customer.name} is at risk (payment risk ${paymentRisk}/100) with ${money(customer.outstandingBalance)} outstanding.`
      : `${customer.name} is a healthy ${customerTierLabel(customer.tier).toLowerCase()} account worth ${money(ltv)}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface CustomerModuleInsights {
  totalCustomers: number;
  activeCustomers: number;
  outstandingReceivables: number;
  highRiskCustomers: number;
  averageHealthScore: number;
  totalRevenue: number;
  revenueByTier: Record<CustomerTier, number>;
  topCustomers: { id: string; name: string; lifetimeRevenue: number }[];
}

/** Roll a set of active customers into the CRM account KPIs. Pure. */
export function deriveCustomerInsights(customers: CrmCustomer[], nowMs: number): CustomerModuleInsights {
  const revenueByTier: Record<CustomerTier, number> = {
    standard: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
    enterprise: 0,
  };
  let active = 0;
  let outstanding = 0;
  let highRisk = 0;
  let healthSum = 0;
  let totalRevenue = 0;
  for (const c of customers) {
    if (c.status === 'active' || c.status === 'preferred') active += 1;
    outstanding += c.outstandingBalance;
    totalRevenue += c.lifetimeRevenue;
    revenueByTier[c.tier] += c.lifetimeRevenue;
    const health = calculateCustomerHealth(c, nowMs);
    if (health.level === 'high') highRisk += 1;
    healthSum += customerHealthScore(health.level);
  }
  const topCustomers = [...customers]
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue)
    .slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, lifetimeRevenue: c.lifetimeRevenue }));
  return {
    totalCustomers: customers.length,
    activeCustomers: active,
    outstandingReceivables: Math.round(outstanding),
    highRiskCustomers: highRisk,
    averageHealthScore: customers.length === 0 ? 100 : Math.round(healthSum / customers.length),
    totalRevenue: Math.round(totalRevenue),
    revenueByTier,
    topCustomers,
  };
}

/** Map customer insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function customerInsightsToKpis(insights: CustomerModuleInsights): ExecutiveKpi[] {
  const riskBand: ExecutiveKpi['band'] =
    insights.highRiskCustomers === 0 ? 'healthy' : insights.highRiskCustomers <= 3 ? 'watch' : 'at-risk';
  const healthBand: ExecutiveKpi['band'] =
    insights.averageHealthScore >= 75 ? 'healthy' : insights.averageHealthScore >= 50 ? 'watch' : 'at-risk';
  return [
    { key: 'cust-total', label: 'Total Customers', value: null, display: String(insights.totalCustomers), deepLink: 'enterprise/modules' },
    { key: 'cust-active', label: 'Active Customers', value: null, display: String(insights.activeCustomers), deepLink: 'enterprise/modules' },
    { key: 'cust-receivables', label: 'Outstanding Receivables', value: null, display: money(insights.outstandingReceivables), deepLink: 'enterprise/modules' },
    {
      key: 'cust-high-risk',
      label: 'High-Risk Customers',
      value: null,
      display: `${insights.highRiskCustomers} at risk`,
      band: riskBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'cust-health',
      label: 'Avg Customer Health',
      value: insights.averageHealthScore,
      display: `${insights.averageHealthScore}/100`,
      band: healthBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'cust-revenue', label: 'Customer Revenue', value: null, display: money(insights.totalRevenue), deepLink: 'enterprise/modules' },
  ];
}

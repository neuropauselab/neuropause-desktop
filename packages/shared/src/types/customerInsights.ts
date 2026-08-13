/**
 * CRM → Customer Insights — the cross-module Customer Health register + the
 * Customer Timeline engine (W2.7).
 *
 * The existing `calculateCustomerHealth` (customers.ts) judges a customer from
 * its OWN record. These engines widen the lens across the whole ERP — real
 * receivables (the W1 aging engine, reused), overdue activities (W2.2), open
 * weighted pipeline (W2.1), and contract state (W2.3) — without touching or
 * replacing the existing scorer: its level remains the BASE, and cross-module
 * facts apply transparent penalties.
 *
 * MATCH BASIS, stated honestly: finance documents and quotes reference
 * customers by exact NAME (their historical convention); activities and
 * contracts reference by record ID (the W2 convention). Both engines match on
 * exactly that — no fuzzy matching, no guessing.
 *
 * Both consumers are immutable snapshot modules (the Aging pattern). Pure
 * (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { FinanceInvoice } from './finance';
import { deriveArAging } from './finance';
import type { CrmCustomer } from './customers';
import { calculateCustomerHealth, customerHealthScore } from './customers';
import type { CrmOpportunity } from './opportunities';
import type { CrmActivity } from './activities';
import { activityStatusOf, assessActivityHealth } from './activities';
import type { SalesContract } from './contracts';
import { contractRuntimeState } from './contracts';
import type { SalesQuote } from './quotes';

/** The Customer Health module id + record kind (the framework store key). */
export const CUSTOMER_HEALTH_MODULE_ID = 'crm-customer-health';
export const CUSTOMER_HEALTH_KIND = 'customerHealthReport';

/** The Customer Timeline module id + record kind (the framework store key). */
export const CUSTOMER_TIMELINE_MODULE_ID = 'crm-customer-timeline';
export const CUSTOMER_TIMELINE_KIND = 'customerTimeline';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export type CustomerHealthBand = 'healthy' | 'watch' | 'at-risk';

/** One customer's line on the health register. */
export interface CustomerHealthRow {
  customer: string;
  tier: string;
  score: number;
  band: CustomerHealthBand;
  openAr: number;
  overdueAr: number;
  overdueActivities: number;
  openPipelineWeighted: number;
  activeContracts: number;
  expiredContracts: number;
  reasons: string[];
}

export interface CustomerHealthRegister {
  rows: CustomerHealthRow[];
  customerCount: number;
  atRisk: number;
  watch: number;
  healthy: number;
  totalOpenAr: number;
  totalPipelineWeighted: number;
}

/** The transparent penalty schedule — visible in every row's reasons. */
export const HEALTH_PENALTY_OVERDUE_AR = 25;
export const HEALTH_PENALTY_OVERDUE_ACTIVITIES = 15;
export const HEALTH_PENALTY_EXPIRED_CONTRACT = 20;

function bandOf(score: number): CustomerHealthBand {
  return score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'at-risk';
}

/**
 * The cross-module health register: base = the existing per-record scorer;
 * penalties = overdue AR, overdue activities, expired contracts. Worst first.
 */
export function deriveCustomerHealthRegister(
  customers: CrmCustomer[],
  invoices: FinanceInvoice[],
  opportunities: CrmOpportunity[],
  activities: CrmActivity[],
  contracts: SalesContract[],
  asOfMs: number,
): CustomerHealthRegister {
  const aging = deriveArAging(invoices, asOfMs);
  const arByCustomer = new Map<string, { open: number; overdue: number }>();
  for (const row of aging.rows) {
    const cell = arByCustomer.get(row.customer) ?? { open: 0, overdue: 0 };
    cell.open = round2(cell.open + row.outstanding);
    if (row.daysOverdue > 0) cell.overdue = round2(cell.overdue + row.outstanding);
    arByCustomer.set(row.customer, cell);
  }
  const rows: CustomerHealthRow[] = [];
  for (const customer of customers) {
    if (customer.status === 'archived') continue;
    const baseHealth = calculateCustomerHealth(customer, asOfMs);
    const base = customerHealthScore(baseHealth.level);
    const ar = arByCustomer.get(customer.name) ?? { open: 0, overdue: 0 };
    const overdueActivities = activities.filter(
      (a) =>
        a.relatedCustomerRef === customer.id &&
        activityStatusOf(a) === 'open' &&
        assessActivityHealth(a, asOfMs).level === 'high',
    ).length;
    const openPipelineWeighted = round2(
      opportunities
        .filter((o) => !o.closedAt && o.account === customer.name)
        .reduce((s, o) => s + o.weightedValue, 0),
    );
    const theirContracts = contracts.filter((k) => k.customerRef === customer.id);
    const expiredContracts = theirContracts.filter(
      (k) => contractRuntimeState(k, asOfMs) === 'expired',
    ).length;
    const activeContracts = theirContracts.filter((k) => {
      const state = contractRuntimeState(k, asOfMs);
      return state === 'active' || state === 'expiring';
    }).length;

    const reasons: string[] = [`base ${baseHealth.level} (${base}) — ${baseHealth.reason}`];
    let score = base;
    if (ar.overdue > 0) {
      score -= HEALTH_PENALTY_OVERDUE_AR;
      reasons.push(`overdue receivables ${ar.overdue} (−${HEALTH_PENALTY_OVERDUE_AR})`);
    }
    if (overdueActivities > 0) {
      score -= HEALTH_PENALTY_OVERDUE_ACTIVITIES;
      reasons.push(`${overdueActivities} overdue activit${overdueActivities === 1 ? 'y' : 'ies'} (−${HEALTH_PENALTY_OVERDUE_ACTIVITIES})`);
    }
    if (expiredContracts > 0) {
      score -= HEALTH_PENALTY_EXPIRED_CONTRACT;
      reasons.push(`${expiredContracts} expired contract(s) (−${HEALTH_PENALTY_EXPIRED_CONTRACT})`);
    }
    score = clamp(score, 0, 100);
    rows.push({
      customer: customer.name,
      tier: customer.tier,
      score,
      band: bandOf(score),
      openAr: ar.open,
      overdueAr: ar.overdue,
      overdueActivities,
      openPipelineWeighted,
      activeContracts,
      expiredContracts,
      reasons,
    });
  }
  rows.sort((a, b) => a.score - b.score || a.customer.localeCompare(b.customer));
  return {
    rows,
    customerCount: rows.length,
    atRisk: rows.filter((r) => r.band === 'at-risk').length,
    watch: rows.filter((r) => r.band === 'watch').length,
    healthy: rows.filter((r) => r.band === 'healthy').length,
    totalOpenAr: round2(rows.reduce((s, r) => s + r.openAr, 0)),
    totalPipelineWeighted: round2(rows.reduce((s, r) => s + r.openPipelineWeighted, 0)),
  };
}

/** One event on a customer's timeline. */
export interface CustomerTimelineEvent {
  at: string; // ISO datetime or YYYY-MM-DD
  kind: string;
  ref: string;
  label: string;
}

export const CUSTOMER_TIMELINE_CAP = 200;

/** The sources the timeline reads — matched by name or id per the header. */
export interface CustomerTimelineSources {
  quotes: SalesQuote[];
  invoices: FinanceInvoice[];
  opportunities: CrmOpportunity[];
  activities: CrmActivity[];
  contracts: SalesContract[];
}

/**
 * One customer's chronological story across the ERP, newest first, capped at
 * `CUSTOMER_TIMELINE_CAP` (the cap is reported by the caller, never silent).
 */
export function deriveCustomerTimeline(
  customer: { id: string; name: string },
  sources: CustomerTimelineSources,
): { events: CustomerTimelineEvent[]; totalBeforeCap: number } {
  const events: CustomerTimelineEvent[] = [];
  const push = (at: string | null, kind: string, ref: string, label: string): void => {
    if (at && Number.isFinite(Date.parse(at))) events.push({ at, kind, ref, label });
  };
  for (const q of sources.quotes) {
    if (q.customer !== customer.name) continue;
    push(q.issueDate || q.createdAt, 'quote', q.quoteNumber, `Quote ${q.quoteNumber} — ${q.status}`);
  }
  for (const inv of sources.invoices) {
    if (inv.customer !== customer.name) continue;
    push(inv.issueDate, 'invoice', inv.number, `Invoice ${inv.number} — ${inv.status}`);
  }
  for (const o of sources.opportunities) {
    if (o.account !== customer.name) continue;
    push(o.createdAt, 'opportunity', o.name, `Opportunity "${o.name}" opened (${o.stage})`);
    if (o.closedAt && o.outcome) {
      push(o.closedAt, 'opportunity', o.name, `Opportunity "${o.name}" ${o.outcome}`);
    }
  }
  for (const a of sources.activities) {
    if (a.relatedCustomerRef !== customer.id) continue;
    const status = activityStatusOf(a);
    push(
      a.completedAt ?? a.scheduledFor ?? a.createdAt,
      a.activityType,
      a.subject,
      `${a.activityType} "${a.subject}" — ${status}`,
    );
  }
  for (const k of sources.contracts) {
    if (k.customerRef !== customer.id) continue;
    push(k.activatedAt ?? k.createdAt, 'contract', k.contractNumber, `Contract ${k.contractNumber} — ${k.status}`);
    if (k.terminatedAt) push(k.terminatedAt, 'contract', k.contractNumber, `Contract ${k.contractNumber} terminated`);
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { events: events.slice(0, CUSTOMER_TIMELINE_CAP), totalBeforeCap: events.length };
}

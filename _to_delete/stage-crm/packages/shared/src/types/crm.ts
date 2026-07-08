/**
 * CRM module — Contact domain types + pure logic.
 *
 * Like Finance, a Contact is a typed *projection* of the framework's flat
 * `EnterpriseEntity` — the Enterprise Module Framework owns persistence, CRUD,
 * RBAC, audit, timeline, and UI. This file only adds the CRM-specific typing and
 * the deterministic relationship-health / follow-up logic the AI pipeline
 * explains on top of, plus the aggregate insights the Executive Center surfaces.
 * Pure (no I/O), so it is shared by the backend hook, the exec composer, and the
 * tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

/** The relationship stage of a contact. */
export type ContactStatus = 'lead' | 'prospect' | 'customer' | 'partner' | 'inactive';
export const CONTACT_STATUSES: readonly ContactStatus[] = [
  'lead',
  'prospect',
  'customer',
  'partner',
  'inactive',
];

export type ContactPriority = 'low' | 'medium' | 'high';
export type ContactSource = 'website' | 'referral' | 'outreach' | 'event' | 'partner' | 'other';

/** The CRM module id + record kind (the framework store key). */
export const CRM_MODULE_ID = 'crm';
export const CONTACT_KIND = 'contact';

/** A typed view over a contact record's flat fields (+ envelope timestamps). */
export interface CrmContact {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: ContactStatus;
  priority: ContactPriority;
  source: string;
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<ContactStatus, string> = {
  lead: 'Lead',
  prospect: 'Prospect',
  customer: 'Customer',
  partner: 'Partner',
  inactive: 'Inactive',
};

export function contactStatusLabel(status: ContactStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function asStatus(v: unknown): ContactStatus {
  const s = str(v);
  return (CONTACT_STATUSES as readonly string[]).includes(s) ? (s as ContactStatus) : 'lead';
}

function asPriority(v: unknown): ContactPriority {
  const s = str(v);
  return s === 'low' || s === 'high' ? s : 'medium';
}

/** Project a framework record into a typed contact. */
export function contactFromRecord(record: EnterpriseEntity): CrmContact {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    company: str(f.company),
    email: str(f.email),
    phone: str(f.phone),
    status: asStatus(f.status),
    priority: asPriority(f.priority),
    source: str(f.source),
    assignedTo: str(f.assignedTo),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface ContactHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic relationship health / follow-up risk — the authoritative signal
 * the AI narrates but never overrides. Leads/prospects that have gone quiet are
 * high risk (need a follow-up); established accounts with no recent activity are
 * medium; fresh activity and intentionally-inactive contacts are low.
 */
export function assessContactHealth(contact: CrmContact, nowMs: number): ContactHealth {
  if (contact.status === 'inactive') return { level: 'low', reason: 'Marked inactive.' };
  const updatedMs = Date.parse(contact.updatedAt);
  const staleDays = Number.isFinite(updatedMs)
    ? Math.max(0, Math.round((nowMs - updatedMs) / DAY_MS))
    : 0;

  if (contact.status === 'customer' || contact.status === 'partner') {
    if (staleDays > 90) {
      return {
        level: 'medium',
        reason: `Established account with no activity in ${staleDays} days.`,
      };
    }
    return { level: 'low', reason: 'Healthy — recent activity.' };
  }
  // lead / prospect
  if (staleDays > 30) {
    return { level: 'high', reason: `No contact in ${staleDays} days — at risk of going cold.` };
  }
  return {
    level: 'medium',
    reason: `Active ${contactStatusLabel(contact.status).toLowerCase()} — follow up to progress.`,
  };
}

/** Deterministic summary + follow-up + opportunity — the no-model fallback. */
export function contactSummaryFallback(
  contact: CrmContact,
  health: ContactHealth,
): { summary: string; executiveExplanation: string } {
  const where = contact.company ? ` at ${contact.company}` : '';
  const followUp =
    health.level === 'high'
      ? 'Recommend an immediate follow-up.'
      : health.level === 'medium'
        ? 'Schedule a follow-up to keep momentum.'
        : 'No action needed right now.';
  const opportunity =
    contact.status === 'lead' || contact.status === 'prospect'
      ? ' Potential opportunity to convert.'
      : contact.status === 'customer'
        ? ' Opportunity to expand the account.'
        : '';
  const summary = `${contact.name}${where} is a ${contactStatusLabel(contact.status).toLowerCase()}. ${health.reason} ${followUp}${opportunity}`;
  const executiveExplanation =
    health.level === 'high'
      ? `Relationship with ${contact.name} is at risk (${health.reason.toLowerCase()}) — prioritize a touch-point.`
      : `Relationship with ${contact.name} is ${health.level === 'low' ? 'healthy' : 'stable'}.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface CrmModuleInsights {
  activeContacts: number;
  newLeads: number;
  customers: number;
  highValueAccounts: number;
  /** Count of contacts with high follow-up risk. */
  followUpRisk: number;
  /** Share of customers in healthy standing, 0..100. */
  customerHealthPct: number;
}

/** Roll a set of active contacts into the CRM KPIs. Pure. */
export function deriveCrmInsights(contacts: CrmContact[], nowMs: number): CrmModuleInsights {
  let newLeads = 0;
  let customers = 0;
  let partners = 0;
  let healthyCustomers = 0;
  let followUpRisk = 0;
  for (const c of contacts) {
    if (c.status === 'lead') newLeads += 1;
    if (c.status === 'customer') {
      customers += 1;
      if (assessContactHealth(c, nowMs).level === 'low') healthyCustomers += 1;
    }
    if (c.status === 'partner') partners += 1;
    if (assessContactHealth(c, nowMs).level === 'high') followUpRisk += 1;
  }
  return {
    activeContacts: contacts.length,
    newLeads,
    customers,
    highValueAccounts: customers + partners,
    followUpRisk,
    customerHealthPct: customers === 0 ? 100 : Math.round((healthyCustomers / customers) * 100),
  };
}

/** Map CRM insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function crmInsightsToKpis(insights: CrmModuleInsights): ExecutiveKpi[] {
  const followUpBand: ExecutiveKpi['band'] =
    insights.followUpRisk === 0 ? 'healthy' : insights.followUpRisk <= 3 ? 'watch' : 'at-risk';
  const healthBand: ExecutiveKpi['band'] =
    insights.customerHealthPct >= 70
      ? 'healthy'
      : insights.customerHealthPct >= 40
        ? 'watch'
        : 'at-risk';
  return [
    {
      key: 'crm-active-contacts',
      label: 'Active Contacts',
      value: null,
      display: String(insights.activeContacts),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'crm-new-leads',
      label: 'New Leads',
      value: null,
      display: String(insights.newLeads),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'crm-customer-health',
      label: 'Customer Health',
      value: insights.customerHealthPct,
      display: `${insights.customerHealthPct}%`,
      band: healthBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'crm-followup-risk',
      label: 'Follow-up Risk',
      value: null,
      display: `${insights.followUpRisk} at risk`,
      band: followUpBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'crm-high-value',
      label: 'High-Value Accounts',
      value: null,
      display: String(insights.highValueAccounts),
      deepLink: 'enterprise/modules',
    },
  ];
}

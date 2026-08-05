/**
 * Finance module — Invoice domain types + pure deterministic business logic.
 *
 * The Invoice "entity" is a typed *projection* of the framework's flat
 * `EnterpriseEntity` (its `fields` bag), not a second store — the Enterprise
 * Module Framework owns persistence, CRUD, RBAC, audit, timeline, search, and UI.
 * This file adds the finance-specific typing + the DETERMINISTIC amount/tax/
 * balance/due-date/payment-status/collection-risk rules the AI explains but never
 * replaces, the invoice lifecycle transitions, and the aggregate insights the
 * Executive Center surfaces. Pure (no I/O), so it is shared by the backend hooks,
 * the renderer, and the tests.
 */
import type { EnterpriseEntity, EnterpriseFieldValue, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

/** The business status of an invoice (distinct from the record lifecycle). */
export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
];

/** Statuses a user/action may set directly (paid/partially_paid derive from payment; overdue is derived). */
export const SETTABLE_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'cancelled',
];

/** Unpaid, still-collectable statuses. */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'issued',
  'partially_paid',
  'overdue',
];

export type InvoicePaymentTerms = 'prepaid' | 'net15' | 'net30' | 'net45' | 'net60';
const TERM_DAYS: Record<string, number> = { prepaid: 0, net15: 15, net30: 30, net45: 45, net60: 60 };

/** The Finance module id + record kind (the framework store key). */
export const FINANCE_MODULE_ID = 'finance';
export const INVOICE_KIND = 'invoice';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A typed view over an invoice record's flat fields. Named `FinanceInvoice` to
 * avoid colliding with the ecosystem billing `Invoice` type. `amount` is the
 * pre-tax subtotal; the tax-inclusive figure is `calculateInvoiceAmount`.
 */
export interface FinanceInvoice {
  id: string;
  number: string;
  customer: string;
  amount: number;
  taxRate: number;
  amountPaid: number;
  currency: string;
  status: InvoiceStatus;
  paymentTerms: string;
  issueDate: string | null;
  dueDate: string | null;
  sourceOrder: string;
  notes: string | null;
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function asString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(asString(v)) || 0;
}

function asStatus(v: unknown): InvoiceStatus {
  const s = asString(v);
  // Backward compatibility: the pre-lifecycle module used 'sent' for 'issued'.
  if (s === 'sent') return 'issued';
  return (INVOICE_STATUSES as readonly string[]).includes(s) ? (s as InvoiceStatus) : 'draft';
}

/** Project a framework record into a typed invoice. */
export function invoiceFromRecord(record: EnterpriseEntity): FinanceInvoice {
  const f = record.fields;
  return {
    id: record.id,
    number: asString(f.number) || record.title,
    customer: asString(f.customer),
    amount: num(f.amount),
    taxRate: num(f.taxRate),
    amountPaid: num(f.amountPaid),
    currency: asString(f.currency) || 'USD',
    status: asStatus(f.status),
    paymentTerms: asString(f.paymentTerms),
    issueDate: asString(f.issueDate) || null,
    dueDate: asString(f.dueDate) || null,
    sourceOrder: asString(f.sourceOrder),
    notes: asString(f.notes) || null,
  };
}

/* ── deterministic business logic (AI explains; it never sets these) ───────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Tax on the subtotal at the invoice's rate. Deterministic. */
export function calculateTaxAmount(invoice: FinanceInvoice): number {
  return Math.round(Math.max(0, invoice.amount) * (Math.max(0, invoice.taxRate) / 100));
}

/** The authoritative invoice total: subtotal + tax. Deterministic. */
export function calculateInvoiceAmount(invoice: FinanceInvoice): number {
  return Math.round(Math.max(0, invoice.amount) + calculateTaxAmount(invoice));
}

/** Outstanding balance: total − amount paid (never negative). Deterministic. */
export function calculateOutstandingBalance(invoice: FinanceInvoice): number {
  return Math.max(0, calculateInvoiceAmount(invoice) - Math.max(0, invoice.amountPaid));
}

/** Due date from an issue date + payment terms (YYYY-MM-DD), or '' if no issue date. */
export function calculateDueDate(issueDate: string, paymentTerms: string): string {
  if (!issueDate) return '';
  const base = Date.parse(issueDate);
  if (!Number.isFinite(base)) return '';
  const days = TERM_DAYS[paymentTerms] ?? 30;
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The effective, live payment status — folds in partial payment and overdue
 * (past due date with an outstanding balance). Deterministic; the AI never sets it.
 */
export function calculatePaymentStatus(invoice: FinanceInvoice, nowMs: number): InvoiceStatus {
  if (invoice.status === 'cancelled') return 'cancelled';
  const total = calculateInvoiceAmount(invoice);
  const outstanding = calculateOutstandingBalance(invoice);
  if (total > 0 && outstanding === 0) return 'paid';
  if (invoice.status === 'draft' && invoice.amountPaid <= 0) return 'draft';
  const dueMs = invoice.dueDate ? Date.parse(invoice.dueDate) : NaN;
  if (Number.isFinite(dueMs) && dueMs < nowMs && outstanding > 0) return 'overdue';
  if (invoice.amountPaid > 0) return 'partially_paid';
  return 'issued';
}

/**
 * Collection risk 0..100 — rises with days overdue and the share still outstanding.
 * Paid/cancelled carry none. Deterministic.
 */
export function calculateCollectionRisk(invoice: FinanceInvoice, nowMs: number): number {
  if (invoice.status === 'cancelled') return 0;
  const total = calculateInvoiceAmount(invoice);
  const outstanding = calculateOutstandingBalance(invoice);
  if (total <= 0 || outstanding === 0) return 0;
  const outstandingShare = outstanding / total; // 0..1
  let risk = 0;
  const dueMs = invoice.dueDate ? Date.parse(invoice.dueDate) : NaN;
  if (Number.isFinite(dueMs)) {
    const overdueDays = (nowMs - dueMs) / DAY_MS;
    if (overdueDays > 0) risk = 50 + overdueDays * 2;
    else if (overdueDays > -7) risk = 25; // due within a week
  }
  risk *= outstandingShare;
  if (invoice.status === 'draft') risk = Math.min(risk, 10); // not yet issued
  return clamp(Math.round(risk), 0, 100);
}

export interface InvoiceRisk {
  level: EnterpriseRiskLevel;
  reason: string;
}

/**
 * Deterministic invoice risk band — the authoritative signal the AI narrates but
 * never overrides. Kept for backward compatibility; now derives from the live
 * payment status + collection risk.
 */
export function assessInvoiceRisk(invoice: FinanceInvoice, nowMs: number): InvoiceRisk {
  const effective = calculatePaymentStatus(invoice, nowMs);
  if (effective === 'paid') return { level: 'low', reason: 'Invoice is paid.' };
  if (effective === 'cancelled') return { level: 'low', reason: 'Invoice is cancelled.' };
  if (effective === 'overdue') {
    const dueMs = invoice.dueDate ? Date.parse(invoice.dueDate) : NaN;
    const days = Number.isFinite(dueMs) ? Math.abs(Math.round((nowMs - dueMs) / DAY_MS)) : 0;
    return { level: 'high', reason: `Overdue by ${days} day(s) and unpaid.` };
  }
  const dueMs = invoice.dueDate ? Date.parse(invoice.dueDate) : NaN;
  if (Number.isFinite(dueMs)) {
    const diffDays = Math.round((dueMs - nowMs) / DAY_MS);
    if (diffDays <= 7 && (effective === 'issued' || effective === 'partially_paid')) {
      return { level: 'medium', reason: `Due in ${diffDays} day(s) and unpaid.` };
    }
  }
  if (effective === 'partially_paid') return { level: 'medium', reason: 'Partially paid.' };
  if (effective === 'draft') return { level: 'low', reason: 'Draft — not yet issued.' };
  return { level: 'low', reason: 'Issued and not yet due.' };
}

/** Simple, currency-agnostic money format ("USD 1,250.00"). */
export function formatInvoiceAmount(amount: number, currency: string): string {
  const n = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${n}`;
}

/** The now-independent computed fields stamped onto every invoice write. */
export function invoiceComputedFields(invoice: FinanceInvoice): Record<string, EnterpriseFieldValue> {
  return {
    taxAmount: calculateTaxAmount(invoice),
    total: calculateInvoiceAmount(invoice),
    outstandingBalance: calculateOutstandingBalance(invoice),
  };
}

/**
 * The stored status derived from the entered status + payment (time-independent;
 * `overdue` is never stored — it is derived live by `calculatePaymentStatus`).
 */
export function deriveStoredInvoiceStatus(
  entered: InvoiceStatus,
  invoice: FinanceInvoice,
): InvoiceStatus {
  if (entered === 'cancelled') return 'cancelled';
  const total = calculateInvoiceAmount(invoice);
  const outstanding = calculateOutstandingBalance(invoice);
  if (total > 0 && outstanding === 0) return 'paid';
  if (invoice.amountPaid > 0) return 'partially_paid';
  return entered === 'draft' ? 'draft' : 'issued';
}

/* ── lifecycle transitions (deterministic; the actions apply these) ────────── */

export type InvoiceAction = 'issue' | 'markPaid' | 'cancel';

const ACTION_LEGAL: Record<InvoiceAction, (from: InvoiceStatus) => boolean> = {
  issue: (from) => from === 'draft',
  markPaid: (from) => from === 'issued' || from === 'partially_paid' || from === 'overdue',
  cancel: (from) => from !== 'paid' && from !== 'cancelled',
};

/**
 * The deterministic field patch a lifecycle action applies, or null when the
 * transition is illegal from the invoice's current *effective* status. `nowIso`
 * is the injected clock (ISO); date fields are stamped as YYYY-MM-DD.
 */
export function invoiceActionPatch(
  action: InvoiceAction,
  invoice: FinanceInvoice,
  nowMs: number,
  nowIso: string,
): Record<string, EnterpriseFieldValue> | null {
  const effective = calculatePaymentStatus(invoice, nowMs);
  if (!ACTION_LEGAL[action](effective)) return null;
  const day = nowIso.slice(0, 10);
  if (action === 'issue') {
    const issueDate = invoice.issueDate || day;
    return {
      status: 'issued',
      issueDate,
      dueDate: invoice.dueDate || calculateDueDate(issueDate, invoice.paymentTerms),
    };
  }
  if (action === 'markPaid') {
    return { status: 'paid', amountPaid: calculateInvoiceAmount(invoice) };
  }
  return { status: 'cancelled' }; // cancel
}

export interface InvoiceSignals {
  effectiveStatus: InvoiceStatus;
  risk: InvoiceRisk;
  total: number;
  outstanding: number;
  collectionRisk: number;
}

/** Compute every deterministic signal for an invoice at once. */
export function computeInvoiceSignals(invoice: FinanceInvoice, nowMs: number): InvoiceSignals {
  return {
    effectiveStatus: calculatePaymentStatus(invoice, nowMs),
    risk: assessInvoiceRisk(invoice, nowMs),
    total: calculateInvoiceAmount(invoice),
    outstanding: calculateOutstandingBalance(invoice),
    collectionRisk: calculateCollectionRisk(invoice, nowMs),
  };
}

/** Deterministic summary text — the fallback when no model is configured. */
export function invoiceSummaryFallback(
  invoice: FinanceInvoice,
  risk: InvoiceRisk,
): { summary: string; executiveExplanation: string } {
  const total = calculateInvoiceAmount(invoice);
  const outstanding = calculateOutstandingBalance(invoice);
  const money = formatInvoiceAmount(total, invoice.currency);
  const who = invoice.customer || 'an unnamed customer';
  const summary =
    `Invoice ${invoice.number} to ${who} for ${money} is ${invoiceStatusLabel(invoice.status).toLowerCase()}. ` +
    risk.reason;
  const executiveExplanation =
    outstanding > 0
      ? `${formatInvoiceAmount(outstanding, invoice.currency)} is outstanding from ${who}. Risk is ${risk.level} — ${risk.reason.toLowerCase()}`
      : `No cash is outstanding on this invoice (${invoiceStatusLabel(invoice.status).toLowerCase()}).`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface InvoiceModuleInsights {
  totalInvoices: number;
  totalInvoiced: number;
  outstandingReceivables: number;
  overdueAmount: number;
  paidAmount: number;
  highCollectionRisk: number;
  averagePaymentDays: number;
}

/** Roll a set of active invoices into the Finance receivables KPIs. Pure. */
export function deriveInvoiceInsights(
  invoices: FinanceInvoice[],
  nowMs: number,
): InvoiceModuleInsights {
  let totalInvoiced = 0;
  let outstanding = 0;
  let overdue = 0;
  let paid = 0;
  let highRisk = 0;
  let paymentDaysSum = 0;
  let paidWithDates = 0;
  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue;
    const total = calculateInvoiceAmount(inv);
    const out = calculateOutstandingBalance(inv);
    const effective = calculatePaymentStatus(inv, nowMs);
    totalInvoiced += total;
    outstanding += out;
    paid += Math.max(0, inv.amountPaid);
    if (effective === 'overdue') overdue += out;
    if (calculateCollectionRisk(inv, nowMs) >= 70) highRisk += 1;
    if (effective === 'paid' && inv.issueDate && inv.dueDate) {
      // Approximate payment time as issue→due span for settled invoices.
      const issued = Date.parse(inv.issueDate);
      const settled = Date.parse(inv.dueDate);
      if (Number.isFinite(issued) && Number.isFinite(settled) && settled >= issued) {
        paymentDaysSum += (settled - issued) / DAY_MS;
        paidWithDates += 1;
      }
    }
  }
  return {
    totalInvoices: invoices.length,
    totalInvoiced: Math.round(totalInvoiced),
    outstandingReceivables: Math.round(outstanding),
    overdueAmount: Math.round(overdue),
    paidAmount: Math.round(paid),
    highCollectionRisk: highRisk,
    averagePaymentDays: paidWithDates === 0 ? 0 : Math.round(paymentDaysSum / paidWithDates),
  };
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Map invoice insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function invoiceInsightsToKpis(insights: InvoiceModuleInsights): ExecutiveKpi[] {
  const overdueBand: ExecutiveKpi['band'] =
    insights.overdueAmount === 0 ? 'healthy' : insights.overdueAmount <= insights.totalInvoiced * 0.1 ? 'watch' : 'at-risk';
  const riskBand: ExecutiveKpi['band'] =
    insights.highCollectionRisk === 0 ? 'healthy' : insights.highCollectionRisk <= 3 ? 'watch' : 'at-risk';
  return [
    { key: 'inv-total', label: 'Total Invoiced', value: null, display: money(insights.totalInvoiced), deepLink: 'enterprise/modules' },
    { key: 'inv-outstanding', label: 'Outstanding Receivables', value: null, display: money(insights.outstandingReceivables), deepLink: 'enterprise/modules' },
    {
      key: 'inv-overdue',
      label: 'Overdue Amount',
      value: null,
      display: money(insights.overdueAmount),
      band: overdueBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'inv-paid', label: 'Paid Amount', value: null, display: money(insights.paidAmount), deepLink: 'enterprise/modules' },
    {
      key: 'inv-collection-risk',
      label: 'High Collection Risk',
      value: null,
      display: `${insights.highCollectionRisk} at risk`,
      band: riskBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'inv-payment-time', label: 'Avg Payment Time', value: insights.averagePaymentDays, display: `${insights.averagePaymentDays}d`, deepLink: 'enterprise/modules' },
  ];
}

/* ── receivables aging (W1.5) — pure bucketing over open invoices ── */

/** The Receivables Aging module id + record kind (the framework store key). */
export const AR_AGING_MODULE_ID = 'finance-ar-aging';
export const AR_AGING_KIND = 'arAgingReport';

export type ArAgingBucket = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90plus';

/** One open invoice's row in an aging view. */
export interface ArAgingRow {
  invoiceNumber: string;
  customer: string;
  dueDate: string;
  outstanding: number;
  daysOverdue: number;
  bucket: ArAgingBucket;
}

export interface ArAging {
  totalOutstanding: number;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  invoiceCount: number;
  rows: ArAgingRow[];
}

/** Bucket a days-overdue count (≤0 — including no due date — is current). */
export function arAgingBucketFor(daysOverdue: number): ArAgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
  return 'days90plus';
}

/**
 * Derive the receivables aging view at a moment in time. DETERMINISTIC and
 * pure: only issued-side invoices with a real outstanding balance appear
 * (drafts, cancelled, and settled invoices never age), days-overdue counts
 * whole days past the due date at `nowMs`, and an invoice without a due date
 * sits in `current` (it cannot be overdue by a date it does not have). Payables
 * aging deliberately does not exist yet — there is no vendor-bill module to age
 * — and is added with Procurement completion, not faked here.
 */
export function deriveArAging(invoices: readonly FinanceInvoice[], nowMs: number): ArAging {
  const rows: ArAgingRow[] = [];
  for (const inv of invoices) {
    const effective = calculatePaymentStatus(inv, nowMs);
    if (effective === 'draft' || effective === 'cancelled' || effective === 'paid') continue;
    const outstanding = calculateOutstandingBalance(inv);
    if (outstanding <= 0) continue;
    let daysOverdue = 0;
    if (inv.dueDate) {
      const due = Date.parse(inv.dueDate);
      if (Number.isFinite(due)) daysOverdue = Math.max(0, Math.floor((nowMs - due) / DAY_MS));
    }
    rows.push({
      invoiceNumber: inv.number,
      customer: inv.customer,
      dueDate: inv.dueDate ?? '',
      outstanding,
      daysOverdue,
      bucket: arAgingBucketFor(daysOverdue),
    });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);
  const sum = (bucket: ArAgingBucket): number =>
    rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.outstanding, 0);
  const buckets = {
    current: sum('current'),
    days1to30: sum('days1to30'),
    days31to60: sum('days31to60'),
    days61to90: sum('days61to90'),
    days90plus: sum('days90plus'),
  };
  return {
    totalOutstanding: buckets.current + buckets.days1to30 + buckets.days31to60 + buckets.days61to90 + buckets.days90plus,
    ...buckets,
    invoiceCount: rows.length,
    rows,
  };
}

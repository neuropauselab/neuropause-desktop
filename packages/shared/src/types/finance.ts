/**
 * Finance module — Invoice domain types + pure logic.
 *
 * The Invoice "entity" is a typed *projection* of the framework's flat
 * `EnterpriseEntity` (its `fields` bag), not a second store — the Enterprise
 * Module Framework owns persistence, CRUD, RBAC, audit, timeline, and UI. This
 * file only adds the finance-specific typing + the deterministic risk/summary
 * logic that the AI pipeline explains on top of. Pure, so it is shared by the
 * backend summarize hook, the renderer, and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The business status of an invoice (distinct from the record lifecycle). */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'paid', 'cancelled'];

/** The Finance module id + record kind (the framework store key). */
export const FINANCE_MODULE_ID = 'finance';
export const INVOICE_KIND = 'invoice';

/**
 * A typed view over an invoice record's flat fields. Named `FinanceInvoice` to
 * avoid colliding with the ecosystem billing `Invoice` type.
 */
export interface FinanceInvoice {
  id: string;
  number: string;
  customer: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function asString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function asStatus(v: unknown): InvoiceStatus {
  const s = asString(v);
  return (INVOICE_STATUSES as readonly string[]).includes(s) ? (s as InvoiceStatus) : 'draft';
}

/** Project a framework record into a typed invoice. */
export function invoiceFromRecord(record: EnterpriseEntity): FinanceInvoice {
  const f = record.fields;
  const amountRaw = f.amount;
  return {
    id: record.id,
    number: asString(f.number) || record.title,
    customer: asString(f.customer),
    amount: typeof amountRaw === 'number' ? amountRaw : Number(asString(amountRaw)) || 0,
    currency: asString(f.currency) || 'USD',
    status: asStatus(f.status),
    issueDate: asString(f.issueDate) || null,
    dueDate: asString(f.dueDate) || null,
    notes: asString(f.notes) || null,
  };
}

export interface InvoiceRisk {
  level: EnterpriseRiskLevel;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic invoice risk — the authoritative signal the AI narrates but
 * never overrides. Overdue unpaid invoices are high risk; those due within a
 * week are medium; paid/cancelled/comfortably-future are low.
 */
export function assessInvoiceRisk(invoice: FinanceInvoice, nowMs: number): InvoiceRisk {
  if (invoice.status === 'paid') return { level: 'low', reason: 'Invoice is paid.' };
  if (invoice.status === 'cancelled') return { level: 'low', reason: 'Invoice is cancelled.' };

  const dueMs = invoice.dueDate ? Date.parse(invoice.dueDate) : NaN;
  if (Number.isFinite(dueMs)) {
    const diffDays = Math.round((dueMs - nowMs) / DAY_MS);
    if (diffDays < 0) {
      return { level: 'high', reason: `Overdue by ${Math.abs(diffDays)} day(s) and unpaid.` };
    }
    if (diffDays <= 7) {
      return { level: 'medium', reason: `Due in ${diffDays} day(s) and unpaid.` };
    }
  }
  if (invoice.status === 'draft') return { level: 'low', reason: 'Draft — not yet sent.' };
  return { level: 'low', reason: 'Sent and not yet due.' };
}

/** Simple, currency-agnostic money format ("USD 1,250.00"). */
export function formatInvoiceAmount(amount: number, currency: string): string {
  const n = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${n}`;
}

/** Deterministic summary text — the fallback when no model is configured. */
export function invoiceSummaryFallback(
  invoice: FinanceInvoice,
  risk: InvoiceRisk,
): { summary: string; executiveExplanation: string } {
  const money = formatInvoiceAmount(invoice.amount, invoice.currency);
  const who = invoice.customer || 'an unnamed customer';
  const summary =
    `Invoice ${invoice.number} to ${who} for ${money} is ${invoiceStatusLabel(invoice.status).toLowerCase()}. ` +
    risk.reason;
  const outstanding = invoice.status === 'sent' || invoice.status === 'draft';
  const executiveExplanation = outstanding
    ? `${money} is outstanding from ${who}. Risk is ${risk.level} — ${risk.reason.toLowerCase()}`
    : `No cash is outstanding on this invoice (${invoiceStatusLabel(invoice.status).toLowerCase()}).`;
  return { summary, executiveExplanation };
}

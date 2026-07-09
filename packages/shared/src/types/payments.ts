/**
 * Finance → Payments — Payment domain types + pure deterministic business logic.
 *
 * A Payment is a REAL, independent record (a typed projection of the framework's
 * flat `EnterpriseEntity`) — never derived from invoice status. It is the source
 * of truth for how much has been collected: an invoice's paid amount, outstanding
 * balance, and status are RECONCILED from the payment ledger, not the reverse.
 * This file adds the payment typing and the DETERMINISTIC ledger rules
 * (`calculatePaidAmount`, `calculateCashReceived`, `calculateInvoiceOutstanding`,
 * `calculatePaymentCompletion`, `calculateLatePaymentRisk`, `calculatePaymentHealth`,
 * `identifyCollectionProblems`) the AI explains but never replaces, plus the
 * aggregate insights the Executive Center surfaces. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';
import type { FinanceInvoice } from './finance';
import { calculateInvoiceAmount } from './finance';

/** A payment's clearing status. Only non-void payments count toward an invoice. */
export type PaymentStatus = 'pending' | 'cleared' | 'void';
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['pending', 'cleared', 'void'];

export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'bank_transfer',
  'card',
  'cash',
  'cheque',
  'other',
];

/** The Payments module id + record kind (the framework store key). */
export const PAYMENTS_MODULE_ID = 'finance-payments';
export const PAYMENT_KIND = 'payment';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A typed view over a payment record's flat fields (+ envelope timestamps). */
export interface SalesPayment {
  id: string;
  paymentNumber: string;
  invoiceRef: string;
  customer: string;
  amount: number;
  currency: string;
  method: string;
  transactionRef: string;
  receivedDate: string;
  bankAccount: string;
  status: PaymentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending',
  cleared: 'Cleared',
  void: 'Void',
};
export function paymentStatusLabel(status: PaymentStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank Transfer',
  card: 'Card',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
};
export function paymentMethodLabel(method: string): string {
  return METHOD_LABELS[method as PaymentMethod] ?? method;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStatus(v: unknown): PaymentStatus {
  const s = str(v);
  return (PAYMENT_STATUSES as readonly string[]).includes(s) ? (s as PaymentStatus) : 'cleared';
}

/** Project a framework record into a typed payment. */
export function paymentFromRecord(record: EnterpriseEntity): SalesPayment {
  const f = record.fields;
  return {
    id: record.id,
    paymentNumber: str(f.paymentNumber) || record.title,
    invoiceRef: str(f.invoiceRef),
    customer: str(f.customer),
    amount: num(f.amount),
    currency: str(f.currency) || 'USD',
    method: str(f.method),
    transactionRef: str(f.transactionRef),
    receivedDate: str(f.receivedDate),
    bankAccount: str(f.bankAccount),
    status: asStatus(f.status),
    notes: str(f.notes),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic ledger logic (AI explains; it never sets these) ─────────── */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** A payment counts against the invoice unless it has been voided. */
export function isApplied(payment: SalesPayment): boolean {
  return payment.status !== 'void';
}
/** A payment is cash-in-hand only once cleared. */
export function isCleared(payment: SalesPayment): boolean {
  return payment.status === 'cleared';
}

/** Total applied (non-void) payment amount. Deterministic. */
export function calculatePaidAmount(payments: SalesPayment[]): number {
  return Math.round(payments.filter(isApplied).reduce((s, p) => s + Math.max(0, p.amount), 0));
}

/** Total cleared payment amount — real cash received. Deterministic. */
export function calculateCashReceived(payments: SalesPayment[]): number {
  return Math.round(payments.filter(isCleared).reduce((s, p) => s + Math.max(0, p.amount), 0));
}

/** Outstanding balance from the ledger: total − applied payments (never negative). */
export function calculateInvoiceOutstanding(invoiceTotal: number, payments: SalesPayment[]): number {
  return Math.max(0, Math.round(invoiceTotal) - calculatePaidAmount(payments));
}

/** Payment completion 0..100 — share of the invoice total collected. Deterministic. */
export function calculatePaymentCompletion(invoiceTotal: number, payments: SalesPayment[]): number {
  if (invoiceTotal <= 0) return 0;
  return clamp(Math.round((calculatePaidAmount(payments) / invoiceTotal) * 100), 0, 100);
}

/**
 * Late-payment risk 0..100 — the chance the remaining balance is collected late,
 * rising with days overdue and the outstanding share. Zero once settled. Pure.
 */
export function calculateLatePaymentRisk(
  invoiceTotal: number,
  dueDate: string,
  payments: SalesPayment[],
  nowMs: number,
): number {
  const outstanding = calculateInvoiceOutstanding(invoiceTotal, payments);
  if (invoiceTotal <= 0 || outstanding === 0) return 0;
  const share = outstanding / invoiceTotal;
  let risk = 0;
  const dueMs = dueDate ? Date.parse(dueDate) : NaN;
  if (Number.isFinite(dueMs)) {
    const overdueDays = (nowMs - dueMs) / DAY_MS;
    if (overdueDays > 0) risk = 50 + overdueDays * 2;
    else if (overdueDays > -7) risk = 25;
  }
  return clamp(Math.round(risk * share), 0, 100);
}

/** Deterministic health of a single payment record. */
export function calculatePaymentHealth(payment: SalesPayment): {
  level: EnterpriseRiskLevel;
  reason: string;
} {
  if (payment.status === 'void') return { level: 'low', reason: 'Payment voided.' };
  if (payment.status === 'pending') return { level: 'medium', reason: 'Awaiting clearance.' };
  return { level: 'low', reason: 'Cleared.' };
}

/** The value the reconciler writes to `invoice.amountPaid` (applied ledger sum). */
export function deriveInvoiceAmountPaid(payments: SalesPayment[]): number {
  return calculatePaidAmount(payments);
}

/** Whether a transaction reference is already used by a DIFFERENT payment. */
export function isDuplicateTransaction(
  payments: SalesPayment[],
  transactionRef: string,
  selfPaymentNumber: string,
): boolean {
  const ref = transactionRef.trim();
  if (!ref) return false;
  return payments.some(
    (p) => p.transactionRef.trim() === ref && p.paymentNumber !== selfPaymentNumber,
  );
}

export interface InvoiceCollectionInput {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  dueDate: string;
  payments: SalesPayment[];
}

/** Invoices with an outstanding balance whose due date has passed. Deterministic. */
export function identifyCollectionProblems(
  rows: InvoiceCollectionInput[],
  nowMs: number,
): InvoiceCollectionInput[] {
  return rows.filter((r) => {
    if (calculateInvoiceOutstanding(r.invoiceTotal, r.payments) <= 0) return false;
    const dueMs = r.dueDate ? Date.parse(r.dueDate) : NaN;
    return Number.isFinite(dueMs) && dueMs < nowMs;
  });
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic summary text — the fallback when no model is configured. */
export function paymentSummaryFallback(payment: SalesPayment): {
  summary: string;
  executiveExplanation: string;
} {
  const health = calculatePaymentHealth(payment);
  const amount = `${payment.currency} ${money(payment.amount)}`;
  const summary =
    `Payment ${payment.paymentNumber} of ${amount} from ${payment.customer || 'a customer'} ` +
    `via ${paymentMethodLabel(payment.method) || 'an unspecified method'} is ${paymentStatusLabel(payment.status).toLowerCase()}` +
    (payment.invoiceRef ? ` against invoice ${payment.invoiceRef}. ` : '. ') +
    health.reason;
  const executiveExplanation =
    payment.status === 'cleared'
      ? `${amount} in cash received from ${payment.customer || 'a customer'}.`
      : `${amount} recorded from ${payment.customer || 'a customer'} — ${health.reason.toLowerCase()}`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) — payments joined to invoices ───── */

export interface PaymentModuleInsights {
  totalPayments: number;
  cashReceived: number;
  collectionRate: number;
  latePayments: number;
  averageCollectionDays: number;
}

/** Group applied payments by the invoice they reference (id or number). */
function paymentsByInvoice(payments: SalesPayment[], invoices: FinanceInvoice[]): Map<string, SalesPayment[]> {
  const byId = new Map<string, FinanceInvoice>();
  const byNumber = new Map<string, FinanceInvoice>();
  for (const inv of invoices) {
    byId.set(inv.id, inv);
    if (inv.number) byNumber.set(inv.number, inv);
  }
  const out = new Map<string, SalesPayment[]>();
  for (const p of payments) {
    const inv = byId.get(p.invoiceRef) ?? byNumber.get(p.invoiceRef);
    if (!inv) continue;
    const list = out.get(inv.id) ?? [];
    list.push(p);
    out.set(inv.id, list);
  }
  return out;
}

/**
 * Roll the payment ledger (joined to invoices) into the Finance collection KPIs.
 * Pure. `nowMs` reserved for future time-bucketed metrics.
 */
export function derivePaymentInsights(
  payments: SalesPayment[],
  invoices: FinanceInvoice[],
  _nowMs: number,
): PaymentModuleInsights {
  const grouped = paymentsByInvoice(payments, invoices);
  const invById = new Map(invoices.map((i) => [i.id, i]));

  let totalInvoiced = 0;
  let totalCollected = 0;
  let latePayments = 0;
  let collectionDaysSum = 0;
  let settledCount = 0;

  for (const [invId, invPayments] of grouped) {
    const inv = invById.get(invId);
    if (!inv || inv.status === 'cancelled') continue;
    const total = calculateInvoiceAmount(inv);
    const paid = calculatePaidAmount(invPayments);
    totalInvoiced += total;
    totalCollected += Math.min(paid, total);

    const dueMs = inv.dueDate ? Date.parse(inv.dueDate) : NaN;
    for (const p of invPayments.filter(isApplied)) {
      const recMs = p.receivedDate ? Date.parse(p.receivedDate) : NaN;
      if (Number.isFinite(dueMs) && Number.isFinite(recMs) && recMs > dueMs) latePayments += 1;
    }

    // Fully-paid invoice → collection time from issue to the last applied payment.
    if (paid >= total && total > 0 && inv.issueDate) {
      const issued = Date.parse(inv.issueDate);
      const lastPaid = invPayments
        .filter(isApplied)
        .map((p) => (p.receivedDate ? Date.parse(p.receivedDate) : NaN))
        .filter((n) => Number.isFinite(n));
      if (Number.isFinite(issued) && lastPaid.length > 0) {
        const settledMs = Math.max(...lastPaid);
        if (settledMs >= issued) {
          collectionDaysSum += (settledMs - issued) / DAY_MS;
          settledCount += 1;
        }
      }
    }
  }

  return {
    totalPayments: payments.filter(isApplied).length,
    cashReceived: calculateCashReceived(payments),
    collectionRate: totalInvoiced === 0 ? 0 : clamp(Math.round((totalCollected / totalInvoiced) * 100), 0, 100),
    latePayments,
    averageCollectionDays: settledCount === 0 ? 0 : Math.round(collectionDaysSum / settledCount),
  };
}

/** Map payment insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function paymentInsightsToKpis(insights: PaymentModuleInsights): ExecutiveKpi[] {
  const rateBand: ExecutiveKpi['band'] =
    insights.collectionRate >= 80 ? 'healthy' : insights.collectionRate >= 50 ? 'watch' : 'at-risk';
  const lateBand: ExecutiveKpi['band'] =
    insights.latePayments === 0 ? 'healthy' : insights.latePayments <= 3 ? 'watch' : 'at-risk';
  return [
    { key: 'pay-cash-received', label: 'Cash Received', value: null, display: money(insights.cashReceived), deepLink: 'enterprise/modules' },
    {
      key: 'pay-collection-rate',
      label: 'Collection Rate',
      value: insights.collectionRate,
      display: `${insights.collectionRate}%`,
      band: rateBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'pay-late',
      label: 'Late Payments',
      value: null,
      display: `${insights.latePayments} late`,
      band: lateBand,
      deepLink: 'enterprise/modules',
    },
    { key: 'pay-avg-collection', label: 'Avg Collection Time', value: insights.averageCollectionDays, display: `${insights.averageCollectionDays}d`, deepLink: 'enterprise/modules' },
    { key: 'pay-count', label: 'Payments Recorded', value: null, display: String(insights.totalPayments), deepLink: 'enterprise/modules' },
  ];
}

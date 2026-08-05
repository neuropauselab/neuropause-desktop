/**
 * Finance → Vendor Bills — the payable mirror of invoices: domain types and
 * the pure, DETERMINISTIC payable rules the Vendor Bills module enforces, plus
 * AP aging (the mirror of `deriveArAging`).
 *
 * A VendorBill is a typed *projection* of the framework's flat
 * `EnterpriseEntity` (same blueprint as invoices). Money stamps (tax, total,
 * outstanding) are computed, never typed; approving a bill books
 * Dr Operating Expense + Dr GST Input Credit / Cr Accounts Payable, and
 * recording payment books Dr Accounts Payable / Cr Cash — through the same
 * idempotent auto-posting seam invoices use. Pure (no I/O); the AI explains,
 * never posts.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import { GL_CONTROL_ACCOUNTS, type GlJournalLine } from './generalLedger';

/** The Vendor Bills module id + record kind (the framework store key). */
export const VENDOR_BILLS_MODULE_ID = 'finance-vendor-bills';
export const VENDOR_BILL_KIND = 'vendorBill';

/** The AP Aging module id + record kind (the framework store key). */
export const AP_AGING_MODULE_ID = 'finance-ap-aging';
export const AP_AGING_KIND = 'apAgingReport';

/** Additional payable-side control accounts (seeded only into an empty chart). */
export const GL_PAYABLE_CONTROL_ACCOUNTS = {
  accountsPayable: { code: '2000', name: 'Accounts Payable', accountClass: 'liability' as const },
  gstInputCredit: { code: '1200', name: 'GST Input Credit', accountClass: 'asset' as const },
  operatingExpense: { code: '5000', name: 'Operating Expenses', accountClass: 'expense' as const },
} as const;

export type VendorBillStatus = 'draft' | 'approved' | 'paid' | 'cancelled';
export const VENDOR_BILL_STATUSES: readonly VendorBillStatus[] = ['draft', 'approved', 'paid', 'cancelled'];

/** A typed view over a vendor-bill record's flat fields (+ envelope). */
export interface VendorBill {
  id: string;
  billNumber: string;
  vendor: string;
  vendorGstin: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: VendorBillStatus;
  billDate: string;
  dueDate: string;
  paidDate: string;
  paymentReference: string;
  sourcePurchaseOrder: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isVendorBillStatus(value: unknown): value is VendorBillStatus {
  return VENDOR_BILL_STATUSES.includes(value as VendorBillStatus);
}

export function calculateBillTax(amount: number, taxRate: number): number {
  return Math.round(amount * taxRate) / 100;
}

/** Project a vendor-bill record into its typed view (money stamps recomputed). */
export function vendorBillFromRecord(record: EnterpriseEntity): VendorBill {
  const f = record.fields;
  const amount = num(f.amount);
  const taxRate = num(f.taxRate);
  const taxAmount = calculateBillTax(amount, taxRate);
  const status = isVendorBillStatus(f.status) ? f.status : 'draft';
  return {
    id: record.id,
    billNumber: str(f.billNumber).trim(),
    vendor: str(f.vendor),
    vendorGstin: str(f.vendorGstin),
    amount,
    taxRate,
    taxAmount,
    total: Math.round((amount + taxAmount) * 100) / 100,
    currency: str(f.currency) || 'USD',
    status,
    billDate: str(f.billDate),
    dueDate: str(f.dueDate),
    paidDate: str(f.paidDate),
    paymentReference: str(f.paymentReference),
    sourcePurchaseOrder: str(f.sourcePurchaseOrder),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Deterministic entry numbers — the idempotency keys of bill auto-posting. */
export function glBillEntryNumber(billNumber: string): string {
  return `JE-BILL-${billNumber}`;
}
export function glBillPaymentEntryNumber(billNumber: string): string {
  return `JE-BILLPAY-${billNumber}`;
}

/** The cumulative lines an APPROVED bill's CURRENT amounts imply. */
export function glBillExpectedLines(subtotal: number, taxAmount: number, total: number): GlJournalLine[] {
  return [
    { account: GL_PAYABLE_CONTROL_ACCOUNTS.operatingExpense.code, debit: subtotal, credit: 0 },
    ...(taxAmount > 0
      ? [{ account: GL_PAYABLE_CONTROL_ACCOUNTS.gstInputCredit.code, debit: taxAmount, credit: 0 }]
      : []),
    { account: GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code, debit: 0, credit: total },
  ];
}

/** The lines a PAID bill's settlement implies. */
export function glBillPaymentExpectedLines(total: number): GlJournalLine[] {
  return [
    { account: GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code, debit: total, credit: 0 },
    { account: GL_CONTROL_ACCOUNTS.cash.code, debit: 0, credit: total },
  ];
}

/* ── payables aging — the mirror of receivables aging ── */

export interface ApAgingRow {
  billNumber: string;
  vendor: string;
  dueDate: string;
  outstanding: number;
  daysOverdue: number;
  bucket: 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90plus';
}

export interface ApAging {
  totalOutstanding: number;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  billCount: number;
  rows: ApAgingRow[];
}

const DAY_MS = 86400000;

function apBucketFor(daysOverdue: number): ApAgingRow['bucket'] {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
  return 'days90plus';
}

/**
 * Derive the payables aging view at a moment in time. Only APPROVED, unpaid
 * bills age (drafts, paid, cancelled never do); an approved bill's outstanding
 * is its full total until the payment action records settlement; no due date
 * sits in `current`. DETERMINISTIC and pure — the AR mirror, same buckets,
 * same rules.
 */
export function deriveApAging(bills: readonly VendorBill[], nowMs: number): ApAging {
  const rows: ApAgingRow[] = [];
  for (const bill of bills) {
    if (bill.status !== 'approved') continue;
    if (bill.total <= 0) continue;
    let daysOverdue = 0;
    if (bill.dueDate) {
      const due = Date.parse(bill.dueDate);
      if (Number.isFinite(due)) daysOverdue = Math.max(0, Math.floor((nowMs - due) / DAY_MS));
    }
    rows.push({
      billNumber: bill.billNumber,
      vendor: bill.vendor,
      dueDate: bill.dueDate,
      outstanding: bill.total,
      daysOverdue,
      bucket: apBucketFor(daysOverdue),
    });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);
  const sum = (bucket: ApAgingRow['bucket']): number =>
    rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.outstanding, 0);
  const buckets = {
    current: sum('current'),
    days1to30: sum('days1to30'),
    days31to60: sum('days31to60'),
    days61to90: sum('days61to90'),
    days90plus: sum('days90plus'),
  };
  return {
    totalOutstanding:
      buckets.current + buckets.days1to30 + buckets.days31to60 + buckets.days61to90 + buckets.days90plus,
    ...buckets,
    billCount: rows.length,
    rows,
  };
}

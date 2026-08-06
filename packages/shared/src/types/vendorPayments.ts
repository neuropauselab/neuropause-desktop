/**
 * Finance → Vendor Payments — the payable settlement records, the exact mirror
 * of customer payments: domain types and the pure, DETERMINISTIC rules the
 * Vendor Payments module enforces.
 *
 * A VendorPayment is a typed *projection* of the framework's flat
 * `EnterpriseEntity`. Payments are the SOURCE OF TRUTH for settlement: a
 * vendor bill is paid when — and only when — its cleared payments cover its
 * total. Partial payments accumulate; overpaying past the bill's remaining
 * balance and duplicate transaction references are refused deterministically.
 * Each cleared payment books Dr Accounts Payable / Cr Cash (`JE-VPAY-*`,
 * idempotent); void or deletion reverses. This module RETIRES the bill-level
 * `markPaid` primitive W1.8 shipped as the honest interim. Pure (no I/O).
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Vendor Payments module id + record kind (the framework store key). */
export const VENDOR_PAYMENTS_MODULE_ID = 'finance-vendor-payments';
export const VENDOR_PAYMENT_KIND = 'vendorPayment';

export type VendorPaymentStatus = 'pending' | 'cleared' | 'void';

/** A typed view over a vendor-payment record's flat fields (+ envelope). */
export interface VendorPayment {
  id: string;
  paymentNumber: string;
  /** The settled bill's number or record id. */
  billRef: string;
  vendor: string;
  amount: number;
  currency: string;
  /**
   * W6-B8: units of functional currency per one unit of `currency` at
   * settlement. Defaults to 1 — a single-currency payment is unchanged. The
   * realized FX difference vs the bill's booking rate posts to P&L.
   */
  exchangeRate: number;
  method: string;
  status: VendorPaymentStatus;
  paidDate: string;
  transactionRef: string;
  bankAccount: string;
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

export function vendorPaymentFromRecord(record: EnterpriseEntity): VendorPayment {
  const f = record.fields;
  const status = str(f.status);
  return {
    id: record.id,
    paymentNumber: str(f.paymentNumber).trim(),
    billRef: str(f.billRef).trim(),
    vendor: str(f.vendor),
    amount: num(f.amount),
    currency: str(f.currency) || 'USD',
    exchangeRate: num(f.exchangeRate) || 1,
    method: str(f.method) || 'bank_transfer',
    status: status === 'pending' || status === 'void' ? status : 'cleared',
    paidDate: str(f.paidDate),
    transactionRef: str(f.transactionRef),
    bankAccount: str(f.bankAccount),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Σ cleared payments allocated to one bill reference (id or number). */
export function sumClearedVendorPayments(
  refs: readonly string[],
  payments: readonly VendorPayment[],
): number {
  const keys = new Set(refs.filter(Boolean));
  return (
    Math.round(
      payments
        .filter((p) => p.status === 'cleared' && keys.has(p.billRef))
        .reduce((s, p) => s + p.amount, 0) * 100,
    ) / 100
  );
}

/** True when another payment already carries this transaction reference. */
export function isDuplicateVendorTransaction(
  payments: readonly VendorPayment[],
  transactionRef: string,
  ownPaymentNumber: string,
): boolean {
  const ref = transactionRef.trim();
  if (!ref) return false;
  return payments.some((p) => p.transactionRef === ref && p.paymentNumber !== ownPaymentNumber);
}

/** Deterministic entry number — the idempotency key of settlement posting. */
export function glVendorPaymentEntryNumber(paymentNumber: string): string {
  return `JE-VPAY-${paymentNumber}`;
}

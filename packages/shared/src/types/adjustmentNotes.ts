/**
 * Finance → Credit Notes & Debit Notes — the adjustment documents of the
 * receivable and payable sides: domain types and the pure, DETERMINISTIC rules
 * the two note modules enforce.
 *
 * A note is a typed *projection* of the framework's flat `EnterpriseEntity`
 * (same blueprint as invoices/bills). A CREDIT note reduces an issued customer
 * invoice — issuing it books Dr Sales Revenue (+ Dr Tax Payable) / Cr Accounts
 * Receivable. A DEBIT note reduces an approved vendor bill — issuing it books
 * Dr Accounts Payable / Cr Operating Expense (+ Cr GST Input Credit). Both are
 * tax-aware, idempotent by entry number, and OVER-adjustment is refused
 * deterministically: the sum of issued notes against one document can never
 * exceed that document's total. Cancellation reverses the cumulative booking.
 * Pure (no I/O); the AI explains adjustments, never makes them.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import { GL_CONTROL_ACCOUNTS, type GlJournalLine } from './generalLedger';
import { GL_PAYABLE_CONTROL_ACCOUNTS, calculateBillTax } from './vendorBills';

/** The Credit Notes module id + record kind (the framework store key). */
export const CREDIT_NOTES_MODULE_ID = 'finance-credit-notes';
export const CREDIT_NOTE_KIND = 'creditNote';

/** The Debit Notes module id + record kind (the framework store key). */
export const DEBIT_NOTES_MODULE_ID = 'finance-debit-notes';
export const DEBIT_NOTE_KIND = 'debitNote';

export type AdjustmentNoteStatus = 'draft' | 'issued' | 'cancelled';

/** A typed view over a credit/debit-note record's flat fields (+ envelope). */
export interface AdjustmentNote {
  id: string;
  noteNumber: string;
  /** The adjusted document's number (invoice number for CN, bill number for DN). */
  documentRef: string;
  party: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  reason: string;
  status: AdjustmentNoteStatus;
  issuedAt: string;
  cancelledAt: string;
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

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Project a note record into its typed view (money stamps recomputed). */
export function adjustmentNoteFromRecord(record: EnterpriseEntity): AdjustmentNote {
  const f = record.fields;
  const amount = num(f.amount);
  const taxRate = num(f.taxRate);
  const taxAmount = calculateBillTax(amount, taxRate);
  const issuedAt = str(f.issuedAt);
  const cancelledAt = str(f.cancelledAt);
  return {
    id: record.id,
    noteNumber: str(f.noteNumber).trim(),
    documentRef: str(f.documentRef).trim(),
    party: str(f.party),
    amount,
    taxRate,
    taxAmount,
    total: round2(amount + taxAmount),
    currency: str(f.currency) || 'USD',
    reason: str(f.reason),
    status: cancelledAt ? 'cancelled' : issuedAt ? 'issued' : 'draft',
    issuedAt,
    cancelledAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Σ totals of ISSUED (not cancelled) notes against one document reference. */
export function sumIssuedNotesFor(documentRef: string, notes: readonly AdjustmentNote[]): number {
  return round2(
    notes
      .filter((n) => n.documentRef === documentRef && n.status === 'issued')
      .reduce((s, n) => s + n.total, 0),
  );
}

/**
 * The over-adjustment guard: issuing this note must not push the issued-note
 * total past the adjusted document's total. Returns '' when allowed, else the
 * stated refusal.
 */
export function overAdjustmentError(input: {
  documentTotal: number;
  alreadyIssued: number;
  noteTotal: number;
  documentLabel: string;
}): string {
  const after = round2(input.alreadyIssued + input.noteTotal);
  if (after <= round2(input.documentTotal)) return '';
  const remaining = round2(Math.max(0, input.documentTotal - input.alreadyIssued));
  return `Note exceeds the ${input.documentLabel}'s remaining adjustable amount (${remaining}).`;
}

/** Deterministic entry numbers — the idempotency keys of note posting. */
export function glCreditNoteEntryNumber(noteNumber: string): string {
  return `JE-CN-${noteNumber}`;
}
export function glDebitNoteEntryNumber(noteNumber: string): string {
  return `JE-DN-${noteNumber}`;
}

/** Credit note issue: Dr Revenue (+ Dr Tax Payable) / Cr Accounts Receivable. */
export function creditNoteIssueLines(subtotal: number, taxAmount: number, total: number): GlJournalLine[] {
  return [
    { account: GL_CONTROL_ACCOUNTS.salesRevenue.code, debit: subtotal, credit: 0 },
    ...(taxAmount > 0 ? [{ account: GL_CONTROL_ACCOUNTS.taxPayable.code, debit: taxAmount, credit: 0 }] : []),
    { account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: 0, credit: total },
  ];
}

/** Debit note issue: Dr Accounts Payable / Cr Expense (+ Cr GST Input Credit). */
export function debitNoteIssueLines(subtotal: number, taxAmount: number, total: number): GlJournalLine[] {
  return [
    { account: GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code, debit: total, credit: 0 },
    { account: GL_PAYABLE_CONTROL_ACCOUNTS.operatingExpense.code, debit: 0, credit: subtotal },
    ...(taxAmount > 0
      ? [{ account: GL_PAYABLE_CONTROL_ACCOUNTS.gstInputCredit.code, debit: 0, credit: taxAmount }]
      : []),
  ];
}

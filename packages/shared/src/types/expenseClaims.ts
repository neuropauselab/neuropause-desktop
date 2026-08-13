/**
 * HR → Expense Claims — the pure claims engine (Final Wave FW-3).
 *
 * Employee out-of-pocket claims with a human-approved lifecycle that ends in
 * a REAL ledger accrual: approving a claim books
 *   Dr Employee Expenses (5330) / Cr Expense Claims Payable (2260)
 * through the same idempotent GL seam payroll uses — deterministic entry
 * number per claim, so a re-fired approval can never double-post.
 *
 * Boundaries stated (the W4 payroll precedent): approval books the ACCRUAL;
 * the reimbursement disbursement (Dr 2260 / Cr Cash) is a named future wave —
 * the payable stands visible in the ledger until then. No receipts/OCR yet;
 * the receipt reference is a free-text pointer.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */
import type { GlJournalLine } from './generalLedger';

/** Module id + record kind (FW-3). */
export const EXPENSE_CLAIMS_MODULE_ID = 'hr-expense-claims';
export const EXPENSE_CLAIM_KIND = 'expense_claim';

/** Claim categories — a closed set so spend rolls up deterministically. */
export const EXPENSE_CATEGORIES = ['travel', 'meals', 'lodging', 'supplies', 'communication', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Accrual accounts (ensured before posting, the payroll pattern). */
export const EMPLOYEE_EXPENSES_ACCOUNT = { code: '5330', name: 'Employee Expenses', type: 'expense' } as const;
export const EXPENSE_CLAIMS_PAYABLE_ACCOUNT = { code: '2260', name: 'Expense Claims Payable', type: 'liability' } as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A claim amount is valid when it is a finite positive number (≤ 2dp enforced by rounding). */
export function normalizeClaimAmount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
}

/** Deterministic journal entry number for one claim — the idempotency key. */
export function expenseEntryNumber(claimNumber: string): string {
  return `JE-EXP-${claimNumber}`;
}

/**
 * The balanced accrual for one approved claim:
 * Dr Employee Expenses / Cr Expense Claims Payable, to the paisa.
 */
export function expenseAccrualLines(amount: number): GlJournalLine[] {
  const amt = round2(amount);
  return [
    { account: EMPLOYEE_EXPENSES_ACCOUNT.code, debit: amt, credit: 0 },
    { account: EXPENSE_CLAIMS_PAYABLE_ACCOUNT.code, debit: 0, credit: amt },
  ];
}

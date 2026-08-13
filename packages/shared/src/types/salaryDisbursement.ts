/**
 * HR → Salary Disbursement + Bank Advice — the pure disbursement engine
 * (W6-A4). A disbursement CLEARS the net-pay liability the W6-A3 accrual
 * booked: it reads a POSTED payroll run's net-pay lines, matches each to the
 * employee's current bank details, and produces (a) the balanced clearing
 * entry Dr Salaries Payable / Cr Cash for the BANKED total, and (b) a
 * deterministic bank-advice file the finance team uploads to their bank.
 *
 * HONEST BOUNDARIES, stated not faked:
 * - Employees WITHOUT complete bank details (account + IFSC) are UNBANKED:
 *   counted, named, and LEFT in the payable — never silently paid, never
 *   silently dropped. The residual 2200 balance is correct: they are owed.
 * - NeuroPause does not transmit to any bank. There is no bank API here; the
 *   advice is a file a human uploads. Per-bank proprietary upload formats
 *   (HDFC/ICICI/SBI templates) are named future work — this emits a generic
 *   NEFT advice with the fields every bank needs.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { GlJournalLine } from './generalLedger';
import type { StatutoryPayrollRun } from './payrollProcessing';

/** The Salary Disbursements module id + record kind (the framework store key). */
export const SALARY_DISBURSEMENTS_MODULE_ID = 'hr-salary-disbursements';
export const SALARY_DISBURSEMENT_KIND = 'salaryDisbursement';

/** The net-pay liability disbursement clears + the cash it credits (GL convention). */
export const SALARIES_PAYABLE_CODE = '2200';
export const DEFAULT_DISBURSEMENT_CASH_CODE = '1000';

/** IFSC is exactly 11 chars: 4 bank letters + '0' + 6 alphanumeric branch. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const round2 = (n: number): number => Math.round(n * 100) / 100;
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** One employee's current bank details (looked up live at disbursement time). */
export interface EmployeeBankDetails {
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

/** One line of the bank advice — a beneficiary the bank will credit. */
export interface BankAdviceRow {
  employee: string;
  name: string;
  accountNumber: string;
  ifsc: string;
  amount: number;
}

/** An employee owed net pay but missing complete bank details — never paid silently. */
export interface UnbankedBeneficiary {
  employee: string;
  name: string;
  amount: number;
  reason: string;
}

export interface BankAdvice {
  rows: BankAdviceRow[];
  unbanked: UnbankedBeneficiary[];
  totalDisbursable: number;
  unbankedNet: number;
  bankedCount: number;
  unbankedCount: number;
}

/** Complete, well-formed bank details? (both fields present, IFSC valid). */
export function hasCompleteBankDetails(details: EmployeeBankDetails | undefined): boolean {
  if (!details) return false;
  const account = str(details.accountNumber).trim();
  const ifsc = str(details.ifsc).trim().toUpperCase();
  return account.length > 0 && IFSC_PATTERN.test(ifsc);
}

/**
 * Derive the bank advice from a posted run's net-pay lines and current bank
 * details. Lines with net ≤ 0 are ignored; banked beneficiaries become advice
 * rows; everyone else owed money is surfaced as unbanked (counted, not zeroed).
 */
export function deriveBankAdvice(
  run: StatutoryPayrollRun,
  bankByEmployee: Map<string, EmployeeBankDetails>,
): BankAdvice {
  const rows: BankAdviceRow[] = [];
  const unbanked: UnbankedBeneficiary[] = [];
  for (const line of run.lines) {
    const net = round2(line.netPay);
    if (net <= 0) continue;
    const details = bankByEmployee.get(line.employee);
    if (hasCompleteBankDetails(details)) {
      rows.push({
        employee: line.employee,
        name: line.name,
        accountNumber: str(details!.accountNumber).trim(),
        ifsc: str(details!.ifsc).trim().toUpperCase(),
        amount: net,
      });
    } else {
      const account = str(details?.accountNumber).trim();
      const ifsc = str(details?.ifsc).trim();
      unbanked.push({
        employee: line.employee,
        name: line.name,
        amount: net,
        reason: !account && !ifsc
          ? 'no bank account on file'
          : !account
            ? 'missing account number'
            : !ifsc
              ? 'missing IFSC'
              : 'IFSC is not a valid 11-character code',
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.employee.localeCompare(b.employee));
  unbanked.sort((a, b) => a.name.localeCompare(b.name) || a.employee.localeCompare(b.employee));
  return {
    rows,
    unbanked,
    totalDisbursable: round2(rows.reduce((s, r) => s + r.amount, 0)),
    unbankedNet: round2(unbanked.reduce((s, u) => s + u.amount, 0)),
    bankedCount: rows.length,
    unbankedCount: unbanked.length,
  };
}

/** Meta stamped into the advice header (all deterministic, caller-supplied). */
export interface BankAdviceMeta {
  runNumber: string;
  periodKey: string;
  valueDate: string;
  debitAccount: string;
  creditAccount: string;
}

/**
 * Format the generic NEFT advice text — a stable header plus one CSV line per
 * beneficiary. Amounts use `toFixed(2)` (locale-free, deterministic). This is
 * the bank-agnostic advice; per-bank templates are named future work.
 */
export function formatBankAdvice(advice: BankAdvice, meta: BankAdviceMeta): string {
  const header = [
    'NEFT SALARY DISBURSEMENT ADVICE',
    `Run: ${meta.runNumber}`,
    `Period: ${meta.periodKey}`,
    `Value Date: ${meta.valueDate}`,
    `Debit (clearing) Account: ${meta.debitAccount}`,
    `Credit (funding) Account: ${meta.creditAccount}`,
    `Beneficiaries: ${advice.bankedCount} | Total: ${advice.totalDisbursable.toFixed(2)}`,
    advice.unbankedCount > 0
      ? `Held (no bank details): ${advice.unbankedCount} | ${advice.unbankedNet.toFixed(2)} — left in payable, not paid`
      : 'Held (no bank details): 0',
    'beneficiary_name,account_number,ifsc,amount,narration',
  ];
  const narration = `Salary ${meta.periodKey}`;
  const rows = advice.rows.map(
    (r) => `${csv(r.name)},${csv(r.accountNumber)},${csv(r.ifsc)},${r.amount.toFixed(2)},${csv(narration)}`,
  );
  return [...header, ...rows].join('\n');
}

/** Minimal CSV escaping — quote fields containing a comma, quote, or newline. */
function csv(value: string): string {
  const s = str(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The deterministic idempotency key of a disbursement clearing entry. */
export function disbursementEntryNumber(runNumber: string): string {
  return `JE-DISBURSE-${runNumber}`;
}

/**
 * The balanced clearing lines: Dr Salaries Payable / Cr Cash for the banked
 * total. Returns [] when nothing is disbursable (no fabricated zero entry).
 */
export function disbursementClearingLines(
  totalDisbursable: number,
  payableCode: string,
  cashCode: string,
): GlJournalLine[] {
  const total = round2(totalDisbursable);
  if (total <= 0) return [];
  return [
    { account: payableCode, debit: total, credit: 0 },
    { account: cashCode, debit: 0, credit: total },
  ];
}

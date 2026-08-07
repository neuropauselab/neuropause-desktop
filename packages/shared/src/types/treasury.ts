/**
 * Finance → Treasury — the pure cash-position engine (Final Wave FW-12, the
 * charter's last named Finance item).
 *
 * A treasury position is a DERIVED statement of liquidity on a day, composed
 * entirely from figures other certified modules already own — nothing here is
 * typed by hand:
 *
 *   cash          — balances of the chart's cash/bank accounts, selected by
 *                   the SAME rule the cash-flow statement uses (accounts
 *                   tagged `cashFlowCategory: cash`, plus the seeded cash
 *                   control account when left on auto);
 *   receivables   — outstanding balances of open customer invoices
 *                   (issued / partially_paid / overdue — draft is not owed,
 *                   paid and cancelled are done);
 *   payables      — outstanding balances of APPROVED vendor bills (a draft
 *                   bill is not yet a commitment; paid/cancelled are done);
 *   net position  — cash + receivables − payables.
 *
 * Pure (no I/O) so the module's Refresh action and the tests share it.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import { GL_CONTROL_ACCOUNTS, glAccountFromRecord } from './generalLedger';
import { calculateOutstandingBalance, invoiceFromRecord } from './finance';
import { vendorBillFromRecord } from './vendorBills';

export const TREASURY_POSITIONS_MODULE_ID = 'finance-treasury-positions';
export const TREASURY_POSITION_KIND = 'treasury-position';

/** Invoice statuses that still owe the company money. */
export const RECEIVABLE_INVOICE_STATUSES = ['issued', 'partially_paid', 'overdue'] as const;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One cash/bank account's contribution to the position. */
export interface TreasuryCashAccount {
  code: string;
  name: string;
  balance: number;
}

/** The derived liquidity statement, with every figure it used. */
export interface TreasuryPosition {
  cashBalance: number;
  receivablesOutstanding: number;
  payablesOutstanding: number;
  /** cash + receivables − payables. */
  netPosition: number;
  cashAccounts: TreasuryCashAccount[];
  openInvoiceCount: number;
  openBillCount: number;
}

/**
 * True when this ledger-account record counts as cash — the cash-flow
 * statement's own selection rule, reused verbatim: explicitly tagged `cash`,
 * or the seeded cash control account when the tag is empty/auto.
 */
export function isTreasuryCashAccount(record: EnterpriseEntity): boolean {
  const account = glAccountFromRecord(record);
  if (!account.code || account.archived) return false;
  const tag = str(record.fields.cashFlowCategory).trim().toLowerCase();
  return tag === 'cash' || ((tag === '' || tag === 'auto') && account.code === GL_CONTROL_ACCOUNTS.cash.code);
}

/** Compose the position from the three certified sources. */
export function deriveTreasuryPosition(input: {
  accounts: ReadonlyArray<EnterpriseEntity>;
  invoices: ReadonlyArray<EnterpriseEntity>;
  vendorBills: ReadonlyArray<EnterpriseEntity>;
}): TreasuryPosition {
  const cashAccounts: TreasuryCashAccount[] = input.accounts
    .filter((r) => r.status !== 'deleted' && isTreasuryCashAccount(r))
    .map((r) => {
      const account = glAccountFromRecord(r);
      return { code: account.code, name: account.name, balance: round2(account.balance) };
    });
  const cashBalance = round2(cashAccounts.reduce((s, a) => s + a.balance, 0));

  let receivablesOutstanding = 0;
  let openInvoiceCount = 0;
  for (const record of input.invoices) {
    if (record.status === 'deleted') continue;
    const invoice = invoiceFromRecord(record);
    if (!(RECEIVABLE_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) continue;
    const outstanding = calculateOutstandingBalance(invoice);
    if (outstanding <= 0) continue;
    receivablesOutstanding += outstanding;
    openInvoiceCount += 1;
  }
  receivablesOutstanding = round2(receivablesOutstanding);

  let payablesOutstanding = 0;
  let openBillCount = 0;
  for (const record of input.vendorBills) {
    if (record.status === 'deleted') continue;
    const bill = vendorBillFromRecord(record);
    if (bill.status !== 'approved' || bill.outstanding <= 0) continue;
    payablesOutstanding += bill.outstanding;
    openBillCount += 1;
  }
  payablesOutstanding = round2(payablesOutstanding);

  return {
    cashBalance,
    receivablesOutstanding,
    payablesOutstanding,
    netPosition: round2(cashBalance + receivablesOutstanding - payablesOutstanding),
    cashAccounts,
    openInvoiceCount,
    openBillCount,
  };
}

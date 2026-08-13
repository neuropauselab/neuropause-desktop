/**
 * Finance → Budgets — budget-vs-actual domain types and the pure,
 * DETERMINISTIC variance rules the Budgets module enforces.
 *
 * A Budget is a typed *projection* of the framework's flat `EnterpriseEntity`
 * (same blueprint as quotes/invoices/GL). A budget targets ONE ledger account
 * for ONE monthly period; its ACTUAL is never entered by hand — it is the net
 * movement of that account across POSTED journal entries dated in the period,
 * measured in the account's normal direction (the ErpCore convention). Variance
 * follows spending intuition: for debit-normal accounts (expenses/assets) over
 * budget is a positive overrun; for credit-normal accounts (revenue) actual
 * above budget is favourable. Pure (no I/O); the AI explains variances, never
 * sets them.
 */
import {
  glNormalBalance,
  glPeriodKeyForDate,
  type GlAccountClass,
  type GlJournalEntry,
} from './generalLedger';

/** The Budgets module id + record kind (the framework store key). */
export const BUDGETS_MODULE_ID = 'finance-budgets';
export const BUDGET_KIND = 'budget';

export type BudgetHealth = 'on-track' | 'over' | 'under' | 'no-actuals';

export interface BudgetActuals {
  /** Net movement in the account's normal direction across the period. */
  actualAmount: number;
  /** actual − budget, signed in the account's normal direction. */
  variance: number;
  /** variance / budget × 100, 0 when the budget is 0. */
  variancePercent: number;
  health: BudgetHealth;
  /** True when at least one posted entry touched the account in the period. */
  hasActivity: boolean;
}

/**
 * Net movement of one account (by code) across posted entries dated in a
 * period, signed in the account's normal direction — an expense account's
 * actual grows with debits, a revenue account's with credits.
 */
export function budgetPeriodActual(
  accountCode: string,
  accountClass: GlAccountClass,
  periodKey: string,
  entries: readonly GlJournalEntry[],
): { amount: number; hasActivity: boolean } {
  const normal = glNormalBalance(accountClass);
  let debit = 0;
  let credit = 0;
  let touched = false;
  for (const e of entries) {
    if (!e.posted || glPeriodKeyForDate(e.entryDate) !== periodKey) continue;
    for (const l of e.lines) {
      if (l.account !== accountCode) continue;
      debit += l.debit;
      credit += l.credit;
      touched = true;
    }
  }
  return { amount: normal === 'debit' ? debit - credit : credit - debit, hasActivity: touched };
}

/** Within ±5% of budget counts as on-track (deterministic, documented). */
export const BUDGET_ON_TRACK_TOLERANCE_PERCENT = 5;

/**
 * Derive budget-vs-actual figures. `over` / `under` follow the account's
 * spending intuition: for debit-normal accounts (expense/asset) an actual above
 * budget is OVER; for credit-normal accounts (revenue/liability/equity) an
 * actual above budget is favourable and reports UNDER only when it falls short.
 */
export function deriveBudgetActuals(input: {
  accountCode: string;
  accountClass: GlAccountClass;
  periodKey: string;
  budgetAmount: number;
  entries: readonly GlJournalEntry[];
}): BudgetActuals {
  const { amount, hasActivity } = budgetPeriodActual(
    input.accountCode,
    input.accountClass,
    input.periodKey,
    input.entries,
  );
  const variance = Math.round((amount - input.budgetAmount) * 100) / 100;
  const variancePercent =
    input.budgetAmount === 0 ? 0 : Math.round((variance / input.budgetAmount) * 10000) / 100;
  let health: BudgetHealth;
  if (!hasActivity) {
    health = 'no-actuals';
  } else if (Math.abs(variancePercent) <= BUDGET_ON_TRACK_TOLERANCE_PERCENT) {
    health = 'on-track';
  } else {
    const normal = glNormalBalance(input.accountClass);
    const above = variance > 0;
    // Debit-normal above budget = overspend; credit-normal above budget = ahead.
    health = normal === 'debit' ? (above ? 'over' : 'under') : above ? 'on-track' : 'under';
  }
  return { actualAmount: amount, variance, variancePercent, health, hasActivity };
}

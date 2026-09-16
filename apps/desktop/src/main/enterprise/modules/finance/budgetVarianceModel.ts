/**
 * S83 — Governed Budget-Variance Intelligence: the PURE aggregation model.
 *
 * This computes NOTHING new about variance. The per-budget variance — actual (posted-journal
 * net in the account's normal direction), variance (actual − budget, signed), variancePercent
 * (0 when budget is 0), and health (favorable/unfavorable band) — is the CANONICAL
 * `deriveBudgetActuals` output (packages/shared/types/budgets.ts), reused verbatim by the
 * snapshot module. This file only ROLLS the per-budget rows into a tenant-scoped portfolio
 * register: totals + health counts + a stable per-row projection. Deterministic; read-only;
 * empty in → honestly empty out. No policy is invented — see DECISION-MEMO-S83.
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type { BudgetActuals, BudgetHealth } from '@neuropause/shared';

/** One budget master joined to its live canonical actuals (from deriveBudgetActuals). */
export interface BudgetVarianceInput {
  budgetId: string;
  budgetName: string;
  periodKey: string;
  accountCode: string;
  budgetAmount: number;
  actuals: BudgetActuals;
}

/** One immutable variance-register row — the budget's variance at snapshot time. */
export interface BudgetVarianceRow {
  budgetId: string;
  budgetName: string;
  periodKey: string;
  accountCode: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  variancePercent: number;
  health: BudgetHealth;
  hasActivity: boolean;
}

export interface BudgetVarianceSnapshot {
  asOfDate: string;
  budgetCount: number;
  totalBudget: number;
  totalActual: number;
  /** Σ per-row variance (actual − budget, signed in each account's normal direction). */
  totalVariance: number;
  onTrackCount: number;
  underCount: number;
  overCount: number;
  noActualsCount: number;
  rows: BudgetVarianceRow[];
}

/**
 * Roll a set of budgets-with-actuals into a portfolio variance snapshot. Totals are plain
 * base-currency sums — the budget/GL model carries no currency dimension (single-base-currency
 * assumption, documented in the memo, NOT invented here). Rows are sorted deterministically by
 * period then account then budget id so regeneration from identical inputs is byte-identical.
 */
export function deriveBudgetVarianceSnapshot(
  budgets: BudgetVarianceInput[],
  asOfDate: string,
): BudgetVarianceSnapshot {
  const rows: BudgetVarianceRow[] = budgets
    .map((b) => ({
      budgetId: b.budgetId,
      budgetName: b.budgetName,
      periodKey: b.periodKey,
      accountCode: b.accountCode,
      budgetAmount: b.budgetAmount,
      actualAmount: b.actuals.actualAmount,
      variance: b.actuals.variance,
      variancePercent: b.actuals.variancePercent,
      health: b.actuals.health,
      hasActivity: b.actuals.hasActivity,
    }))
    .sort((a, b) =>
      a.periodKey !== b.periodKey
        ? a.periodKey.localeCompare(b.periodKey)
        : a.accountCode !== b.accountCode
          ? a.accountCode.localeCompare(b.accountCode)
          : a.budgetId.localeCompare(b.budgetId),
    );

  const snap: BudgetVarianceSnapshot = {
    asOfDate,
    budgetCount: rows.length,
    totalBudget: 0,
    totalActual: 0,
    totalVariance: 0,
    onTrackCount: 0,
    underCount: 0,
    overCount: 0,
    noActualsCount: 0,
    rows,
  };
  for (const r of rows) {
    snap.totalBudget += r.budgetAmount;
    snap.totalActual += r.actualAmount;
    snap.totalVariance += r.variance;
    if (r.health === 'over') snap.overCount += 1;
    else if (r.health === 'under') snap.underCount += 1;
    else if (r.health === 'on-track') snap.onTrackCount += 1;
    else snap.noActualsCount += 1; // 'no-actuals'
  }
  snap.totalBudget = Math.round(snap.totalBudget);
  snap.totalActual = Math.round(snap.totalActual);
  snap.totalVariance = Math.round(snap.totalVariance);
  return snap;
}

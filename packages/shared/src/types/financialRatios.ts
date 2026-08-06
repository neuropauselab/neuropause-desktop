/**
 * Finance → Financial Ratios — the pure ratio engine over the GL's own
 * financial-statement aggregates (W6-B5). Built ENTIRELY on `glStatement`
 * (revenue, expenses, net income, assets, liabilities, equity from real posted
 * balances), so the figures reconcile to the ledger by construction.
 *
 * The ratios here are the ones derivable from account-CLASS totals alone, so
 * they never guess: debt-to-equity, net profit margin, return on assets,
 * return on equity, equity ratio, expense ratio. Each returns NULL when its
 * denominator is non-positive — an undefined ratio is reported as undefined,
 * never a fabricated number or a divide-by-zero. Current/quick ratios need a
 * current-vs-non-current account split the chart does not yet carry — named
 * as a refinement, not faked.
 *
 * Figures are lifetime-to-date (the GL accumulates without period-close resets);
 * period-scoped P&L ratios are a stated future refinement.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */

/** The Financial Ratios module id + record kind (the framework store key). */
export const FINANCIAL_RATIOS_MODULE_ID = 'finance-ratios';
export const FINANCIAL_RATIO_KIND = 'ratioReport';

/** The aggregates the ratios read — the shape of `glStatement`'s output. */
export interface RatioInputs {
  revenue: number;
  expenses: number;
  netIncome: number;
  assets: number;
  liabilities: number;
  equity: number;
}

export interface FinancialRatios {
  /** Net income ÷ revenue, as a percent. Null when revenue ≤ 0. */
  netProfitMargin: number | null;
  /** Expenses ÷ revenue, as a percent. Null when revenue ≤ 0. */
  expenseRatio: number | null;
  /** Net income ÷ total assets, as a percent. Null when assets ≤ 0. */
  returnOnAssets: number | null;
  /** Net income ÷ equity, as a percent. Null when equity ≤ 0. */
  returnOnEquity: number | null;
  /** Total liabilities ÷ equity, as a ratio. Null when equity ≤ 0. */
  debtToEquity: number | null;
  /** Equity ÷ total assets, as a percent. Null when assets ≤ 0. */
  equityRatio: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** A percent to two places, or null when the base is non-positive. */
const pct = (numerator: number, base: number): number | null => (base > 0 ? round2((numerator / base) * 100) : null);
/** A ratio to two places, or null when the base is non-positive. */
const ratio = (numerator: number, base: number): number | null => (base > 0 ? round2(numerator / base) : null);

/** Derive the class-total ratios; each null when its denominator is non-positive. */
export function deriveFinancialRatios(s: RatioInputs): FinancialRatios {
  return {
    netProfitMargin: pct(s.netIncome, s.revenue),
    expenseRatio: pct(s.expenses, s.revenue),
    returnOnAssets: pct(s.netIncome, s.assets),
    returnOnEquity: pct(s.netIncome, s.equity),
    debtToEquity: ratio(s.liabilities, s.equity),
    equityRatio: pct(s.equity, s.assets),
  };
}

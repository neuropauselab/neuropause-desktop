/**
 * Finance → Cash Flow Statement — the pure direct-method engine over the GL
 * journal (W6-B6). For a period it walks every posted entry that touches a
 * cash/bank account and allocates the cash movement to Operating / Investing /
 * Financing by the COUNTERPART accounts' cash-flow category.
 *
 * Classification is honest and configurable, never guessed from class alone:
 * each ledger account carries a `cashFlowCategory` (Operating / Investing /
 * Financing, or Auto). Auto falls back to `defaultCashFlowCategory` — equity is
 * financing, everything else operating — so a fresh chart is sensible, and the
 * user tags fixed-asset accounts as investing or long-term debt as financing to
 * make the split exact. A mixed entry's cash movement is split across categories
 * in proportion to its counterpart amounts. The net of the three categories
 * RECONCILES to the period's actual cash movement (the engine reports both and
 * flags any drift) — so even a coarsely-tagged chart produces a correct total.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { GlAccountClass } from './generalLedger';
import type { GlJournalEntry } from './generalLedger';

/** The Cash Flow module id + record kind (the framework store key). */
export const CASH_FLOW_MODULE_ID = 'finance-cash-flow';
export const CASH_FLOW_KIND = 'cashFlowStatement';

export type CashFlowCategory = 'operating' | 'investing' | 'financing';
export const CASH_FLOW_CATEGORIES: readonly CashFlowCategory[] = ['operating', 'investing', 'financing'];

/** The class default when an account is left on Auto — equity finances, the rest operates. */
export function defaultCashFlowCategory(accountClass: GlAccountClass): CashFlowCategory {
  return accountClass === 'equity' ? 'financing' : 'operating';
}

/** Resolve an account's category from its stored tag, else the class default. */
export function resolveCashFlowCategory(tag: string, accountClass: GlAccountClass): CashFlowCategory {
  return tag === 'operating' || tag === 'investing' || tag === 'financing'
    ? tag
    : defaultCashFlowCategory(accountClass);
}

export interface CashFlowStatement {
  operating: number;
  investing: number;
  financing: number;
  netCashFlow: number;
  /** The actual cash movement over the period (the reconciliation target). */
  totalCashMovement: number;
  /** True when the three categories sum to the actual cash movement (± rounding). */
  reconciled: boolean;
  entryCount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Derive the direct-method statement. `categoryByCode` maps each account code to
 * its resolved category; `cashCodes` are the cash/bank accounts whose movement
 * is being explained; `window` bounds the period by inclusive entry date.
 */
export function deriveCashFlowStatement(
  entries: readonly GlJournalEntry[],
  categoryByCode: ReadonlyMap<string, CashFlowCategory>,
  cashCodes: ReadonlySet<string>,
  window: { startDate: string; endDate: string },
): CashFlowStatement {
  let operating = 0;
  let investing = 0;
  let financing = 0;
  let totalCashMovement = 0;
  let entryCount = 0;
  for (const entry of entries) {
    if (!entry.posted) continue;
    const date = entry.entryDate;
    if (date < window.startDate || date > window.endDate) continue;
    const cashDelta = entry.lines
      .filter((l) => cashCodes.has(l.account))
      .reduce((s, l) => s + (l.debit - l.credit), 0);
    if (Math.round(cashDelta * 100) === 0) continue;
    entryCount += 1;
    totalCashMovement += cashDelta;
    const nonCash = entry.lines.filter((l) => !cashCodes.has(l.account));
    const totalWeight = nonCash.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0);
    if (totalWeight === 0) {
      operating += cashDelta; // cash-only movement (e.g. bank transfer) → operating
      continue;
    }
    for (const line of nonCash) {
      const weight = Math.abs(line.debit - line.credit) / totalWeight;
      const alloc = cashDelta * weight;
      const category = categoryByCode.get(line.account) ?? 'operating';
      if (category === 'investing') investing += alloc;
      else if (category === 'financing') financing += alloc;
      else operating += alloc;
    }
  }
  operating = round2(operating);
  investing = round2(investing);
  financing = round2(financing);
  const netCashFlow = round2(operating + investing + financing);
  const total = round2(totalCashMovement);
  return {
    operating,
    investing,
    financing,
    netCashFlow,
    totalCashMovement: total,
    reconciled: Math.abs(netCashFlow - total) < 0.02,
    entryCount,
  };
}

/**
 * Finance → FX Gain/Loss — the pure realized/unrealized foreign-exchange
 * difference engine (W6-B3), built on the W6-B1 rate foundation and consumed by
 * the W6-B4 payment wiring and the period-end revaluation increment.
 *
 * IAS 21 semantics: a monetary item booked in functional currency at one rate,
 * then settled (realized) or remeasured at period-end (unrealized) at another
 * rate, produces an exchange difference recognised in profit or loss. The sign
 * depends on which side of the balance sheet the item sits:
 * - ASSET (receivable, cash): a HIGHER current rate = worth more = GAIN.
 * - LIABILITY (payable): a HIGHER current rate = owe more = LOSS.
 *
 * `gainLoss > 0` is always a GAIN (credit to P&L), `< 0` a LOSS (debit). The
 * balanced-lines helper turns a realized difference into a three-line journal
 * entry (or the unchanged two-line entry when the difference is zero), so the
 * double-entry stays exact and the single-currency path is untouched.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { GlJournalLine } from './generalLedger';

/**
 * The P&L account exchange differences post to (IAS 21). A NET account: a
 * debit balance is a net loss, a credit balance a net gain.
 */
export const FX_GAINLOSS_ACCOUNT = { code: '7810', name: 'Foreign Exchange Gain/Loss', type: 'expense' } as const;

export type MonetaryClass = 'asset' | 'liability';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface FxDifference {
  /** The item's functional value at the current (settled / period-end) rate. */
  functionalCurrent: number;
  /** The item's functional value as originally booked. */
  functionalBooked: number;
  /** Positive = gain (credit P&L), negative = loss (debit P&L). */
  gainLoss: number;
  isGain: boolean;
}

/**
 * The core exchange difference for a monetary amount between its booked rate
 * and a current rate, signed for the balance-sheet side.
 */
export function computeFxDifference(input: {
  amount: number;
  bookedRate: number;
  currentRate: number;
  monetaryClass: MonetaryClass;
}): FxDifference {
  const amount = Math.max(0, input.amount);
  const functionalBooked = round2(amount * input.bookedRate);
  const functionalCurrent = round2(amount * input.currentRate);
  const raw = round2(functionalCurrent - functionalBooked);
  // Asset up = gain; liability up = loss (flip the sign).
  const gainLoss = input.monetaryClass === 'liability' ? round2(-raw) : raw;
  return { functionalCurrent, functionalBooked, gainLoss, isGain: gainLoss > 0 };
}

/**
 * Realized FX difference when a monetary item is SETTLED — the settled amount
 * converts at the settlement-date rate versus its booked rate.
 */
export function computeRealizedFxGainLoss(input: {
  amount: number;
  bookedRate: number;
  settledRate: number;
  monetaryClass: MonetaryClass;
}): FxDifference {
  return computeFxDifference({
    amount: input.amount,
    bookedRate: input.bookedRate,
    currentRate: input.settledRate,
    monetaryClass: input.monetaryClass,
  });
}

/**
 * Unrealized FX difference when an OPEN monetary balance is remeasured at a
 * period-end rate (no cash has moved) versus its booked rate.
 */
export function computeUnrealizedFxGainLoss(input: {
  amount: number;
  bookedRate: number;
  revalRate: number;
  monetaryClass: MonetaryClass;
}): FxDifference {
  return computeFxDifference({
    amount: input.amount,
    bookedRate: input.bookedRate,
    currentRate: input.revalRate,
    monetaryClass: input.monetaryClass,
  });
}

/**
 * Build the balanced journal lines for a settled RECEIVABLE (customer payment):
 * Dr Cash at the settlement functional value, Cr AR at its booked functional
 * value, and the exchange difference to the FX account — a Cr on a gain, a Dr
 * on a loss. When the difference is zero the entry is the unchanged two lines,
 * so the single-currency path is byte-identical. Dr always equals Cr.
 */
export function realizedReceivableFxLines(input: {
  functionalSettled: number;
  functionalBooked: number;
  cashCode: string;
  receivableCode: string;
  fxCode: string;
}): GlJournalLine[] {
  const settled = round2(input.functionalSettled);
  const booked = round2(input.functionalBooked);
  const diff = round2(settled - booked);
  const lines: GlJournalLine[] = [
    { account: input.cashCode, debit: settled, credit: 0 },
    { account: input.receivableCode, debit: 0, credit: booked },
  ];
  if (diff > 0) {
    lines.push({ account: input.fxCode, debit: 0, credit: diff }); // exchange gain
  } else if (diff < 0) {
    lines.push({ account: input.fxCode, debit: round2(-diff), credit: 0 }); // exchange loss
  }
  return lines;
}

/**
 * The P&L account UNREALIZED (period-end revaluation) exchange differences post
 * to (W6-B7) — kept DISTINCT from realized 7810 so the books separate cash-backed
 * differences from mark-to-market ones, and so the reversing entry unwinds only
 * the unrealized side. A NET account like 7810 (debit balance = net loss, credit
 * = net gain).
 */
export const FX_UNREALIZED_ACCOUNT = { code: '7811', name: 'Unrealized Foreign Exchange Gain/Loss', type: 'expense' } as const;

/**
 * The company functional (base / reporting) currency — the currency the GL's
 * control accounts are denominated in and every posted amount is expressed in.
 * A fixed company setting, NOT a rate: revaluation resolves each foreign balance
 * back to THIS currency at the period-end rate (the rates themselves always come
 * from the effective-dated register). The single place to change if the company's
 * functional currency is not USD.
 */
export const FX_FUNCTIONAL_CURRENCY = 'USD';

/**
 * Build the balanced journal lines for a period-end UNREALIZED revaluation of the
 * AR / AP control accounts against the unrealized-FX P&L account. `receivableDelta`
 * / `payableDelta` are the SIGNED change in each control account's functional
 * carrying value (period-end value − booked value). Asset up (Δ>0) debits AR;
 * liability up (Δ>0) credits AP; the FX account takes the single balancing line so
 * Dr always equals Cr. Both zero → no lines (nothing to revalue).
 */
export function unrealizedRevaluationLines(input: {
  receivableDelta: number;
  payableDelta: number;
  receivableCode: string;
  payableCode: string;
  fxCode: string;
}): GlJournalLine[] {
  const recv = round2(input.receivableDelta);
  const pay = round2(input.payableDelta);
  const lines: GlJournalLine[] = [];
  if (recv !== 0) lines.push({ account: input.receivableCode, debit: recv > 0 ? recv : 0, credit: recv < 0 ? round2(-recv) : 0 });
  if (pay !== 0) lines.push({ account: input.payableCode, debit: pay < 0 ? round2(-pay) : 0, credit: pay > 0 ? pay : 0 });
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  const balance = round2(totalDebit - totalCredit);
  if (balance > 0) lines.push({ account: input.fxCode, debit: 0, credit: balance });
  else if (balance < 0) lines.push({ account: input.fxCode, debit: round2(-balance), credit: 0 });
  return lines;
}

/** The exact inverse of a set of lines (swap debit/credit) — a reversing entry. */
export function reverseFxLines(lines: readonly GlJournalLine[]): GlJournalLine[] {
  return lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, ...(l.memo ? { memo: l.memo } : {}) }));
}

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

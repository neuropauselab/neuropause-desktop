/**
 * Finance → Unrealized FX Revaluation — the pure period-end revaluation engine
 * (W6-B7) over open foreign-currency receivables. IAS 21: an open monetary
 * balance is remeasured at the period-end rate, and the difference versus its
 * booked rate is an UNREALIZED exchange gain/loss recognised in profit or loss
 * and REVERSED on the first day of the next period — so it is never
 * double-counted when the item later settles and the REALIZED difference
 * (W6-B4) is booked at the settlement rate.
 *
 * Receivables only: the certified multi-currency foundation (W6-B2..B4) is the
 * AR side; vendor bills carry no exchange rate yet, so payables cannot be
 * revalued until AP gains multi-currency. The downstream lines helper
 * (`unrealizedRevaluationLines`) is written for BOTH sides, and the module
 * passes `payableDelta = 0` today, so AP activates additively with no rework.
 *
 * Pure (no I/O): the module injects the invoices + rates; this decides the math.
 */
import type { ExchangeRate } from './exchangeRates';
import { resolveExchangeRate } from './exchangeRates';
import type { FinanceInvoice } from './finance';
import { calculateInvoiceAmount } from './finance';
import type { VendorBill } from './vendorBills';
import { FX_FUNCTIONAL_CURRENCY, computeUnrealizedFxGainLoss } from './fxGainLoss';

/** The FX Revaluation module id + record kind (the framework store key). */
export const FX_REVALUATION_MODULE_ID = 'finance-fx-revaluation';
export const FX_REVALUATION_KIND = 'fxRevaluation';

/** One revalued open receivable — the audit row linking document → rate → delta. */
export interface FxRevaluationItem {
  document: string;
  currency: string;
  /** Original-currency open amount. */
  outstanding: number;
  /** Functional units per one unit of `currency`, as originally booked. */
  bookedRate: number;
  /** Functional units per one unit of `currency`, at the period-end date. */
  revalRate: number;
  /** outstanding × bookedRate. */
  functionalBooked: number;
  /** outstanding × revalRate. */
  functionalCurrent: number;
  /** functionalCurrent − functionalBooked (signed; the AR carrying-value change). */
  delta: number;
}

export interface FxRevaluationResult {
  items: FxRevaluationItem[];
  /** Σ delta over revalued receivables (functional) — the AR adjustment. */
  receivableDelta: number;
  /** Σ IAS 21 gain(+)/loss(−); for assets this equals receivableDelta. */
  unrealizedGainLoss: number;
  revaluedCount: number;
  /** Open FX receivables with NO period-end rate available — NOT revalued (never faked 1:1). */
  skippedNoRate: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Revalue every open foreign-currency receivable as of `asOfDate` (the period
 * end). An invoice is in scope when it is booked (not draft / cancelled), still
 * outstanding, denominated in a non-functional currency, booked at a positive
 * rate, and issued on or before the period end. When no rate governs the
 * period-end date the item is skipped (and counted) — never revalued at a
 * fabricated rate.
 */
export function deriveReceivableRevaluation(input: {
  invoices: readonly FinanceInvoice[];
  rates: readonly ExchangeRate[];
  asOfDate: string;
  functionalCurrency?: string;
}): FxRevaluationResult {
  const functional = (input.functionalCurrency || FX_FUNCTIONAL_CURRENCY).toUpperCase();
  const rates = input.rates as ExchangeRate[];
  const items: FxRevaluationItem[] = [];
  let receivableDelta = 0;
  let unrealizedGainLoss = 0;
  let skippedNoRate = 0;
  for (const inv of input.invoices) {
    if (inv.status === 'draft' || inv.status === 'cancelled') continue;
    const outstanding = round2(Math.max(0, calculateInvoiceAmount(inv) - Math.max(0, inv.amountPaid)));
    if (outstanding <= 0) continue;
    const currency = (inv.currency || functional).toUpperCase();
    if (currency === functional) continue; // no FX exposure
    const bookedRate = inv.exchangeRate > 0 ? inv.exchangeRate : 0;
    if (bookedRate <= 0) continue; // cannot revalue against a non-positive booked rate
    if (inv.issueDate && inv.issueDate > input.asOfDate) continue; // not yet in the period-end balance
    const revalRate = resolveExchangeRate(rates, currency, functional, input.asOfDate);
    if (revalRate === null) {
      skippedNoRate += 1;
      continue;
    }
    const fx = computeUnrealizedFxGainLoss({ amount: outstanding, bookedRate, revalRate, monetaryClass: 'asset' });
    const delta = round2(fx.functionalCurrent - fx.functionalBooked);
    items.push({
      document: inv.number,
      currency,
      outstanding,
      bookedRate,
      revalRate,
      functionalBooked: fx.functionalBooked,
      functionalCurrent: fx.functionalCurrent,
      delta,
    });
    receivableDelta = round2(receivableDelta + delta);
    unrealizedGainLoss = round2(unrealizedGainLoss + fx.gainLoss);
  }
  return { items, receivableDelta, unrealizedGainLoss, revaluedCount: items.length, skippedNoRate };
}

export interface FxPayableRevaluationResult {
  items: FxRevaluationItem[];
  /** Σ delta over revalued payables (functional) — the AP adjustment (signed, current − booked). */
  payableDelta: number;
  /** Σ IAS 21 gain(+)/loss(−); for liabilities a higher rate is a LOSS. */
  unrealizedGainLoss: number;
  revaluedCount: number;
  /** Open FX payables with NO period-end rate available — NOT revalued (never faked 1:1). */
  skippedNoRate: number;
}

/**
 * Revalue every open foreign-currency PAYABLE (an APPROVED, still-outstanding
 * vendor bill) as of `asOfDate` — the mirror of `deriveReceivableRevaluation`
 * (W6-B9). Same scope rules (booked, outstanding, non-functional, positive
 * booked rate, dated on/before the period end, resolvable period-end rate);
 * the monetary class is `liability`, so a higher period-end rate is a LOSS.
 * `payableDelta` is the signed change in the AP carrying value.
 */
export function derivePayableRevaluation(input: {
  bills: readonly VendorBill[];
  rates: readonly ExchangeRate[];
  asOfDate: string;
  functionalCurrency?: string;
}): FxPayableRevaluationResult {
  const functional = (input.functionalCurrency || FX_FUNCTIONAL_CURRENCY).toUpperCase();
  const rates = input.rates as ExchangeRate[];
  const items: FxRevaluationItem[] = [];
  let payableDelta = 0;
  let unrealizedGainLoss = 0;
  let skippedNoRate = 0;
  for (const bill of input.bills) {
    if (bill.status !== 'approved') continue; // only open payables age (draft/paid/cancelled don't)
    const outstanding = round2(Math.max(0, bill.outstanding));
    if (outstanding <= 0) continue;
    const currency = (bill.currency || functional).toUpperCase();
    if (currency === functional) continue; // no FX exposure
    const bookedRate = bill.exchangeRate > 0 ? bill.exchangeRate : 0;
    if (bookedRate <= 0) continue;
    if (bill.billDate && bill.billDate > input.asOfDate) continue; // not yet in the period-end balance
    const revalRate = resolveExchangeRate(rates, currency, functional, input.asOfDate);
    if (revalRate === null) {
      skippedNoRate += 1;
      continue;
    }
    const fx = computeUnrealizedFxGainLoss({ amount: outstanding, bookedRate, revalRate, monetaryClass: 'liability' });
    const delta = round2(fx.functionalCurrent - fx.functionalBooked);
    items.push({
      document: bill.billNumber,
      currency,
      outstanding,
      bookedRate,
      revalRate,
      functionalBooked: fx.functionalBooked,
      functionalCurrent: fx.functionalCurrent,
      delta,
    });
    payableDelta = round2(payableDelta + delta);
    unrealizedGainLoss = round2(unrealizedGainLoss + fx.gainLoss);
  }
  return { items, payableDelta, unrealizedGainLoss, revaluedCount: items.length, skippedNoRate };
}

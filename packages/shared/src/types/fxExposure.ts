/**
 * Finance → FX Exposure — the pure open-position exposure engine (W6-C2). As of a
 * date it nets each foreign currency's open MONETARY position — receivables (AR) +
 * foreign cash − payables (AP) — and marks it to the latest registered rate, so a
 * report can show both the foreign position at risk and its functional value + the
 * unrealized difference. Read-only: it derives, it never posts.
 *
 * Scope mirrors the revaluation engines (open, non-functional, positive booked
 * rate, dated on/before the as-of date). A currency with no resolvable as-of rate
 * still reports its foreign position (never faked 1:1) — only the mark-to-market is
 * withheld and the currency counted in `skippedNoRate`. Pure (no I/O): the module
 * injects the open documents + foreign cash positions; this decides the math.
 */
import type { ExchangeRate } from './exchangeRates';
import { resolveExchangeRate } from './exchangeRates';
import type { FinanceInvoice } from './finance';
import { calculateInvoiceAmount } from './finance';
import type { VendorBill } from './vendorBills';
import { FX_FUNCTIONAL_CURRENCY } from './fxGainLoss';

/** The FX Exposure module id + record kind (the framework store key) — W6-C2. */
export const FX_EXPOSURE_MODULE_ID = 'finance-fx-exposure';
export const FX_EXPOSURE_KIND = 'fxExposure';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A foreign cash/bank position fed into the exposure engine (own-currency + functional). */
export interface FxCashPosition {
  currency: string;
  foreignBalance: number;
  functionalBalance: number;
}

/** One currency's netted open FX exposure as of the report date (W6-C2). */
export interface FxExposureByCurrency {
  currency: string;
  /** Open receivables outstanding, in the foreign currency. */
  receivableForeign: number;
  /** Open payables outstanding, in the foreign currency. */
  payableForeign: number;
  /** Foreign cash/bank balance, in the foreign currency. */
  cashForeign: number;
  /** receivableForeign + cashForeign − payableForeign (net monetary position). */
  netForeign: number;
  /** The net position valued at the rates it was booked at (functional). */
  functionalBooked: number;
  /** The rate to functional resolved for the as-of date (0 when none). */
  latestRate: number;
  /** Whether an as-of rate resolved — false leaves the position un-marked (never faked 1:1). */
  rateResolved: boolean;
  /** netForeign × latestRate when resolved, else functionalBooked (un-marked). */
  functionalCurrent: number;
  /** functionalCurrent − functionalBooked (0 when no rate). */
  unrealizedDelta: number;
}

export interface FxExposureResult {
  asOfDate: string;
  functionalCurrency: string;
  byCurrency: FxExposureByCurrency[];
  /** Σ functionalCurrent across currencies — the net functional exposure. */
  totalFunctionalCurrent: number;
  /** Σ functionalBooked. */
  totalFunctionalBooked: number;
  /** Σ unrealizedDelta — net unrealized on all open FX positions. */
  totalUnrealizedDelta: number;
  /** Distinct foreign currencies with an open position. */
  currencyCount: number;
  /** Currencies whose as-of rate could not resolve — position shown, mark-to-market withheld. */
  skippedNoRate: number;
}

interface CurrencyAccumulator {
  receivableForeign: number;
  payableForeign: number;
  cashForeign: number;
  functionalBooked: number;
}

/**
 * Derive the netted open FX exposure by currency as of `asOfDate`. Receivables and
 * foreign cash add to the net position (assets); payables subtract (liabilities).
 * `functionalBooked` accumulates each component at the rate it was booked at; the
 * net is marked to the as-of rate to yield `functionalCurrent` and the unrealized
 * difference. Currencies are returned sorted for a deterministic report.
 */
export function deriveFxExposure(input: {
  invoices?: readonly FinanceInvoice[];
  bills?: readonly VendorBill[];
  cash?: readonly FxCashPosition[];
  rates: readonly ExchangeRate[];
  asOfDate: string;
  functionalCurrency?: string;
}): FxExposureResult {
  const functional = (input.functionalCurrency || FX_FUNCTIONAL_CURRENCY).toUpperCase();
  const rates = input.rates as ExchangeRate[];
  const byCcy = new Map<string, CurrencyAccumulator>();
  const ensure = (ccy: string): CurrencyAccumulator => {
    let a = byCcy.get(ccy);
    if (!a) {
      a = { receivableForeign: 0, payableForeign: 0, cashForeign: 0, functionalBooked: 0 };
      byCcy.set(ccy, a);
    }
    return a;
  };

  for (const inv of input.invoices ?? []) {
    if (inv.status === 'draft' || inv.status === 'cancelled') continue;
    const outstanding = round2(Math.max(0, calculateInvoiceAmount(inv) - Math.max(0, inv.amountPaid)));
    if (outstanding <= 0) continue;
    const currency = (inv.currency || functional).toUpperCase();
    if (currency === functional) continue;
    const bookedRate = inv.exchangeRate > 0 ? inv.exchangeRate : 0;
    if (bookedRate <= 0) continue;
    if (inv.issueDate && inv.issueDate > input.asOfDate) continue;
    const a = ensure(currency);
    a.receivableForeign = round2(a.receivableForeign + outstanding);
    a.functionalBooked = round2(a.functionalBooked + outstanding * bookedRate); // AR: +asset
  }

  for (const bill of input.bills ?? []) {
    if (bill.status !== 'approved') continue; // only open payables carry exposure
    const outstanding = round2(Math.max(0, bill.outstanding));
    if (outstanding <= 0) continue;
    const currency = (bill.currency || functional).toUpperCase();
    if (currency === functional) continue;
    const bookedRate = bill.exchangeRate > 0 ? bill.exchangeRate : 0;
    if (bookedRate <= 0) continue;
    if (bill.billDate && bill.billDate > input.asOfDate) continue;
    const a = ensure(currency);
    a.payableForeign = round2(a.payableForeign + outstanding);
    a.functionalBooked = round2(a.functionalBooked - outstanding * bookedRate); // AP: −liability
  }

  for (const c of input.cash ?? []) {
    const currency = (c.currency || functional).toUpperCase();
    if (currency === functional) continue;
    const foreign = round2(c.foreignBalance);
    if (foreign === 0) continue;
    const a = ensure(currency);
    a.cashForeign = round2(a.cashForeign + foreign);
    a.functionalBooked = round2(a.functionalBooked + round2(c.functionalBalance)); // cash: +asset (historical)
  }

  const byCurrency: FxExposureByCurrency[] = [];
  let totalFunctionalCurrent = 0;
  let totalFunctionalBooked = 0;
  let totalUnrealizedDelta = 0;
  let skippedNoRate = 0;
  for (const [currency, a] of [...byCcy.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const netForeign = round2(a.receivableForeign + a.cashForeign - a.payableForeign);
    const resolved = resolveExchangeRate(rates, currency, functional, input.asOfDate);
    const rateResolved = resolved !== null;
    const latestRate = resolved ?? 0;
    const functionalCurrent = rateResolved ? round2(netForeign * latestRate) : a.functionalBooked;
    const unrealizedDelta = rateResolved ? round2(functionalCurrent - a.functionalBooked) : 0;
    if (!rateResolved) skippedNoRate += 1;
    byCurrency.push({
      currency,
      receivableForeign: a.receivableForeign,
      payableForeign: a.payableForeign,
      cashForeign: a.cashForeign,
      netForeign,
      functionalBooked: a.functionalBooked,
      latestRate,
      rateResolved,
      functionalCurrent,
      unrealizedDelta,
    });
    totalFunctionalCurrent = round2(totalFunctionalCurrent + functionalCurrent);
    totalFunctionalBooked = round2(totalFunctionalBooked + a.functionalBooked);
    totalUnrealizedDelta = round2(totalUnrealizedDelta + unrealizedDelta);
  }

  return {
    asOfDate: input.asOfDate,
    functionalCurrency: functional,
    byCurrency,
    totalFunctionalCurrent,
    totalFunctionalBooked,
    totalUnrealizedDelta,
    currencyCount: byCurrency.length,
    skippedNoRate,
  };
}

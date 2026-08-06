/**
 * Sales → Revenue Forecast — the pure forecast engine + snapshot domain (W2.6).
 *
 * A forecast is an immutable point-in-time snapshot (the Aging pattern)
 * derived ENTIRELY from the opportunity pipeline — the single source, so
 * nothing is double-counted against quotes or orders that mirror the same
 * deals. Month by month over the horizon (anchored at the caller's as-of
 * date, never the wall clock inside the math):
 *
 *   • OPEN opportunities contribute their deterministic `weightedValue`
 *     (amount × probability, the W2.1 stamp) to the month of their expected
 *     close date.
 *   • WON opportunities contribute their full amount to the month they
 *     closed (`closedAt`) — booked business inside the horizon.
 *   • Open deals with NO expected close date — or one outside the horizon —
 *     land in the `outside` bucket, VISIBLE, never silently dropped and never
 *     smeared across months.
 *
 * Forecasts never post to the General Ledger: weighted pipeline is an
 * expectation, not revenue. Month arithmetic reuses the W2.3 calendar-exact
 * `addMonthsClamped` — never re-implemented.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { CrmOpportunity } from './opportunities';
import { addMonthsClamped } from './contracts';

/** The Revenue Forecast module id + record kind (the framework store key). */
export const REVENUE_FORECAST_MODULE_ID = 'sales-revenue-forecast';
export const REVENUE_FORECAST_KIND = 'revenueForecast';

/** One month's line on a forecast. */
export interface ForecastMonthRow {
  month: string; // YYYY-MM
  openCount: number;
  openWeighted: number;
  wonCount: number;
  wonBooked: number;
}

export interface RevenueForecastResult {
  rows: ForecastMonthRow[];
  /** Sum of open weighted value inside the horizon. */
  pipelineWeighted: number;
  /** Sum of won amounts closed inside the horizon. */
  bookedInHorizon: number;
  /** Open weighted value with no (or out-of-horizon) expected close date. */
  outsideWeighted: number;
  outsideCount: number;
  /** All open deals considered (in-horizon + outside). */
  openDeals: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The horizon's month keys: the as-of month plus the next `horizon − 1`. */
export function forecastMonths(asOfDate: string, horizonMonths: number): string[] {
  const anchor = `${asOfDate.slice(0, 7)}-01`;
  const months: string[] = [];
  for (let i = 0; i < horizonMonths; i += 1) {
    months.push(addMonthsClamped(anchor, i).slice(0, 7));
  }
  return months;
}

/** The forecast engine — see the header for the exact contribution rules. */
export function deriveRevenueForecast(
  opportunities: CrmOpportunity[],
  asOfDate: string,
  horizonMonths: number,
): RevenueForecastResult {
  const months = forecastMonths(asOfDate, horizonMonths);
  const index = new Map<string, ForecastMonthRow>(
    months.map((month) => [month, { month, openCount: 0, openWeighted: 0, wonCount: 0, wonBooked: 0 }]),
  );
  let outsideWeighted = 0;
  let outsideCount = 0;
  let openDeals = 0;
  for (const opp of opportunities) {
    if (opp.outcome === 'lost') continue;
    if (opp.outcome === 'won') {
      if (!opp.closedAt) continue;
      const row = index.get(opp.closedAt.slice(0, 7));
      if (row) {
        row.wonCount += 1;
        row.wonBooked = round2(row.wonBooked + opp.amount);
      }
      continue;
    }
    // Open deal.
    openDeals += 1;
    const row = opp.expectedCloseDate ? index.get(opp.expectedCloseDate.slice(0, 7)) : undefined;
    if (row) {
      row.openCount += 1;
      row.openWeighted = round2(row.openWeighted + opp.weightedValue);
    } else {
      outsideCount += 1;
      outsideWeighted = round2(outsideWeighted + opp.weightedValue);
    }
  }
  const rows = months.map((m) => index.get(m)!);
  return {
    rows,
    pipelineWeighted: round2(rows.reduce((s, r) => s + r.openWeighted, 0)),
    bookedInHorizon: round2(rows.reduce((s, r) => s + r.wonBooked, 0)),
    outsideWeighted,
    outsideCount,
    openDeals,
  };
}

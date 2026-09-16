/**
 * S84 — Governed Demand-Trend Intelligence: the PURE model.
 *
 * Canonical actual demand is REUSED, not redefined: the repository's planning engine defines
 * historical demand as SHIPPED/DELIVERED shipment quantities (`calculateHistoricalShipped`,
 * packages/shared/types/planning.ts). This model applies the SAME status set and quantity
 * treatment (abs), and adds only the one new deterministic piece — bucketing that demand by
 * calendar month (YYYY-MM, the repo's period convention) per SKU to form a historical series.
 *
 * It is ANALYTICAL and HISTORICAL only: no forecast, no smoothing policy, no reorder/PR/PO,
 * no inventory or financial effect. Direction is a THRESHOLD-FREE strict comparison of the
 * latest period against the mean of the prior covered periods (up / down / flat / insufficient-
 * data); a tolerance band would be an undefined business policy and is deliberately NOT invented
 * (see DECISION-MEMO-S84). Gap months are NOT zero-filled — only observed periods are reported
 * (zero-fill is likewise an undefined convention, not invented).
 *
 * Electron-free and store-free: every input is a plain array, so it unit-tests directly.
 */
import type { Shipping } from '@neuropause/shared';

/** The canonical actual-demand statuses — identical to `calculateHistoricalShipped`. */
export const DEMAND_SHIPMENT_STATUSES: ReadonlySet<string> = new Set(['shipped', 'delivered']);

export type DemandDirection = 'up' | 'down' | 'flat' | 'insufficient-data';

export interface PeriodDemand {
  periodKey: string; // YYYY-MM
  demand: number;
}

export interface DemandTrendRow {
  sku: string;
  periodsCovered: number;
  totalDemand: number;
  latestPeriod: string;
  latestDemand: number;
  /** Arithmetic mean of demand across the covered periods BEFORE the latest (0 if none). */
  priorAverage: number;
  /** latestDemand − priorAverage (signed). */
  delta: number;
  /** delta / priorAverage × 100, 0 when priorAverage is 0. */
  deltaPercent: number;
  direction: DemandDirection;
  periods: PeriodDemand[];
}

export interface DemandTrendSnapshot {
  asOfDate: string;
  skuCount: number;
  totalDemand: number;
  upCount: number;
  downCount: number;
  flatCount: number;
  insufficientCount: number;
  rows: DemandTrendRow[];
}

/** Month key (YYYY-MM) a shipment's demand belongs to: shippedDate, falling back to createdAt. */
function periodKeyOf(s: Shipping): string {
  const d = (s.shippedDate && s.shippedDate.trim()) || s.createdAt || '';
  return d.slice(0, 7);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Derive a demand-trend snapshot from shipments. Only SHIPPED/DELIVERED shipments with a valid
 * month key contribute; quantity is `abs` (matching the planning run-rate). Rows are sorted by
 * SKU and each row's periods ascending by month, so regeneration from identical inputs is
 * byte-identical. Empty in → honestly empty out.
 */
export function deriveDemandTrendSnapshot(shipments: Shipping[], asOfDate: string): DemandTrendSnapshot {
  const bySku = new Map<string, Map<string, number>>();
  for (const s of shipments) {
    if (!DEMAND_SHIPMENT_STATUSES.has(s.status) || !s.product) continue;
    const period = periodKeyOf(s);
    if (!/^\d{4}-\d{2}$/.test(period)) continue; // no honest month → not a data point, never guessed
    const perPeriod = bySku.get(s.product) ?? new Map<string, number>();
    perPeriod.set(period, (perPeriod.get(period) ?? 0) + Math.abs(s.quantity));
    bySku.set(s.product, perPeriod);
  }

  const rows: DemandTrendRow[] = [];
  for (const [sku, perPeriod] of bySku) {
    const periods: PeriodDemand[] = [...perPeriod.entries()]
      .map(([periodKey, demand]) => ({ periodKey, demand: Math.round(demand) }))
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    const totalDemand = periods.reduce((n, p) => n + p.demand, 0);
    const latest = periods[periods.length - 1]!;
    const prior = periods.slice(0, -1);
    const priorAverage = mean(prior.map((p) => p.demand));
    const delta = latest.demand - priorAverage;
    const deltaPercent = priorAverage > 0 ? Math.round((delta / priorAverage) * 100) : 0;
    const direction: DemandDirection =
      periods.length < 2 ? 'insufficient-data' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    rows.push({
      sku,
      periodsCovered: periods.length,
      totalDemand,
      latestPeriod: latest.periodKey,
      latestDemand: latest.demand,
      priorAverage,
      delta,
      deltaPercent,
      direction,
      periods,
    });
  }
  rows.sort((a, b) => a.sku.localeCompare(b.sku));

  const snap: DemandTrendSnapshot = {
    asOfDate,
    skuCount: rows.length,
    totalDemand: 0,
    upCount: 0,
    downCount: 0,
    flatCount: 0,
    insufficientCount: 0,
    rows,
  };
  for (const r of rows) {
    snap.totalDemand += r.totalDemand;
    if (r.direction === 'up') snap.upCount += 1;
    else if (r.direction === 'down') snap.downCount += 1;
    else if (r.direction === 'flat') snap.flatCount += 1;
    else snap.insufficientCount += 1;
  }
  return snap;
}

// Re-exported for callers/tests that want the exact string helper used above.
export { periodKeyOf as demandPeriodKeyOf };

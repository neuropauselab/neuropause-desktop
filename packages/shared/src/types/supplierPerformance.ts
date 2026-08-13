/**
 * Procurement → Supplier Performance — the pure scorecard engine + snapshot
 * domain (W3.2).
 *
 * A scorecard register is an immutable point-in-time snapshot (the Aging
 * pattern) derived ENTIRELY from goods-receipt history — the delivery
 * evidence the warehouse already recorded, never supplier self-reporting.
 * Per supplier:
 *
 *   • ON-TIME RATE — receipts whose `receiptDate` ≤ `expectedDate`, over the
 *     receipts that carry both dates (undated receipts are EXCLUDED from the
 *     rate and the exclusion is counted, never hidden).
 *   • QUANTITY ACCURACY — received ÷ ordered × 100; over- AND under-delivery
 *     both penalize the score symmetrically (110% is not "better" than 100%).
 *   • DAYS LATE — the mean lateness of late receipts, 0 when none.
 *
 * SCORE = round(0.6 × onTimeRate + 0.4 × accuracyFit), where accuracyFit =
 * max(0, 100 − |100 − accuracy|). Transparent arithmetic with reasons on
 * every row — never a vibe. Suppliers registered but never measured (no
 * receipts) are counted in the register note, not given fabricated rows.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { GoodsReceipt } from './procurement';

/** The Supplier Performance module id + record kind (the framework store key). */
export const SUPPLIER_PERFORMANCE_MODULE_ID = 'procurement-supplier-performance';
export const SUPPLIER_PERFORMANCE_KIND = 'supplierScorecard';

export type SupplierPerformanceBand = 'reliable' | 'watch' | 'at-risk';

/** One supplier's line on the scorecard register. */
export interface SupplierPerformanceRow {
  supplier: string;
  receipts: number;
  /** Receipts carrying both dates — the on-time denominator. */
  datedReceipts: number;
  onTimeCount: number;
  /** 0..100 over dated receipts; null when no receipt carries both dates. */
  onTimeRatePct: number | null;
  qtyOrdered: number;
  qtyReceived: number;
  /** received ÷ ordered × 100; null when nothing was ordered on any receipt. */
  quantityAccuracyPct: number | null;
  /** Mean days late across LATE receipts; 0 when none late. */
  avgDaysLate: number;
  score: number;
  band: SupplierPerformanceBand;
  reasons: string[];
}

export interface SupplierPerformanceRegister {
  rows: SupplierPerformanceRow[];
  supplierCount: number;
  reliable: number;
  watch: number;
  atRisk: number;
  receiptCount: number;
  /** 0..100 across every dated receipt; null when none exist. */
  overallOnTimePct: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function bandOf(score: number): SupplierPerformanceBand {
  return score >= 80 ? 'reliable' : score >= 50 ? 'watch' : 'at-risk';
}

/** The scorecard engine — see the header for the exact formula. */
export function deriveSupplierPerformance(receipts: GoodsReceipt[]): SupplierPerformanceRegister {
  const bySupplier = new Map<string, GoodsReceipt[]>();
  for (const r of receipts) {
    const supplier = r.supplier.trim() || '(unattributed)';
    const list = bySupplier.get(supplier) ?? [];
    list.push(r);
    bySupplier.set(supplier, list);
  }
  const rows: SupplierPerformanceRow[] = [];
  let totalDated = 0;
  let totalOnTime = 0;
  for (const [supplier, list] of bySupplier.entries()) {
    let datedReceipts = 0;
    let onTimeCount = 0;
    let lateDaysSum = 0;
    let lateCount = 0;
    let qtyOrdered = 0;
    let qtyReceived = 0;
    for (const r of list) {
      qtyOrdered += r.quantityOrdered;
      qtyReceived += r.quantityReceived;
      const expected = Date.parse(r.expectedDate);
      const received = Date.parse(r.receiptDate);
      if (!Number.isFinite(expected) || !Number.isFinite(received)) continue;
      datedReceipts += 1;
      if (received <= expected) {
        onTimeCount += 1;
      } else {
        lateCount += 1;
        lateDaysSum += Math.max(1, Math.round((received - expected) / DAY_MS));
      }
    }
    totalDated += datedReceipts;
    totalOnTime += onTimeCount;
    const onTimeRatePct = datedReceipts > 0 ? round1((onTimeCount / datedReceipts) * 100) : null;
    const quantityAccuracyPct = qtyOrdered > 0 ? round1((qtyReceived / qtyOrdered) * 100) : null;
    const accuracyFit =
      quantityAccuracyPct === null ? 100 : Math.max(0, 100 - Math.abs(100 - quantityAccuracyPct));
    const onTimeComponent = onTimeRatePct === null ? 100 : onTimeRatePct;
    const score = Math.round(0.6 * onTimeComponent + 0.4 * accuracyFit);
    const avgDaysLate = lateCount > 0 ? round1(lateDaysSum / lateCount) : 0;
    const reasons: string[] = [];
    reasons.push(
      onTimeRatePct === null
        ? 'no receipts carry both expected and received dates — on-time unmeasured (counted as 100, stated here)'
        : `on-time ${onTimeRatePct}% over ${datedReceipts} dated receipt(s)` +
            (lateCount > 0 ? `, late ones average ${avgDaysLate} day(s)` : ''),
    );
    reasons.push(
      quantityAccuracyPct === null
        ? 'no ordered quantities recorded — accuracy unmeasured (counted as 100, stated here)'
        : `quantity accuracy ${quantityAccuracyPct}% (over- and under-delivery penalize alike)`,
    );
    reasons.push(`score = round(0.6 × ${onTimeComponent} + 0.4 × ${accuracyFit})`);
    rows.push({
      supplier,
      receipts: list.length,
      datedReceipts,
      onTimeCount,
      onTimeRatePct,
      qtyOrdered,
      qtyReceived,
      quantityAccuracyPct,
      avgDaysLate,
      score,
      band: bandOf(score),
      reasons,
    });
  }
  rows.sort((a, b) => a.score - b.score || a.supplier.localeCompare(b.supplier));
  return {
    rows,
    supplierCount: rows.length,
    reliable: rows.filter((r) => r.band === 'reliable').length,
    watch: rows.filter((r) => r.band === 'watch').length,
    atRisk: rows.filter((r) => r.band === 'at-risk').length,
    receiptCount: receipts.length,
    overallOnTimePct: totalDated > 0 ? round1((totalOnTime / totalDated) * 100) : null,
  };
}

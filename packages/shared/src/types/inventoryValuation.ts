/**
 * Inventory → Valuation — the pure standard-cost valuation engine + snapshot
 * domain (W3.5).
 *
 * A valuation register is an immutable point-in-time snapshot (the Aging
 * pattern): every product@warehouse cell with stock on hand — quantities from
 * the event-sourced stock ledger (`deriveStockLedger`, reused, never
 * re-implemented) — valued at the product's `standardCost` (a field the
 * Products module already owns).
 *
 * METHOD, stated honestly on every register: STANDARD COST. On-hand ×
 * standard cost is transparent and deterministic; FIFO/weighted-average
 * layering over receipt history is a deliberate future method, not faked
 * here. Cells whose product has no standard cost (or no matching product
 * record) are valued at 0 AND COUNTED as unvalued — visible, never hidden.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { Product, StockMovement } from './inventory';
import { deriveStockLedger } from './inventory';

/** The Inventory Valuation module id + record kind (the framework store key). */
export const INVENTORY_VALUATION_MODULE_ID = 'inventory-valuation';
export const INVENTORY_VALUATION_KIND = 'valuationReport';

/** One product@warehouse line on a valuation register. */
export interface ValuationRow {
  product: string;
  warehouse: string;
  onHand: number;
  standardCost: number;
  value: number;
  /** True when no product record (or a zero standard cost) backed this cell. */
  unvalued: boolean;
}

export interface InventoryValuationResult {
  rows: ValuationRow[];
  cellCount: number;
  unvaluedCount: number;
  totalValue: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The valuation engine — see the header for the exact method. */
export function deriveInventoryValuation(
  movements: StockMovement[],
  products: Product[],
): InventoryValuationResult {
  const costBySku = new Map<string, number>(products.map((p) => [p.sku, p.standardCost]));
  const rows: ValuationRow[] = [];
  for (const cell of deriveStockLedger(movements)) {
    if (cell.onHand <= 0) continue;
    const standardCost = costBySku.get(cell.product) ?? 0;
    const unvalued = standardCost <= 0;
    rows.push({
      product: cell.product,
      warehouse: cell.warehouse,
      onHand: cell.onHand,
      standardCost,
      value: round2(cell.onHand * standardCost),
      unvalued,
    });
  }
  rows.sort((a, b) => b.value - a.value || a.product.localeCompare(b.product));
  return {
    rows,
    cellCount: rows.length,
    unvaluedCount: rows.filter((r) => r.unvalued).length,
    totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
  };
}

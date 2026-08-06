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
 * METHODS (W6-C1 completes the family named here):
 * - STANDARD COST — on-hand × the product's standard cost, per
 *   product@warehouse. Transparent; unpriced cells counted as unvalued.
 * - FIFO / WEIGHTED-AVERAGE / MOVING-AVERAGE — actual cost derived from the
 *   receipt history in the movement journal, computed PER PRODUCT (transfers
 *   are net-zero to a product's cost, so per-location cost layering is a
 *   stated future refinement, not faked). Inbound layers carry their unit
 *   cost; outbound consume them by the method's rule. Products whose remaining
 *   stock has no captured cost are counted as uncosted — visible, never hidden.
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

/* ── actual-cost methods (W6-C1): FIFO / weighted-average / moving-average ──── */

export type CostValuationMethod = 'fifo' | 'weighted-average' | 'moving-average';
export type ValuationMethod = 'standard-cost' | CostValuationMethod;

/** One product's actual-cost line under a cost method (per product, all locations). */
export interface CostValuationRow {
  product: string;
  onHand: number;
  /** Effective unit cost under the method (value ÷ on-hand). */
  unitCost: number;
  value: number;
  /** True when remaining stock has no captured cost — value is understated. */
  uncosted: boolean;
}

export interface CostValuationResult {
  method: CostValuationMethod;
  rows: CostValuationRow[];
  cellCount: number;
  uncostedCount: number;
  totalValue: number;
}

const INBOUND = new Set<StockMovement['type']>(['receive', 'production_output', 'return']);
const OUTBOUND = new Set<StockMovement['type']>(['issue', 'production_consumption']);

/** One inbound cost layer for FIFO. */
interface CostLayer {
  qty: number;
  cost: number;
}

/** Classify a posted movement into a signed, costed stock event (product-level). */
function stockEvent(m: StockMovement): { qty: number; cost: number } | null {
  if (m.status === 'void' || !m.product) return null;
  const q = Math.abs(m.quantity);
  if (INBOUND.has(m.type)) return { qty: q, cost: m.unitCost };
  if (OUTBOUND.has(m.type)) return { qty: -q, cost: m.unitCost };
  if (m.type === 'adjustment') return { qty: m.quantity, cost: m.unitCost }; // signed
  return null; // transfer (net-zero to product), reservations
}

/** Chronological, deterministic movement order for costing. */
function chronological(a: StockMovement, b: StockMovement): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.movementNumber.localeCompare(b.movementNumber) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Derive per-product actual-cost valuation under the chosen method. Deterministic;
 * movements are ordered chronologically before layering. Products with no
 * remaining on-hand are omitted (matching the standard-cost register).
 */
export function deriveCostValuation(
  movements: StockMovement[],
  method: CostValuationMethod,
): CostValuationResult {
  const byProduct = new Map<string, StockMovement[]>();
  for (const m of movements) {
    if (m.status === 'void' || !m.product) continue;
    const list = byProduct.get(m.product) ?? [];
    list.push(m);
    byProduct.set(m.product, list);
  }
  const rows: CostValuationRow[] = [];
  for (const [product, list] of byProduct) {
    const events = list
      .slice()
      .sort(chronological)
      .map(stockEvent)
      .filter((e): e is { qty: number; cost: number } => e !== null);
    let onHand = 0;
    let value = 0;
    if (method === 'fifo') {
      const layers: CostLayer[] = [];
      for (const e of events) {
        if (e.qty >= 0) {
          layers.push({ qty: e.qty, cost: e.cost });
        } else {
          let need = -e.qty;
          while (need > 0 && layers.length > 0) {
            const layer = layers[0];
            const take = Math.min(need, layer.qty);
            layer.qty -= take;
            need -= take;
            if (layer.qty <= 0) layers.shift();
          }
        }
      }
      onHand = Math.round(layers.reduce((s, l) => s + l.qty, 0));
      value = round2(layers.reduce((s, l) => s + l.qty * l.cost, 0));
    } else if (method === 'weighted-average') {
      let inQty = 0;
      let inValue = 0;
      let net = 0;
      for (const e of events) {
        net += e.qty;
        if (e.qty > 0) {
          inQty += e.qty;
          inValue += e.qty * e.cost;
        }
      }
      const avg = inQty > 0 ? inValue / inQty : 0;
      onHand = Math.round(net);
      value = onHand > 0 ? round2(onHand * avg) : 0;
    } else {
      // moving-average: recompute the average on each inbound; issues keep it.
      let qty = 0;
      let avg = 0;
      for (const e of events) {
        if (e.qty > 0) {
          const newQty = qty + e.qty;
          avg = newQty > 0 ? (qty * avg + e.qty * e.cost) / newQty : 0;
          qty = newQty;
        } else {
          qty += e.qty; // outbound at current average, avg unchanged
        }
      }
      onHand = Math.round(qty);
      value = onHand > 0 ? round2(onHand * avg) : 0;
    }
    if (onHand <= 0) continue;
    const unitCost = round2(value / onHand);
    rows.push({ product, onHand, unitCost, value, uncosted: value <= 0 });
  }
  rows.sort((a, b) => b.value - a.value || a.product.localeCompare(b.product));
  return {
    method,
    rows,
    cellCount: rows.length,
    uncostedCount: rows.filter((r) => r.uncosted).length,
    totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
  };
}

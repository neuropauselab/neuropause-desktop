/**
 * Inventory ↔ Procurement → Auto-Reordering — the pure replenishment engine
 * (Final Wave FW-6).
 *
 * A product that opts in (`autoReorder: on`) drafts its OWN purchase request
 * the moment the immutable stock ledger reconciles it to or below its reorder
 * level. The decision is classic min–max replenishment on the INVENTORY
 * POSITION, never bare on-hand:
 *
 *   position = availableStock + open supply
 *   open supply = quantities on live purchase REQUESTS (draft/pending/approved)
 *               + live purchase ORDERS (draft/approved/sent)
 *
 * An `ordered` request hands its quantity to its purchase order (counting both
 * would double it); a `received` order already landed in stock; rejected and
 * cancelled paper is dead. Because the drafted request itself becomes open
 * supply, the engine is naturally idempotent — the next movement sees the
 * position restored and stays quiet.
 *
 * When position ≤ reorderLevel the suggested order replenishes to the target:
 * maximumStock when one is set above the reorder level, otherwise
 * reorderLevel + safetyStock — never less than one whole unit.
 *
 * Pure (no I/O) so the movement reconciler, the manual product action, and the
 * tests all share one truth.
 */
import type { Product } from './inventory';

/** Purchase-request statuses whose quantity still counts as incoming supply. */
export const REORDER_OPEN_REQUEST_STATUSES = ['draft', 'pending', 'approved'] as const;
/** Purchase-order statuses whose quantity still counts as incoming supply. */
export const REORDER_OPEN_ORDER_STATUSES = ['draft', 'approved', 'sent'] as const;

/** The generic-record shape the engine reads (purchase requests and orders). */
interface RecordLike {
  id: string;
  status: string;
  fields: Record<string, unknown>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** True when a request/order line references this product (by SKU or record id). */
function refersTo(recordProduct: string, sku: string, productId: string): boolean {
  const p = recordProduct.trim();
  return p !== '' && (p === sku || p === productId);
}

/**
 * Sum the incoming supply already on paper for one product: live purchase
 * requests in draft/pending/approved plus live purchase orders in
 * draft/approved/sent, matched by SKU or product record id.
 */
export function openSupplyForProduct(input: {
  sku: string;
  productId: string;
  purchaseRequests: ReadonlyArray<RecordLike>;
  purchaseOrders: ReadonlyArray<RecordLike>;
}): number {
  const fromRequests = input.purchaseRequests
    .filter(
      (r) =>
        r.status !== 'deleted' &&
        (REORDER_OPEN_REQUEST_STATUSES as readonly string[]).includes(str(r.fields.status)) &&
        refersTo(str(r.fields.product), input.sku, input.productId),
    )
    .reduce((s, r) => s + num(r.fields.quantity), 0);
  const fromOrders = input.purchaseOrders
    .filter(
      (r) =>
        r.status !== 'deleted' &&
        (REORDER_OPEN_ORDER_STATUSES as readonly string[]).includes(str(r.fields.status)) &&
        refersTo(str(r.fields.product), input.sku, input.productId),
    )
    .reduce((s, r) => s + num(r.fields.quantity), 0);
  return round2(fromRequests + fromOrders);
}

/** One replenishment decision, with every number it used. */
export interface ReorderAssessment {
  /** True when a replenishment request should exist. */
  triggered: boolean;
  availableStock: number;
  /** Incoming supply already on live requests/orders. */
  openSupply: number;
  /** availableStock + openSupply — the figure compared to the reorder level. */
  position: number;
  reorderLevel: number;
  /** The level a triggered order replenishes to. */
  targetLevel: number;
  /** Whole units to order (≥ 1 when triggered, 0 otherwise). */
  suggestedQuantity: number;
  /** The sentence the modules stamp/say — always states the numbers. */
  note: string;
}

/**
 * Assess one product's replenishment need from its ledger-derived stock and
 * the open supply already on paper. Only ACTIVE products with a positive
 * reorder level ever trigger — a product without a reorder level has declared
 * no replenishment policy, and the engine says so instead of guessing one.
 */
export function assessReorder(input: { product: Product; openSupply: number }): ReorderAssessment {
  const p = input.product;
  const openSupply = round2(num(input.openSupply));
  const availableStock = round2(p.availableStock);
  const position = round2(availableStock + openSupply);
  const reorderLevel = round2(p.reorderLevel);
  const base: ReorderAssessment = {
    triggered: false,
    availableStock,
    openSupply,
    position,
    reorderLevel,
    targetLevel: reorderLevel,
    suggestedQuantity: 0,
    note: '',
  };
  if (p.status !== 'active') {
    base.note = `"${p.sku}" is ${p.status} — replenishment applies to active products only.`;
    return base;
  }
  if (reorderLevel <= 0) {
    base.note = `"${p.sku}" has no reorder level — set one to enable replenishment checks.`;
    return base;
  }
  // The target must EXCEED the trigger: replenishing exactly to the reorder
  // level would leave position ≤ reorderLevel and re-trigger forever. So the
  // target is the largest of maximumStock, reorderLevel + safetyStock, and
  // reorderLevel + 1 — one draft always closes the loop.
  const targetLevel = round2(
    Math.max(p.maximumStock, reorderLevel + Math.max(p.safetyStock, 0), reorderLevel + 1),
  );
  if (position > reorderLevel) {
    return {
      ...base,
      targetLevel,
      note:
        `"${p.sku}" is above its reorder level: available ${availableStock} + on order ${openSupply} ` +
        `= position ${position} > reorder level ${reorderLevel}. No replenishment needed.`,
    };
  }
  const suggestedQuantity = Math.max(Math.ceil(targetLevel - position), 1);
  return {
    ...base,
    triggered: true,
    targetLevel,
    suggestedQuantity,
    note:
      `"${p.sku}" hit its reorder level: available ${availableStock} + on order ${openSupply} ` +
      `= position ${position} ≤ reorder level ${reorderLevel}. ` +
      `Replenish to ${targetLevel} → order ${suggestedQuantity} ${p.unit || 'unit'}(s).`,
  };
}

/**
 * Deterministic request number for an auto-drafted replenishment:
 * `PR-AUTO-<SKU>-<n>`, where n is one past the highest existing suffix for
 * this SKU among the given request numbers.
 */
export function autoReorderRequestNumber(sku: string, existingNumbers: ReadonlyArray<string>): string {
  const prefix = `PR-AUTO-${sku}-`;
  let highest = 0;
  for (const number of existingNumbers) {
    if (!number.startsWith(prefix)) continue;
    const suffix = Number(number.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}${highest + 1}`;
}

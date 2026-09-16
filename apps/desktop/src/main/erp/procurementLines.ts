/**
 * ERP Session 16 — canonical multi-line procurement line model (pure).
 *
 * ONE line shape per document, no side effects, no persistence. Reused by the
 * Purchase Order module (subtotal from lines), the Goods Receipt `post`
 * (PO-line validation + the movement lines fed to the shared multi-line seam),
 * and the goods-bill three-way match (order lines). Keeping the parsers here
 * means there is never a second, divergent procurement line model — the PO and
 * the receipt read their lines through exactly these functions.
 *
 * Backward compatible by construction: a document with no `lines` parses to an
 * empty array, so every existing single-product Purchase Order / Goods Receipt
 * keeps its current header-driven behaviour untouched.
 */
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One purchase-order line: an item, an ordered quantity, a unit price. */
export interface PurchaseOrderLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

/** One goods-receipt line: an item, a received quantity, its PO-line reference. */
export interface GoodsReceiptLine {
  sku: string;
  quantity: number;
  /** 1-based PO line number this receipt line fulfils, or null (resolve by SKU). */
  poLine: number | null;
  warehouse: string;
}

/**
 * Parse a Purchase Order's `lines` JSON. Malformed / empty → []. Only
 * structurally valid lines (a SKU and a positive ordered quantity) are kept.
 */
export function parsePurchaseOrderLines(raw: unknown): PurchaseOrderLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(raw) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PurchaseOrderLine[] = [];
  for (const item of parsed) {
    const l = (item ?? {}) as Record<string, unknown>;
    const sku = str(l.sku ?? l.productId ?? l.product).trim();
    const quantity = num(l.quantity ?? l.orderedQuantity ?? l.qty);
    const unitPrice = num(l.unitPrice ?? l.price ?? l.unitCost);
    if (sku && quantity > 0) out.push({ sku, quantity, unitPrice });
  }
  return out;
}

/**
 * Parse a Goods Receipt's `lines` JSON. Malformed / empty → []. Warehouse falls
 * back to the document warehouse. `poLine` (1-based) is optional — when absent
 * the receipt line is matched to its PO line by SKU.
 */
export function parseGoodsReceiptLines(raw: unknown, docWarehouse: string): GoodsReceiptLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(raw) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GoodsReceiptLine[] = [];
  for (const item of parsed) {
    const l = (item ?? {}) as Record<string, unknown>;
    const sku = str(l.sku ?? l.productId ?? l.product).trim();
    const quantity = num(l.quantity ?? l.quantityReceived ?? l.qty);
    const poLineRaw = l.poLine ?? l.poLineNo ?? l.line;
    const poLine =
      poLineRaw === undefined || poLineRaw === null || str(poLineRaw).trim() === ''
        ? null
        : Math.trunc(num(poLineRaw));
    const warehouse = str(l.warehouse).trim() || docWarehouse;
    if (sku && quantity > 0) out.push({ sku, quantity, poLine, warehouse });
  }
  return out;
}

/** Σ (ordered quantity × unit price) over PO lines, rounded to cents. */
export function purchaseOrderSubtotal(lines: readonly PurchaseOrderLine[]): number {
  return round2(lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0));
}

/** Sum quantity per SKU across any line list (received-so-far, ordered, billed). */
export function sumBySku(lines: readonly { sku: string; quantity: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.sku, round2((m.get(l.sku) ?? 0) + l.quantity));
  return m;
}

/**
 * Resolve the PO line a receipt line fulfils. When `poLine` (1-based) is given it
 * is authoritative AND its SKU must match; otherwise the single PO line with the
 * receipt line's SKU is used. Returns null when nothing matches — the caller
 * MUST refuse a receipt line with no PO-line identity (deny by default).
 */
export function resolvePoLine(
  receiptLine: GoodsReceiptLine,
  poLines: readonly PurchaseOrderLine[],
): PurchaseOrderLine | null {
  if (receiptLine.poLine !== null) {
    const byIndex = poLines[receiptLine.poLine - 1];
    if (!byIndex || byIndex.sku !== receiptLine.sku) return null; // index and SKU must agree
    return byIndex;
  }
  const matches = poLines.filter((l) => l.sku === receiptLine.sku);
  return matches.length === 1 ? matches[0] : null; // ambiguous (0 or >1) → no deterministic identity
}

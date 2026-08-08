/**
 * Phase 6 — Three-way match: Purchase Order ↔ Goods Receipt ↔ Supplier Bill.
 *
 * This is the control that stops an organization paying for goods it did not
 * order or did not receive. It was previously impossible: single-line documents
 * carry no quantity/price detail to match against. It is implementable now only
 * because documents have real lines.
 *
 * Governing rule: a MISMATCH NEVER POSTS. The engine's job is to decide whether
 * a bill may proceed, and to say precisely why when it may not. Tolerances are
 * explicit and configurable — an unstated tolerance is just a silent error.
 */
import type { DocumentLine } from './documentLines';
import { computeLineTotals, round2 } from './documentLines';

export type MatchState = 'MATCHED' | 'PARTIAL' | 'MISMATCH' | 'BLOCKED' | 'MANUAL_REVIEW';

export interface MatchTolerance {
  /** Absolute quantity tolerance, in units. */
  quantityAbsolute: number;
  /** Price tolerance as a fraction of the ordered unit price (0.02 = 2%). */
  pricePercent: number;
  /** Absolute price tolerance in minor-unit terms, for very small prices. */
  priceAbsolute: number;
  /** Receiving more than ordered by this fraction is tolerated. */
  overReceiptPercent: number;
}

/**
 * Deliberately tight. A tolerance is a decision to accept loss; it should be a
 * conscious configuration, not a generous default.
 */
export const DEFAULT_TOLERANCE: MatchTolerance = {
  quantityAbsolute: 0,
  pricePercent: 0.01,
  priceAbsolute: 0.05,
  overReceiptPercent: 0.05,
};

export interface MatchLineResult {
  productId: string | null;
  description: string;
  orderedQuantity: number;
  receivedQuantity: number;
  billedQuantity: number;
  orderedUnitPrice: number;
  billedUnitPrice: number;
  state: MatchState;
  reasons: string[];
}

export interface MatchResult {
  state: MatchState;
  /** True only when the whole document may proceed to posting. */
  postable: boolean;
  lines: MatchLineResult[];
  reasons: string[];
  totals: {
    ordered: number;
    received: number;
    billed: number;
  };
  /** Quantity received but not yet billed — the GRNI balance. */
  receivedNotInvoiced: number;
}

export interface MatchInput {
  supplierId: string;
  orderSupplierId: string;
  currency: string;
  orderCurrency: string;
  orderLines: readonly DocumentLine[];
  receiptLines: readonly DocumentLine[];
  billLines: readonly DocumentLine[];
  tolerance?: Partial<MatchTolerance>;
}

/** Group lines by their matching key: product where present, else description. */
function keyOf(line: DocumentLine): string {
  const product = (line.productId ?? '').trim();
  if (product !== '') return `p:${product}`;
  return `d:${line.description.trim().toLowerCase()}`;
}

function sumQuantity(lines: readonly DocumentLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** Weighted-average unit price across lines, so split lines do not distort. */
function averageUnitPrice(lines: readonly DocumentLine[]): number {
  const qty = sumQuantity(lines);
  if (qty === 0) return lines[0]?.unitPrice ?? 0;
  const value = lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
  return round2(value / qty);
}

/**
 * Match a supplier bill against its order and receipts.
 *
 * Returns `postable: true` only for MATCHED. Everything else — partial receipt,
 * price drift, an unordered item, a currency or supplier mismatch — stops the
 * bill and names the cause.
 */
export function threeWayMatch(input: MatchInput): MatchResult {
  const tol: MatchTolerance = { ...DEFAULT_TOLERANCE, ...(input.tolerance ?? {}) };
  const reasons: string[] = [];

  // Document-level blockers are checked first: no amount of line agreement
  // rescues a bill from the wrong supplier or in the wrong currency.
  let blocked = false;
  if (input.supplierId !== input.orderSupplierId) {
    reasons.push(`Bill supplier "${input.supplierId}" does not match the order supplier "${input.orderSupplierId}".`);
    blocked = true;
  }
  if (input.currency !== input.orderCurrency) {
    reasons.push(`Bill currency ${input.currency} does not match the order currency ${input.orderCurrency}.`);
    blocked = true;
  }

  const keys = new Set<string>([
    ...input.orderLines.map(keyOf),
    ...input.receiptLines.map(keyOf),
    ...input.billLines.map(keyOf),
  ]);

  const lines: MatchLineResult[] = [];
  for (const key of keys) {
    const ordered = input.orderLines.filter((l) => keyOf(l) === key);
    const received = input.receiptLines.filter((l) => keyOf(l) === key);
    const billed = input.billLines.filter((l) => keyOf(l) === key);

    const orderedQty = sumQuantity(ordered);
    const receivedQty = sumQuantity(received);
    const billedQty = sumQuantity(billed);
    const orderedPrice = averageUnitPrice(ordered);
    const billedPrice = averageUnitPrice(billed);

    const lineReasons: string[] = [];
    let state: MatchState = 'MATCHED';

    if (ordered.length === 0) {
      lineReasons.push('Billed item does not appear on the purchase order.');
      state = 'MISMATCH';
    }

    // Quantity: billed must not exceed received (never pay for goods not in).
    if (billedQty > receivedQty + tol.quantityAbsolute) {
      lineReasons.push(
        `Billed quantity ${billedQty} exceeds received ${receivedQty}.`,
      );
      state = 'MISMATCH';
    }
    // Over-receipt beyond tolerance is a receiving problem, not a billing one.
    if (orderedQty > 0 && receivedQty > orderedQty * (1 + tol.overReceiptPercent)) {
      lineReasons.push(`Received quantity ${receivedQty} exceeds ordered ${orderedQty} beyond tolerance.`);
      state = state === 'MISMATCH' ? 'MISMATCH' : 'MANUAL_REVIEW';
    }

    // Price: a bill above the ordered price is the classic overcharge.
    if (ordered.length > 0 && billed.length > 0) {
      const delta = Math.abs(billedPrice - orderedPrice);
      const allowed = Math.max(orderedPrice * tol.pricePercent, tol.priceAbsolute);
      if (delta > allowed) {
        lineReasons.push(
          `Billed unit price ${billedPrice} differs from ordered ${orderedPrice} beyond tolerance.`,
        );
        state = 'MISMATCH';
      }
    }

    // Under-billing against receipt is legitimate (a later bill follows).
    if (state === 'MATCHED' && billedQty < receivedQty - tol.quantityAbsolute) {
      state = 'PARTIAL';
      lineReasons.push(`Received ${receivedQty}, billed ${billedQty} — remainder not yet invoiced.`);
    }
    // Nothing received yet, but a bill exists.
    if (receivedQty === 0 && billedQty > 0) {
      state = 'MISMATCH';
      lineReasons.push('Billed before any goods were received.');
    }

    lines.push({
      productId: ordered[0]?.productId ?? received[0]?.productId ?? billed[0]?.productId ?? null,
      description: ordered[0]?.description ?? received[0]?.description ?? billed[0]?.description ?? '',
      orderedQuantity: orderedQty,
      receivedQuantity: receivedQty,
      billedQuantity: billedQty,
      orderedUnitPrice: orderedPrice,
      billedUnitPrice: billedPrice,
      state,
      reasons: lineReasons,
    });
  }

  const orderedValue = input.orderLines.reduce((n, l) => round2(n + computeLineTotals(l).total), 0);
  const receivedValue = input.receiptLines.reduce((n, l) => round2(n + l.quantity * (l.unitPrice || 0)), 0);
  const billedValue = input.billLines.reduce((n, l) => round2(n + computeLineTotals(l).total), 0);

  let state: MatchState;
  if (blocked) state = 'BLOCKED';
  else if (lines.some((l) => l.state === 'MISMATCH')) state = 'MISMATCH';
  else if (lines.some((l) => l.state === 'MANUAL_REVIEW')) state = 'MANUAL_REVIEW';
  else if (lines.some((l) => l.state === 'PARTIAL')) state = 'PARTIAL';
  else state = 'MATCHED';

  for (const l of lines) for (const r of l.reasons) reasons.push(`${l.description || l.productId || 'line'}: ${r}`);

  // Quantity received but not billed, valued at the ordered price — the GRNI
  // balance this match leaves outstanding.
  const receivedNotInvoiced = round2(
    lines.reduce((n, l) => n + Math.max(0, l.receivedQuantity - l.billedQuantity) * l.orderedUnitPrice, 0),
  );

  return {
    state,
    postable: state === 'MATCHED',
    lines,
    reasons,
    totals: { ordered: orderedValue, received: receivedValue, billed: billedValue },
    receivedNotInvoiced,
  };
}

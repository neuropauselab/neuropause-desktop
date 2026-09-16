/**
 * ERP Session 11 — goods vendor-bill three-way match + GRNI-relief evaluation.
 *
 * A goods bill (one that references a purchase order via `sourcePurchaseOrder`)
 * must pass a LINE-LEVEL three-way match — Purchase Order ↔ Goods Receipt ↔
 * Vendor Bill — before it may post, and when it does it relieves GRNI rather than
 * booking an operating expense. A service/expense bill (no PO source) is NOT a
 * goods bill and keeps the existing Operating Expense path.
 *
 * This module is the single place that RESOLVES the match: it reuses the existing
 * pure `threeWayMatch` engine (never a second matcher) and the pure
 * `deriveGoodsBillPosting` derivation. It reads only tenant-scoped stores through
 * `ctx.moduleFor`, so it can never cross a tenant. It is used by TWO callers with
 * one source of truth — the vendor-bill `approve` action (to gate, fail-closed)
 * and `handleVendorBillChangeForGl` (to post the relief lines).
 *
 * Received value is read back from the ACTUAL posted receipt movements
 * (quantity × posted unitCost), i.e. the GRNI that was really accrued — so the
 * relief nets GRNI to zero even if the product's standard cost later changes.
 */
import {
  GL_PAYABLE_CONTROL_ACCOUNTS,
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  type EnterpriseEntity,
  type GlJournalLine,
} from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';
import { threeWayMatch, type MatchState } from '../../../erp/threeWayMatch';
import type { DocumentLine, LineDocumentType } from '../../../erp/documentLines';
import { deriveGoodsBillPosting } from '../../../erp/postingRules';
import { parsePurchaseOrderLines } from '../../../erp/procurementLines';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One parsed vendor-bill line. */
export interface BillLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  taxRatePercent: number | null;
}

/**
 * Parse the vendor bill's `lines` JSON. Malformed / empty → []. Only structurally
 * valid lines (a SKU and a positive quantity) are kept; the caller decides what an
 * empty result means (a goods bill with no lines cannot match).
 */
export function parseBillLines(raw: unknown): BillLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(raw) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BillLine[] = [];
  for (const item of parsed) {
    const l = (item ?? {}) as Record<string, unknown>;
    const sku = str(l.sku ?? l.productId ?? l.product).trim();
    const quantity = num(l.quantity);
    const unitPrice = num(l.unitPrice ?? l.price);
    if (sku && quantity > 0) {
      const tr = l.taxRatePercent ?? l.taxRate;
      out.push({ sku, quantity, unitPrice, taxRatePercent: tr === undefined || tr === null ? null : num(tr) });
    }
  }
  return out;
}

/** A goods bill is one that names a source purchase order. */
export function isGoodsBill(record: EnterpriseEntity): boolean {
  return str(record.fields.sourcePurchaseOrder).trim() !== '';
}

export type GoodsBillState =
  | 'SERVICE' // not a goods bill — no PO source
  | 'NO_PO' // named a PO that does not resolve in scope
  | 'NO_LINES' // goods bill without line items
  | 'LINES_INCONSISTENT' // lines do not sum to the subtotal
  | 'NO_RECEIPT' // no received goods to match/relieve
  | MatchState; // MATCHED / PARTIAL / MISMATCH / BLOCKED / MANUAL_REVIEW

export interface GoodsBillEvaluation {
  isGoods: boolean;
  /** True when the bill may post (MATCHED or a legitimate PARTIAL). */
  postable: boolean;
  state: GoodsBillState;
  reasons: string[];
  receivedValue: number;
  billedExTax: number;
  taxAmount: number;
  reliefLines: GlJournalLine[] | null;
}

function matchLine(
  documentType: LineDocumentType,
  lineNo: number,
  productId: string,
  quantity: number,
  unitPrice: number,
  currency: string,
): DocumentLine {
  return {
    id: `ml-${documentType}-${lineNo}`,
    documentId: `ml-${documentType}`,
    documentType,
    lineNo,
    productId: productId || null,
    description: productId,
    quantity,
    unit: null,
    unitPrice,
    discountPercent: null,
    discountAmount: null,
    taxRatePercent: null,
    currency,
    accountId: null,
    warehouseId: null,
    projectId: null,
    costCenterId: null,
    batchId: null,
    createdAt: '',
    updatedAt: '',
    createdBy: null,
  };
}

const notGoods = (): GoodsBillEvaluation => ({
  isGoods: false,
  postable: false,
  state: 'SERVICE',
  reasons: [],
  receivedValue: 0,
  billedExTax: 0,
  taxAmount: 0,
  reliefLines: null,
});

const held = (state: GoodsBillState, reasons: string[]): GoodsBillEvaluation => ({
  isGoods: true,
  postable: false,
  state,
  reasons,
  receivedValue: 0,
  billedExTax: 0,
  taxAmount: 0,
  reliefLines: null,
});

/**
 * Evaluate a vendor bill. For a goods bill, resolve PO + receipts (tenant-scoped),
 * read the actual accrued GRNI from the receipt movements, run the three-way match,
 * and — only when MATCHED — compute the GRNI-relief lines. Deterministic; performs
 * no writes.
 */
export async function evaluateGoodsBill(
  ctx: EnterpriseModuleActionContext,
  record: EnterpriseEntity,
): Promise<GoodsBillEvaluation> {
  const fields = record.fields;
  const poRef = str(fields.sourcePurchaseOrder).trim();
  if (!poRef) return notGoods();

  // Resolve the PO through the tenant-scoped store (a foreign-tenant PO is invisible).
  const poModule = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
  if (!poModule) return held('NO_PO', ['Purchase orders module is unavailable.']);
  await poModule.store.load();
  const po = poModule.store
    .list()
    .find((r) => r.status !== 'deleted' && (r.id === poRef || str(r.fields.poNumber).trim() === poRef));
  if (!po) return held('NO_PO', [`Source purchase order "${poRef}" was not found in scope.`]);

  const billLinesParsed = parseBillLines(fields.lines);
  if (billLinesParsed.length === 0) {
    return held('NO_LINES', ['A goods bill must carry line items (product, quantity, unit price) to be matched.']);
  }

  // Bill lines must be consistent with the entered subtotal (base currency).
  const lineSum = round2(billLinesParsed.reduce((n, l) => n + l.quantity * l.unitPrice, 0));
  const subtotal = round2(num(fields.amount));
  if (lineSum !== subtotal) {
    return held('LINES_INCONSISTENT', [`Bill lines sum to ${lineSum} but the subtotal is ${subtotal}.`]);
  }

  // Accrued GRNI per SKU, read back from the actual posted receipt movements —
  // the GRNI really accrued, so relief nets to zero even if the product's
  // standard cost later changes. Aggregated across ALL of the PO's receipts
  // (partial + multiple receipts).
  const receiptsModule = ctx.moduleFor(GOODS_RECEIPTS_MODULE_ID);
  const movementsModule = ctx.moduleFor(STOCK_MOVEMENTS_MODULE_ID);
  if (!receiptsModule || !movementsModule) return held('NO_RECEIPT', ['Receipt/movement modules are unavailable.']);
  await receiptsModule.store.load();
  await movementsModule.store.load();
  const receipts = receiptsModule.store
    .list()
    .filter((r) => r.status !== 'deleted' && str(r.fields.purchaseOrder) === po.id && str(r.fields.status) === 'received');

  // ERP Session 16 — aggregate received value from the ACTUAL `receive`
  // movements that reference this PO's receipts, reading the SKU from each
  // movement. This unifies single-product receipts (one movement per receipt)
  // and multi-line receipts (one movement per line) with no second path: a
  // legacy receipt has exactly one movement whose product equals its header, so
  // the result is byte-identical to the prior single-movement read.
  const receivedQty = new Map<string, number>();
  const accruedValue = new Map<string, number>();
  const receiptIds = new Set(receipts.map((r) => r.id));
  for (const mv of movementsModule.store.list()) {
    if (mv.status === 'deleted') continue;
    if (str(mv.fields.type) !== 'receive' || str(mv.fields.status) === 'void') continue;
    if (str(mv.fields.referenceModule) !== GOODS_RECEIPTS_MODULE_ID) continue;
    if (!receiptIds.has(str(mv.fields.referenceRecord))) continue;
    const q = num(mv.fields.quantity);
    const uc = num(mv.fields.unitCost);
    if (q <= 0) continue;
    const sku = str(mv.fields.product);
    receivedQty.set(sku, round2((receivedQty.get(sku) ?? 0) + q));
    accruedValue.set(sku, round2((accruedValue.get(sku) ?? 0) + q * uc));
  }
  const totalReceived = [...receivedQty.values()].reduce((n, q) => n + q, 0);
  if (totalReceived <= 0) {
    return held('NO_RECEIPT', ['No received-and-posted goods for this purchase order to match against.']);
  }

  // CUMULATIVE billing: quantity already billed on prior POSTED (approved/paid)
  // bills for this PO, derived from their line items (no new field). This bill
  // therefore matches against the REMAINING receivable, and cumulative billed can
  // never exceed cumulative received. Cancelled/draft bills do not consume it.
  const alreadyBilled = new Map<string, number>();
  const billsModule = ctx.moduleFor(VENDOR_BILLS_MODULE_ID);
  if (billsModule) {
    await billsModule.store.load();
    const poRefs = new Set([po.id, str(po.fields.poNumber).trim()].filter((s) => s !== ''));
    for (const other of billsModule.store.list()) {
      if (other.id === record.id || other.status === 'deleted') continue;
      const st = str(other.fields.status);
      if (st !== 'approved' && st !== 'paid') continue; // only posted bills consume received qty
      if (!poRefs.has(str(other.fields.sourcePurchaseOrder).trim())) continue;
      for (const l of parseBillLines(other.fields.lines)) {
        alreadyBilled.set(l.sku, round2((alreadyBilled.get(l.sku) ?? 0) + l.quantity));
      }
    }
  }

  /** Accrued GRNI per unit for a SKU (pool allocated by quantity; = standard cost when constant). */
  const perUnit = (sku: string): number => {
    const q = receivedQty.get(sku) ?? 0;
    return q > 0 ? (accruedValue.get(sku) ?? 0) / q : 0;
  };

  // Feed the EXISTING three-way match engine the REMAINING receivable (received −
  // already billed): billed ≤ remaining → MATCHED (bills the rest) or PARTIAL
  // (bills part) — both postable for their portion; billed > remaining → MISMATCH,
  // fail closed. No second matcher.
  // ERP Session 16 — the order side of the match is the PO's lines when it has
  // them (one order line per SKU), else the single-product header. This is what
  // lets a multi-SKU bill match: every billed SKU has an order line to match.
  const orderPoLines = parsePurchaseOrderLines(po.fields.lines);
  const orderLines: DocumentLine[] =
    orderPoLines.length > 0
      ? orderPoLines.map((l, i) => matchLine('purchaseOrder', i + 1, l.sku, l.quantity, l.unitPrice, str(po.fields.currency)))
      : [matchLine('purchaseOrder', 1, str(po.fields.product), num(po.fields.quantity), num(po.fields.unitCost), str(po.fields.currency))];
  const receiptLines: DocumentLine[] = [];
  let rl = 0;
  for (const [sku, q] of receivedQty) {
    const remaining = Math.max(0, round2(q - (alreadyBilled.get(sku) ?? 0)));
    receiptLines.push(matchLine('goodsReceipt', (rl += 1), sku, remaining, perUnit(sku), str(fields.currency)));
  }
  const billLines: DocumentLine[] = billLinesParsed.map((l, i) =>
    matchLine('bill', i + 1, l.sku, l.quantity, l.unitPrice, str(fields.currency)),
  );

  const match = threeWayMatch({
    supplierId: str(fields.vendor),
    orderSupplierId: str(po.fields.supplier),
    currency: str(fields.currency),
    orderCurrency: str(po.fields.currency),
    orderLines,
    receiptLines,
    billLines,
  });

  // A partial bill is legitimate: MATCHED (bills the whole remaining) and PARTIAL
  // (bills part of it) both post their portion; everything else fails closed.
  const postable = match.state === 'MATCHED' || match.state === 'PARTIAL';

  const rate = num(fields.exchangeRate) > 0 ? num(fields.exchangeRate) : 1;
  const billedExTax = round2(subtotal * rate);
  const taxAmount = round2(num(fields.taxAmount) * rate);
  // GRNI relieved for THIS bill = its billed quantity × the accrued per-unit rate.
  // Cumulative relief across all of a PO's bills therefore sums to the accrued
  // pool exactly, so GRNI nets to zero once fully billed. (Base currency, as
  // accrued; PPV = billedExTax − relief absorbs price and, for a foreign bill, FX.)
  const reliefValue = round2(billLinesParsed.reduce((n, l) => n + l.quantity * perUnit(l.sku), 0));

  if (!postable) {
    return {
      isGoods: true,
      postable: false,
      state: match.state,
      reasons: match.reasons.length > 0 ? match.reasons : [`Three-way match state ${match.state}.`],
      receivedValue: reliefValue,
      billedExTax,
      taxAmount,
      reliefLines: null,
    };
  }

  const derivation = deriveGoodsBillPosting({
    billId: str(fields.billNumber) || record.id,
    receivedValue: reliefValue,
    billedExTax,
    taxAmount,
    taxAccount: GL_PAYABLE_CONTROL_ACCOUNTS.gstInputCredit.code,
  });
  if (!derivation.ok) {
    return {
      isGoods: true,
      postable: false,
      state: 'MISMATCH',
      reasons: [derivation.refusedReason ?? 'GRNI-relief derivation refused.'],
      receivedValue: reliefValue,
      billedExTax,
      taxAmount,
      reliefLines: null,
    };
  }

  return {
    isGoods: true,
    postable: true,
    state: match.state,
    reasons: [],
    receivedValue: reliefValue,
    billedExTax,
    taxAmount,
    reliefLines: derivation.lines,
  };
}

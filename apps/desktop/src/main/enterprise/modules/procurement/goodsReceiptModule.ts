/**
 * Procurement → Goods Receipt — where procurement meets inventory. Posting a
 * receipt records a REAL `receive` Stock Movement into the Inventory Ledger (via
 * the shared `postStockMovement` seam), so the product's stock is derived, never
 * edited directly — inventory stays the single source of truth. The `post` action
 * is guarded + idempotent (a receipt posts once). The `summarize` hook explains
 * the deterministic receipt accuracy; the AI never computes it.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  GoodsReceipt,
} from '@neuropause/shared';
import {
  GOODS_RECEIPTS_MODULE_ID,
  GOODS_RECEIPT_KIND,
  PURCHASE_ORDERS_MODULE_ID,
  goodsReceiptFromRecord,
  goodsReceiptSummaryFallback,
  type EnterpriseEntity,
  type EnterpriseModuleActionResult,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { postStockMovement } from '../inventory/postMovement';
import { postMovementLinesAtomic } from '../inventory/multiLineMovements';
import {
  parseGoodsReceiptLines,
  parsePurchaseOrderLines,
  resolvePoLine,
  sumBySku,
} from '../../../erp/procurementLines';

export const POST_RECEIPT_ACTION = 'post';

const gstr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * ERP Session 16 — post a multi-line goods receipt. Each receipt line is
 * validated against a Purchase Order line (it must resolve to one — deny by
 * default) and cumulative received ≤ ordered per SKU across all of the PO's
 * received receipts (the default no-over-receipt invariant; the repository
 * defines no over-receipt acceptance policy). Lines then post one valued
 * `receive` movement each through the shared multi-line seam (Session 7), so
 * inventory + Dr Inventory / Cr GRNI per line and all-or-nothing compensation
 * are inherited, never re-implemented. Standard cost, canonical accounts and the
 * single-product path are unchanged.
 */
async function postMultiLineReceipt(
  store: EnterpriseRecordStore,
  record: EnterpriseEntity,
  ctx: EnterpriseModuleActionContext,
): Promise<EnterpriseModuleActionResult> {
  const grNumber = gstr(record.fields.grNumber);
  const docLines = parseGoodsReceiptLines(record.fields.lines, gstr(record.fields.warehouse));
  const poRef = gstr(record.fields.purchaseOrder).trim();
  if (!poRef) return { ok: false, message: 'A multi-line goods receipt must reference a purchase order.' };

  const poModule = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
  if (!poModule) return { ok: false, error: 'Purchase orders module is unavailable.' };
  await poModule.store.load();
  const po = poModule.store
    .list()
    .find((r) => r.status !== 'deleted' && (r.id === poRef || gstr(r.fields.poNumber).trim() === poRef));
  if (!po) return { ok: false, message: `Purchase order "${poRef}" was not found in scope.` };
  const poLines = parsePurchaseOrderLines(po.fields.lines);
  if (poLines.length === 0) return { ok: false, message: 'The referenced purchase order has no lines to receive against.' };

  // Every receipt line must resolve to a PO line — its deterministic identity.
  for (const rl of docLines) {
    if (!resolvePoLine(rl, poLines)) {
      return { ok: false, message: `Receipt line for SKU "${rl.sku}" does not match a line on purchase order "${poRef}".` };
    }
  }

  // Cumulative received ≤ ordered per SKU (this receipt + prior received receipts
  // of the same PO). No SKU's receipt can satisfy another SKU — keyed by SKU.
  await store.load();
  const poRefs = new Set([po.id, gstr(po.fields.poNumber).trim()].filter((s) => s !== ''));
  const priorReceiptLines = store
    .list()
    .filter(
      (o) =>
        o.id !== record.id &&
        o.status !== 'deleted' &&
        gstr(o.fields.status) === 'received' &&
        poRefs.has(gstr(o.fields.purchaseOrder).trim()),
    )
    .flatMap((o) => parseGoodsReceiptLines(o.fields.lines, gstr(o.fields.warehouse)));
  const orderedBySku = sumBySku(poLines);
  const priorBySku = sumBySku(priorReceiptLines);
  const thisBySku = sumBySku(docLines);
  for (const [sku, qtyThis] of thisBySku) {
    const ordered = orderedBySku.get(sku) ?? 0;
    const prior = priorBySku.get(sku) ?? 0;
    if (round2(prior + qtyThis) > round2(ordered) + 1e-6) {
      return {
        ok: false,
        message: `Over-receipt refused: SKU "${sku}" cumulative received ${round2(prior + qtyThis)} would exceed ordered ${ordered}.`,
      };
    }
  }

  // One valued `receive` movement per line — the shared multi-line seam gives
  // per-line inventory + GRNI + all-or-nothing compensation + reversal identity.
  const result = await postMovementLinesAtomic(
    ctx,
    { module: GOODS_RECEIPTS_MODULE_ID, recordId: record.id, number: grNumber, type: 'receive', reason: `Goods receipt ${grNumber}` },
    docLines.map((l) => ({ sku: l.sku, quantity: l.quantity, warehouse: l.warehouse })),
  );
  if (!result.ok) return { ok: false, error: result.message };
  const updated = store.update(record.id, {
    fields: {
      status: 'received',
      receiptMovements: result.movementIds.join(','),
      quantityReceived: [...thisBySku.values()].reduce((n, q) => n + q, 0),
      receiptDate: ctx.now().slice(0, 10),
    },
    actor: ctx.actor(),
    now: ctx.now(),
  });
  if (!updated) return { ok: false, error: 'Goods receipt not found.' };
  const self = ctx.moduleFor(GOODS_RECEIPTS_MODULE_ID);
  if (self) ctx.emit(self, 'updated', updated);
  return { ok: true, message: `Received ${result.postedCount} line(s) for ${grNumber}.` };
}

export const GOODS_RECEIPT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: GOODS_RECEIPTS_MODULE_ID,
  title: 'Goods Receipts',
  singular: 'Goods Receipt',
  plural: 'Goods Receipts',
  icon: 'download',
  description: 'Receive purchased goods into inventory via real stock movements.',
  group: 'Procurement',
  titleField: 'grNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [{ key: POST_RECEIPT_ACTION, label: 'Post Receipt', icon: 'check' }],
  fields: [
    { key: 'grNumber', label: 'GR Number', type: 'text', required: true, placeholder: 'GR-0001' },
    { key: 'purchaseOrder', label: 'Purchase Order', type: 'text', column: false, readOnly: true },
    { key: 'supplier', label: 'Supplier', type: 'text', column: false },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'quantityOrdered', label: 'Qty Ordered', type: 'number', min: 0, column: false },
    { key: 'quantityReceived', label: 'Qty Received', type: 'number', required: true, min: 0 },
    // ERP Session 16 — multi-line receipt. When present, this JSON array of
    // {sku, quantity, poLine?} is received one valued movement per line against
    // the referenced PO's lines; the single-product fields above stay a header
    // summary. Absent → the single-product receipt path (backward compatible).
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea', column: false, placeholder: '[{"sku":"SKU-A","quantity":6,"poLine":1}]' },
    { key: 'receiptMovements', label: 'Line Movements', type: 'textarea', column: false, readOnly: true },
    { key: 'expectedDate', label: 'Expected', type: 'date', column: false, format: 'date' },
    { key: 'receiptDate', label: 'Received', type: 'date', format: 'date' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'received', label: 'Received', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'neutral' },
      ],
    },
    { key: 'condition', label: 'Condition', type: 'text', column: false },
    { key: 'receiptMovement', label: 'Stock Movement', type: 'text', column: false, readOnly: true },
  ],
};

export interface GoodsReceiptAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type GoodsReceiptAiRunner = (receipt: GoodsReceipt) => Promise<GoodsReceiptAiNarrative | null>;

export function createGoodsReceiptModule(storePath: string, aiRunner?: GoodsReceiptAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, GOODS_RECEIPTS_MODULE_ID, GOODS_RECEIPT_KIND);
  return defineEnterpriseModule({
    descriptor: GOODS_RECEIPT_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const receipt = goodsReceiptFromRecord(record);
        const ai = aiRunner ? await aiRunner(receipt).catch(() => null) : null;
        const fallback = goodsReceiptSummaryFallback(receipt);
        return {
          moduleId: GOODS_RECEIPTS_MODULE_ID,
          recordId: record.id,
          headline: `${receipt.grNumber} · ${receipt.product} · ${receipt.quantityReceived}/${receipt.quantityOrdered} · ${receipt.status}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: receipt.status === 'rejected' ? 'medium' : 'low',
          riskReason: `Receipt ${receipt.status}.`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // THE inventory integration: posting a receipt writes a real `receive`
      // movement into the ledger and stamps the movement reference back. Idempotent.
      runAction: async (action, record, ctx) => {
        if (action !== POST_RECEIPT_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const receipt = goodsReceiptFromRecord(record);
        if (receipt.status === 'received') return { ok: false, message: 'This receipt has already been posted.' };
        // ERP Session 16 — a receipt carrying `lines` posts one valued movement
        // per line against its PO's lines (document-level idempotency: the
        // 'received' guard above already prevents a re-post). Otherwise the
        // single-product path below runs unchanged.
        if (parseGoodsReceiptLines(record.fields.lines, gstr(record.fields.warehouse)).length > 0) {
          return postMultiLineReceipt(store, record, ctx);
        }
        if (receipt.quantityReceived <= 0 || !receipt.product || !receipt.warehouse) {
          return { ok: false, message: 'Set a product, warehouse, and received quantity before posting.' };
        }
        const movement = await postStockMovement(ctx, {
          movementNumber: `MV-${receipt.grNumber}-RCV`,
          type: 'receive',
          product: receipt.product,
          warehouse: receipt.warehouse,
          quantity: receipt.quantityReceived,
          referenceModule: GOODS_RECEIPTS_MODULE_ID,
          referenceRecord: receipt.id,
          reason: `Goods receipt ${receipt.grNumber}`,
        });
        if (!movement) return { ok: false, error: 'Could not post the stock movement.' };
        const updated = store.update(record.id, {
          fields: { status: 'received', receiptMovement: movement.id, receiptDate: ctx.now().slice(0, 10) },
          actor: ctx.actor(),
          now: ctx.now(),
        });
        if (!updated) return { ok: false, error: 'Goods receipt not found.' };
        const self = ctx.moduleFor(GOODS_RECEIPTS_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Received ${receipt.quantityReceived} of ${receipt.product} into stock.` };
      },
    },
  });
}

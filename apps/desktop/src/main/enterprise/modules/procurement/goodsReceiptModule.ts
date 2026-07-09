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
  goodsReceiptFromRecord,
  goodsReceiptSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { postStockMovement } from '../inventory/postMovement';

export const POST_RECEIPT_ACTION = 'post';

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

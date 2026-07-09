/**
 * Procurement → Purchase Orders — the commitment to buy. A `validate` hook stamps
 * the deterministic `total` (subtotal − discount + tax); lifecycle actions
 * (approve / send / cancel) apply guarded transitions; and a `receiveGoods`
 * conversion raises a Goods Receipt. The `summarize` hook explains the order; the
 * AI never computes the total.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  PurchaseOrder,
} from '@neuropause/shared';
import {
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_ORDER_KIND,
  calculatePurchaseTotal,
  purchaseOrderFromRecord,
  purchaseOrderSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { RECEIVE_GOODS_ACTION, convertPurchaseOrderToReceipt } from './conversion';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const PURCHASE_ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PURCHASE_ORDERS_MODULE_ID,
  title: 'Purchase Orders',
  singular: 'Purchase Order',
  plural: 'Purchase Orders',
  icon: 'doc',
  description: 'Commitments to buy from suppliers, received into inventory.',
  group: 'Procurement',
  titleField: 'poNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [
    { key: 'approve', label: 'Approve', icon: 'check' },
    { key: 'send', label: 'Send', icon: 'upload' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
    { key: RECEIVE_GOODS_ACTION, label: 'Receive Goods', icon: 'download' },
  ],
  fields: [
    { key: 'poNumber', label: 'PO Number', type: 'text', required: true, placeholder: 'PO-0001' },
    { key: 'supplier', label: 'Supplier', type: 'text', placeholder: 'Acme Supplies' },
    { key: 'product', label: 'Product (SKU)', type: 'text', placeholder: 'SKU-0001' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', column: false, placeholder: 'WH-01' },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0 },
    { key: 'unitCost', label: 'Unit Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'subtotal', label: 'Subtotal', type: 'number', min: 0, format: 'currency' },
    { key: 'discount', label: 'Discount', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'tax', label: 'Tax', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'total', label: 'Total', type: 'number', format: 'currency', readOnly: true },
    { key: 'budget', label: 'Budget', type: 'number', min: 0, format: 'currency', column: false },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      column: false,
      default: 'USD',
      options: [
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
        { value: 'GBP', label: 'GBP' },
        { value: 'INR', label: 'INR' },
      ],
    },
    { key: 'expectedDelivery', label: 'Expected Delivery', type: 'date', format: 'date' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'approved', label: 'Approved', tone: 'blue' },
        { value: 'sent', label: 'Sent', tone: 'teal' },
        { value: 'received', label: 'Received', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'approvedBy', label: 'Approved By', type: 'text', column: false },
    { key: 'sourceRequest', label: 'Source Request', type: 'text', column: false, readOnly: true },
    { key: 'convertedReceipt', label: 'Goods Receipt', type: 'text', column: false, readOnly: true },
  ],
};

export interface PurchaseOrderAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type PurchaseOrderAiRunner = (order: PurchaseOrder) => Promise<PurchaseOrderAiNarrative | null>;

/** Legal target status for each lifecycle action, given the current status. */
function poTransition(action: string, from: string): string | null {
  if (action === 'approve') return from === 'draft' ? 'approved' : null;
  if (action === 'send') return from === 'approved' ? 'sent' : null;
  if (action === 'cancel') return from === 'received' || from === 'cancelled' ? null : 'cancelled';
  return null;
}

function projectValues(values: EnterpriseRecordInput['fields']): PurchaseOrder {
  const record: EnterpriseEntity = {
    id: '', moduleId: PURCHASE_ORDERS_MODULE_ID, kind: PURCHASE_ORDER_KIND, title: '', status: 'active',
    fields: { ...(values ?? {}) }, tags: [], rev: 0, createdAt: '', updatedAt: '', createdBy: null, updatedBy: null, metadata: {},
  };
  return purchaseOrderFromRecord(record);
}

export function createPurchaseOrderModule(storePath: string, aiRunner?: PurchaseOrderAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PURCHASE_ORDERS_MODULE_ID, PURCHASE_ORDER_KIND);
  return defineEnterpriseModule({
    descriptor: PURCHASE_ORDER_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(PURCHASE_ORDER_DESCRIPTOR, input);
        if (result.ok) result.values.total = calculatePurchaseTotal(projectValues(result.values));
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const order = purchaseOrderFromRecord(record);
        const ai = aiRunner ? await aiRunner(order).catch(() => null) : null;
        const fallback = purchaseOrderSummaryFallback(order);
        return {
          moduleId: PURCHASE_ORDERS_MODULE_ID,
          recordId: record.id,
          headline: `${order.poNumber} · ${order.supplier || '—'} · ${order.status} · ${Math.round(calculatePurchaseTotal(order)).toLocaleString()}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: order.status === 'cancelled' ? 'low' : 'low',
          riskReason: `Purchase order ${order.status}.`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        if (action === RECEIVE_GOODS_ACTION) return convertPurchaseOrderToReceipt(record, ctx);
        const target = poTransition(action, str(record.fields.status));
        if (!target) return { ok: false, message: `Cannot ${action} a purchase order that is ${str(record.fields.status)}.` };
        const updated = store.update(record.id, { fields: { status: target }, actor: ctx.actor(), now: ctx.now() });
        if (!updated) return { ok: false, error: 'Purchase order not found.' };
        const self = ctx.moduleFor(PURCHASE_ORDERS_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Purchase order ${str(record.fields.poNumber)} ${target}.` };
      },
    },
  });
}

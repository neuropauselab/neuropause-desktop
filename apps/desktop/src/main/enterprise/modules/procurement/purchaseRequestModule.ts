/**
 * Procurement → Purchase Requests — the intake of the buy-side flow. Master data
 * + an `approve` action and a `createPurchaseOrder` conversion (Purchase Request
 * → Purchase Order). CRUD, RBAC, audit, timeline, and search are inherited.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import {
  PURCHASE_REQUESTS_MODULE_ID,
  PURCHASE_REQUEST_KIND,
  purchaseRequestFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { CREATE_PO_ACTION, convertRequestToPurchaseOrder } from './conversion';

export const PURCHASE_REQUEST_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PURCHASE_REQUESTS_MODULE_ID,
  title: 'Purchase Requests',
  singular: 'Purchase Request',
  plural: 'Purchase Requests',
  icon: 'clipboard',
  description: 'Internal requests to buy — routed for approval into purchase orders.',
  group: 'Procurement',
  titleField: 'requestNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [
    { key: 'submit', label: 'Submit', icon: 'upload' },
    { key: 'approve', label: 'Approve', icon: 'check' },
    { key: 'reject', label: 'Reject', icon: 'close' },
    { key: CREATE_PO_ACTION, label: 'Create Purchase Order', icon: 'arrow-right' },
  ],
  fields: [
    { key: 'requestNumber', label: 'Request #', type: 'text', required: true, placeholder: 'PR-0001' },
    { key: 'department', label: 'Department', type: 'text' },
    { key: 'requester', label: 'Requester', type: 'text', column: false },
    { key: 'product', label: 'Product (SKU)', type: 'text', placeholder: 'SKU-0001' },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0 },
    // ERP Session 17 — multi-line PR (the Session 16 line model). When present,
    // this JSON array of {sku, quantity, unitPrice} is the authoritative request
    // content and is carried verbatim to the PO lines on conversion. Absent → the
    // single-product header (backward compatible).
    { key: 'lines', label: 'Lines (JSON)', type: 'textarea', column: false, placeholder: '[{"sku":"SKU-A","quantity":10,"unitPrice":5}]' },
    { key: 'requiredDate', label: 'Required Date', type: 'date', column: false, format: 'date' },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      default: 'medium',
      badge: true,
      filterable: true,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'orange' },
        { value: 'urgent', label: 'Urgent', tone: 'pink' },
      ],
    },
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
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'approved', label: 'Approved', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'pink' },
        { value: 'ordered', label: 'Ordered', tone: 'purple' },
      ],
    },
    { key: 'budget', label: 'Budget', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'approver', label: 'Approver', type: 'text', column: false },
    { key: 'reason', label: 'Reason', type: 'textarea', column: false },
    { key: 'convertedOrder', label: 'Purchase Order', type: 'text', column: false, readOnly: true },
  ],
};

export function createPurchaseRequestModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PURCHASE_REQUESTS_MODULE_ID, PURCHASE_REQUEST_KIND);
  return defineEnterpriseModule({
    descriptor: PURCHASE_REQUEST_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        if (action === CREATE_PO_ACTION) return convertRequestToPurchaseOrder(record, ctx);
        const pr = purchaseRequestFromRecord(record);
        const self = ctx.moduleFor(PURCHASE_REQUESTS_MODULE_ID);
        const transition = (target: string): { ok: true; message: string } | { ok: false; error: string } => {
          const updated = store.update(record.id, { fields: { status: target }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'Request not found.' };
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Request ${pr.requestNumber} ${target === 'pending' ? 'submitted' : target}.` };
        };
        // ERP Session 17 — the governed lifecycle: DRAFT → SUBMITTED(pending) →
        // APPROVED / REJECTED → CONVERTED(ordered). Reuses the existing status
        // values (no invented states); each transition is authorized + audited +
        // emits an 'updated' lifecycle event through the framework.
        if (action === 'submit') {
          if (pr.status !== 'draft') return { ok: false, message: `Cannot submit a request that is ${pr.status}.` };
          return transition('pending');
        }
        if (action === 'approve') {
          if (pr.status !== 'draft' && pr.status !== 'pending') {
            return { ok: false, message: `Cannot approve a request that is ${pr.status}.` };
          }
          return transition('approved');
        }
        if (action === 'reject') {
          if (pr.status !== 'draft' && pr.status !== 'pending') {
            return { ok: false, message: `Cannot reject a request that is ${pr.status}.` };
          }
          return transition('rejected');
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

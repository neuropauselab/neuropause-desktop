/**
 * Finance → Vendor Bills — the payable mirror of invoices, on the Enterprise
 * Module Framework: a descriptor + the framework's record store + a `validate`
 * hook + `approve`/`markPaid`/`cancel` actions + an `onChange` that flows every
 * lifecycle change into the General Ledger through the same idempotent
 * auto-posting seam invoices use. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC: tax/total are computed stamps; `status` derives from the
 * action-stamped markers (approvedAt / paidAt / cancelledAt) and can never be
 * forged through the validated path. Approving books Dr Operating Expense
 * (+ Dr GST Input Credit) / Cr Accounts Payable; marking paid books
 * Dr Accounts Payable / Cr Cash; cancellation reverses the CUMULATIVE booking;
 * amount edits after approval book balanced ADJ deltas — all via `glPosting`.
 * `markPaid` is the honest single-step settlement primitive until a
 * vendor-payments module exists (stated, not hidden).
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  VENDOR_BILLS_MODULE_ID,
  VENDOR_BILL_KIND,
  calculateBillTax,
  vendorBillFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { handleVendorBillChangeForGl } from './glPosting';

/** The declarative description of a vendor bill — drives store, CRUD, and the UI. */
export const VENDOR_BILL_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: VENDOR_BILLS_MODULE_ID,
  title: 'Vendor Bills',
  singular: 'Vendor Bill',
  plural: 'Vendor Bills',
  icon: 'download',
  description: 'Supplier bills — approval books the payable, settlement books the payment, aging watches the rest.',
  group: 'Finance',
  titleField: 'billNumber',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  // Settlement is recorded through Vendor Payments (the source of truth since
  // W1.11) — there is no manual "mark paid".
  actions: [
    { key: 'approve', label: 'Approve', icon: 'upload' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'billNumber', label: 'Bill #', type: 'text', required: true, placeholder: 'BILL-0001' },
    { key: 'vendor', label: 'Vendor', type: 'text', required: true, placeholder: 'Supplies Co.' },
    { key: 'vendorGstin', label: 'Vendor GSTIN', type: 'text', column: false, placeholder: '22AAAAA0000A1Z5' },
    { key: 'amount', label: 'Subtotal', type: 'number', required: true, min: 0, format: 'currency' },
    { key: 'taxRate', label: 'Tax Rate %', type: 'number', min: 0, max: 100, column: false },
    { key: 'taxAmount', label: 'Tax', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'total', label: 'Total', type: 'number', readOnly: true, format: 'currency' },
    { key: 'functionalTotal', label: 'Functional Total', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'amountPaid', label: 'Amount Paid', type: 'number', readOnly: true, format: 'currency', default: 0 },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      required: true,
      default: 'USD',
      column: false,
      options: [
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
        { value: 'GBP', label: 'GBP' },
        { value: 'INR', label: 'INR' },
      ],
    },
    { key: 'exchangeRate', label: 'Exchange Rate', type: 'number', min: 0, default: 1, column: false },
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
        { value: 'paid', label: 'Paid', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'billDate', label: 'Bill Date', type: 'date', format: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date', format: 'date' },
    { key: 'paymentReference', label: 'Payment Ref', type: 'text', column: false },
    { key: 'paidDate', label: 'Paid', type: 'date', format: 'date', readOnly: true, column: false },
    { key: 'sourcePurchaseOrder', label: 'Source PO', type: 'text', column: false, readOnly: true },
    { key: 'approvedAt', label: 'Approved At', type: 'text', readOnly: true, column: false },
    { key: 'cancelledAt', label: 'Cancelled At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Status derives from the action-stamped markers — never from user input. */
function deriveStatus(values: Record<string, unknown>): string {
  if (str(values.cancelledAt)) return 'cancelled';
  if (str(values.paidDate)) return 'paid';
  if (str(values.approvedAt)) return 'approved';
  return 'draft';
}

/** Build the Vendor Bills module. */
export function createVendorBillModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, VENDOR_BILLS_MODULE_ID, VENDOR_BILL_KIND);
  return defineEnterpriseModule({
    descriptor: VENDOR_BILL_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(VENDOR_BILL_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        const amount = Number(result.values.amount ?? 0);
        if (amount <= 0) errors.amount = 'Subtotal must be greater than zero.';
        const taxRate = Number(result.values.taxRate ?? 0);
        const taxAmount = calculateBillTax(amount, taxRate);
        result.values.taxAmount = taxAmount;
        result.values.total = Math.round((amount + taxAmount) * 100) / 100;
        // W6-B8: stamp the functional-currency total the GL posts (rate default 1 → equals total).
        const billRate = Number(result.values.exchangeRate ?? 1) > 0 ? Number(result.values.exchangeRate ?? 1) : 1;
        result.values.functionalTotal = Math.round(amount * billRate) + Math.round(taxAmount * billRate);
        result.values.status = deriveStatus(result.values);
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // Every lifecycle change flows into the GL through the shared seam —
      // approve/pay/cancel/delete/amount-edit are all idempotent bookkeeping.
      onChange: async (event, ctx) => {
        await handleVendorBillChangeForGl(event, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const bill = vendorBillFromRecord(record);
        return {
          moduleId: VENDOR_BILLS_MODULE_ID,
          recordId: record.id,
          headline: `${bill.billNumber} · ${bill.status} · ${bill.currency} ${Math.round(bill.total).toLocaleString('en-US')}`,
          summary: `${bill.vendor}: subtotal ${bill.amount.toLocaleString('en-US')}, tax ${bill.taxAmount.toLocaleString('en-US')}, total ${bill.total.toLocaleString('en-US')} — ${bill.status}${bill.status === 'paid' ? ` on ${bill.paidDate}` : bill.dueDate ? `, due ${bill.dueDate}` : ''}.`,
          risk: bill.status === 'approved' ? 'medium' : 'low',
          riskReason:
            bill.status === 'approved'
              ? 'Open payable — appears in AP aging until settled.'
              : 'No open payable exposure.',
          executiveExplanation:
            'Approval books the payable (Dr Expense + Dr GST Input Credit / Cr AP); settlement books Dr AP / Cr Cash; cancellation reverses the cumulative booking. All idempotent, all in the journal.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const bill = vendorBillFromRecord(record);
        const self = actionCtx.moduleFor(VENDOR_BILLS_MODULE_ID);
        const stampAndEmit = (fields: Record<string, string>): ReturnType<EnterpriseRecordStore['update']> => {
          const updated = store.update(record.id, {
            fields: { ...fields, status: deriveStatus({ ...record.fields, ...fields }) },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (updated && self) actionCtx.emit(self, 'updated', updated);
          return updated;
        };

        if (action === 'approve') {
          if (bill.status !== 'draft') return { ok: false, message: `Cannot approve a bill that is ${bill.status}.` };
          const updated = stampAndEmit({ approvedAt: actionCtx.now() });
          if (!updated) return { ok: false, error: 'Bill not found.' };
          return { ok: true, message: `Bill ${bill.billNumber} approved — payable booked.` };
        }
        if (action === 'cancel') {
          if (bill.status === 'cancelled') return { ok: false, message: 'Already cancelled.' };
          const updated = stampAndEmit({ cancelledAt: actionCtx.now() });
          if (!updated) return { ok: false, error: 'Bill not found.' };
          return { ok: true, message: `Bill ${bill.billNumber} cancelled — bookings reversed.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

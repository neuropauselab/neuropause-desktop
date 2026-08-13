/**
 * Finance → Vendor Payments — payable settlement on the Enterprise Module
 * Framework, the exact mirror of customer Payments: a descriptor + the
 * framework's record store + a `validate` hook + an `onChange` reconciler + a
 * deterministic `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * Payments are the SOURCE OF TRUTH for settlement: on every payment change the
 * `onChange` hook re-derives the referenced bill's `amountPaid` from the
 * cleared ledger and stamps `paidDate` when — and only when — the bill is
 * fully covered (clearing it again if payments are voided), then flows the
 * payment into the General Ledger (Dr AP / Cr Cash per payment, `JE-VPAY-*`,
 * idempotent; void reverses). DETERMINISTIC guards at validate: the bill must
 * resolve to exactly one approved/paid record, duplicate transaction
 * references are refused, and overpaying past the bill's remaining balance is
 * refused with the remainder stated. Partial payments simply accumulate.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  VENDOR_BILLS_MODULE_ID,
  VENDOR_PAYMENTS_MODULE_ID,
  VENDOR_PAYMENT_KIND,
  isDuplicateVendorTransaction,
  sumClearedVendorPayments,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { handleVendorPaymentChangeForGl } from './glPosting';

/** The declarative description of a vendor payment — drives store, CRUD, and the UI. */
export const VENDOR_PAYMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: VENDOR_PAYMENTS_MODULE_ID,
  title: 'Vendor Payments',
  singular: 'Vendor Payment',
  plural: 'Vendor Payments',
  icon: 'upload',
  description: 'Record and allocate payments against vendor bills — partials accumulate until the bill settles.',
  group: 'Finance',
  titleField: 'paymentNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true, placeholder: 'VPAY-0001' },
    { key: 'billRef', label: 'Vendor Bill', type: 'text', required: true, placeholder: 'Bill number or id' },
    { key: 'vendor', label: 'Vendor', type: 'text', placeholder: 'Supplies Co.' },
    { key: 'amount', label: 'Amount', type: 'number', required: true, min: 0, format: 'currency' },
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
      key: 'method',
      label: 'Method',
      type: 'select',
      column: false,
      default: 'bank_transfer',
      filterable: true,
      options: [
        { value: 'bank_transfer', label: 'Bank Transfer' },
        { value: 'card', label: 'Card' },
        { value: 'cash', label: 'Cash' },
        { value: 'cheque', label: 'Cheque' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'cleared',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'cleared', label: 'Cleared', tone: 'green' },
        { value: 'void', label: 'Void', tone: 'neutral' },
      ],
    },
    { key: 'paidDate', label: 'Paid', type: 'date', format: 'date' },
    { key: 'transactionRef', label: 'Transaction Ref', type: 'text', column: false },
    { key: 'bankAccount', label: 'Bank Account', type: 'text', column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Resolve a bill by record id or by its bill number (the payment-module rule). */
function findBill(billStore: EnterpriseRecordStore, ref: string): EnterpriseEntity | null {
  if (!ref) return null;
  const byId = billStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return billStore.list().find((r) => str(r.fields.billNumber) === ref) ?? null;
}

/**
 * Build the Vendor Payments module. `billStore` is injected so the guards can
 * read the referenced bill + the payment ledger (the Payments pattern).
 */
export function createVendorPaymentModule(
  storePath: string,
  billStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, VENDOR_PAYMENTS_MODULE_ID, VENDOR_PAYMENT_KIND);

  /** Re-derive the referenced bill's paid state from the cleared ledger + persist it. */
  async function reconcileBill(ref: string, ctx: EnterpriseModuleActionContext): Promise<void> {
    if (!ref) return;
    const billModule = ctx.moduleFor(VENDOR_BILLS_MODULE_ID);
    if (!billModule) return;
    await billModule.store.load();
    const billRecord = findBill(billModule.store, ref);
    if (!billRecord) return;
    const bill = vendorBillFromRecord(billRecord);
    const ledger = store.list().map(vendorPaymentFromRecord);
    const amountPaid = sumClearedVendorPayments([billRecord.id, bill.billNumber], ledger);
    const fullyPaid = Math.round((amountPaid - bill.total) * 100) >= 0 && bill.total > 0;
    const paidDate = fullyPaid ? (str(billRecord.fields.paidDate) || ctx.now().slice(0, 10)) : '';
    const unchanged =
      Math.round((bill.amountPaid - amountPaid) * 100) === 0 &&
      str(billRecord.fields.paidDate) === paidDate;
    if (unchanged) return;
    const status = str(billRecord.fields.cancelledAt)
      ? 'cancelled'
      : paidDate
        ? 'paid'
        : str(billRecord.fields.approvedAt)
          ? 'approved'
          : 'draft';
    const updated = billModule.store.update(billRecord.id, {
      fields: { amountPaid, paidDate, status },
      actor: ctx.actor(),
      now: ctx.now(),
    });
    if (updated) ctx.emit(billModule, 'updated', updated);
  }

  return defineEnterpriseModule({
    descriptor: VENDOR_PAYMENT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(VENDOR_PAYMENT_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        const payment = vendorPaymentFromRecord({
          id: '',
          moduleId: VENDOR_PAYMENTS_MODULE_ID,
          kind: VENDOR_PAYMENT_KIND,
          title: '',
          status: 'active',
          fields: { ...result.values },
          tags: [],
          rev: 0,
          createdAt: '',
          updatedAt: '',
          createdBy: null,
          updatedBy: null,
          metadata: {},
        } as EnterpriseEntity);

        if (payment.amount <= 0) errors.amount = 'Amount must be greater than zero.';

        const billRecord = findBill(billStore, payment.billRef);
        if (!billRecord) {
          errors.billRef = 'No matching vendor bill was found.';
        } else {
          const bill = vendorBillFromRecord(billRecord);
          if (bill.status === 'draft' || bill.status === 'cancelled') {
            errors.billRef = `Cannot pay a ${bill.status} bill — approve it first.`;
          } else if (payment.status !== 'void' && payment.amount > 0) {
            const others = store
              .list()
              .map(vendorPaymentFromRecord)
              .filter((p) => p.paymentNumber !== payment.paymentNumber);
            const alreadyPaid = sumClearedVendorPayments([billRecord.id, bill.billNumber], others);
            if (Math.round((alreadyPaid + payment.amount - bill.total) * 100) > 0) {
              const remaining = Math.max(0, Math.round((bill.total - alreadyPaid) * 100) / 100);
              errors.amount = `Payment exceeds the bill's remaining balance (${remaining}).`;
            }
          }
        }

        const ledger = store.list().map(vendorPaymentFromRecord);
        if (isDuplicateVendorTransaction(ledger, payment.transactionRef, payment.paymentNumber)) {
          errors.transactionRef = 'This transaction reference is already recorded.';
        }

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // The source-of-truth inversion: reconcile the bill from the cleared
      // ledger, then flow the payment into the General Ledger.
      onChange: async (event, ctx) => {
        await reconcileBill(str(event.record.fields.billRef), ctx);
        await handleVendorPaymentChangeForGl(event, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const payment = vendorPaymentFromRecord(record);
        return {
          moduleId: VENDOR_PAYMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${payment.paymentNumber} · ${payment.status} · ${payment.currency} ${Math.round(payment.amount).toLocaleString('en-US')}`,
          summary: `${payment.amount.toLocaleString('en-US')} against bill ${payment.billRef} (${payment.method}) — ${payment.status}.`,
          risk: payment.status === 'pending' ? 'medium' : 'low',
          riskReason:
            payment.status === 'pending'
              ? 'Pending payments do not settle the bill or touch the books until cleared.'
              : 'Cleared payments are booked and reconciled.',
          executiveExplanation:
            'Each cleared payment books Dr Accounts Payable / Cr Cash for its own amount; the bill is paid exactly when its cleared payments cover its total, and voiding a payment un-pays it — the ledger is the truth.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

/**
 * Finance → Payment Reversals (ERP Session 61, D4) — the governed reversal of an
 * already-cleared customer or vendor payment.
 *
 * The reversal is a SEPARATE, immutable record that references the original
 * payment; the ORIGINAL payment is never mutated (no status flip to
 * pending/void/deleted, no field edit) and remains historical truth. Creating a
 * reversal:
 *   • books the COMPENSATING GL — one cumulative `${base}-REV` entry mirroring
 *     everything the original clearing booked (cash, AR/AP, realized FX), at the
 *     original amounts, via the same `decideLifecycle` revocation path the void/
 *     soft-delete flow already uses (`handlePaymentReversalForGl`); and
 *   • re-opens the referenced invoice/bill by re-deriving its paid amount with
 *     the reversed payment EXCLUDED (the shared `paymentReconcile`).
 *
 * Guards (deny-by-default, fail-closed): the original must exist IN THE CALLER'S
 * TENANT (scopeOrDeny), be `cleared`, not be bank-reconciled (S55 — a bank-
 * evidenced settled payment is not reversible here; that subset is STOP+memo),
 * and not already carry a reversal (at-most-one effective reversal per payment).
 * A reversal record is immutable once created.
 *
 * Electron-free (store paths + the payment stores injected), so it unit-tests
 * without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  paymentFromRecord,
  validateEnterpriseRecordInput,
  vendorPaymentFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { handlePaymentReversalForGl } from './glPosting';
import {
  PAYMENT_REVERSALS_MODULE_ID,
  reconcileBillFromLedger,
  reconcileInvoiceFromLedger,
} from './paymentReconcile';

/** The record kind for the reversal store. Local, non-frozen. */
export const PAYMENT_REVERSAL_KIND = 'finance-payment-reversal';

export const PAYMENT_REVERSAL_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PAYMENT_REVERSALS_MODULE_ID,
  title: 'Payment Reversals',
  singular: 'Payment Reversal',
  plural: 'Payment Reversals',
  icon: 'download',
  description: 'Governed reversal of a cleared customer or vendor payment — the original stays immutable; compensating GL is booked.',
  group: 'Finance',
  titleField: 'reversalNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    // Stamped deterministically from the original payment number when not supplied (`REV-<paymentNumber>`).
    { key: 'reversalNumber', label: 'Reversal #', type: 'text', placeholder: 'REV-PAY-0001' },
    {
      key: 'originalKind',
      label: 'Payment Type',
      type: 'select',
      required: true,
      default: 'customer',
      options: [
        { value: 'customer', label: 'Customer Payment' },
        { value: 'vendor', label: 'Vendor Payment' },
      ],
    },
    { key: 'originalPaymentId', label: 'Original Payment', type: 'text', required: true, placeholder: 'Payment record id' },
    { key: 'originalPaymentNumber', label: 'Payment #', type: 'text', readOnly: true, column: false },
    { key: 'documentRef', label: 'Document', type: 'text', readOnly: true, column: false },
    { key: 'amount', label: 'Amount', type: 'number', readOnly: true, format: 'currency' },
    { key: 'currency', label: 'Currency', type: 'text', readOnly: true, column: false },
    { key: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'Why is this payment being reversed?' },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Payment Reversals module. The customer + vendor payment stores are
 * injected so the guards can resolve the original payment (tenant-scoped) and the
 * reconciler can re-open the referenced invoice/bill.
 */
export function createPaymentReversalModule(
  storePath: string,
  paymentsStore: EnterpriseRecordStore,
  vendorPaymentsStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYMENT_REVERSALS_MODULE_ID, PAYMENT_REVERSAL_KIND);

  return defineEnterpriseModule({
    descriptor: PAYMENT_REVERSAL_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PAYMENT_REVERSAL_DESCRIPTOR, input);
        if (!result.ok) return result;

        // A reversal is immutable — it is additional history, never edited.
        if (input.recordId) {
          return {
            ok: false,
            errors: { _: 'A payment reversal is immutable historical evidence — it cannot be edited.' },
            values: result.values,
          };
        }

        const kind = str(result.values.originalKind);
        if (kind !== 'customer' && kind !== 'vendor') {
          return { ok: false, errors: { originalKind: 'Reversal type must be customer or vendor.' }, values: result.values };
        }
        const originalId = str(result.values.originalPaymentId).trim();
        result.values.originalPaymentId = originalId;
        if (!originalId) {
          return { ok: false, errors: { originalPaymentId: 'The original payment is required.' }, values: result.values };
        }

        // Resolve the original IN THE CALLER'S TENANT — `store.get` applies
        // scopeOrDeny, so a payment belonging to another tenant is null → refused.
        const sourceStore = kind === 'vendor' ? vendorPaymentsStore : paymentsStore;
        const original = sourceStore.get(originalId);
        if (!original || original.status === 'deleted') {
          return { ok: false, errors: { originalPaymentId: 'No matching payment was found.' }, values: result.values };
        }
        const op = kind === 'vendor' ? vendorPaymentFromRecord(original) : paymentFromRecord(original);

        // Only a CLEARED payment carries a booked economic effect to reverse.
        if (op.status !== 'cleared') {
          return {
            ok: false,
            errors: { originalPaymentId: `Only a cleared payment can be reversed — this one is ${op.status || 'status-less'}.` },
            values: result.values,
          };
        }

        // S55 — a bank-reconciled payment is bank-evidenced settled fact; reversing
        // it needs a bank-side correction/authority that does not exist yet
        // (DECISION-MEMO-S61). Refuse rather than silently erase the evidence.
        if (str(original.fields.bankReconciledAt)) {
          return {
            ok: false,
            errors: { originalPaymentId: 'This payment is bank-reconciled against a finalized statement — it cannot be reversed here (see the bank correction workflow).' },
            values: result.values,
          };
        }

        // At-most-one EFFECTIVE reversal per original payment (deterministic replay).
        const alreadyReversed = store
          .list()
          .some((r) => r.status !== 'deleted' && str(r.fields.originalPaymentId) === originalId);
        if (alreadyReversed) {
          return {
            ok: false,
            errors: { originalPaymentId: 'This payment has already been reversed.' },
            values: result.values,
          };
        }

        // Stamp the immutable evidence from the ORIGINAL (never user-forged): the
        // reconciler + GL read these, and they must reflect the original's truth.
        result.values.originalPaymentNumber = op.paymentNumber;
        result.values.documentRef =
          kind === 'vendor'
            ? vendorPaymentFromRecord(original).billRef
            : paymentFromRecord(original).invoiceRef;
        result.values.amount = op.amount;
        result.values.currency = op.currency;
        if (!str(result.values.reversalNumber).trim()) {
          result.values.reversalNumber = `REV-${op.paymentNumber}`;
        }
        return result;
      },
      onChange: async (event, ctx) => {
        // Book the compensating `${base}-REV` GL for the original payment.
        await handlePaymentReversalForGl(event, ctx);
        // Re-open the referenced invoice/bill — the reversed original is now
        // excluded from the applied ledger by the shared reconciler.
        const kind = str(event.record.fields.originalKind);
        const docRef = str(event.record.fields.documentRef);
        if (kind === 'vendor') {
          await reconcileBillFromLedger(vendorPaymentsStore, docRef, ctx);
        } else {
          await reconcileInvoiceFromLedger(paymentsStore, docRef, ctx);
        }
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const kind = str(record.fields.originalKind);
        const number = str(record.fields.originalPaymentNumber);
        const amount = Number(record.fields.amount ?? 0);
        const currency = str(record.fields.currency) || 'USD';
        return {
          moduleId: PAYMENT_REVERSALS_MODULE_ID,
          recordId: record.id,
          headline: `${str(record.fields.reversalNumber)} · reverses ${kind} payment ${number} · ${currency} ${Math.round(amount).toLocaleString('en-US')}`,
          summary: `Governed reversal of ${kind} payment ${number}: the original stays immutable; a compensating ${kind === 'vendor' ? 'Dr Cash / Cr AP' : 'Dr AR / Cr Cash'} entry unwinds the settlement and the document re-opens.`,
          risk: 'low',
          riskReason: 'Deterministic, idempotent unwind of the original posting — no new balancing accounts, the original journal untouched.',
          executiveExplanation:
            'Reversing a cleared payment books a compensating mirror of the original entry and re-opens the invoice/bill. The original payment and its journal are preserved as historical truth; at most one reversal per payment.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

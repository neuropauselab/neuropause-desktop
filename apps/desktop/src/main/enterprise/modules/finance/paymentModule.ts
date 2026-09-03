/**
 * Finance → Payments — the module that completes the commercial ERP lifecycle
 * (…Invoice → **Payment** → receivable closed). Built on the Enterprise Module
 * Framework like every other module: a descriptor + the framework's record store
 * + a `validate` hook + a `summarize` hook + an `onChange` reconciler.
 *
 * Payments are REAL, independent records — never derived from invoice status.
 * They are the SOURCE OF TRUTH for collection: on every payment change the
 * `onChange` hook re-derives the referenced invoice's paid amount from the ledger
 * and runs it back through the invoice's OWN validate hook, so the invoice's
 * status / outstanding balance always reflect real payments (no duplicated
 * state). DETERMINISTIC guards block overpayment and duplicate transactions at
 * create time; the AI only explains. Overpayment and duplicate checks read the
 * injected invoice store + the payment ledger (both loaded before validate).
 *
 * Electron-free (store paths + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  SalesPayment,
} from '@neuropause/shared';
import {
  PAYMENTS_MODULE_ID,
  PAYMENT_KIND,
  calculateInvoiceAmount,
  calculatePaidAmount,
  calculatePaymentHealth,
  formatInvoiceAmount,
  invoiceFromRecord,
  isDuplicateTransaction,
  paymentFromRecord,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { handlePaymentChangeForGl } from './glPosting';
import { reconcileInvoiceFromLedger } from './paymentReconcile';

/** The declarative description of a payment — drives store, CRUD, and the UI. */
export const PAYMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PAYMENTS_MODULE_ID,
  title: 'Payments',
  singular: 'Payment',
  plural: 'Payments',
  icon: 'download',
  description: 'Record and reconcile customer payments against invoices.',
  group: 'Finance',
  titleField: 'paymentNumber',
  // Reuses the Finance write scope — payments are a finance capability.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  // S57 — the governed clearing affordance (routes to ClearCustomerPayment; the S46 fence
  // made edit-door clearing impossible, which left pending payments with NO clearing path).
  actions: [{ key: 'clear', label: 'Clear', icon: 'check' }],
  fields: [
    { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true, placeholder: 'PAY-0001' },
    { key: 'invoiceRef', label: 'Invoice', type: 'text', required: true, placeholder: 'Invoice id or number' },
    { key: 'customer', label: 'Customer', type: 'text', placeholder: 'Acme Inc.' },
    { key: 'amount', label: 'Amount', type: 'number', required: true, min: 0, format: 'currency' },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      required: true,
      default: 'USD',
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
    { key: 'receivedDate', label: 'Received', type: 'date', format: 'date' },
    { key: 'transactionRef', label: 'Transaction Ref', type: 'text', column: false },
    { key: 'bankAccount', label: 'Bank Account', type: 'text', column: false },
    // FW-8 (ADDITIVE): stamped by the Bank Statements module when a FINALIZED
    // statement's matched line evidences this payment — never user-edited.
    { key: 'bankReconciledAt', label: 'Bank Reconciled', type: 'text', readOnly: true, column: false },
    { key: 'bankStatementRef', label: 'Bank Statement', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

/** The AI narrative half of a summary; the health band stays deterministic. */
export interface PaymentAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

export type PaymentAiRunner = (payment: SalesPayment) => Promise<PaymentAiNarrative | null>;

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Resolve an invoice by record id or by its invoice number (either may be used as the ref). */
function findInvoice(invoiceStore: EnterpriseRecordStore, ref: string): EnterpriseEntity | null {
  if (!ref) return null;
  const byId = invoiceStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return invoiceStore.list().find((r) => str(r.fields.number) === ref) ?? null;
}

/** Project already-validated field values into a typed payment. */
function projectValues(values: EnterpriseRecordInput['fields']): SalesPayment {
  const record: EnterpriseEntity = {
    id: '',
    moduleId: PAYMENTS_MODULE_ID,
    kind: PAYMENT_KIND,
    title: '',
    status: 'active',
    fields: { ...(values ?? {}) },
    tags: [],
    rev: 0,
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    metadata: {},
  };
  return paymentFromRecord(record);
}

/**
 * Build the Payments module. `invoiceStore` is injected so the create-time guards
 * (invoice-exists, overpayment, duplicate transaction) can read the referenced
 * invoice + the ledger. The AI runner is optional (offline → deterministic
 * fallback).
 */
export function createPaymentModule(
  storePath: string,
  invoiceStore: EnterpriseRecordStore,
  aiRunner?: PaymentAiRunner,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYMENTS_MODULE_ID, PAYMENT_KIND);

  /**
   * Re-derive the referenced invoice's paid amount from the ledger + persist it.
   * ERP Session 61 — delegates to the ONE shared reconciliation so the customer
   * payment, vendor payment, and governed reversal paths all derive `amountPaid`
   * identically (a reversed payment is excluded, re-opening the invoice without
   * mutating the original). With no reversal records this is byte-identical to
   * the pre-S61 inline derivation the finance suites pin.
   */
  async function reconcileInvoice(ref: string, ctx: EnterpriseModuleActionContext): Promise<void> {
    await reconcileInvoiceFromLedger(store, ref, ctx);
  }

  return defineEnterpriseModule({
    descriptor: PAYMENT_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic guards: positive amount, invoice must exist, no duplicate
      // transaction reference, and no overpayment beyond the invoice's balance.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PAYMENT_DESCRIPTOR, input);
        if (!result.ok) return result;
        // FW-8: a bank-reconciled payment is bank-evidenced settled fact — a
        // finalized statement line vouches for it. Immutable through edits.
        // S55 — STORE-ANCHORED half (census-found forgeable token): the input half
        // below reads the merged payload, so bankReconciledAt:'' blanked the stamp
        // and the guard passed. The stored stamp is the authority.
        if (input.recordId) {
          const prior = store.get(input.recordId);
          if (prior && String(prior.fields.bankReconciledAt ?? '')) {
            return {
              ok: false,
              errors: { _: 'This payment is bank-reconciled against a finalized statement — bank-evidenced payments are immutable.' },
              values: result.values,
            };
          }
        }
        if (String(input.fields?.bankReconciledAt ?? '')) {
          return {
            ok: false,
            errors: { _: 'This payment is bank-reconciled against a finalized statement — bank-evidenced payments are immutable.' },
            values: result.values,
          };
        }
        // ERP Session 46 — the transition INTO `cleared` books real GL (Dr Cash / Cr AR via the onChange
        // reconciler), so it must go through the governed `ReceiveCustomerPayment` command, never a plain
        // edit. An EDIT (recordId present ⇒ the update door) that moves a NON-cleared payment into `cleared`
        // is refused — closing the "create pending → edit to cleared" shortcut that minted cash GL around
        // the command spine. A cleared receipt created through the governed command has no prior record on
        // that path and is unaffected; a status-less importer row is not compared; voiding/reversal stays a
        // separate, memo-tracked policy decision.
        if (input.recordId) {
          const priorStatus = String(store.get(input.recordId)?.fields.status ?? '');
          if (priorStatus !== '' && priorStatus !== 'cleared' && String(result.values.status) === 'cleared') {
            return {
              ok: false,
              errors: { status: 'Clearing a payment books cash — record it through New Payment (cleared), not by editing the status.' },
              values: result.values,
            };
          }
        }
        const payment = projectValues(result.values);
        const errors: Record<string, string> = {};

        if (payment.amount <= 0) errors.amount = 'Amount must be greater than zero.';

        const invRecord = findInvoice(invoiceStore, payment.invoiceRef);
        if (!invRecord) {
          errors.invoiceRef = 'No matching invoice was found.';
        }

        const ledger = store.list().map(paymentFromRecord);
        if (isDuplicateTransaction(ledger, payment.transactionRef, payment.paymentNumber)) {
          errors.transactionRef = 'This transaction reference is already recorded.';
        }

        if (invRecord && payment.status !== 'void' && payment.amount > 0) {
          const invoice = invoiceFromRecord(invRecord);
          const total = calculateInvoiceAmount(invoice);
          const others = ledger.filter(
            (p) =>
              (p.invoiceRef === invRecord.id || p.invoiceRef === invoice.number) &&
              p.paymentNumber !== payment.paymentNumber,
          );
          const alreadyApplied = calculatePaidAmount(others);
          if (alreadyApplied + payment.amount > total) {
            const remaining = Math.max(0, total - alreadyApplied);
            errors.amount = `Payment exceeds the invoice balance (remaining ${formatInvoiceAmount(remaining, invoice.currency)}).`;
          }
        }

        if (Object.keys(errors).length > 0) {
          return { ok: false, errors, values: result.values };
        }
        return result;
      },
      // The source-of-truth inversion: on every payment change, reconcile the
      // invoice's paid amount + status from the real ledger, then post the
      // settlement into the General Ledger (Dr Cash / Cr AR + realized FX,
      // W6-B4.5) — the same reconcile-then-post pattern the Vendor Payments
      // module already uses. A no-op when the GL modules are not wired.
      // S57 — the DEFINED pending→cleared transition, relocated from the fenced edit door to
      // an explicit action (semantics unchanged: the status flip; onChange below books
      // Dr Cash / Cr AR and settles the invoice exactly as it always did). Reached through
      // the governed ClearCustomerPayment command; void/cleared rows refuse.
      runAction: async (action, record, actionCtx) => {
        if (action !== 'clear') return { ok: false, error: `Unknown action "${action}".` };
        const status = String(record.fields.status ?? '');
        if (status !== 'pending') {
          return { ok: false, message: `Only a pending payment can be cleared — this one is ${status || 'status-less'}.` };
        }
        const updated = store.update(record.id, { fields: { status: 'cleared' }, actor: actionCtx.actor(), now: actionCtx.now() });
        if (!updated) return { ok: false, error: 'Payment not found.' };
        const self = actionCtx.moduleFor(PAYMENTS_MODULE_ID);
        if (self) actionCtx.emit(self, 'updated', updated);
        return { ok: true, message: `Payment ${String(record.fields.paymentNumber ?? '')} cleared — cash booked and the invoice reconciled.` };
      },
      onChange: async (_event, ctx) => {
        await reconcileInvoice(str(_event.record.fields.invoiceRef), ctx);
        await handlePaymentChangeForGl(_event, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const payment = paymentFromRecord(record);
        const health = calculatePaymentHealth(payment);
        const ai = aiRunner ? await aiRunner(payment).catch(() => null) : null;
        const fallback = paymentSummaryFallback(payment);
        return {
          moduleId: PAYMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${payment.paymentNumber} · ${paymentStatusLabel(payment.status)} · ${payment.currency} ${Math.round(payment.amount).toLocaleString()} · ${paymentMethodLabel(payment.method)}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}

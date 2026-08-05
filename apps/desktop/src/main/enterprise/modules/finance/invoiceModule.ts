/**
 * Finance → Invoices — the first ERP module, promoted from a thin invoice record
 * into a full receivables module on the Enterprise Module Framework. Same
 * blueprint as the rest: a descriptor + the framework's record store + a
 * `validate` hook + a `summarize` hook + lifecycle module actions. CRUD, RBAC
 * (`operations:read` / `operations:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC finance logic, never AI, never user-forged: a `validate` hook
 * stamps the read-only `taxAmount`, `total`, and `outstandingBalance` and derives
 * the stored `status` from the payment recorded, and the issue/markPaid/cancel
 * actions apply real, guarded state transitions. The `summarize` hook hands the
 * model those signals to EXPLAIN — never to set. Overdue is derived live.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  FinanceInvoice,
  InvoiceAction,
  InvoiceRisk,
} from '@neuropause/shared';
import {
  FINANCE_MODULE_ID,
  INVOICE_KIND,
  calculatePaymentStatus,
  computeInvoiceSignals,
  deriveStoredInvoiceStatus,
  formatInvoiceAmount,
  invoiceActionPatch,
  invoiceComputedFields,
  invoiceFromRecord,
  invoiceStatusLabel,
  invoiceSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { handleInvoiceChangeForGl } from './glPosting';

/** The declarative description of an invoice — drives store, CRUD, and the UI. */
export const INVOICE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FINANCE_MODULE_ID,
  title: 'Finance',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'database',
  description: 'Issue, collect, and track customer invoices with AI risk assessment.',
  group: 'Finance',
  titleField: 'number',
  // Reuses existing enterprise scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  // Paying an invoice is done by recording a Payment (the source of truth), which
  // reconciles this invoice's paid amount + status — there is no manual "mark paid".
  actions: [
    { key: 'issue', label: 'Issue', icon: 'upload' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'number', label: 'Invoice #', type: 'text', required: true, placeholder: 'INV-0001' },
    { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'Acme Inc.' },
    { key: 'amount', label: 'Subtotal', type: 'number', required: true, min: 0, format: 'currency' },
    { key: 'taxRate', label: 'Tax Rate %', type: 'number', min: 0, max: 100, column: false },
    { key: 'taxAmount', label: 'Tax', type: 'number', column: false, format: 'currency', readOnly: true },
    { key: 'total', label: 'Total', type: 'number', format: 'currency', readOnly: true },
    { key: 'amountPaid', label: 'Amount Paid', type: 'number', min: 0, format: 'currency', readOnly: true },
    { key: 'outstandingBalance', label: 'Outstanding', type: 'number', format: 'currency', readOnly: true },
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
        { value: 'issued', label: 'Issued', tone: 'blue' },
        { value: 'partially_paid', label: 'Partially Paid', tone: 'teal' },
        { value: 'paid', label: 'Paid', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    {
      key: 'paymentTerms',
      label: 'Payment Terms',
      type: 'select',
      column: false,
      default: 'net30',
      options: [
        { value: 'prepaid', label: 'Prepaid' },
        { value: 'net15', label: 'Net 15' },
        { value: 'net30', label: 'Net 30' },
        { value: 'net45', label: 'Net 45' },
        { value: 'net60', label: 'Net 60' },
      ],
    },
    { key: 'issueDate', label: 'Issued', type: 'date', format: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date', format: 'date' },
    { key: 'sourceOrder', label: 'Source Order', type: 'text', column: false, readOnly: true },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

/** The AI narrative half of a summary; the risk band stays deterministic. */
export interface InvoiceAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

/** Injected AI runner (bound to the real AI engine in the instance file). */
export type InvoiceAiRunner = (
  invoice: FinanceInvoice,
  risk: InvoiceRisk,
) => Promise<InvoiceAiNarrative | null>;

/** Past-tense confirmation + verb for each lifecycle action. */
const ACTION_DONE: Record<InvoiceAction, { done: string; verb: string }> = {
  issue: { done: 'issued', verb: 'issue' },
  markPaid: { done: 'marked paid', verb: 'mark paid' },
  cancel: { done: 'cancelled', verb: 'cancel' },
};

/** Project already-validated field values into a typed invoice (for the stamps). */
function projectValues(values: EnterpriseRecordInput['fields']): FinanceInvoice {
  const record: EnterpriseEntity = {
    id: '',
    moduleId: FINANCE_MODULE_ID,
    kind: INVOICE_KIND,
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
  return invoiceFromRecord(record);
}

/**
 * Build the Finance module. `taxAmount`, `total`, `outstandingBalance`, and the
 * stored `status` are derived deterministically by the validate hook; the
 * issue/markPaid/cancel actions apply guarded state transitions. The AI runner is
 * optional (offline → deterministic fallback).
 */
export function createInvoiceModule(storePath: string, aiRunner?: InvoiceAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FINANCE_MODULE_ID, INVOICE_KIND);
  return defineEnterpriseModule({
    descriptor: INVOICE_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic, read-only money stamps + payment-derived status (all
      // time-independent). Overdue is derived live, never stamped.
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(INVOICE_DESCRIPTOR, input);
        if (result.ok) {
          const invoice = projectValues(result.values);
          Object.assign(result.values, invoiceComputedFields(invoice));
          result.values.status = deriveStoredInvoiceStatus(invoice.status, invoice);
        }
        return result;
      },
      // Bookkeeping is derived, never manual: issuing, cancelling, or deleting an
      // invoice flows into the General Ledger through the idempotent auto-posting
      // seam (a no-op when the GL modules are not wired, e.g. module-local tests).
      onChange: async (event, ctx) => {
        await handleInvoiceChangeForGl(event, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const invoice = invoiceFromRecord(record);
        const signals = computeInvoiceSignals(invoice, Date.now());
        const ai = aiRunner ? await aiRunner(invoice, signals.risk).catch(() => null) : null;
        const fallback = invoiceSummaryFallback(invoice, signals.risk);
        return {
          moduleId: FINANCE_MODULE_ID,
          recordId: record.id,
          headline: `${invoice.number} · ${invoiceStatusLabel(signals.effectiveStatus)} · ${formatInvoiceAmount(signals.total, invoice.currency)}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: signals.risk.level,
          riskReason: signals.risk.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // Lifecycle actions — issue / markPaid / cancel. Each applies a real, guarded
      // deterministic transition and emits the change to audit + Timeline. Illegal
      // transitions (from the live effective status) return a message, never a write.
      runAction: async (action, record, actionCtx) => {
        const key = action as InvoiceAction;
        if (!ACTION_DONE[key]) return { ok: false, error: `Unknown action "${action}".` };
        const invoice = invoiceFromRecord(record);
        const nowMs = Date.now();
        const patch = invoiceActionPatch(key, invoice, nowMs, actionCtx.now());
        if (!patch) {
          const eff = invoiceStatusLabel(calculatePaymentStatus(invoice, nowMs)).toLowerCase();
          return { ok: false, message: `Cannot ${ACTION_DONE[key].verb} an invoice that is ${eff}.` };
        }
        const merged = projectValues({ ...record.fields, ...patch });
        const updated = store.update(record.id, {
          fields: { ...patch, ...invoiceComputedFields(merged) },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        if (!updated) return { ok: false, error: 'Invoice not found.' };
        const self = actionCtx.moduleFor(FINANCE_MODULE_ID);
        if (self) actionCtx.emit(self, 'updated', updated);
        return { ok: true, message: `Invoice ${invoice.number} ${ACTION_DONE[key].done}.` };
      },
    },
  });
}

/**
 * Finance → Invoices — the first ERP module built on the Enterprise Module
 * Framework. It is deliberately thin: a descriptor (the invoice fields), the
 * framework's record store, and one `summarize` hook that runs the existing AI
 * pipeline. Everything else — CRUD, RBAC, audit, timeline events, search,
 * offline persistence, and the entire list/detail/form UI — is inherited from
 * the foundation. This is the blueprint every later module follows.
 *
 * Electron-free by construction (store path + AI runner are injected), so it
 * unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  FinanceInvoice,
  InvoiceRisk,
} from '@neuropause/shared';
import {
  FINANCE_MODULE_ID,
  INVOICE_KIND,
  assessInvoiceRisk,
  formatInvoiceAmount,
  invoiceFromRecord,
  invoiceStatusLabel,
  invoiceSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of an invoice — drives store, CRUD, and the UI. */
export const INVOICE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FINANCE_MODULE_ID,
  title: 'Finance',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'database',
  description: 'Issue and track customer invoices, with AI risk assessment.',
  group: 'Finance',
  titleField: 'number',
  // Reuses existing enterprise scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'number', label: 'Invoice #', type: 'text', required: true, placeholder: 'INV-0001' },
    { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'Acme Inc.' },
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
        { value: 'sent', label: 'Sent', tone: 'blue' },
        { value: 'paid', label: 'Paid', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'issueDate', label: 'Issued', type: 'date', format: 'date' },
    { key: 'dueDate', label: 'Due', type: 'date', format: 'date' },
    {
      key: 'notes',
      label: 'Notes',
      type: 'textarea',
      column: false,
      placeholder: 'Optional notes…',
    },
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

/**
 * Build the Finance module. The AI runner is optional: without it (or when no
 * model is configured) the summary uses the deterministic fallback, so the
 * feature works fully offline and in tests.
 */
export function createInvoiceModule(
  storePath: string,
  aiRunner?: InvoiceAiRunner,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FINANCE_MODULE_ID, INVOICE_KIND);
  return defineEnterpriseModule({
    descriptor: INVOICE_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const invoice = invoiceFromRecord(record);
        const risk = assessInvoiceRisk(invoice, Date.now());
        const ai = aiRunner ? await aiRunner(invoice, risk).catch(() => null) : null;
        const fallback = invoiceSummaryFallback(invoice, risk);
        return {
          moduleId: FINANCE_MODULE_ID,
          recordId: record.id,
          headline: `${invoice.number} · ${invoiceStatusLabel(invoice.status)} · ${formatInvoiceAmount(invoice.amount, invoice.currency)}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: risk.level,
          riskReason: risk.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}

/**
 * Sales → Quotes — the first Sales-domain ERP module on the Enterprise Module
 * Framework, and the same blueprint proven across Finance + CRM: a descriptor +
 * the framework's record store + a `summarize` hook + a module action. CRUD, RBAC
 * (`sales:read` / `sales:manage`), audit, timeline events, search, offline
 * persistence, and the entire list/detail/form UI are all inherited — nothing is
 * re-implemented.
 *
 * DETERMINISTIC pricing logic, never AI, never user input: a `validate` hook
 * stamps the read-only `total`, `marginPct`, `discountRisk`, and `approvalStatus`
 * on every write, so those numbers are always current and consistent. The
 * `summarize` hook hands the model those signals to EXPLAIN — it never sets them.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  QuoteSignals,
  SalesQuote,
} from '@neuropause/shared';
import {
  QUOTES_MODULE_ID,
  QUOTE_KIND,
  calculateDiscountRisk,
  calculateQuoteMargin,
  calculateQuoteTotal,
  computeQuoteSignals,
  quoteApprovalStatus,
  quoteFromRecord,
  quoteStatusLabel,
  quoteSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { CONVERT_TO_ORDER_ACTION, convertQuoteToOrder } from './conversion';

/** The declarative description of a quote — drives store, CRUD, and the UI. */
export const QUOTE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: QUOTES_MODULE_ID,
  title: 'Quotes',
  singular: 'Quote',
  plural: 'Quotes',
  icon: 'doc',
  description: 'Build, price, and approve sales quotes across the commercial pipeline.',
  group: 'Sales',
  titleField: 'quoteNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  actions: [{ key: CONVERT_TO_ORDER_ACTION, label: 'Convert to Sales Order', icon: 'arrow-right' }],
  fields: [
    { key: 'quoteNumber', label: 'Quote Number', type: 'text', required: true, placeholder: 'Q-0001' },
    { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'Acme Inc.' },
    { key: 'contact', label: 'Contact', type: 'text', column: false, placeholder: 'Ada Lovelace' },
    { key: 'opportunity', label: 'Opportunity', type: 'text', column: false },
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
        { value: 'pending_approval', label: 'Pending Approval', tone: 'orange' },
        { value: 'approved', label: 'Approved', tone: 'blue' },
        { value: 'rejected', label: 'Rejected', tone: 'pink' },
        { value: 'sent', label: 'Sent', tone: 'teal' },
        { value: 'accepted', label: 'Accepted', tone: 'green' },
        { value: 'expired', label: 'Expired', tone: 'orange' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
        { value: 'converted', label: 'Converted', tone: 'purple' },
      ],
    },
    { key: 'issueDate', label: 'Issue Date', type: 'date', column: false, format: 'date' },
    { key: 'expiryDate', label: 'Expiry Date', type: 'date', format: 'date' },
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
        { value: 'AUD', label: 'AUD' },
      ],
    },
    { key: 'subtotal', label: 'Subtotal', type: 'number', min: 0, format: 'currency' },
    { key: 'discount', label: 'Discount', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'tax', label: 'Tax', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'cost', label: 'Cost of Goods', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'total', label: 'Total', type: 'number', format: 'currency', readOnly: true },
    { key: 'marginPct', label: 'Margin %', type: 'number', readOnly: true },
    { key: 'discountRisk', label: 'Discount Risk', type: 'number', readOnly: true },
    {
      key: 'approvalStatus',
      label: 'Approval',
      type: 'select',
      readOnly: true,
      badge: true,
      options: [
        { value: 'not_required', label: 'Not Required', tone: 'neutral' },
        { value: 'required', label: 'Approval Required', tone: 'orange' },
      ],
    },
    { key: 'salesRep', label: 'Sales Rep', type: 'text', column: false, placeholder: 'rep@company.com' },
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
    { key: 'deliveryTerms', label: 'Delivery Terms', type: 'text', column: false },
    { key: 'version', label: 'Version', type: 'number', min: 1, default: 1, column: false },
    { key: 'items', label: 'Items', type: 'textarea', column: false, placeholder: 'One line item per row…' },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false },
    { key: 'internalNotes', label: 'Internal Notes', type: 'textarea', column: false },
    { key: 'convertedOrder', label: 'Converted Order', type: 'text', column: false, readOnly: true },
  ],
};

/** The AI narrative half of a summary; pricing/health signals stay deterministic. */
export interface QuoteAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

export type QuoteAiRunner = (
  quote: SalesQuote,
  signals: QuoteSignals,
) => Promise<QuoteAiNarrative | null>;

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Project already-validated field values into a typed quote (for the stamps). */
function projectValues(values: EnterpriseRecordInput['fields']): SalesQuote {
  const record: EnterpriseEntity = {
    id: '',
    moduleId: QUOTES_MODULE_ID,
    kind: QUOTE_KIND,
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
  return quoteFromRecord(record);
}

/**
 * Build the Quotes module. `total`, `marginPct`, `discountRisk`, and
 * `approvalStatus` are stamped deterministically by the validate hook on every
 * write. The AI runner is optional (offline → deterministic fallback).
 */
export function createQuoteModule(storePath: string, aiRunner?: QuoteAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, QUOTES_MODULE_ID, QUOTE_KIND);
  return defineEnterpriseModule({
    descriptor: QUOTE_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic, read-only pricing stamps — computed from the record's own
      // fields, so they are always current and never user-editable or AI-set.
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(QUOTE_DESCRIPTOR, input);
        if (result.ok) {
          const quote = projectValues(result.values);
          result.values.total = calculateQuoteTotal(quote);
          result.values.marginPct = calculateQuoteMargin(quote).percent;
          result.values.discountRisk = calculateDiscountRisk(quote);
          result.values.approvalStatus = quoteApprovalStatus(quote);
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const quote = quoteFromRecord(record);
        const signals = computeQuoteSignals(quote, Date.now());
        const ai = aiRunner ? await aiRunner(quote, signals).catch(() => null) : null;
        const fallback = quoteSummaryFallback(quote, signals);
        const total = calculateQuoteTotal(quote);
        return {
          moduleId: QUOTES_MODULE_ID,
          recordId: record.id,
          headline: `${quote.quoteNumber} · ${quote.customer || '—'} · ${quoteStatusLabel(quote.status)} · ${money(total)}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: signals.health.level,
          riskReason: signals.health.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // Quote → Sales Order — deterministic, idempotent, non-destructive. The
      // framework authorizes sales:manage before dispatching here.
      runAction: async (action, record, actionCtx) => {
        if (action === CONVERT_TO_ORDER_ACTION) return convertQuoteToOrder(record, actionCtx);
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

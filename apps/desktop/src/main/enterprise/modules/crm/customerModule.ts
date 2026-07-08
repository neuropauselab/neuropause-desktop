/**
 * CRM → Customers — the fourth ERP module on the Enterprise Module Framework and
 * the same blueprint again: a descriptor + the framework's record store + a
 * `summarize` hook. CRUD, RBAC (`crm:read` / `crm:manage`), audit, timeline
 * events, search, offline persistence, and the entire list/detail/form UI are all
 * inherited from the foundation — nothing is re-implemented.
 *
 * Two customer-specific twists, both DETERMINISTIC (business logic, never AI,
 * never user input):
 *   • a `validate` hook stamps the read-only `riskScore` (via `calculatePaymentRisk`)
 *     on every write, so the payment-risk number is always current;
 *   • the `summarize` hook hands the model the deterministic health + payment
 *     risk + lifetime value to EXPLAIN — it never sets them.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  CrmCustomer,
  CustomerHealth,
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  CUSTOMERS_MODULE_ID,
  CUSTOMER_KIND,
  calculateCustomerHealth,
  calculateLifetimeValue,
  calculatePaymentRisk,
  customerFromRecord,
  customerStatusLabel,
  customerSummaryFallback,
  customerTierLabel,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a customer — drives store, CRUD, and the UI. */
export const CUSTOMER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CUSTOMERS_MODULE_ID,
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'store',
  description: 'Manage customer accounts, tiers, receivables and relationship health.',
  group: 'CRM',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Customer Name', type: 'text', required: true, placeholder: 'Acme Inc.' },
    { key: 'customerCode', label: 'Customer Code', type: 'text', column: false, placeholder: 'CUST-0001' },
    { key: 'company', label: 'Company', type: 'text', column: false },
    { key: 'primaryContact', label: 'Primary Contact', type: 'text', placeholder: 'Ada Lovelace' },
    { key: 'email', label: 'Email', type: 'text', column: false, placeholder: 'ap@acme.com' },
    { key: 'phone', label: 'Phone', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'onboarding',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'onboarding', label: 'Onboarding', tone: 'blue' },
        { value: 'preferred', label: 'Preferred', tone: 'teal' },
        { value: 'inactive', label: 'Inactive', tone: 'orange' },
        { value: 'blocked', label: 'Blocked', tone: 'pink' },
        { value: 'archived', label: 'Archived', tone: 'neutral' },
      ],
    },
    {
      key: 'customerTier',
      label: 'Tier',
      type: 'select',
      required: true,
      default: 'standard',
      badge: true,
      filterable: true,
      options: [
        { value: 'standard', label: 'Standard', tone: 'neutral' },
        { value: 'silver', label: 'Silver', tone: 'blue' },
        { value: 'gold', label: 'Gold', tone: 'orange' },
        { value: 'platinum', label: 'Platinum', tone: 'teal' },
        { value: 'enterprise', label: 'Enterprise', tone: 'purple' },
      ],
    },
    { key: 'accountManager', label: 'Account Manager', type: 'text', placeholder: 'owner@company.com' },
    { key: 'creditLimit', label: 'Credit Limit', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'outstandingBalance', label: 'Outstanding', type: 'number', min: 0, format: 'currency' },
    { key: 'lifetimeRevenue', label: 'Lifetime Revenue', type: 'number', min: 0, format: 'currency' },
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
    { key: 'riskScore', label: 'Risk', type: 'number', readOnly: true },
    { key: 'gstNumber', label: 'GST Number', type: 'text', column: false },
    { key: 'pan', label: 'PAN', type: 'text', column: false },
    { key: 'industry', label: 'Industry', type: 'text', column: false },
    { key: 'website', label: 'Website', type: 'text', column: false },
    { key: 'billingAddress', label: 'Billing Address', type: 'textarea', column: false },
    { key: 'shippingAddress', label: 'Shipping Address', type: 'textarea', column: false },
    { key: 'sourceLead', label: 'Source Lead', type: 'text', column: false, readOnly: true },
    { key: 'sourceContact', label: 'Source Contact', type: 'text', column: false, readOnly: true },
    { key: 'tags', label: 'Tags', type: 'text', column: false, placeholder: 'comma, separated' },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

/** The AI narrative half of a summary; health/risk/value stay deterministic. */
export interface CustomerAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

/** Deterministic signals handed to the AI to explain (never to override). */
export interface CustomerSignals {
  health: CustomerHealth;
  paymentRisk: number;
  lifetimeValue: number;
}

export type CustomerAiRunner = (
  customer: CrmCustomer,
  signals: CustomerSignals,
) => Promise<CustomerAiNarrative | null>;

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Project already-validated field values into a typed customer (for the risk stamp). */
function projectValues(values: EnterpriseRecordInput['fields']): CrmCustomer {
  const record: EnterpriseEntity = {
    id: '',
    moduleId: CUSTOMERS_MODULE_ID,
    kind: CUSTOMER_KIND,
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
  return customerFromRecord(record);
}

/**
 * Build the Customers module. `riskScore` is stamped deterministically by the
 * validate hook on every write. The AI runner is optional (offline → fallback).
 */
export function createCustomerModule(storePath: string, aiRunner?: CustomerAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CUSTOMERS_MODULE_ID, CUSTOMER_KIND);
  return defineEnterpriseModule({
    descriptor: CUSTOMER_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic, read-only payment-risk score — computed from the record's
      // own fields, so it is always current and never user-editable or AI-set.
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(CUSTOMER_DESCRIPTOR, input);
        if (result.ok) {
          result.values.riskScore = calculatePaymentRisk(projectValues(result.values));
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const customer = customerFromRecord(record);
        const now = Date.now();
        const health = calculateCustomerHealth(customer, now);
        const paymentRisk = calculatePaymentRisk(customer);
        const lifetimeValue = calculateLifetimeValue(customer);
        const ai = aiRunner
          ? await aiRunner(customer, { health, paymentRisk, lifetimeValue }).catch(() => null)
          : null;
        const fallback = customerSummaryFallback(customer, health);
        return {
          moduleId: CUSTOMERS_MODULE_ID,
          recordId: record.id,
          headline: `${customer.name} · ${customerTierLabel(customer.tier)} · ${customerStatusLabel(customer.status)} · LTV ${money(lifetimeValue)}`,
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

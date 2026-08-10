/**
 * Procurement → Suppliers — the vendor master on the Enterprise Module Framework.
 * Master data + a `summarize` hook that explains the deterministic supplier
 * health (rating / lead time / status). Vendor performance + risk that depend on
 * delivery history are surfaced in the Executive Center (joined to goods receipts),
 * keeping this module self-contained. AI explains; it never computes.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  Supplier,
  SupplierHealth,
} from '@neuropause/shared';
import {
  SUPPLIERS_MODULE_ID,
  SUPPLIER_KIND,
  calculateSupplierHealth,
  supplierFromRecord,
  supplierSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

export const SUPPLIER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SUPPLIERS_MODULE_ID,
  title: 'Suppliers',
  singular: 'Supplier',
  plural: 'Suppliers',
  icon: 'store',
  description: 'Vendor master with ratings, lead times, and performance.',
  group: 'Procurement',
  titleField: 'name',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  fields: [
    { key: 'name', label: 'Company', type: 'text', required: true, placeholder: 'Acme Supplies' },
    { key: 'contactPerson', label: 'Contact', type: 'text', placeholder: 'Jane Doe' },
    { key: 'email', label: 'Email', type: 'text', column: false },
    { key: 'phone', label: 'Phone', type: 'text', column: false },
    { key: 'gst', label: 'GST', type: 'text', column: false },
    { key: 'pan', label: 'PAN', type: 'text', column: false },
    { key: 'bankDetails', label: 'Bank Details', type: 'textarea', column: false, sensitive: 'restricted' },
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
    { key: 'leadTime', label: 'Lead Time (days)', type: 'number', min: 0 },
    { key: 'vendorRating', label: 'Rating', type: 'number', min: 0, max: 5 },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'onboarding', label: 'Onboarding', tone: 'blue' },
        { value: 'suspended', label: 'Suspended', tone: 'pink' },
        { value: 'inactive', label: 'Inactive', tone: 'neutral' },
      ],
    },
  ],
};

export interface SupplierAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type SupplierAiRunner = (supplier: Supplier, health: SupplierHealth) => Promise<SupplierAiNarrative | null>;

export function createSupplierModule(storePath: string, aiRunner?: SupplierAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SUPPLIERS_MODULE_ID, SUPPLIER_KIND);
  return defineEnterpriseModule({
    descriptor: SUPPLIER_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const supplier = supplierFromRecord(record);
        const health = calculateSupplierHealth(supplier);
        const ai = aiRunner ? await aiRunner(supplier, health).catch(() => null) : null;
        const fallback = supplierSummaryFallback(supplier, health);
        return {
          moduleId: SUPPLIERS_MODULE_ID,
          recordId: record.id,
          headline: `${supplier.name}${supplier.vendorRating ? ` · ${supplier.vendorRating}/5` : ''} · ${supplier.leadTime}d lead`,
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

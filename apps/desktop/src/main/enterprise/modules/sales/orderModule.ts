/**
 * Sales → Orders (MINIMAL) — the Sales Order module, shipped here as the target
 * of the Quote → Order conversion. It is a first-class framework module
 * (descriptor + store) so the conversion writes a real, audited, searchable
 * record with full RBAC/timeline/UI — but its rich behaviour (fulfillment health,
 * AI summary, Order KPIs, Order → Invoice conversion) is intentionally deferred
 * to the dedicated Sales → Orders increment. No hooks beyond descriptor-driven
 * validation; nothing is duplicated.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { ORDERS_MODULE_ID, ORDER_KIND } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a sales order — drives store, CRUD, and the UI. */
export const ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ORDERS_MODULE_ID,
  title: 'Sales Orders',
  singular: 'Sales Order',
  plural: 'Sales Orders',
  icon: 'package',
  description: 'Sales orders raised from accepted quotes.',
  group: 'Sales',
  titleField: 'orderNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'orderNumber', label: 'Order Number', type: 'text', required: true, placeholder: 'SO-0001' },
    { key: 'customer', label: 'Customer', type: 'text', required: true, placeholder: 'Acme Inc.' },
    { key: 'contact', label: 'Contact', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'confirmed', label: 'Confirmed', tone: 'blue' },
        { value: 'fulfilled', label: 'Fulfilled', tone: 'green' },
        { value: 'invoiced', label: 'Invoiced', tone: 'teal' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'orderDate', label: 'Order Date', type: 'date', column: false, format: 'date' },
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
    { key: 'total', label: 'Total', type: 'number', min: 0, format: 'currency' },
    { key: 'salesRep', label: 'Sales Rep', type: 'text', column: false },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'text', column: false },
    { key: 'deliveryTerms', label: 'Delivery Terms', type: 'text', column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false },
    { key: 'sourceQuote', label: 'Source Quote', type: 'text', column: false, readOnly: true },
  ],
};

/** Build the minimal Sales Orders module (conversion target). */
export function createOrderModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ORDERS_MODULE_ID, ORDER_KIND);
  return defineEnterpriseModule({ descriptor: ORDER_DESCRIPTOR, store });
}

/**
 * Inventory → Warehouses — the warehouse/location master, built on the Enterprise
 * Module Framework. Master data only (descriptor + store); stock balances live in
 * the movement ledger, not here. CRUD, RBAC, audit, timeline, search, and the UI
 * are all inherited.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { WAREHOUSES_MODULE_ID, WAREHOUSE_KIND } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a warehouse — drives store, CRUD, and the UI. */
export const WAREHOUSE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: WAREHOUSES_MODULE_ID,
  title: 'Warehouses',
  singular: 'Warehouse',
  plural: 'Warehouses',
  icon: 'server',
  description: 'Warehouses, zones, and bins that hold stock.',
  group: 'Inventory',
  titleField: 'name',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Main Warehouse' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'WH-01' },
    { key: 'location', label: 'Location', type: 'text', column: false },
    { key: 'zone', label: 'Zone', type: 'text', column: false },
    { key: 'bin', label: 'Bin', type: 'text', column: false },
    { key: 'capacity', label: 'Capacity', type: 'number', min: 0 },
    { key: 'manager', label: 'Manager', type: 'text', column: false },
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
        { value: 'inactive', label: 'Inactive', tone: 'neutral' },
      ],
    },
  ],
};

/** Build the Warehouses module (master data). */
export function createWarehouseModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, WAREHOUSES_MODULE_ID, WAREHOUSE_KIND);
  return defineEnterpriseModule({ descriptor: WAREHOUSE_DESCRIPTOR, store });
}

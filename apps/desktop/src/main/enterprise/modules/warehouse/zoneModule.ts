/**
 * Warehouse → Zones — master data for the logical areas of a warehouse. Pure
 * framework CRUD (RBAC, audit, timeline, search, rendering) with no stock effect;
 * zones organise bins, which hold stock the Inventory Ledger accounts for.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { WAREHOUSE_ZONES_MODULE_ID, WAREHOUSE_ZONE_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const WAREHOUSE_ZONE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: WAREHOUSE_ZONES_MODULE_ID,
  title: 'Warehouse Zones',
  singular: 'Zone',
  plural: 'Zones',
  icon: 'grid',
  description: 'Logical areas within a warehouse that organise bins.',
  group: 'Warehouse',
  titleField: 'name',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  fields: [
    { key: 'name', label: 'Zone Name', type: 'text', required: true, placeholder: 'Cold Storage A' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'Z-01' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    {
      key: 'zoneType',
      label: 'Type',
      type: 'select',
      filterable: true,
      default: 'storage',
      options: [
        { value: 'storage', label: 'Storage', tone: 'blue' },
        { value: 'picking', label: 'Picking', tone: 'teal' },
        { value: 'packing', label: 'Packing', tone: 'purple' },
        { value: 'receiving', label: 'Receiving', tone: 'green' },
        { value: 'shipping', label: 'Shipping', tone: 'orange' },
        { value: 'cold', label: 'Cold Storage', tone: 'blue' },
      ],
    },
    { key: 'capacity', label: 'Capacity', type: 'number', min: 0 },
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

export function createZoneModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, WAREHOUSE_ZONES_MODULE_ID, WAREHOUSE_ZONE_KIND);
  return defineEnterpriseModule({ descriptor: WAREHOUSE_ZONE_DESCRIPTOR, store });
}

/**
 * Manufacturing → Work Centers — the production resources (capacity, efficiency,
 * shift, queue load). Master data; capacity utilization is derived deterministically
 * for the Executive KPIs. No stock effect.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { WORK_CENTERS_MODULE_ID, WORK_CENTER_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const WORK_CENTER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: WORK_CENTERS_MODULE_ID,
  title: 'Work Centers',
  singular: 'Work Center',
  plural: 'Work Centers',
  icon: 'grid',
  description: 'Production resources with capacity, efficiency, and queue load.',
  group: 'Manufacturing',
  titleField: 'name',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Assembly Line 1' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'WC-01' },
    { key: 'capacity', label: 'Capacity (units/shift)', type: 'number', min: 0 },
    { key: 'efficiency', label: 'Efficiency %', type: 'number', min: 0, max: 100, default: 100, column: false },
    {
      key: 'shift',
      label: 'Shift',
      type: 'select',
      column: false,
      default: 'day',
      options: [
        { value: 'day', label: 'Day' },
        { value: 'evening', label: 'Evening' },
        { value: 'night', label: 'Night' },
      ],
    },
    { key: 'queueLoad', label: 'Queue Load (units)', type: 'number', min: 0 },
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

export function createWorkCenterModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, WORK_CENTERS_MODULE_ID, WORK_CENTER_KIND);
  return defineEnterpriseModule({ descriptor: WORK_CENTER_DESCRIPTOR, store });
}

/**
 * Maintenance → Maintenance Plans — preventive schedule templates for an asset or
 * machine (frequency, interval, task). Master data; Preventive Maintenance occurrences
 * are raised from a plan. No stock effect.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { MAINTENANCE_PLANS_MODULE_ID, MAINTENANCE_PLAN_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const MAINTENANCE_PLAN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MAINTENANCE_PLANS_MODULE_ID,
  title: 'Maintenance Plans',
  singular: 'Maintenance Plan',
  plural: 'Maintenance Plans',
  icon: 'calendar',
  description: 'Preventive maintenance schedule templates.',
  group: 'Maintenance',
  titleField: 'planNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  fields: [
    { key: 'planNumber', label: 'Plan #', type: 'text', required: true, placeholder: 'MP-0001' },
    { key: 'asset', label: 'Asset', type: 'text', column: false, placeholder: 'AST-0001' },
    { key: 'machine', label: 'Machine', type: 'text', column: false, placeholder: 'CNC Mill 3' },
    {
      key: 'frequency',
      label: 'Frequency',
      type: 'select',
      required: true,
      default: 'monthly',
      badge: true,
      filterable: true,
      options: [
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'yearly', label: 'Yearly' },
      ],
    },
    { key: 'intervalDays', label: 'Interval (days)', type: 'number', min: 0, column: false },
    { key: 'task', label: 'Task', type: 'textarea', column: false },
    { key: 'lastServiced', label: 'Last Serviced', type: 'date', format: 'date' },
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

export function createMaintenancePlanModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MAINTENANCE_PLANS_MODULE_ID, MAINTENANCE_PLAN_KIND);
  return defineEnterpriseModule({ descriptor: MAINTENANCE_PLAN_DESCRIPTOR, store });
}

/**
 * Maintenance → Maintenance History — the permanent log of completed maintenance,
 * created from REAL verified work orders (never fabricated). Read-oriented master
 * data; records are authored by the Work Order `verify` action. No stock effect.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { MAINTENANCE_HISTORY_MODULE_ID, MAINTENANCE_HISTORY_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const MAINTENANCE_HISTORY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MAINTENANCE_HISTORY_MODULE_ID,
  title: 'Maintenance History',
  singular: 'History Entry',
  plural: 'History Entries',
  icon: 'clock',
  description: 'The permanent record of completed maintenance.',
  group: 'Maintenance',
  titleField: 'historyNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  fields: [
    { key: 'historyNumber', label: 'History #', type: 'text', required: true, placeholder: 'MH-0001' },
    { key: 'workOrder', label: 'Work Order', type: 'text', column: false, readOnly: true },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'asset', label: 'Asset', type: 'text', column: false },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      badge: true,
      filterable: true,
      default: 'corrective',
      options: [
        { value: 'preventive', label: 'Preventive', tone: 'green' },
        { value: 'corrective', label: 'Corrective', tone: 'orange' },
        { value: 'inspection', label: 'Inspection', tone: 'blue' },
      ],
    },
    { key: 'technician', label: 'Technician', type: 'text', column: false },
    { key: 'downtimeHours', label: 'Downtime (h)', type: 'number', min: 0 },
    { key: 'totalCost', label: 'Total Cost', type: 'number', format: 'currency' },
    {
      key: 'result',
      label: 'Result',
      type: 'select',
      badge: true,
      filterable: true,
      default: 'pass',
      options: [
        { value: 'pass', label: 'Pass', tone: 'green' },
        { value: 'fail', label: 'Fail', tone: 'orange' },
        { value: 'rework', label: 'Rework', tone: 'blue' },
      ],
    },
    { key: 'completedDate', label: 'Completed', type: 'date', format: 'date' },
  ],
};

export function createMaintenanceHistoryModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MAINTENANCE_HISTORY_MODULE_ID, MAINTENANCE_HISTORY_KIND);
  return defineEnterpriseModule({ descriptor: MAINTENANCE_HISTORY_DESCRIPTOR, store });
}

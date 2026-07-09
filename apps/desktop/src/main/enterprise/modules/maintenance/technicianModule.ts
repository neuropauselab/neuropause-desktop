/**
 * Maintenance → Technicians — the maintenance workforce master (skill, shift,
 * availability). Utilization is derived deterministically for the Executive KPIs.
 * No stock effect.
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { TECHNICIANS_MODULE_ID, TECHNICIAN_KIND } from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const TECHNICIAN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TECHNICIANS_MODULE_ID,
  title: 'Technicians',
  singular: 'Technician',
  plural: 'Technicians',
  icon: 'user',
  description: 'The maintenance workforce.',
  group: 'Maintenance',
  titleField: 'name',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Sam Rivera' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'TECH-01' },
    { key: 'skill', label: 'Skill', type: 'text', column: false, placeholder: 'Electrical' },
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
    { key: 'assignedOrders', label: 'Assigned Orders', type: 'number', min: 0, readOnly: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'available',
      badge: true,
      filterable: true,
      options: [
        { value: 'available', label: 'Available', tone: 'green' },
        { value: 'busy', label: 'Busy', tone: 'blue' },
        { value: 'off_duty', label: 'Off Duty', tone: 'neutral' },
      ],
    },
  ],
};

export function createTechnicianModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TECHNICIANS_MODULE_ID, TECHNICIAN_KIND);
  return defineEnterpriseModule({ descriptor: TECHNICIAN_DESCRIPTOR, store });
}

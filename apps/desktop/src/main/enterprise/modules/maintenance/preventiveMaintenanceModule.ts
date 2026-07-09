/**
 * Maintenance → Preventive Maintenance — scheduled PM occurrences (from a plan).
 * `raiseWorkOrder` creates the executing work order; `complete` marks the PM done.
 * No stock effect (the work order owns any downtime + parts).
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import {
  PREVENTIVE_MAINTENANCE_MODULE_ID,
  PREVENTIVE_MAINTENANCE_KIND,
  preventiveMaintenanceFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { RAISE_WORK_ORDER_ACTION, raiseWorkOrderFromPreventive } from './conversion';

export const COMPLETE_PM_ACTION = 'complete';

export const PREVENTIVE_MAINTENANCE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PREVENTIVE_MAINTENANCE_MODULE_ID,
  title: 'Preventive Maintenance',
  singular: 'Preventive Task',
  plural: 'Preventive Tasks',
  icon: 'shield',
  description: 'Scheduled preventive maintenance occurrences.',
  group: 'Maintenance',
  titleField: 'pmNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  actions: [
    { key: RAISE_WORK_ORDER_ACTION, label: 'Raise Work Order', icon: 'plus' },
    { key: COMPLETE_PM_ACTION, label: 'Mark Completed', icon: 'check' },
  ],
  fields: [
    { key: 'pmNumber', label: 'PM #', type: 'text', required: true, placeholder: 'PM-0001' },
    { key: 'plan', label: 'Plan', type: 'text', column: false, placeholder: 'MP-0001' },
    { key: 'asset', label: 'Asset', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'scheduledDate', label: 'Scheduled', type: 'date', format: 'date' },
    { key: 'completedDate', label: 'Completed', type: 'date', format: 'date', readOnly: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'scheduled',
      badge: true,
      filterable: true,
      options: [
        { value: 'scheduled', label: 'Scheduled', tone: 'blue' },
        { value: 'due', label: 'Due', tone: 'orange' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'skipped', label: 'Skipped', tone: 'neutral' },
      ],
    },
    { key: 'workOrder', label: 'Work Order', type: 'text', column: false, readOnly: true },
  ],
};

export function createPreventiveMaintenanceModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PREVENTIVE_MAINTENANCE_MODULE_ID, PREVENTIVE_MAINTENANCE_KIND);
  return defineEnterpriseModule({
    descriptor: PREVENTIVE_MAINTENANCE_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        if (action === RAISE_WORK_ORDER_ACTION) return raiseWorkOrderFromPreventive(record, ctx);
        if (action === COMPLETE_PM_ACTION) {
          const pm = preventiveMaintenanceFromRecord(record);
          if (pm.status === 'completed') return { ok: false, message: 'This PM is already completed.' };
          const updated = store.update(record.id, { fields: { status: 'completed', completedDate: ctx.now().slice(0, 10) }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'PM not found.' };
          const self = ctx.moduleFor(PREVENTIVE_MAINTENANCE_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `PM ${pm.pmNumber} completed.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

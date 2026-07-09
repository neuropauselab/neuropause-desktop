/**
 * Maintenance → Corrective Maintenance — unplanned fault reports. `raiseWorkOrder`
 * creates the executing work order; `resolve` closes the fault. No stock effect (the
 * work order owns any downtime + parts).
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import {
  CORRECTIVE_MAINTENANCE_MODULE_ID,
  CORRECTIVE_MAINTENANCE_KIND,
  correctiveMaintenanceFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { RAISE_WORK_ORDER_ACTION, raiseWorkOrderFromCorrective } from './conversion';

export const RESOLVE_CM_ACTION = 'resolve';

export const CORRECTIVE_MAINTENANCE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CORRECTIVE_MAINTENANCE_MODULE_ID,
  title: 'Corrective Maintenance',
  singular: 'Fault Report',
  plural: 'Fault Reports',
  icon: 'alert',
  description: 'Unplanned faults requiring corrective maintenance.',
  group: 'Maintenance',
  titleField: 'cmNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  actions: [
    { key: RAISE_WORK_ORDER_ACTION, label: 'Raise Work Order', icon: 'plus' },
    { key: RESOLVE_CM_ACTION, label: 'Resolve', icon: 'check' },
  ],
  fields: [
    { key: 'cmNumber', label: 'CM #', type: 'text', required: true, placeholder: 'CM-0001' },
    { key: 'asset', label: 'Asset', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'faultDescription', label: 'Fault', type: 'textarea' },
    { key: 'reportedDate', label: 'Reported', type: 'date', format: 'date' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'open',
      badge: true,
      filterable: true,
      options: [
        { value: 'open', label: 'Open', tone: 'orange' },
        { value: 'in_progress', label: 'In Progress', tone: 'blue' },
        { value: 'resolved', label: 'Resolved', tone: 'green' },
      ],
    },
    { key: 'workOrder', label: 'Work Order', type: 'text', column: false, readOnly: true },
  ],
};

export function createCorrectiveMaintenanceModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CORRECTIVE_MAINTENANCE_MODULE_ID, CORRECTIVE_MAINTENANCE_KIND);
  return defineEnterpriseModule({
    descriptor: CORRECTIVE_MAINTENANCE_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        if (action === RAISE_WORK_ORDER_ACTION) return raiseWorkOrderFromCorrective(record, ctx);
        if (action === RESOLVE_CM_ACTION) {
          const cm = correctiveMaintenanceFromRecord(record);
          if (cm.status === 'resolved') return { ok: false, message: 'This fault is already resolved.' };
          const updated = store.update(record.id, { fields: { status: 'resolved' }, actor: ctx.actor(), now: ctx.now() });
          if (!updated) return { ok: false, error: 'Fault report not found.' };
          const self = ctx.moduleFor(CORRECTIVE_MAINTENANCE_MODULE_ID);
          if (self) ctx.emit(self, 'updated', updated);
          return { ok: true, message: `Fault ${cm.cmNumber} resolved.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

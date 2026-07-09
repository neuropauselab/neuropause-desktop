/**
 * Manufacturing → Production Scheduling — assigns a production order to a work center
 * / machine over a time window. Lifecycle transitions (start / finish / cancel); no
 * stock effect (the Production Order owns the inventory movements).
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import {
  PRODUCTION_SCHEDULES_MODULE_ID,
  PRODUCTION_SCHEDULE_KIND,
  productionScheduleFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const START_SCHEDULE_ACTION = 'start';
export const FINISH_SCHEDULE_ACTION = 'finish';
export const CANCEL_SCHEDULE_ACTION = 'cancel';

export const PRODUCTION_SCHEDULE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTION_SCHEDULES_MODULE_ID,
  title: 'Production Scheduling',
  singular: 'Schedule',
  plural: 'Schedules',
  icon: 'calendar',
  description: 'Schedule production orders onto work centers and machines.',
  group: 'Manufacturing',
  titleField: 'scheduleNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [
    { key: START_SCHEDULE_ACTION, label: 'Start', icon: 'play' },
    { key: FINISH_SCHEDULE_ACTION, label: 'Finish', icon: 'check' },
    { key: CANCEL_SCHEDULE_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'scheduleNumber', label: 'Schedule #', type: 'text', required: true, placeholder: 'SCH-0001' },
    { key: 'productionOrder', label: 'Production Order', type: 'text', required: true, placeholder: 'MO-0001' },
    { key: 'workCenter', label: 'Work Center', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'startDate', label: 'Start', type: 'date', format: 'date' },
    { key: 'endDate', label: 'End', type: 'date', format: 'date' },
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
        { value: 'in_progress', label: 'In Progress', tone: 'purple' },
        { value: 'done', label: 'Done', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
  ],
};

function transition(action: string, from: string): string | null {
  if (action === START_SCHEDULE_ACTION) return from === 'scheduled' ? 'in_progress' : null;
  if (action === FINISH_SCHEDULE_ACTION) return from === 'in_progress' ? 'done' : null;
  if (action === CANCEL_SCHEDULE_ACTION) return from === 'done' || from === 'cancelled' ? null : 'cancelled';
  return null;
}

export function createScheduleModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTION_SCHEDULES_MODULE_ID, PRODUCTION_SCHEDULE_KIND);
  return defineEnterpriseModule({
    descriptor: PRODUCTION_SCHEDULE_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const schedule = productionScheduleFromRecord(record);
        const target = transition(action, schedule.status);
        if (!target) return { ok: false, message: `Cannot ${action} a schedule that is ${schedule.status.replace('_', ' ')}.` };
        const updated = store.update(record.id, { fields: { status: target }, actor: ctx.actor(), now: ctx.now() });
        if (!updated) return { ok: false, error: 'Schedule not found.' };
        const self = ctx.moduleFor(PRODUCTION_SCHEDULES_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Schedule ${schedule.scheduleNumber} ${target.replace('_', ' ')}.` };
      },
    },
  });
}

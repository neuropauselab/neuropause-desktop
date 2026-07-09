/**
 * Manufacturing → Production Execution — the shop-floor run log for a production
 * order (operator, machine, times, good/scrap quantities, downtime). Lifecycle
 * transitions (pause / resume / complete) capture the actual run; the telemetry
 * feeds the deterministic throughput / OEE metrics. No stock effect (the Production
 * Order posts the consumption + output movements).
 */
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import {
  PRODUCTION_EXECUTIONS_MODULE_ID,
  PRODUCTION_EXECUTION_KIND,
  productionExecutionFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const PAUSE_ACTION = 'pause';
export const RESUME_ACTION = 'resume';
export const COMPLETE_EXECUTION_ACTION = 'complete';

export const PRODUCTION_EXECUTION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRODUCTION_EXECUTIONS_MODULE_ID,
  title: 'Production Execution',
  singular: 'Execution',
  plural: 'Executions',
  icon: 'activity',
  description: 'Shop-floor run logs for production orders.',
  group: 'Manufacturing',
  titleField: 'executionNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  actions: [
    { key: PAUSE_ACTION, label: 'Pause', icon: 'pause' },
    { key: RESUME_ACTION, label: 'Resume', icon: 'play' },
    { key: COMPLETE_EXECUTION_ACTION, label: 'Complete', icon: 'check' },
  ],
  fields: [
    { key: 'executionNumber', label: 'Execution #', type: 'text', required: true, placeholder: 'EX-0001' },
    { key: 'productionOrder', label: 'Production Order', type: 'text', required: true, placeholder: 'MO-0001' },
    { key: 'operator', label: 'Operator', type: 'text', column: false },
    { key: 'machine', label: 'Machine', type: 'text', column: false },
    { key: 'startTime', label: 'Start', type: 'date', column: false, format: 'date' },
    { key: 'endTime', label: 'End', type: 'date', column: false, format: 'date' },
    { key: 'goodQuantity', label: 'Good Qty', type: 'number', min: 0 },
    { key: 'scrapQuantity', label: 'Scrap Qty', type: 'number', min: 0 },
    { key: 'downtime', label: 'Downtime (min)', type: 'number', min: 0, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'running',
      badge: true,
      filterable: true,
      options: [
        { value: 'running', label: 'Running', tone: 'purple' },
        { value: 'paused', label: 'Paused', tone: 'orange' },
        { value: 'completed', label: 'Completed', tone: 'green' },
      ],
    },
  ],
};

function transition(action: string, from: string): string | null {
  if (action === PAUSE_ACTION) return from === 'running' ? 'paused' : null;
  if (action === RESUME_ACTION) return from === 'paused' ? 'running' : null;
  if (action === COMPLETE_EXECUTION_ACTION) return from === 'running' || from === 'paused' ? 'completed' : null;
  return null;
}

export function createExecutionModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRODUCTION_EXECUTIONS_MODULE_ID, PRODUCTION_EXECUTION_KIND);
  return defineEnterpriseModule({
    descriptor: PRODUCTION_EXECUTION_DESCRIPTOR,
    store,
    hooks: {
      runAction: async (action, record, ctx) => {
        const execution = productionExecutionFromRecord(record);
        const target = transition(action, execution.status);
        if (!target) return { ok: false, message: `Cannot ${action} an execution that is ${execution.status}.` };
        const updated = store.update(record.id, { fields: { status: target }, actor: ctx.actor(), now: ctx.now() });
        if (!updated) return { ok: false, error: 'Execution not found.' };
        const self = ctx.moduleFor(PRODUCTION_EXECUTIONS_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Execution ${execution.executionNumber} ${target}.` };
      },
    },
  });
}

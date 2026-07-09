/**
 * Maintenance → Work Orders — the central repair execution record. The lifecycle
 * writes the AUTHORITATIVE Machine record (Manufacturing), never a duplicate state:
 *   assign   → technician assigned; machine → maintenance
 *   start    → machine stays in maintenance; work begins
 *   complete → repair done; cost captured
 *   verify   → quality verified; machine → running (available); Maintenance History created
 *   cancel   → close without completing
 * Machine DOWNTIME is written by Downtime Events (the sole writer); Work Orders write
 * machine STATUS. The `summarize` hook explains the order; the AI never computes cost.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  WorkOrder,
} from '@neuropause/shared';
import {
  WORK_ORDERS_MODULE_ID,
  WORK_ORDER_KIND,
  workOrderFromRecord,
  workOrderSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { setMachineStatus } from './maintenanceMovements';
import { createMaintenanceHistory } from './conversion';

export const ASSIGN_ACTION = 'assign';
export const START_WO_ACTION = 'start';
export const COMPLETE_WO_ACTION = 'complete';
export const VERIFY_ACTION = 'verify';
export const CANCEL_WO_ACTION = 'cancel';

export const WORK_ORDER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: WORK_ORDERS_MODULE_ID,
  title: 'Work Orders',
  singular: 'Work Order',
  plural: 'Work Orders',
  icon: 'wrench',
  description: 'Execute maintenance and restore the machine to service.',
  group: 'Maintenance',
  titleField: 'workOrderNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  actions: [
    { key: ASSIGN_ACTION, label: 'Assign', icon: 'user' },
    { key: START_WO_ACTION, label: 'Start', icon: 'play' },
    { key: COMPLETE_WO_ACTION, label: 'Complete', icon: 'check' },
    { key: VERIFY_ACTION, label: 'Verify & Restore', icon: 'shield' },
    { key: CANCEL_WO_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'workOrderNumber', label: 'Work Order #', type: 'text', required: true, placeholder: 'WO-0001' },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      default: 'corrective',
      badge: true,
      filterable: true,
      options: [
        { value: 'preventive', label: 'Preventive', tone: 'green' },
        { value: 'corrective', label: 'Corrective', tone: 'orange' },
        { value: 'inspection', label: 'Inspection', tone: 'blue' },
      ],
    },
    { key: 'machine', label: 'Machine', type: 'text', column: false, placeholder: 'CNC Mill 3' },
    { key: 'asset', label: 'Asset', type: 'text', column: false },
    { key: 'technician', label: 'Technician', type: 'text', column: false },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      default: 'medium',
      badge: true,
      filterable: true,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'orange' },
        { value: 'urgent', label: 'Urgent', tone: 'orange' },
      ],
    },
    { key: 'description', label: 'Description', type: 'textarea', column: false },
    { key: 'scheduledDate', label: 'Scheduled', type: 'date', format: 'date' },
    { key: 'completedDate', label: 'Completed', type: 'date', format: 'date', readOnly: true },
    { key: 'downtimeHours', label: 'Downtime (h)', type: 'number', min: 0, column: false },
    { key: 'laborCost', label: 'Labor Cost', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'partsCost', label: 'Parts Cost', type: 'number', min: 0, format: 'currency', column: false },
    {
      key: 'result',
      label: 'Result',
      type: 'select',
      default: 'pass',
      badge: true,
      filterable: true,
      options: [
        { value: 'pass', label: 'Pass', tone: 'green' },
        { value: 'fail', label: 'Fail', tone: 'orange' },
        { value: 'rework', label: 'Rework', tone: 'blue' },
      ],
    },
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
        { value: 'assigned', label: 'Assigned', tone: 'teal' },
        { value: 'in_progress', label: 'In Progress', tone: 'purple' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'verified', label: 'Verified', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'historyRecord', label: 'History', type: 'text', column: false, readOnly: true },
  ],
};

export interface WorkOrderAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type WorkOrderAiRunner = (order: WorkOrder) => Promise<WorkOrderAiNarrative | null>;

export function createWorkOrderModule(storePath: string, aiRunner?: WorkOrderAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, WORK_ORDERS_MODULE_ID, WORK_ORDER_KIND);

  function emitSelf(record: EnterpriseEntity | null, ctx: EnterpriseModuleActionContext): void {
    if (!record) return;
    const self = ctx.moduleFor(WORK_ORDERS_MODULE_ID);
    if (self) ctx.emit(self, 'updated', record);
  }

  return defineEnterpriseModule({
    descriptor: WORK_ORDER_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const wo = workOrderFromRecord(record);
        const ai = aiRunner ? await aiRunner(wo).catch(() => null) : null;
        const fallback = workOrderSummaryFallback(wo);
        return {
          moduleId: WORK_ORDERS_MODULE_ID,
          recordId: record.id,
          headline: `${wo.workOrderNumber} · ${wo.type} · ${wo.machine || wo.asset || '—'} · ${wo.status.replace('_', ' ')}`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: wo.priority === 'urgent' && wo.status !== 'verified' ? 'high' : wo.result === 'fail' ? 'medium' : 'low',
          riskReason: `Work order ${wo.status.replace('_', ' ')} (${wo.priority}).`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const wo = workOrderFromRecord(record);

        if (action === ASSIGN_ACTION) {
          if (wo.status !== 'scheduled') return { ok: false, message: `Cannot assign a work order that is ${wo.status.replace('_', ' ')}.` };
          if (!wo.technician) return { ok: false, message: 'Set a technician before assigning.' };
          if (wo.machine) await setMachineStatus(ctx, wo.machine, 'maintenance');
          emitSelf(store.update(record.id, { fields: { status: 'assigned' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Work order ${wo.workOrderNumber} assigned to ${wo.technician}.` };
        }

        if (action === START_WO_ACTION) {
          if (wo.status !== 'assigned') return { ok: false, message: `Assign the work order before starting (it is ${wo.status.replace('_', ' ')}).` };
          if (wo.machine) await setMachineStatus(ctx, wo.machine, 'maintenance');
          emitSelf(store.update(record.id, { fields: { status: 'in_progress' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Work order ${wo.workOrderNumber} started.` };
        }

        if (action === COMPLETE_WO_ACTION) {
          if (wo.status !== 'in_progress') return { ok: false, message: `Start the work order before completing (it is ${wo.status.replace('_', ' ')}).` };
          emitSelf(store.update(record.id, { fields: { status: 'completed', completedDate: ctx.now().slice(0, 10) }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Work order ${wo.workOrderNumber} completed.` };
        }

        if (action === VERIFY_ACTION) {
          if (wo.status !== 'completed') return { ok: false, message: `Complete the work order before verifying (it is ${wo.status.replace('_', ' ')}).` };
          // Quality verification passed → restore the machine to service (authoritative).
          if (wo.machine) await setMachineStatus(ctx, wo.machine, 'running');
          const historyId = await createMaintenanceHistory(wo, ctx);
          emitSelf(store.update(record.id, { fields: { status: 'verified', historyRecord: historyId }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Work order ${wo.workOrderNumber} verified; ${wo.machine || 'the asset'} restored.` };
        }

        if (action === CANCEL_WO_ACTION) {
          if (wo.status === 'completed' || wo.status === 'verified' || wo.status === 'cancelled') {
            return { ok: false, message: `Cannot cancel a work order that is ${wo.status.replace('_', ' ')}.` };
          }
          emitSelf(store.update(record.id, { fields: { status: 'cancelled' }, actor: ctx.actor(), now: ctx.now() }), ctx);
          return { ok: true, message: `Work order ${wo.workOrderNumber} cancelled.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

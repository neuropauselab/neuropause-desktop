/**
 * Maintenance → Downtime Events — the REAL machine-downtime ledger, and the single
 * writer of machine downtime. The `log` action adds the event's duration to the
 * AUTHORITATIVE Machine record (Manufacturing) and sets its status (unplanned →
 * breakdown, planned → maintenance) — so Manufacturing's availability / utilization /
 * OEE KPIs reflect maintenance downtime. Idempotent. The `summarize` hook explains the
 * event; the AI never computes the duration.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  DowntimeEvent,
} from '@neuropause/shared';
import {
  DOWNTIME_EVENTS_MODULE_ID,
  DOWNTIME_EVENT_KIND,
  downtimeEventFromRecord,
  downtimeEventSummaryFallback,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';
import { applyMachineDowntime } from './maintenanceMovements';

export const LOG_DOWNTIME_ACTION = 'log';

export const DOWNTIME_EVENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DOWNTIME_EVENTS_MODULE_ID,
  title: 'Downtime Events',
  singular: 'Downtime Event',
  plural: 'Downtime Events',
  icon: 'alert',
  description: 'Real machine downtime, written to the authoritative machine.',
  group: 'Maintenance',
  titleField: 'eventNumber',
  permissions: { read: 'maintenance:read', write: 'maintenance:manage' },
  actions: [{ key: LOG_DOWNTIME_ACTION, label: 'Log Downtime', icon: 'check' }],
  fields: [
    { key: 'eventNumber', label: 'Event #', type: 'text', required: true, placeholder: 'DT-0001' },
    { key: 'machine', label: 'Machine', type: 'text', required: true, placeholder: 'CNC Mill 3' },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      default: 'unplanned',
      badge: true,
      filterable: true,
      options: [
        { value: 'planned', label: 'Planned', tone: 'blue' },
        { value: 'unplanned', label: 'Unplanned', tone: 'orange' },
      ],
    },
    { key: 'cause', label: 'Cause', type: 'text', column: false },
    { key: 'startTime', label: 'Start', type: 'date', column: false, format: 'date' },
    { key: 'endTime', label: 'End', type: 'date', column: false, format: 'date' },
    { key: 'durationHours', label: 'Duration (h)', type: 'number', required: true, min: 0 },
    { key: 'workOrder', label: 'Work Order', type: 'text', column: false },
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
        { value: 'logged', label: 'Logged', tone: 'green' },
      ],
    },
  ],
};

export interface DowntimeAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type DowntimeAiRunner = (event: DowntimeEvent) => Promise<DowntimeAiNarrative | null>;

export function createDowntimeEventModule(storePath: string, aiRunner?: DowntimeAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DOWNTIME_EVENTS_MODULE_ID, DOWNTIME_EVENT_KIND);
  return defineEnterpriseModule({
    descriptor: DOWNTIME_EVENT_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const event = downtimeEventFromRecord(record);
        const ai = aiRunner ? await aiRunner(event).catch(() => null) : null;
        const fallback = downtimeEventSummaryFallback(event);
        return {
          moduleId: DOWNTIME_EVENTS_MODULE_ID,
          recordId: record.id,
          headline: `${event.eventNumber} · ${event.machine} · ${event.type} · ${event.durationHours}h`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: event.type === 'unplanned' ? 'medium' : 'low',
          riskReason: `${event.type} downtime.`,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
      // THE Manufacturing-KPI integration: real downtime is written to the
      // authoritative machine, so availability/OEE derive from maintenance. Idempotent.
      runAction: async (action, record, ctx) => {
        if (action !== LOG_DOWNTIME_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const event = downtimeEventFromRecord(record);
        if (event.status === 'logged') return { ok: false, message: 'This downtime event has already been logged.' };
        if (!event.machine || event.durationHours <= 0) return { ok: false, message: 'Set a machine and a positive duration before logging.' };
        const machine = await applyMachineDowntime(ctx, event.machine, event.durationHours, event.type === 'unplanned' ? 'breakdown' : 'maintenance');
        if (!machine) return { ok: false, error: `Machine "${event.machine}" was not found.` };
        const updated = store.update(record.id, { fields: { status: 'logged' }, actor: ctx.actor(), now: ctx.now() });
        if (!updated) return { ok: false, error: 'Downtime event not found.' };
        const self = ctx.moduleFor(DOWNTIME_EVENTS_MODULE_ID);
        if (self) ctx.emit(self, 'updated', updated);
        return { ok: true, message: `Logged ${event.durationHours}h downtime on ${event.machine}.` };
      },
    },
  });
}

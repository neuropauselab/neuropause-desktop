/**
 * Manufacturing → Shop-Floor Event Ledger — the APPEND-ONLY, immutable stream of manufacturing
 * events and the telemetry SOURCE OF TRUTH. Every execution state change, machine/operator event,
 * material issue, inspection, downtime, scrap, and finished-goods post is recorded here as one
 * immutable event (monotonic `sequence` + `timestamp`), and execution telemetry / machine +
 * operator timelines / OEE are DERIVED from it (see `mesEvents.ts`) rather than entered. It mirrors
 * the Inventory stock ledger's contract: history is never rewritten — corrections are new events.
 * Events are written only through the `postManufacturingEvent` seam; this module exposes no
 * mutating actions. The `summarize` hook explains an event; the AI never fabricates telemetry.
 */
import type { EnterpriseModuleDescriptor, EnterpriseRecordSummary } from '@neuropause/shared';
import {
  MANUFACTURING_EVENTS_MODULE_ID,
  MANUFACTURING_EVENT_KIND,
  MANUFACTURING_EVENT_TYPES,
  manufacturingEventFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const MANUFACTURING_EVENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MANUFACTURING_EVENTS_MODULE_ID,
  title: 'Shop-Floor Events',
  singular: 'Event',
  plural: 'Events',
  icon: 'activity',
  description: 'The append-only, immutable manufacturing event ledger — the telemetry source of truth.',
  group: 'Manufacturing',
  titleField: 'eventNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'eventNumber', label: 'Event #', type: 'text', required: true, readOnly: true },
    { key: 'sequence', label: 'Seq', type: 'number', readOnly: true },
    { key: 'timestamp', label: 'Timestamp', type: 'text', readOnly: true },
    {
      key: 'eventType',
      label: 'Event',
      type: 'select',
      required: true,
      badge: true,
      filterable: true,
      readOnly: true,
      options: MANUFACTURING_EVENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })),
    },
    { key: 'productionOrder', label: 'Production Order', type: 'text', readOnly: true },
    { key: 'execution', label: 'Execution', type: 'text', readOnly: true, column: false },
    { key: 'operation', label: 'Operation', type: 'text', readOnly: true, column: false },
    { key: 'machine', label: 'Machine', type: 'text', readOnly: true },
    { key: 'workCenter', label: 'Work Center', type: 'text', readOnly: true, column: false },
    { key: 'operator', label: 'Operator', type: 'text', readOnly: true },
    { key: 'quantity', label: 'Quantity', type: 'number', readOnly: true, column: false },
    { key: 'reason', label: 'Reason', type: 'text', readOnly: true, column: false },
    { key: 'metadata', label: 'Metadata', type: 'textarea', readOnly: true, column: false },
    { key: 'user', label: 'User', type: 'text', readOnly: true, column: false },
  ],
};

export function createManufacturingEventModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MANUFACTURING_EVENTS_MODULE_ID, MANUFACTURING_EVENT_KIND);
  return defineEnterpriseModule({
    descriptor: MANUFACTURING_EVENT_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const e = manufacturingEventFromRecord(record);
        const label = e.eventType.replace(/_/g, ' ');
        const parts = [e.machine && `on ${e.machine}`, e.operator && `by ${e.operator}`, e.execution && `for ${e.execution}`].filter(Boolean).join(' ');
        return {
          moduleId: MANUFACTURING_EVENTS_MODULE_ID,
          recordId: record.id,
          headline: `#${e.sequence} · ${label} · ${e.timestamp.slice(0, 16).replace('T', ' ')}`,
          summary: `Event #${e.sequence}: ${label} ${parts}${e.quantity ? ` (qty ${e.quantity})` : ''}${e.reason ? ` — ${e.reason}` : ''}.`,
          risk: e.eventType === 'inspection_failed' || e.eventType === 'downtime_started' ? 'medium' : 'low',
          riskReason: `${label} event.`,
          executiveExplanation: `${label}${e.machine ? ` on ${e.machine}` : ''}.`,
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

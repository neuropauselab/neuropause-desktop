/**
 * Manufacturing → Machines — the equipment (status, runtime, downtime, maintenance
 * due). Master data; utilization / availability / OEE are derived deterministically
 * for the Executive KPIs. The `summarize` hook explains the machine's availability;
 * the AI never computes it. No stock effect.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
  Machine,
} from '@neuropause/shared';
import {
  MACHINES_MODULE_ID,
  MACHINE_KIND,
  calculateMachineAvailability,
  calculateMachineUtilization,
  machineFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const MACHINE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: MACHINES_MODULE_ID,
  title: 'Machines',
  singular: 'Machine',
  plural: 'Machines',
  icon: 'settings',
  description: 'Production equipment with runtime, downtime, and maintenance.',
  group: 'Manufacturing',
  titleField: 'name',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'CNC Mill 3' },
    { key: 'code', label: 'Code', type: 'text', placeholder: 'MC-03' },
    { key: 'workCenter', label: 'Work Center', type: 'text', column: false },
    { key: 'runtime', label: 'Runtime (hrs)', type: 'number', min: 0 },
    { key: 'downtime', label: 'Downtime (hrs)', type: 'number', min: 0 },
    { key: 'maintenanceDue', label: 'Maintenance Due', type: 'date', column: false, format: 'date' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'idle',
      badge: true,
      filterable: true,
      options: [
        { value: 'running', label: 'Running', tone: 'green' },
        { value: 'idle', label: 'Idle', tone: 'neutral' },
        { value: 'maintenance', label: 'Maintenance', tone: 'blue' },
        { value: 'breakdown', label: 'Breakdown', tone: 'orange' },
        { value: 'offline', label: 'Offline', tone: 'neutral' },
        { value: 'down', label: 'Down', tone: 'orange' },
      ],
    },
  ],
};

export interface MachineAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}
export type MachineAiRunner = (machine: Machine) => Promise<MachineAiNarrative | null>;

export function createMachineModule(storePath: string, aiRunner?: MachineAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, MACHINES_MODULE_ID, MACHINE_KIND);
  return defineEnterpriseModule({
    descriptor: MACHINE_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const machine = machineFromRecord(record);
        const availability = calculateMachineAvailability(machine.runtime, machine.downtime);
        const utilization = calculateMachineUtilization(machine.runtime, machine.runtime + machine.downtime);
        const ai = aiRunner ? await aiRunner(machine).catch(() => null) : null;
        const summary =
          `${machine.name} (${machine.code || '—'}) is ${machine.status}: ${machine.runtime}h runtime, ` +
          `${machine.downtime}h downtime — ${availability}% availability, ${utilization}% utilization.`;
        return {
          moduleId: MACHINES_MODULE_ID,
          recordId: record.id,
          headline: `${machine.name} · ${machine.status} · ${availability}% avail`,
          summary: ai?.summary?.trim() || summary,
          risk: machine.status === 'down' ? 'high' : availability < 70 ? 'medium' : 'low',
          riskReason: machine.status === 'down' ? 'Machine down.' : `Availability ${availability}%.`,
          executiveExplanation:
            ai?.executiveExplanation?.trim() ||
            (machine.status === 'down' ? `${machine.name} is down.` : `${machine.name} is ${availability}% available.`),
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}

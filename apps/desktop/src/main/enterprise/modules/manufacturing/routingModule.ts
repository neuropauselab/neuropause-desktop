/**
 * Manufacturing → Routings — the operation recipe for a product: the ordered operations it
 * passes through (e.g. 10 Cutting → 20 Machining → 30 Assembly → 40 Inspection), each with a
 * required work center, the machines qualified for it, and deterministic setup / run-per-unit
 * / queue / inspection / transfer times. Operations are stored as a JSON array in a `textarea`
 * field (the framework-native way to carry a list on a flat record) and parsed deterministically;
 * a `validate` hook rejects malformed operation JSON. Master data — no stock effect. The
 * Routing-Aware Scheduler reads these to load each operation onto a qualified machine, and the
 * Production Order's Commit Schedule action turns an approved plan into real Production Schedules.
 */
import type { EnterpriseModuleDescriptor, EnterpriseRecordInput } from '@neuropause/shared';
import {
  ROUTINGS_MODULE_ID,
  ROUTING_KIND,
  parseRoutingOperations,
  serializeRoutingOperations,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const ROUTING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ROUTINGS_MODULE_ID,
  title: 'Routings',
  singular: 'Routing',
  plural: 'Routings',
  icon: 'git-branch',
  description: 'The ordered operations, work centers, and qualified machines to build a product.',
  group: 'Manufacturing',
  titleField: 'routingNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'routingNumber', label: 'Routing #', type: 'text', required: true, placeholder: 'ROUTE-0001' },
    { key: 'product', label: 'Product (SKU)', type: 'text', required: true, placeholder: 'FG-0001' },
    {
      key: 'operations',
      label: 'Operations (JSON)',
      type: 'textarea',
      column: false,
      help: 'JSON array: [{"sequence":10,"operation":"Cutting","workCenter":"WC-CUT","eligibleMachines":["CNC-1"],"setupTime":2,"runTimePerUnit":0.1,"queueTime":1,"inspectionTime":0,"transferTime":1}]',
      placeholder: '[{"sequence":10,"operation":"Cutting","workCenter":"WC-CUT","runTimePerUnit":0.1}]',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'archived', label: 'Archived', tone: 'orange' },
      ],
    },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false },
  ],
};

export function createRoutingModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ROUTINGS_MODULE_ID, ROUTING_KIND);
  return defineEnterpriseModule({
    descriptor: ROUTING_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(ROUTING_DESCRIPTOR, input);
        if (result.ok) {
          const rawOps = str(result.values.operations);
          if (rawOps.trim()) {
            const parsed = parseRoutingOperations(rawOps);
            if (parsed.length === 0) {
              return {
                ok: false,
                values: result.values,
                errors: { operations: 'Operations must be a JSON array of {operation, workCenter, ...}.' },
              };
            }
            // Normalize to the canonical serialized form (sorted by sequence).
            result.values.operations = serializeRoutingOperations(parsed);
          }
        }
        return result;
      },
    },
  });
}

/**
 * Warehouse → Bins — the storage locations inside a zone. Master data with a
 * deterministic `status` derived from occupancy vs capacity (blocked bins are left
 * as-is). Bins locate stock; the Inventory Ledger remains the source of truth for
 * quantities — a bin's `occupied` is an operational hint, not a stock authority.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
} from '@neuropause/shared';
import {
  WAREHOUSE_BINS_MODULE_ID,
  WAREHOUSE_BIN_KIND,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? '')) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const WAREHOUSE_BIN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: WAREHOUSE_BINS_MODULE_ID,
  title: 'Warehouse Bins',
  singular: 'Bin',
  plural: 'Bins',
  icon: 'box',
  description: 'Storage locations inside a zone that hold stock.',
  group: 'Warehouse',
  titleField: 'code',
  permissions: { read: 'warehouse:read', write: 'warehouse:manage' },
  fields: [
    { key: 'code', label: 'Bin Code', type: 'text', required: true, placeholder: 'A-01-01' },
    { key: 'zone', label: 'Zone', type: 'text', placeholder: 'Z-01' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', required: true, placeholder: 'WH-01' },
    { key: 'capacity', label: 'Capacity', type: 'number', min: 0 },
    { key: 'occupied', label: 'Occupied', type: 'number', min: 0 },
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
        { value: 'occupied', label: 'Occupied', tone: 'blue' },
        { value: 'full', label: 'Full', tone: 'orange' },
        { value: 'blocked', label: 'Blocked', tone: 'neutral' },
      ],
    },
  ],
};

/** Derive a bin's status from occupancy vs capacity — but never override 'blocked'. */
function deriveBinStatus(values: EnterpriseRecordInput['fields']): void {
  if (!values) return;
  if (str(values.status) === 'blocked') return;
  const capacity = num(values.capacity);
  const occupied = num(values.occupied);
  if (capacity > 0 && occupied >= capacity) values.status = 'full';
  else if (occupied > 0) values.status = 'occupied';
  else values.status = 'available';
}

export function createBinModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, WAREHOUSE_BINS_MODULE_ID, WAREHOUSE_BIN_KIND);
  return defineEnterpriseModule({
    descriptor: WAREHOUSE_BIN_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(WAREHOUSE_BIN_DESCRIPTOR, input);
        if (result.ok) deriveBinStatus(result.values);
        return result;
      },
    },
  });
}

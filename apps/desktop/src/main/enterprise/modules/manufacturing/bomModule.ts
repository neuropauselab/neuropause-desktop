/**
 * Manufacturing → Bill of Materials — the recipe for a finished product: its
 * components (SKU + quantity + waste + alternative), yield %, waste %, and revision.
 * Components are stored as a JSON array in a `textarea` field (the framework-native
 * way to carry a list on a flat record) and parsed deterministically. A `validate`
 * hook rejects malformed component JSON. Master data — no stock effect; the
 * Production Order consumes against this recipe through the Inventory Ledger.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
} from '@neuropause/shared';
import {
  BOM_MODULE_ID,
  BOM_KIND,
  parseBomComponents,
  serializeBomComponents,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const BOM_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BOM_MODULE_ID,
  title: 'Bill of Materials',
  singular: 'BOM',
  plural: 'BOMs',
  icon: 'layers',
  description: 'The component recipe for a finished product.',
  group: 'Manufacturing',
  titleField: 'bomNumber',
  permissions: { read: 'manufacturing:read', write: 'manufacturing:manage' },
  fields: [
    { key: 'bomNumber', label: 'BOM Number', type: 'text', required: true, placeholder: 'BOM-0001' },
    { key: 'product', label: 'Finished Product (SKU)', type: 'text', required: true, placeholder: 'FG-0001' },
    { key: 'outputQuantity', label: 'Output Qty', type: 'number', min: 1, default: 1, column: false },
    { key: 'yield', label: 'Yield %', type: 'number', min: 0, max: 100, default: 100 },
    { key: 'waste', label: 'Waste %', type: 'number', min: 0, max: 100, default: 0, column: false },
    { key: 'revision', label: 'Revision', type: 'text', placeholder: 'A' },
    {
      key: 'components',
      label: 'Components (JSON)',
      type: 'textarea',
      column: false,
      help: 'JSON array: [{"sku":"COMP-1","quantity":2,"waste":0,"alternative":""}]',
      placeholder: '[{"sku":"COMP-1","quantity":2}]',
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

export function createBomModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BOM_MODULE_ID, BOM_KIND);
  return defineEnterpriseModule({
    descriptor: BOM_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(BOM_DESCRIPTOR, input);
        if (result.ok) {
          const rawComponents = str(result.values.components);
          if (rawComponents.trim()) {
            const parsed = parseBomComponents(rawComponents);
            if (parsed.length === 0) {
              return { ok: false, values: result.values, errors: { components: 'Components must be a JSON array of {sku, quantity}.' } };
            }
            // Normalize to the canonical serialized form.
            result.values.components = serializeBomComponents(parsed);
          }
        }
        return result;
      },
    },
  });
}

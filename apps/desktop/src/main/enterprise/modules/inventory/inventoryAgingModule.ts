/**
 * Inventory → Aging — a governed, immutable, point-in-time inventory-aging snapshot, on the
 * Enterprise Module Framework and modelled exactly on Finance → Payables Aging
 * (`apAgingModule`): create = generate a snapshot bucketing on-hand by physical age
 * (0–30 / 31–60 / 61–90 / 90+) via the pure `deriveAgingSnapshot`. Snapshots are history,
 * never edited. It reads the AUTHORITATIVE stock-movement ledger (injected, tenant-scoped)
 * and mutates NOTHING in inventory — the ledger is untouched.
 *
 * Electron-free (store path + ledger store injected), so it unit-tests without the runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import { movementFromRecord, validateEnterpriseRecordInput } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveAgingSnapshot } from './inventoryIntelligenceModel';

export const INVENTORY_AGING_MODULE_ID = 'inventory-aging';
export const INVENTORY_AGING_KIND = 'inventoryAgingReport';

export const INVENTORY_AGING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: INVENTORY_AGING_MODULE_ID,
  title: 'Inventory Aging',
  singular: 'Inventory Aging Report',
  plural: 'Inventory Aging Reports',
  icon: 'database',
  description:
    'Point-in-time inventory-aging snapshots — on-hand stock bucketed by physical age (FIFO layers) per SKU + warehouse.',
  group: 'Inventory',
  titleField: 'reportNumber',
  permissions: { read: 'inventory:read', write: 'inventory:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'totalOnHand', label: 'On Hand', type: 'number', readOnly: true, default: 0 },
    { key: 'days0to30', label: '0–30d', type: 'number', readOnly: true, default: 0 },
    { key: 'days31to60', label: '31–60d', type: 'number', readOnly: true, default: 0 },
    { key: 'days61to90', label: '61–90d', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'days90plus', label: '90d+', type: 'number', readOnly: true, default: 0 },
    { key: 'skuWarehouseCount', label: 'SKU·WH', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'over90Count', label: 'Aged 90+ Lines', type: 'number', readOnly: true, default: 0 },
    { key: 'rows', label: 'Aging Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Inventory Aging module (stock-movement ledger store injected, tenant-scoped). */
export function createInventoryAgingModule(
  storePath: string,
  movementStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, INVENTORY_AGING_MODULE_ID, INVENTORY_AGING_KIND);
  return defineEnterpriseModule({
    descriptor: INVENTORY_AGING_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(INVENTORY_AGING_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Aging reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        const asOfMs = Date.parse(`${asOfDate}T23:59:59.999Z`);
        if (!Number.isFinite(asOfMs)) {
          return { ok: false, errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' }, values: result.values };
        }
        const movements = movementStore.list().map(movementFromRecord);
        const aging = deriveAgingSnapshot(movements, asOfMs, asOfDate);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `INV-AGING-${asOfDate}-${priorCount + 1}`;
        result.values.totalOnHand = aging.totalOnHand;
        result.values.days0to30 = aging.days0to30;
        result.values.days31to60 = aging.days31to60;
        result.values.days61to90 = aging.days61to90;
        result.values.days90plus = aging.days90plus;
        result.values.skuWarehouseCount = aging.skuWarehouseCount;
        result.values.over90Count = aging.over90Count;
        result.values.rows = JSON.stringify(aging.rows);
        result.values.note =
          aging.skuWarehouseCount === 0
            ? 'no on-hand inventory at the as-of date — the report is empty, not fabricated'
            : `derived from the stock ledger across ${aging.skuWarehouseCount} SKU·warehouse line(s) at ${asOfDate} (FIFO physical-age layers)`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const over90 = Number(f.days90plus ?? 0);
        return {
          moduleId: INVENTORY_AGING_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · on-hand ${Number(f.totalOnHand ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.totalOnHand ?? 0).toLocaleString('en-US')} units on hand across ${Number(f.skuWarehouseCount ?? 0)} SKU·warehouse line(s); ${over90.toLocaleString('en-US')} unit(s) aged 90+ days.`,
          risk: over90 > 0 ? 'medium' : 'low',
          riskReason: over90 > 0 ? 'Stock aged over 90 days — obsolescence / carrying-cost risk.' : 'No stock aged over 90 days.',
          executiveExplanation:
            'On-hand is attributed to receipt layers oldest-consumed-first (FIFO physical flow) and bucketed by age; snapshots are immutable and kept as inventory-health history. The stock ledger is never modified.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

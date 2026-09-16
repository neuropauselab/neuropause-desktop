/**
 * Sales → Demand Trend — a governed, immutable, point-in-time demand-trend register on the
 * Enterprise Module Framework, modelled on Payables Aging / Revenue Forecast / the S81–S83
 * snapshots: create = generate a snapshot of every SKU's historical demand series + direction.
 *
 * Canonical actual demand is REUSED (packages/shared/types/planning.ts `calculateHistoricalShipped`
 * — SHIPPED/DELIVERED shipment quantities); this module buckets it by month per SKU via the pure
 * `deriveDemandTrendSnapshot`. It is analytical and HISTORICAL: no forecast, no reorder/PR/PO, no
 * inventory or GL effect. It READS the shipping store (injected) and mutates NOTHING — it only
 * writes its own immutable snapshot.
 *
 * Electron-free (store paths + shipping store injected), so it unit-tests without the runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import { shippingFromRecord, validateEnterpriseRecordInput } from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveDemandTrendSnapshot } from './demandTrendModel';

export const DEMAND_TREND_MODULE_ID = 'sales-demand-trend';
export const DEMAND_TREND_KIND = 'demandTrendReport';

export const DEMAND_TREND_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DEMAND_TREND_MODULE_ID,
  title: 'Demand Trend',
  singular: 'Demand Trend Report',
  plural: 'Demand Trend Reports',
  icon: 'database',
  description:
    'Point-in-time demand-trend snapshots — historical shipped/delivered demand by month per SKU, with a threshold-free direction.',
  group: 'Sales',
  titleField: 'reportNumber',
  // Reuses the established analytics scopes (as apAging / budget variance).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'skuCount', label: 'SKUs', type: 'number', readOnly: true, default: 0 },
    { key: 'totalDemand', label: 'Total Demand', type: 'number', readOnly: true, default: 0 },
    { key: 'upCount', label: 'Rising', type: 'number', readOnly: true, default: 0 },
    { key: 'downCount', label: 'Falling', type: 'number', readOnly: true, default: 0 },
    { key: 'flatCount', label: 'Flat', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'insufficientCount', label: 'Insufficient', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Demand Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Demand Trend module (shipping store injected — the canonical demand source). */
export function createDemandTrendModule(
  storePath: string,
  shippingStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DEMAND_TREND_MODULE_ID, DEMAND_TREND_KIND);
  return defineEnterpriseModule({
    descriptor: DEMAND_TREND_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(DEMAND_TREND_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Demand-trend reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
          return { ok: false, errors: { asOfDate: 'As-of must be a date (YYYY-MM-DD).' }, values: result.values };
        }
        const shipments = shippingStore.list().map(shippingFromRecord);
        const snap = deriveDemandTrendSnapshot(shipments, asOfDate);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `DEMAND-${asOfDate}-${priorCount + 1}`;
        result.values.skuCount = snap.skuCount;
        result.values.totalDemand = snap.totalDemand;
        result.values.upCount = snap.upCount;
        result.values.downCount = snap.downCount;
        result.values.flatCount = snap.flatCount;
        result.values.insufficientCount = snap.insufficientCount;
        result.values.rows = JSON.stringify(snap.rows);
        result.values.note =
          snap.skuCount === 0
            ? 'no shipped/delivered demand at the as-of date — the report is empty, not fabricated'
            : `derived from shipped/delivered shipments across ${snap.skuCount} SKU(s) at ${asOfDate}; historical only, no forecast; direction is a threshold-free latest-vs-prior comparison`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const falling = Number(f.downCount ?? 0);
        return {
          moduleId: DEMAND_TREND_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${Number(f.skuCount ?? 0)} SKU(s) · demand ${Number(f.totalDemand ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.upCount ?? 0)} rising, ${falling} falling, ${Number(f.flatCount ?? 0)} flat, ${Number(f.insufficientCount ?? 0)} with insufficient history.`,
          risk: falling > 0 ? 'low' : 'low',
          riskReason: falling > 0 ? 'Some SKUs show falling demand vs their prior average (informational).' : 'No falling-demand SKUs.',
          executiveExplanation:
            'Demand is shipped/delivered units (the planning run-rate definition) bucketed by month per SKU; direction compares the latest month to the mean of prior months with no tolerance band. Historical and analytical only — no forecast, no reorder, no GL, no source mutation.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

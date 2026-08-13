/**
 * Finance → Payables Aging — the AP mirror of Receivables Aging, on the
 * Enterprise Module Framework: create = generate an immutable point-in-time
 * snapshot bucketing every APPROVED, unpaid vendor bill by days past due
 * (current / 1–30 / 31–60 / 61–90 / 90+) via the pure `deriveApAging`.
 * Snapshots are history, never superseded. This module exists because vendor
 * bills now exist — the W1.5 deferral honoured, not papered over.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  AP_AGING_MODULE_ID,
  AP_AGING_KIND,
  deriveApAging,
  vendorBillFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of an AP aging report — drives store, CRUD, and the UI. */
export const AP_AGING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: AP_AGING_MODULE_ID,
  title: 'Payables Aging',
  singular: 'AP Aging Report',
  plural: 'AP Aging Reports',
  icon: 'database',
  description: 'Point-in-time AP aging snapshots — open vendor bills bucketed by days past due.',
  group: 'Finance',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'totalOutstanding', label: 'Outstanding', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'current', label: 'Current', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'days1to30', label: '1–30d', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'days31to60', label: '31–60d', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'days61to90', label: '61–90d', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'days90plus', label: '90d+', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'billCount', label: 'Open Bills', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Bill Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Payables Aging module (vendor-bill store injected). */
export function createApAgingModule(
  storePath: string,
  billStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, AP_AGING_MODULE_ID, AP_AGING_KIND);
  return defineEnterpriseModule({
    descriptor: AP_AGING_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(AP_AGING_DESCRIPTOR, input);
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
        const aging = deriveApAging(billStore.list().map(vendorBillFromRecord), asOfMs);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `AP-AGING-${asOfDate}-${priorCount + 1}`;
        result.values.totalOutstanding = aging.totalOutstanding;
        result.values.current = aging.current;
        result.values.days1to30 = aging.days1to30;
        result.values.days31to60 = aging.days31to60;
        result.values.days61to90 = aging.days61to90;
        result.values.days90plus = aging.days90plus;
        result.values.billCount = aging.billCount;
        result.values.rows = JSON.stringify(aging.rows);
        result.values.note =
          aging.billCount === 0
            ? 'no open payables at the as-of date — the report is empty, not fabricated'
            : `derived from ${aging.billCount} approved unpaid bill(s) at ${asOfDate}`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const late = Number(f.days61to90 ?? 0) + Number(f.days90plus ?? 0);
        return {
          moduleId: AP_AGING_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · payable ${Number(f.totalOutstanding ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.totalOutstanding ?? 0).toLocaleString('en-US')} payable across ${Number(f.billCount ?? 0)} bill(s); ${late.toLocaleString('en-US')} is 61+ days late.`,
          risk: late > 0 ? 'medium' : 'low',
          riskReason: late > 0 ? 'Payables older than 60 days — supplier-relationship risk.' : 'No payables older than 60 days.',
          executiveExplanation:
            'Buckets derive from approved unpaid bills at the as-of date; snapshots are immutable and kept as payment-discipline history.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

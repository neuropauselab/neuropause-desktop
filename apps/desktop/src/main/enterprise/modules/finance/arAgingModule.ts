/**
 * Finance → Receivables Aging — point-in-time AR aging snapshots on the
 * Enterprise Module Framework like every other module: a descriptor + the
 * framework's record store + a `validate` hook (which IS the generator) + a
 * deterministic `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * CREATING a report generates it: the validate hook buckets every OPEN invoice
 * (issued / partially paid / overdue with a real outstanding balance) by days
 * past due at the report's as-of date — current, 1–30, 31–60, 61–90, 90+ —
 * through the shared, pure `deriveArAging`. Snapshots are immutable and are
 * deliberately NOT superseded: a sequence of aging snapshots is collections
 * history. Generate one any time for the current view; regenerate at month-end
 * for the close package. PAYABLES aging deliberately does not exist yet —
 * there is no vendor-bill module to age — and arrives with Procurement
 * completion, not faked here.
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
  AR_AGING_MODULE_ID,
  AR_AGING_KIND,
  deriveArAging,
  invoiceFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveSourceLineage } from './sourceLineage';

/** The declarative description of an aging report — drives store, CRUD, and the UI. */
export const AR_AGING_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: AR_AGING_MODULE_ID,
  title: 'Receivables Aging',
  singular: 'Aging Report',
  plural: 'Aging Reports',
  icon: 'database',
  description: 'Point-in-time AR aging snapshots — open receivables bucketed by days past due.',
  group: 'Finance',
  titleField: 'reportNumber',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
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
    { key: 'invoiceCount', label: 'Open Invoices', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Invoice Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    // NP-010 §3 — the tile law: the snapshot names what it was computed over,
    // source by source, carrying the §2 honesty label.
    { key: 'sourceLineage', label: 'Evidence Lineage', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Receivables Aging module. The invoice store is injected (the
 * Payments ← invoice-store pattern) so generation reads the real open ledger.
 */
export function createArAgingModule(
  storePath: string,
  invoiceStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, AR_AGING_MODULE_ID, AR_AGING_KIND);
  return defineEnterpriseModule({
    descriptor: AR_AGING_DESCRIPTOR,
    store,
    hooks: {
      // Creating a report IS generating it; a generated report is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(AR_AGING_DESCRIPTOR, input);
        if (!result.ok) return result;

        // generatedAt is stamped here on create. Reaching validate WITH one
        // means an edit of an existing snapshot — refused; generate a new one.
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
          return {
            ok: false,
            errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' },
            values: result.values,
          };
        }

        const invoiceRecords = invoiceStore.list();
        const aging = deriveArAging(invoiceRecords.map(invoiceFromRecord), asOfMs);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `AR-AGING-${asOfDate}-${priorCount + 1}`;
        result.values.totalOutstanding = aging.totalOutstanding;
        result.values.current = aging.current;
        result.values.days1to30 = aging.days1to30;
        result.values.days31to60 = aging.days31to60;
        result.values.days61to90 = aging.days61to90;
        result.values.days90plus = aging.days90plus;
        result.values.invoiceCount = aging.invoiceCount;
        result.values.rows = JSON.stringify(aging.rows);
        result.values.note =
          aging.invoiceCount === 0
            ? 'no open receivables at the as-of date — the report is empty, not fabricated'
            : `derived from ${aging.invoiceCount} open invoice(s) at ${asOfDate}; payables aging arrives with the vendor-bill module`;
        // NP-010 §3: the lineage describes the register the buckets derive
        // from — files (with the §2 trust label), connector rows, hand entry.
        result.values.sourceLineage = deriveSourceLineage(invoiceRecords, 'invoice(s)').sentence;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const overdue =
          Number(f.days1to30 ?? 0) + Number(f.days31to60 ?? 0) + Number(f.days61to90 ?? 0) + Number(f.days90plus ?? 0);
        const late = Number(f.days61to90 ?? 0) + Number(f.days90plus ?? 0);
        return {
          moduleId: AR_AGING_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · outstanding ${Number(f.totalOutstanding ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.totalOutstanding ?? 0).toLocaleString('en-US')} outstanding across ${Number(f.invoiceCount ?? 0)} invoice(s) — current ${Number(f.current ?? 0).toLocaleString('en-US')}, overdue ${overdue.toLocaleString('en-US')} (of which ${late.toLocaleString('en-US')} is 61+ days).`,
          risk: late > 0 ? 'medium' : 'low',
          riskReason:
            late > 0
              ? 'Receivables older than 60 days — collection attention needed.'
              : 'No receivables older than 60 days.',
          executiveExplanation:
            'Buckets derive from open invoices at the as-of date; snapshots are immutable and kept as collections history.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

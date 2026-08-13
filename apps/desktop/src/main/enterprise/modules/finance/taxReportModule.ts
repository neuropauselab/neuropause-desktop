/**
 * Finance → Tax Reports — period GST/tax snapshots on the Enterprise Module
 * Framework like every other module: a descriptor + the framework's record
 * store + a `validate` hook (which IS the generator) + an `onChange` superseder
 * + a deterministic `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * CREATING a report generates it: the validate hook computes every figure from
 * the POSTED journal (net Tax Payable / Sales Revenue credits dated in the
 * period, per-invoice nets across base + ADJ − REV entries) with the invoice
 * records' declared amounts beside them, and any books-vs-declared discrepancy
 * stamped — surfaced, never reconciled silently (`glTaxReportForPeriod`).
 * Reports are immutable snapshots (edits are refused); regenerating a period
 * creates a NEW report and marks earlier ones superseded. Report GENERATION
 * only — filing remains a human act, exactly as scoped in the approved ERP
 * Completion Report.
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
  TAX_REPORTS_MODULE_ID,
  TAX_REPORT_KIND,
  calculateTaxAmount,
  glJournalEntryFromRecord,
  glTaxReportForPeriod,
  invoiceFromRecord,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a tax report — drives store, CRUD, and the UI. */
export const TAX_REPORT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TAX_REPORTS_MODULE_ID,
  title: 'Tax Reports',
  singular: 'Tax Report',
  plural: 'Tax Reports',
  icon: 'database',
  description: 'Period GST/tax snapshots generated from posted journal entries — filing stays manual.',
  group: 'Finance',
  titleField: 'reportNumber',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'taxCollected', label: 'Tax Collected (books)', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'taxableRevenue', label: 'Taxable Revenue (books)', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'declaredTax', label: 'Declared Tax (invoices)', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'discrepancy', label: 'Discrepancy', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'invoiceCount', label: 'Invoices', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'lines', label: 'Invoice Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'generated',
      badge: true,
      filterable: true,
      options: [
        { value: 'generated', label: 'Generated', tone: 'green' },
        { value: 'superseded', label: 'Superseded', tone: 'neutral' },
      ],
    },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Tax Reports module. The journal + invoice stores are injected (the
 * Payments ← invoice-store pattern) so generation reads the real posted books.
 */
export function createTaxReportModule(
  storePath: string,
  journalStore: EnterpriseRecordStore,
  invoiceStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TAX_REPORTS_MODULE_ID, TAX_REPORT_KIND);
  return defineEnterpriseModule({
    descriptor: TAX_REPORT_DESCRIPTOR,
    store,
    hooks: {
      // Creating a report IS generating it; a generated report is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(TAX_REPORT_DESCRIPTOR, input);
        if (!result.ok) return result;

        // generatedAt is stamped here on create. Reaching validate WITH one
        // means an edit of an existing snapshot — refused; regenerate instead.
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Tax reports are immutable snapshots — create a new report to regenerate the period.' },
            values: result.values,
          };
        }

        const periodKey = str(result.values.periodKey).trim();
        if (!isGlPeriodKey(periodKey)) {
          return {
            ok: false,
            errors: { periodKey: 'Period must be a YYYY-MM month key (e.g. 2026-08).' },
            values: result.values,
          };
        }

        const entries = journalStore.list().map(glJournalEntryFromRecord);
        const invoices = invoiceStore.list().map((r) => {
          const inv = invoiceFromRecord(r);
          return {
            number: inv.number,
            customer: inv.customer,
            customerGstin: str(r.fields.customerGstin),
            subtotal: inv.amount,
            taxAmount: calculateTaxAmount(inv),
          };
        });
        const report = glTaxReportForPeriod({ periodKey, entries, invoices });

        const priorCount = store
          .list()
          .filter((r) => str(r.fields.periodKey) === periodKey).length;
        result.values.periodKey = periodKey;
        result.values.reportNumber = `GST-${periodKey}-${priorCount + 1}`;
        result.values.taxCollected = report.taxCollected;
        result.values.taxableRevenue = report.taxableRevenue;
        result.values.declaredTax = report.declaredTax;
        result.values.discrepancy = report.discrepancy;
        result.values.invoiceCount = report.invoiceCount;
        result.values.lines = JSON.stringify(report.lines);
        result.values.note = report.note;
        result.values.status = 'generated';
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      // Regenerating a period supersedes its earlier snapshots — audited and
      // broadcast through the module's own store like any other change.
      onChange: async (event, ctx) => {
        if (event.action !== 'created') return;
        const periodKey = str(event.record.fields.periodKey);
        const self = ctx.moduleFor(TAX_REPORTS_MODULE_ID);
        if (!self || !periodKey) return;
        await self.store.load();
        for (const prior of self.store.list()) {
          if (prior.id === event.record.id) continue;
          if (str(prior.fields.periodKey) !== periodKey) continue;
          if (str(prior.fields.status) === 'superseded') continue;
          const updated = self.store.update(prior.id, {
            fields: { status: 'superseded' },
            actor: ctx.actor(),
            now: ctx.now(),
          });
          if (updated) ctx.emit(self, 'updated', updated);
        }
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const discrepancy = Number(f.discrepancy ?? 0);
        return {
          moduleId: TAX_REPORTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${str(f.periodKey)} · tax ${Number(f.taxCollected ?? 0).toLocaleString('en-US')}`,
          summary: `${str(f.periodKey)}: taxable revenue ${Number(f.taxableRevenue ?? 0).toLocaleString('en-US')}, tax collected ${Number(f.taxCollected ?? 0).toLocaleString('en-US')} across ${Number(f.invoiceCount ?? 0)} invoice(s). ${str(f.note)}`,
          risk: discrepancy === 0 ? 'low' : 'medium',
          riskReason:
            discrepancy === 0
              ? 'Books and declared invoice tax agree.'
              : `Books differ from declared invoice tax by ${discrepancy} — review before filing.`,
          executiveExplanation:
            'Every figure derives from posted journal entries; the report is a snapshot for filing, and filing itself remains a human act.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

/**
 * Projects → Billing Runs — portfolio→billing on the Enterprise Module
 * Framework (W4.2). CRUD, RBAC (`operations:read` / `operations:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * CREATING a run PREVIEWS it deterministically: the validate hook gathers the
 * project's UNBILLED billable time inside the period through the pure
 * `deriveBillingRun` engine (grouped person + rate; rate-less entries skipped
 * AND counted) and stamps the lines and totals read-only. `Issue Invoice`
 * then does the real thing through the runtime action context: it creates a
 * DRAFT invoice via the certified W1 Invoice module (which walks its own
 * issue → GL → payment chain from there), stamps every gathered entry
 * `invoicedBy`, and freezes the run. One invoice per run; a stale preview
 * (entries billed elsewhere since) re-derives at issue time and refuses if
 * nothing remains.
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
  BILLING_RUNS_MODULE_ID,
  BILLING_RUN_KIND,
  FINANCE_MODULE_ID,
  TIME_ENTRIES_MODULE_ID,
  customerFromRecord,
  deriveBillingRun,
  deriveRecordTitle,
  projectFromRecord,
  timeEntryFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Billing Runs module surfaces. */
export const ISSUE_INVOICE_ACTION = 'issueInvoice';

/** The declarative description of a billing run — drives store, CRUD, and the UI. */
export const BILLING_RUN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BILLING_RUNS_MODULE_ID,
  title: 'Billing Runs',
  singular: 'Billing Run',
  plural: 'Billing Runs',
  icon: 'receipt',
  description:
    'Turn unbilled project time into a real draft invoice — deterministic preview on create, one invoice per run.',
  group: 'Projects',
  titleField: 'runNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: ISSUE_INVOICE_ACTION, label: 'Issue Invoice', icon: 'upload' }],
  fields: [
    { key: 'runNumber', label: 'Run #', type: 'text', readOnly: true },
    { key: 'projectRef', label: 'Project', type: 'text', required: true, placeholder: 'Project id' },
    { key: 'periodFrom', label: 'From', type: 'date', required: true, format: 'date' },
    { key: 'periodTo', label: 'To', type: 'date', required: true, format: 'date' },
    { key: 'taxRate', label: 'Tax Rate %', type: 'number', min: 0, max: 100, default: 0, column: false },
    { key: 'entryCount', label: 'Entries', type: 'number', readOnly: true, default: 0 },
    { key: 'totalHours', label: 'Hours', type: 'number', readOnly: true, default: 0 },
    { key: 'totalAmount', label: 'Amount', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'skippedNoRate', label: 'Skipped (no rate)', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'lines', label: 'Lines', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'preview',
      badge: true,
      filterable: true,
      options: [
        { value: 'preview', label: 'Preview', tone: 'blue' },
        { value: 'invoiced', label: 'Invoiced', tone: 'green' },
      ],
    },
    { key: 'invoiceRef', label: 'Invoice', type: 'text', readOnly: true, column: false },
    { key: 'issuedAt', label: 'Issued At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Billing Runs module. Time Entries + Projects + Customers stores
 * back the preview; the REAL invoice + entry stamping go through the runtime
 * action context (the W1 cross-module pattern).
 */
export function createBillingRunModule(
  storePath: string,
  timeEntryStore: EnterpriseRecordStore,
  projectStore: EnterpriseRecordStore,
  customerStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BILLING_RUNS_MODULE_ID, BILLING_RUN_KIND);
  return defineEnterpriseModule({
    descriptor: BILLING_RUN_DESCRIPTOR,
    store,
    hooks: {
      // Creating a run IS previewing it; an issued run is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BILLING_RUN_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.issuedAt)) {
          return {
            ok: false,
            errors: { status: 'This run has issued its invoice — issued runs are immutable billing history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const projectRef = str(result.values.projectRef);
        const project = projectStore.get(projectRef);
        if (!project || project.status === 'deleted') {
          errors.projectRef = `No project with id "${projectRef}" was found.`;
        }
        const fromDate = str(result.values.periodFrom);
        const toDate = str(result.values.periodTo);
        if (fromDate && toDate && Date.parse(toDate) < Date.parse(fromDate)) {
          errors.periodTo = 'The period must end on or after it starts.';
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        const run = deriveBillingRun(
          timeEntryStore.list().map(timeEntryFromRecord),
          projectRef,
          fromDate,
          toDate,
        );
        const priorCount = store.list().filter((r) => str(r.fields.projectRef) === projectRef).length;
        result.values.runNumber = `BR-${str(project!.fields.projectNumber) || projectRef}-${priorCount + 1}`;
        result.values.entryCount = run.entryCount;
        result.values.totalHours = run.totalHours;
        result.values.totalAmount = run.totalAmount;
        result.values.skippedNoRate = run.skippedNoRate;
        result.values.lines = JSON.stringify(run.lines);
        result.values.status = 'preview';
        result.values.note =
          run.entryCount === 0
            ? 'no unbilled billable time in the period — the preview is empty, not fabricated'
            : `unbilled billable time only; grouped person + rate` +
              (run.skippedNoRate > 0 ? `; ${run.skippedNoRate} entr(ies) skipped for missing a rate — never billed at zero` : '');
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: BILLING_RUNS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.runNumber)} · ${str(f.status)} · ${Number(f.totalAmount ?? 0).toLocaleString('en-US')} for ${Number(f.totalHours ?? 0)}h`,
          summary: `${str(f.periodFrom)} → ${str(f.periodTo)}: ${Number(f.entryCount ?? 0)} entr(ies), ${Number(f.totalHours ?? 0)}h, ${Number(f.totalAmount ?? 0).toLocaleString('en-US')}. ${str(f.note)}.`,
          risk: Number(f.skippedNoRate ?? 0) > 0 ? 'medium' : 'low',
          riskReason:
            Number(f.skippedNoRate ?? 0) > 0
              ? 'Rate-less billable time was skipped — set rates and run again.'
              : 'Every gathered entry carries a rate.',
          executiveExplanation:
            'Billing runs are the seam from delivery to revenue: the invoice they issue is a real W1 invoice that walks the certified issue → GL → payment chain.',
          grounded: false,
          model: 'none',
        };
      },
      // The real thing: create the draft invoice, stamp the entries, freeze the run.
      runAction: async (action, record, actionCtx) => {
        if (action !== ISSUE_INVOICE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const f = record.fields;
        if (str(f.issuedAt)) return { ok: false, error: 'This run has already issued its invoice.' };
        const projectRef = str(f.projectRef);
        const projectRecord = projectStore.get(projectRef);
        if (!projectRecord) return { ok: false, error: 'The run’s project no longer exists.' };
        const project = projectFromRecord(projectRecord);
        // Re-derive at issue time — the preview may be stale if entries were billed since.
        const run = deriveBillingRun(
          timeEntryStore.list().map(timeEntryFromRecord),
          projectRef,
          str(f.periodFrom),
          str(f.periodTo),
        );
        if (run.entryCount === 0) {
          return { ok: false, error: 'No unbilled billable time remains in the period — nothing to invoice.' };
        }
        const invoiceModule = actionCtx.moduleFor(FINANCE_MODULE_ID);
        const entriesModule = actionCtx.moduleFor(TIME_ENTRIES_MODULE_ID);
        if (!invoiceModule || !entriesModule) {
          return { ok: false, error: 'The Invoice or Time Entries module is not available.' };
        }
        await Promise.all([invoiceModule.store.load(), entriesModule.store.load()]);
        const customerName = (() => {
          if (!project.customerRef || !customerStore) return project.name;
          const customer = customerStore.get(project.customerRef);
          return customer ? customerFromRecord(customer).name : project.name;
        })();
        const description = run.lines
          .map((l) => `${l.person}: ${l.hours}h × ${l.hourlyRate}`)
          .join('; ');
        const validation = invoiceModule.hooks.validate({
          fields: {
            number: `INV-${str(f.runNumber)}`,
            customer: customerName,
            amount: run.totalAmount,
            taxRate: Number(f.taxRate ?? 0),
            status: 'draft',
            notes: `Project ${project.projectNumber} time ${str(f.periodFrom)} → ${str(f.periodTo)} — ${description}`,
          },
        });
        if (!validation.ok) {
          const first = Object.values(validation.errors)[0] ?? 'invalid invoice input';
          return { ok: false, error: `Invoice creation failed: ${first}` };
        }
        const invoice = invoiceModule.store.create({
          title: deriveRecordTitle(invoiceModule.descriptor, validation.values),
          fields: validation.values,
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        actionCtx.emit(invoiceModule, 'created', invoice);
        // Stamp every gathered entry — invoiced time freezes.
        for (const line of run.lines) {
          for (const entryId of line.entryIds) {
            const updated = entriesModule.store.update(entryId, {
              fields: { invoicedBy: invoice.id },
              actor: actionCtx.actor(),
              now: actionCtx.now(),
            });
            if (updated) actionCtx.emit(entriesModule, 'updated', updated);
          }
        }
        store.update(record.id, {
          fields: {
            issuedAt: actionCtx.now(),
            status: 'invoiced',
            invoiceRef: invoice.id,
            entryCount: run.entryCount,
            totalHours: run.totalHours,
            totalAmount: run.totalAmount,
            lines: JSON.stringify(run.lines),
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message: `Draft invoice INV-${str(f.runNumber)} created for ${run.totalAmount} (${run.totalHours}h) — it now walks the certified invoice chain; ${run.entryCount} entr(ies) frozen.`,
        };
      },
    },
  });
}

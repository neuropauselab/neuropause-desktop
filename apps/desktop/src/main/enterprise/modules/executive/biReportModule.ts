/**
 * Executive → BI Report Definitions — the generic aggregation primitive on
 * the Enterprise Module Framework (W5.2), the final module of the W2–W5
 * mandate. CRUD, RBAC (`executive:read` / `executive:execute` — the Executive
 * family's certified prefix), audit, timeline, search, offline persistence,
 * and the UI are all inherited.
 *
 * A definition is a saved question over ANY registered module: count records,
 * or sum a numeric field, optionally grouped and exact-match filtered. `Run`
 * resolves the target module at RUNTIME through the action context (unknown
 * ids refused, stated), executes the pure `runBiReport` engine over the live
 * records, and stamps result + run time onto the definition — every run in
 * the audit trail. Sums over non-numeric values are COUNTED as unparseable,
 * never silently zeroed. BI LITE, stated: charts are renderer work, schedules
 * belong to the automation subsystem — named, not faked.
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
  BI_REPORTS_MODULE_ID,
  BI_REPORT_KIND,
  runBiReport,
  validateEnterpriseRecordInput,
  type BiReportDefinition,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the BI Reports module surfaces. */
export const RUN_REPORT_ACTION = 'run';

/** The declarative description of a report definition — drives store, CRUD, and the UI. */
export const BI_REPORT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BI_REPORTS_MODULE_ID,
  title: 'BI Reports',
  singular: 'Report Definition',
  plural: 'BI Reports',
  icon: 'bar-chart',
  description:
    'Saved aggregations over any registered module — count or sum, grouped and filtered; every run audited, honest nulls.',
  group: 'Executive',
  titleField: 'reportName',
  permissions: { read: 'executive:read', write: 'executive:execute' },
  actions: [{ key: RUN_REPORT_ACTION, label: 'Run', icon: 'play' }],
  fields: [
    { key: 'reportName', label: 'Report', type: 'text', required: true, placeholder: 'Open pipeline by rep' },
    { key: 'targetModule', label: 'Module', type: 'text', required: true, placeholder: 'crm-opportunities' },
    {
      key: 'aggregate',
      label: 'Aggregate',
      type: 'select',
      required: true,
      default: 'count',
      badge: true,
      options: [
        { value: 'count', label: 'Count', tone: 'blue' },
        { value: 'sum', label: 'Sum', tone: 'teal' },
      ],
    },
    { key: 'sumField', label: 'Sum Field', type: 'text', column: false, placeholder: 'weightedValue (for sum)' },
    { key: 'groupByField', label: 'Group By', type: 'text', column: false, placeholder: 'assignedTo (optional)' },
    { key: 'filterField', label: 'Filter Field', type: 'text', column: false, placeholder: 'stage (optional)' },
    { key: 'filterValue', label: 'Filter Value', type: 'text', column: false, placeholder: 'negotiation' },
    { key: 'lastRunAt', label: 'Last Run', type: 'text', readOnly: true },
    { key: 'lastResult', label: 'Result', type: 'textarea', readOnly: true, column: false },
    { key: 'lastRunNote', label: 'Run Note', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the BI Reports module — definitions here, targets resolved at run time. */
export function createBiReportModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BI_REPORTS_MODULE_ID, BI_REPORT_KIND);

  const defOf = (fields: Record<string, unknown>): BiReportDefinition => ({
    reportName: str(fields.reportName),
    targetModule: str(fields.targetModule),
    aggregate: str(fields.aggregate) === 'sum' ? 'sum' : 'count',
    sumField: str(fields.sumField),
    groupByField: str(fields.groupByField),
    filterField: str(fields.filterField),
    filterValue: str(fields.filterValue),
  });

  return defineEnterpriseModule({
    descriptor: BI_REPORT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BI_REPORT_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        if (str(result.values.aggregate) === 'sum' && !str(result.values.sumField)) {
          errors.sumField = 'A sum report needs the field to sum.';
        }
        if (str(result.values.filterField) && !str(result.values.filterValue)) {
          errors.filterValue = 'A filter field needs a value to match.';
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const def = defOf(f);
        return {
          moduleId: BI_REPORTS_MODULE_ID,
          recordId: record.id,
          headline: `${def.reportName} · ${def.aggregate} over ${def.targetModule}${str(f.lastRunAt) ? ` · ran ${str(f.lastRunAt)}` : ' · never run'}`,
          summary:
            `${def.aggregate === 'sum' ? `Sum of ${def.sumField}` : 'Count'} over ${def.targetModule}` +
            (def.groupByField ? `, grouped by ${def.groupByField}` : '') +
            (def.filterField ? `, where ${def.filterField} = "${def.filterValue}"` : '') +
            `. ${str(f.lastRunNote) || 'Run it to get numbers — definitions never fabricate results.'}`,
          risk: 'low',
          riskReason: 'Definitions are saved questions; only runs produce numbers.',
          executiveExplanation:
            'BI Lite: saved aggregations over live module records with every run audited — charts and schedules are named future work.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== RUN_REPORT_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const def = defOf(record.fields);
        const target = actionCtx.moduleFor(def.targetModule);
        if (!target) {
          return { ok: false, error: `No registered module with id "${def.targetModule}" — check the module id.` };
        }
        await target.store.load();
        const result = runBiReport(target.store.list(), def);
        const note =
          `${result.totalCount} record(s)` +
          (def.aggregate === 'sum' ? `, total ${result.totalSum}` : '') +
          (result.totalUnparseable > 0 ? `; ${result.totalUnparseable} value(s) unparseable as numbers — counted, not zeroed` : '');
        store.update(record.id, {
          fields: {
            lastRunAt: actionCtx.now(),
            lastResult: JSON.stringify(result.rows),
            lastRunNote: note,
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return { ok: true, message: `Ran over ${def.targetModule}: ${note}.` };
      },
    },
  });
}

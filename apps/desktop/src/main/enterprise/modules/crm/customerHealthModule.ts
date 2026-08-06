/**
 * CRM → Customer Health — immutable cross-module health registers on the
 * Enterprise Module Framework (W2.7), the Aging pattern applied to
 * relationships: CREATING a report generates it. The validate hook walks every
 * non-archived customer through the pure `deriveCustomerHealthRegister` —
 * base = the existing per-record scorer (never replaced), minus transparent
 * penalties for overdue receivables (the W1 aging engine, reused), overdue
 * activities (W2.2), and expired contracts (W2.3), with open weighted pipeline
 * (W2.1) surfaced alongside. CRUD, RBAC (`crm:read` / `crm:manage`), audit,
 * timeline, search, offline persistence, and the entire list/detail/form UI
 * are all inherited.
 *
 * Registers are IMMUTABLE (the `generatedAt` marker refuses edits) and never
 * superseded — the sequence of registers is how account health TRENDS. Every
 * row carries its reasons: the score is explainable arithmetic, never a vibe.
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
  CUSTOMER_HEALTH_MODULE_ID,
  CUSTOMER_HEALTH_KIND,
  activityFromRecord,
  contractFromRecord,
  customerFromRecord,
  deriveCustomerHealthRegister,
  invoiceFromRecord,
  opportunityFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a health register — drives store, CRUD, and the UI. */
export const CUSTOMER_HEALTH_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CUSTOMER_HEALTH_MODULE_ID,
  title: 'Customer Health',
  singular: 'Health Register',
  plural: 'Health Registers',
  icon: 'heart',
  description:
    'Immutable cross-module customer health registers — receivables, activities, pipeline, and contracts behind one explainable score.',
  group: 'CRM',
  titleField: 'reportNumber',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'customerCount', label: 'Customers', type: 'number', readOnly: true, default: 0 },
    { key: 'atRisk', label: 'At Risk', type: 'number', readOnly: true, default: 0 },
    { key: 'watch', label: 'Watch', type: 'number', readOnly: true, default: 0 },
    { key: 'healthy', label: 'Healthy', type: 'number', readOnly: true, default: 0 },
    { key: 'totalOpenAr', label: 'Open AR', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalPipelineWeighted', label: 'Weighted Pipeline', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'rows', label: 'Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Customer Health module. Customer + Invoice + Opportunity +
 * Activity + Contract stores are injected so generation reads real records.
 */
export function createCustomerHealthModule(
  storePath: string,
  customerStore: EnterpriseRecordStore,
  invoiceStore: EnterpriseRecordStore,
  opportunityStore: EnterpriseRecordStore,
  activityStore: EnterpriseRecordStore,
  contractStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CUSTOMER_HEALTH_MODULE_ID, CUSTOMER_HEALTH_KIND);
  return defineEnterpriseModule({
    descriptor: CUSTOMER_HEALTH_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CUSTOMER_HEALTH_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Health registers are immutable snapshots — generate a new register instead.' },
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
        const register = deriveCustomerHealthRegister(
          customerStore.list().map(customerFromRecord),
          invoiceStore.list().map(invoiceFromRecord),
          opportunityStore.list().map(opportunityFromRecord),
          activityStore.list().map(activityFromRecord),
          contractStore.list().map(contractFromRecord),
          asOfMs,
        );
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `CH-${asOfDate}-${priorCount + 1}`;
        result.values.customerCount = register.customerCount;
        result.values.atRisk = register.atRisk;
        result.values.watch = register.watch;
        result.values.healthy = register.healthy;
        result.values.totalOpenAr = register.totalOpenAr;
        result.values.totalPipelineWeighted = register.totalPipelineWeighted;
        result.values.rows = JSON.stringify(register.rows);
        result.values.note =
          register.customerCount === 0
            ? 'no non-archived customers at the as-of date — the register is empty, not fabricated'
            : `base = existing per-record health; penalties: overdue AR −25, overdue activities −15, expired contracts −20; finance/quotes matched by name, activities/contracts by id`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const atRisk = Number(f.atRisk ?? 0);
        return {
          moduleId: CUSTOMER_HEALTH_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${atRisk} at risk of ${Number(f.customerCount ?? 0)}`,
          summary: `As of ${str(f.asOfDate)}: ${atRisk} at-risk, ${Number(f.watch ?? 0)} watch, ${Number(f.healthy ?? 0)} healthy — ${Number(f.totalOpenAr ?? 0).toLocaleString('en-US')} open AR, ${Number(f.totalPipelineWeighted ?? 0).toLocaleString('en-US')} weighted pipeline. ${str(f.note)}.`,
          risk: atRisk > 0 ? 'medium' : 'low',
          riskReason: atRisk > 0 ? 'At-risk accounts need an owner and a plan this week.' : 'No at-risk accounts on this register.',
          executiveExplanation:
            'Health registers are immutable cross-module snapshots — every score is explainable arithmetic over receivables, activities, pipeline, and contracts; the register sequence is the trend.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

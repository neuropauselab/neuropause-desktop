/**
 * HR → Payroll Register — the management summary snapshot over posted payroll
 * runs on the Enterprise Module Framework (W6-A6). CRUD (generate + read),
 * RBAC (`operations:read` / `operations:manage` — the HR family's certified
 * scopes), audit, timeline, search, offline persistence, and the UI are all
 * inherited.
 *
 * CREATING a register generates it: the validate hook filters the injected
 * payroll-run store to the POSTED runs of the chosen period, parses their
 * processed detail, and aggregates per employee via the pure
 * `derivePayrollRegister`. A generated register is immutable (the `generatedAt`
 * marker, the W1 snapshot pattern); the register sequence for a period is the
 * trend of what was reported when. Runs with no processed detail (pre-W6
 * accruals) are counted and named, never silently included as zeros.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  StatutoryPayrollRun,
} from '@neuropause/shared';
import {
  PAYROLL_REGISTER_MODULE_ID,
  PAYROLL_REGISTER_KIND,
  derivePayrollRegister,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a payroll register — drives store, CRUD, and the UI. */
export const PAYROLL_REGISTER_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PAYROLL_REGISTER_MODULE_ID,
  title: 'Payroll Register',
  singular: 'Payroll Register',
  plural: 'Payroll Registers',
  icon: 'table',
  description:
    'Immutable management summary of a period’s posted payroll — per-employee gross, deductions, net, employer cost, with column totals.',
  group: 'HR',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'employeeCount', label: 'Employees', type: 'number', readOnly: true, default: 0 },
    { key: 'statutoryCount', label: 'Statutory', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'flatCount', label: 'Flat', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'totalGross', label: 'Gross', type: 'number', readOnly: true, format: 'currency' },
    { key: 'totalNet', label: 'Net', type: 'number', readOnly: true, format: 'currency' },
    { key: 'totalPfEmployee', label: 'PF (employee)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalEsiEmployee', label: 'ESI (employee)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalPt', label: 'Professional Tax', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalTds', label: 'TDS', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalContractual', label: 'Other Deductions', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalEmployerPf', label: 'PF (employer)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'totalEmployerEsi', label: 'ESI (employer)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'rowsJson', label: 'Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Payroll Register module. The payroll-run store is injected so
 * generation reads the real posted runs — the register never invents figures.
 */
export function createPayrollRegisterModule(
  storePath: string,
  payrollRunStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYROLL_REGISTER_MODULE_ID, PAYROLL_REGISTER_KIND);
  return defineEnterpriseModule({
    descriptor: PAYROLL_REGISTER_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PAYROLL_REGISTER_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Payroll registers are immutable snapshots — generate a new register instead.' },
            values: result.values,
          };
        }
        const periodKey = str(result.values.periodKey).trim();
        if (!isGlPeriodKey(periodKey)) {
          return {
            ok: false,
            errors: { periodKey: 'Period must be a valid month (YYYY-MM).' },
            values: result.values,
          };
        }
        const postedForPeriod = payrollRunStore
          .list()
          .filter((r) => str(r.fields.status) === 'posted' && str(r.fields.periodKey) === periodKey);
        const runs: StatutoryPayrollRun[] = [];
        let skippedNoDetail = 0;
        for (const r of postedForPeriod) {
          const raw = str(r.fields.statutoryJson);
          if (!raw) {
            skippedNoDetail += 1;
            continue;
          }
          try {
            runs.push(JSON.parse(raw) as StatutoryPayrollRun);
          } catch {
            skippedNoDetail += 1;
          }
        }
        const register = derivePayrollRegister(runs);
        const priorCount = store.list().filter((r) => str(r.fields.periodKey) === periodKey).length;
        result.values.reportNumber = `PR-${periodKey}-${priorCount + 1}`;
        result.values.employeeCount = register.employeeCount;
        result.values.statutoryCount = register.statutoryCount;
        result.values.flatCount = register.flatCount;
        result.values.totalGross = register.totalGross;
        result.values.totalNet = register.totalNet;
        result.values.totalPfEmployee = register.totalPfEmployee;
        result.values.totalEsiEmployee = register.totalEsiEmployee;
        result.values.totalPt = register.totalPt;
        result.values.totalTds = register.totalTds;
        result.values.totalContractual = register.totalContractual;
        result.values.totalEmployerPf = register.totalEmployerPf;
        result.values.totalEmployerEsi = register.totalEmployerEsi;
        result.values.rowsJson = JSON.stringify(register.rows);
        result.values.note =
          register.employeeCount === 0
            ? postedForPeriod.length === 0
              ? `no posted payroll run for ${periodKey} — the register is empty, not fabricated`
              : `posted run(s) for ${periodKey} carry no processed detail — nothing to aggregate`
            : `aggregated ${register.runCount} posted run(s): ${register.statutoryCount} statutory, ${register.flatCount} flat` +
              (skippedNoDetail > 0 ? `; skipped ${skippedNoDetail} run(s) with no processed detail (pre-W6)` : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const empty = Number(f.employeeCount ?? 0) === 0;
        return {
          moduleId: PAYROLL_REGISTER_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · ${Number(f.employeeCount ?? 0)} employee(s) · net ${Number(f.totalNet ?? 0).toLocaleString('en-US')}`,
          summary:
            `${str(f.periodKey)}: gross ${Number(f.totalGross ?? 0).toLocaleString('en-US')}, net ${Number(f.totalNet ?? 0).toLocaleString('en-US')} across ${Number(f.employeeCount ?? 0)} employee(s). ` +
            `Statutory withheld — PF ${Number(f.totalPfEmployee ?? 0).toLocaleString('en-US')}, ESI ${Number(f.totalEsiEmployee ?? 0).toLocaleString('en-US')}, PT ${Number(f.totalPt ?? 0).toLocaleString('en-US')}, TDS ${Number(f.totalTds ?? 0).toLocaleString('en-US')}. ${str(f.note)}.`,
          risk: empty ? 'medium' : 'low',
          riskReason: empty
            ? 'An empty register means payroll has not been posted for this period yet.'
            : 'A frozen aggregate of the period’s posted runs — the figures reconcile to the ledger.',
          executiveExplanation:
            'The payroll register is the immutable management summary finance signs off before disbursement and statutory filing; its sequence per period is the reporting trend.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

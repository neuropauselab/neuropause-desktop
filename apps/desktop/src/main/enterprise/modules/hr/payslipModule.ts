/**
 * HR → Payslips — immutable per-employee pay statements on the Enterprise
 * Module Framework (W6-A5). CRUD (read-mostly), RBAC (`operations:read` /
 * `operations:manage` — the HR family's certified scopes), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * Payslips are GENERATED, not hand-authored: the payroll run's `Generate
 * Payslips` action builds one record per employee from the posted run's
 * computed line (idempotent) and stamps `generatedAt` at creation. This
 * module's validate therefore exists to FREEZE them — any edit to a record
 * carrying `generatedAt` is refused, the W1 snapshot-immutability pattern.
 * A payslip re-computes nothing; it is a faithful record of what one run paid.
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
  PAYSLIPS_MODULE_ID,
  PAYSLIP_KIND,
  formatPayslipText,
  payslipFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a payslip — drives store, CRUD, and the UI. */
export const PAYSLIP_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PAYSLIPS_MODULE_ID,
  title: 'Payslips',
  singular: 'Payslip',
  plural: 'Payslips',
  icon: 'file-text',
  description:
    'Immutable per-employee pay statements generated from posted payroll runs — itemized earnings and deductions, net pay, employer cost.',
  group: 'HR',
  titleField: 'payslipNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'payslipNumber', label: 'Payslip #', type: 'text', readOnly: true },
    { key: 'employeeName', label: 'Employee', type: 'text', readOnly: true },
    { key: 'employeeNumber', label: 'Employee #', type: 'text', readOnly: true, column: false },
    { key: 'employee', label: 'Employee Ref', type: 'text', readOnly: true, column: false },
    { key: 'periodKey', label: 'Period', type: 'text', readOnly: true },
    { key: 'runNumber', label: 'Run #', type: 'text', readOnly: true, column: false },
    { key: 'mode', label: 'Mode', type: 'text', readOnly: true, column: false },
    { key: 'grossEarnings', label: 'Gross', type: 'number', readOnly: true, format: 'currency' },
    { key: 'totalDeductions', label: 'Deductions', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'netPay', label: 'Net Pay', type: 'number', readOnly: true, format: 'currency' },
    { key: 'earningsJson', label: 'Earnings', type: 'textarea', readOnly: true, column: false },
    { key: 'deductionsJson', label: 'Deductions Detail', type: 'textarea', readOnly: true, column: false },
    { key: 'pfEmployee', label: 'PF (employee)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'esiEmployee', label: 'ESI (employee)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'professionalTax', label: 'Professional Tax', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'tds', label: 'TDS', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'contractualTotal', label: 'Other Deductions', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'pfEmployer', label: 'PF (employer)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'esiEmployer', label: 'ESI (employer)', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'ptSkipped', label: 'PT Skipped', type: 'boolean', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'issued',
      badge: true,
      filterable: true,
      options: [{ value: 'issued', label: 'Issued', tone: 'green' }],
    },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Payslips module — a frozen archive; the run generates its records. */
export function createPayslipModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYSLIPS_MODULE_ID, PAYSLIP_KIND);
  return defineEnterpriseModule({
    descriptor: PAYSLIP_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PAYSLIP_DESCRIPTOR, input);
        if (!result.ok) return result;
        // A generated payslip is immutable — the merged-input marker guard.
        if (str(input.fields?.generatedAt)) {
          return {
            ok: false,
            errors: { status: 'Payslips are immutable — regenerate from the payroll run instead of editing.' },
            values: result.values,
          };
        }
        result.values.status = 'issued';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const payslip = payslipFromRecord(record);
        return {
          moduleId: PAYSLIPS_MODULE_ID,
          recordId: record.id,
          headline: `${payslip.payslipNumber} · ${payslip.periodKey} · net ${payslip.netPay.toLocaleString('en-US')}`,
          summary:
            `${payslip.employeeName} — gross ${payslip.grossEarnings.toLocaleString('en-US')}, ` +
            `deductions ${payslip.totalDeductions.toLocaleString('en-US')}, net ${payslip.netPay.toLocaleString('en-US')} for ${payslip.periodKey}. ` +
            formatPayslipText(payslip).split('\n').slice(4).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200),
          risk: 'low',
          riskReason: 'A payslip is a frozen record of one posted run — it recomputes nothing.',
          executiveExplanation:
            'Payslips are immutable snapshots generated from posted payroll; employer contributions are shown as cost, never deducted from the employee.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

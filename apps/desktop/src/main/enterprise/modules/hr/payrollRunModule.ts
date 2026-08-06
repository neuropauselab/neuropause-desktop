/**
 * HR → Payroll Runs — Payroll LITE on the Enterprise Module Framework (W4.4).
 * CRUD, RBAC (`operations:read` / `operations:manage`), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * CREATING a run PREVIEWS it deterministically: every ACTIVE employee with a
 * positive monthly salary, gathered by the pure `derivePayrollRun` engine
 * (zero-salary actives counted as unpaid, stated). `Post` books the ACCRUAL
 * into the real W1 General Ledger through the `applyGlDerivedEntries` seam —
 * Dr Salaries Expense (5300) / Cr Salaries Payable (2200), idempotent
 * `JE-PAYROLL-<period>` entry, closed-period guards inherited from the
 * journal's own post action. The two payroll accounts are ENSURED (created if
 * missing) through the Ledger Accounts module before posting.
 *
 * LITE, stated honestly: statutory payroll (PF/ESI/TDS) and salary
 * DISBURSEMENT (Dr Payable / Cr Cash) are deliberately out of scope — named,
 * never faked. One run per month; posted runs are immutable history.
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
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYROLL_EXPENSE_ACCOUNT,
  PAYROLL_LIABILITY_ACCOUNT,
  PAYROLL_RUNS_MODULE_ID,
  PAYROLL_RUN_KIND,
  derivePayrollRun,
  deriveRecordTitle,
  employeeFromRecord,
  isGlPeriodKey,
  payrollAccrualLines,
  payrollEntryNumber,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { applyGlDerivedEntries } from '../finance/glPosting';

/** The descriptor action key the Payroll Runs module surfaces. */
export const POST_PAYROLL_ACTION = 'post';

/** The declarative description of a payroll run — drives store, CRUD, and the UI. */
export const PAYROLL_RUN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PAYROLL_RUNS_MODULE_ID,
  title: 'Payroll Runs',
  singular: 'Payroll Run',
  plural: 'Payroll Runs',
  icon: 'wallet',
  description:
    'Monthly payroll accruals — active salaried employees previewed on create, posted into the real General Ledger.',
  group: 'HR',
  titleField: 'runNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: POST_PAYROLL_ACTION, label: 'Post to GL', icon: 'check' }],
  fields: [
    { key: 'runNumber', label: 'Run #', type: 'text', readOnly: true },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'employeeCount', label: 'Employees', type: 'number', readOnly: true, default: 0 },
    { key: 'totalGross', label: 'Gross', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'unsalariedCount', label: 'Unsalaried', type: 'number', readOnly: true, default: 0, column: false },
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
        { value: 'posted', label: 'Posted', tone: 'green' },
      ],
    },
    { key: 'postedAt', label: 'Posted At', type: 'text', readOnly: true, column: false },
    { key: 'journalEntry', label: 'Journal Entry', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Ensure the payroll accrual accounts exist — created through the module, once. */
async function ensurePayrollAccounts(ctx: EnterpriseModuleActionContext): Promise<boolean> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return false;
  await accounts.store.load();
  for (const def of [PAYROLL_EXPENSE_ACCOUNT, PAYROLL_LIABILITY_ACCOUNT]) {
    const exists = accounts.store.list().some((r) => str(r.fields.code) === def.code);
    if (exists) continue;
    const validation = accounts.hooks.validate({
      fields: { code: def.code, name: def.name, type: def.type, currency: 'USD' },
    });
    if (!validation.ok) return false;
    const record = accounts.store.create({
      title: deriveRecordTitle(accounts.descriptor, validation.values),
      fields: validation.values,
      actor: ctx.actor(),
      now: ctx.now(),
    });
    ctx.emit(accounts, 'created', record);
  }
  return true;
}

/**
 * Build the Payroll Runs module. The Employees store backs the preview; the
 * GL posting goes through the runtime action context (the W1 seam).
 */
export function createPayrollRunModule(
  storePath: string,
  employeeStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYROLL_RUNS_MODULE_ID, PAYROLL_RUN_KIND);
  return defineEnterpriseModule({
    descriptor: PAYROLL_RUN_DESCRIPTOR,
    store,
    hooks: {
      // Creating a run IS previewing it; a posted run is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PAYROLL_RUN_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.postedAt)) {
          return {
            ok: false,
            errors: { status: 'This run has posted its accrual — posted runs are immutable payroll history.' },
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
        // One run per month — re-running requires deleting the unposted preview.
        const duplicate = store
          .list()
          .some((r) => str(r.fields.periodKey) === periodKey && str(r.fields.postedAt));
        if (duplicate) {
          return {
            ok: false,
            errors: { periodKey: `Payroll for ${periodKey} is already posted — one accrual per month.` },
            values: result.values,
          };
        }
        const run = derivePayrollRun(employeeStore.list().map(employeeFromRecord));
        const priorCount = store.list().filter((r) => str(r.fields.periodKey) === periodKey).length;
        result.values.runNumber = `PAY-${periodKey}-${priorCount + 1}`;
        result.values.employeeCount = run.employeeCount;
        result.values.totalGross = run.totalGross;
        result.values.unsalariedCount = run.unsalariedCount;
        result.values.lines = JSON.stringify(run.lines);
        result.values.status = 'preview';
        result.values.note =
          run.employeeCount === 0
            ? 'no active salaried employees — the preview is empty, not fabricated'
            : `payroll LITE: gross accrual only; statutory deductions and disbursement are out of scope, stated` +
              (run.unsalariedCount > 0 ? `; ${run.unsalariedCount} active employee(s) have no salary set — unpaid by this run` : '');
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: PAYROLL_RUNS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.runNumber)} · ${str(f.status)} · gross ${Number(f.totalGross ?? 0).toLocaleString('en-US')}`,
          summary: `${str(f.periodKey)}: ${Number(f.employeeCount ?? 0)} employee(s), gross ${Number(f.totalGross ?? 0).toLocaleString('en-US')}. ${str(f.note)}.`,
          risk: Number(f.unsalariedCount ?? 0) > 0 ? 'medium' : 'low',
          riskReason:
            Number(f.unsalariedCount ?? 0) > 0
              ? 'Active employees without a salary are silently unpaid — set salaries and re-preview.'
              : 'Every active employee on this run carries a salary.',
          executiveExplanation:
            'Payroll runs accrue salaries into the real ledger (Dr Salaries Expense / Cr Salaries Payable); the payable clears when disbursement lands in a future wave.',
          grounded: false,
          model: 'none',
        };
      },
      // The real thing: ensure the accounts, book the accrual, freeze the run.
      runAction: async (action, record, actionCtx) => {
        if (action !== POST_PAYROLL_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const f = record.fields;
        if (str(f.postedAt)) return { ok: false, error: 'This run has already posted its accrual.' };
        const totalGross = Number(f.totalGross ?? 0);
        if (totalGross <= 0) return { ok: false, error: 'Nothing to post — the run gathered no salaried employees.' };
        const periodKey = str(f.periodKey);
        const ready = await ensurePayrollAccounts(actionCtx);
        if (!ready) return { ok: false, error: 'The Ledger Accounts module is not available to ensure the payroll accounts.' };
        await applyGlDerivedEntries(
          [
            {
              entryNumber: payrollEntryNumber(periodKey),
              memo: `Payroll accrual ${periodKey} — ${Number(f.employeeCount ?? 0)} employee(s), gross ${totalGross}`,
              lines: payrollAccrualLines(totalGross),
              sourceModule: PAYROLL_RUNS_MODULE_ID,
              sourceRef: record.id,
            },
          ],
          actionCtx,
        );
        store.update(record.id, {
          fields: { postedAt: actionCtx.now(), status: 'posted', journalEntry: payrollEntryNumber(periodKey) },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message: `Accrual ${payrollEntryNumber(periodKey)} posted — Dr Salaries Expense / Cr Salaries Payable ${totalGross}. Disbursement (Cr Cash) is a future wave, stated.`,
        };
      },
    },
  });
}

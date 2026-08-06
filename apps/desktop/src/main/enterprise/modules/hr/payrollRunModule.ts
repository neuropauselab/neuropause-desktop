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
 * W6-A3 (ADDITIVE): with the salary-structure + statutory-rule stores
 * injected, the preview becomes the FULL STATUTORY ENGINE — structure-assigned
 * employees get gross-to-net (PF/ESI/PT/TDS from the period's resolved
 * effective-dated rule set), legacy flat-salary employees stay on the W4
 * accrual path (counted + named, never silently mixed), and posting books one
 * BALANCED multi-line accrual across expenses and every statutory payable.
 * With structured employees present and NO rule set resolving, the run
 * REFUSES to preview — broken/missing tables block payroll loudly. Omitting
 * the new stores leaves every W4 behavior untouched. Salary DISBURSEMENT
 * (Dr Payable / Cr Cash) remains out of scope — named, never faked.
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
  DEDUCTIONS_PAYABLE_ACCOUNT,
  ESI_PAYABLE_ACCOUNT,
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYROLL_EMPLOYER_ESI_ACCOUNT,
  PAYROLL_EMPLOYER_PF_ACCOUNT,
  PAYROLL_EXPENSE_ACCOUNT,
  PAYROLL_LIABILITY_ACCOUNT,
  PAYROLL_RUNS_MODULE_ID,
  PAYROLL_RUN_KIND,
  PF_PAYABLE_ACCOUNT,
  PT_PAYABLE_ACCOUNT,
  TDS_PAYABLE_ACCOUNT,
  derivePayrollRun,
  deriveRecordTitle,
  deriveStatutoryPayrollRun,
  employeeFromRecord,
  isGlPeriodKey,
  parseSalaryComponents,
  payrollAccrualLines,
  payrollEntryNumber,
  resolveStatutoryRuleSet,
  statutoryAccrualLines,
  validateEnterpriseRecordInput,
  type SalaryComponent,
  type StatutoryPayrollRun,
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
    { key: 'totalNet', label: 'Net', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'statutoryCount', label: 'Statutory', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'flatCount', label: 'Flat', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'ruleSetCode', label: 'Rule Set', type: 'text', readOnly: true, column: false },
    { key: 'lines', label: 'Lines', type: 'textarea', readOnly: true, column: false },
    { key: 'statutoryJson', label: 'Statutory Detail', type: 'textarea', readOnly: true, column: false },
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
async function ensurePayrollAccounts(
  ctx: EnterpriseModuleActionContext,
  defs: ReadonlyArray<{ code: string; name: string; type: string }>,
): Promise<boolean> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return false;
  await accounts.store.load();
  for (const def of defs) {
    const exists = accounts.store.list().some((r) => str(r.fields.code) === def.code);
    if (exists) continue;
    const validation = accounts.hooks.validate({
      fields: { code: def.code, name: def.name, class: def.type, currency: 'USD' },
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
 * GL posting goes through the runtime action context (the W1 seam). The
 * OPTIONAL structure + statutory stores (W6-A3, additive) switch the preview
 * to the full statutory engine — omitting them preserves W4 exactly.
 */
export function createPayrollRunModule(
  storePath: string,
  employeeStore: EnterpriseRecordStore,
  structureStore?: EnterpriseRecordStore,
  statutoryStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PAYROLL_RUNS_MODULE_ID, PAYROLL_RUN_KIND);
  const structuresById = (): Map<string, SalaryComponent[]> => {
    const map = new Map<string, SalaryComponent[]>();
    if (!structureStore) return map;
    for (const r of structureStore.list()) {
      if (r.status === 'deleted') continue;
      map.set(r.id, parseSalaryComponents(r.fields.componentsJson).components);
    }
    return map;
  };
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
        const employees = employeeStore.list().map(employeeFromRecord);
        const priorCount = store.list().filter((r) => str(r.fields.periodKey) === periodKey).length;
        result.values.runNumber = `PAY-${periodKey}-${priorCount + 1}`;
        result.values.status = 'preview';
        if (structureStore && statutoryStore) {
          const anyStructured = employees.some((e) => !e.exitedAt && (e.salaryStructureRef ?? '') && (e.basicSalary ?? 0) > 0);
          const resolution = resolveStatutoryRuleSet(statutoryStore.list(), periodKey);
          if (anyStructured && !resolution.ruleSet) {
            return {
              ok: false,
              errors: {
                periodKey:
                  resolution.errors.length > 0
                    ? `The rule set governing ${periodKey} fails to parse — payroll refuses rather than paying wrong amounts: ${resolution.errors[0]}`
                    : `No statutory rule set covers ${periodKey} — create one (the verified seed is the default) before running payroll.`,
              },
              values: result.values,
            };
          }
          const run = deriveStatutoryPayrollRun(employees, structuresById(), resolution.ruleSet, periodKey);
          result.values.employeeCount = run.employeeCount;
          result.values.totalGross = run.totalGross;
          result.values.totalNet = run.totalNet;
          result.values.unsalariedCount = run.unsalariedCount;
          result.values.statutoryCount = run.statutoryCount;
          result.values.flatCount = run.flatCount;
          result.values.ruleSetCode = run.ruleSetCode ?? '';
          result.values.lines = JSON.stringify(run.lines.map((l) => ({ employee: l.employee, name: l.name, monthlySalary: l.gross })));
          result.values.statutoryJson = JSON.stringify(run);
          result.values.note =
            run.employeeCount === 0
              ? 'no active salaried employees — the preview is empty, not fabricated'
              : `${run.statutoryCount} statutory (rule set ${run.ruleSetCode ?? '—'}), ${run.flatCount} flat-legacy (no statutory computed, stated)` +
                (run.ptSkippedCount > 0 ? `; PT skipped on ${run.ptSkippedCount} line(s) — work state missing or not in the table` : '') +
                (run.unsalariedCount > 0 ? `; ${run.unsalariedCount} active employee(s) unpaid — no structure and no salary` : '');
          return result;
        }
        const run = derivePayrollRun(employees);
        result.values.employeeCount = run.employeeCount;
        result.values.totalGross = run.totalGross;
        result.values.unsalariedCount = run.unsalariedCount;
        result.values.lines = JSON.stringify(run.lines);
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
          summary:
            `${str(f.periodKey)}: ${Number(f.employeeCount ?? 0)} employee(s), gross ${Number(f.totalGross ?? 0).toLocaleString('en-US')}` +
            (Number(f.totalNet ?? 0) > 0 ? `, net ${Number(f.totalNet ?? 0).toLocaleString('en-US')}` : '') +
            `. ${str(f.note)}.`,
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
      // The real thing: ensure the accounts, book the balanced accrual, freeze the run.
      runAction: async (action, record, actionCtx) => {
        if (action !== POST_PAYROLL_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const f = record.fields;
        if (str(f.postedAt)) return { ok: false, error: 'This run has already posted its accrual.' };
        const totalGross = Number(f.totalGross ?? 0);
        if (totalGross <= 0) return { ok: false, error: 'Nothing to post — the run gathered no salaried employees.' };
        const periodKey = str(f.periodKey);
        let statutoryRun: StatutoryPayrollRun | null = null;
        if (str(f.statutoryJson)) {
          try {
            statutoryRun = JSON.parse(str(f.statutoryJson)) as StatutoryPayrollRun;
          } catch {
            return { ok: false, error: 'The stored statutory detail is unreadable — re-preview the run before posting.' };
          }
        }
        const statutory = statutoryRun !== null && statutoryRun.statutoryCount > 0;
        const accountDefs = statutory
          ? [
              PAYROLL_EXPENSE_ACCOUNT, PAYROLL_LIABILITY_ACCOUNT, PAYROLL_EMPLOYER_PF_ACCOUNT, PAYROLL_EMPLOYER_ESI_ACCOUNT,
              PF_PAYABLE_ACCOUNT, ESI_PAYABLE_ACCOUNT, PT_PAYABLE_ACCOUNT, TDS_PAYABLE_ACCOUNT, DEDUCTIONS_PAYABLE_ACCOUNT,
            ]
          : [PAYROLL_EXPENSE_ACCOUNT, PAYROLL_LIABILITY_ACCOUNT];
        const ready = await ensurePayrollAccounts(actionCtx, accountDefs);
        if (!ready) return { ok: false, error: 'The Ledger Accounts module is not available to ensure the payroll accounts.' };
        const lines = statutory
          ? statutoryAccrualLines(statutoryRun!, PAYROLL_EXPENSE_ACCOUNT.code, PAYROLL_LIABILITY_ACCOUNT.code)
          : payrollAccrualLines(totalGross);
        await applyGlDerivedEntries(
          [
            {
              entryNumber: payrollEntryNumber(periodKey),
              memo: statutory
                ? `Statutory payroll accrual ${periodKey} — ${Number(f.employeeCount ?? 0)} employee(s), gross ${totalGross}, net ${Number(f.totalNet ?? 0)}, rule set ${str(f.ruleSetCode) || '—'}`
                : `Payroll accrual ${periodKey} — ${Number(f.employeeCount ?? 0)} employee(s), gross ${totalGross}`,
              lines,
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
          message: statutory
            ? `Accrual ${payrollEntryNumber(periodKey)} posted BALANCED across ${lines.length} line(s) — gross + employer contributions vs net payable + PF/ESI/PT/TDS/deduction payables. Disbursement clears 2200 in W6-A4.`
            : `Accrual ${payrollEntryNumber(periodKey)} posted — Dr Salaries Expense / Cr Salaries Payable ${totalGross}. Disbursement (Cr Cash) is a future wave, stated.`,
        };
      },
    },
  });
}

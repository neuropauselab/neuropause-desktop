/**
 * HR → Salary Disbursement — clearing the net-pay liability + emitting bank
 * advice, on the Enterprise Module Framework (W6-A4). CRUD, RBAC
 * (`operations:read` / `operations:manage` — the HR family's certified
 * scopes), audit, timeline, search, offline persistence, and the UI are all
 * inherited.
 *
 * A disbursement references a POSTED payroll run, reads its net-pay lines,
 * matches each to the employee's CURRENT bank details, and previews the
 * generic NEFT advice + the banked total. `Disburse` books the balanced
 * clearing entry Dr Salaries Payable (2200) / Cr Cash — idempotent
 * `JE-DISBURSE-<runNumber>` — for the BANKED total only; employees with no
 * complete bank details stay in the payable (owed, not paid, counted). No
 * bank API exists here: the advice is a file a human uploads — stated, never
 * faked. Disbursed records are immutable history (the W1 marker pattern).
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
  DEFAULT_DISBURSEMENT_CASH_CODE,
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYROLL_LIABILITY_ACCOUNT,
  SALARIES_PAYABLE_CODE,
  SALARY_DISBURSEMENTS_MODULE_ID,
  SALARY_DISBURSEMENT_KIND,
  deriveBankAdvice,
  deriveRecordTitle,
  disbursementClearingLines,
  disbursementEntryNumber,
  formatBankAdvice,
  type BankAdvice,
  type EmployeeBankDetails,
  type StatutoryPayrollRun,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { applyGlDerivedEntries } from '../finance/glPosting';

/** The descriptor action key the Salary Disbursements module surfaces. */
export const DISBURSE_ACTION = 'disburse';

/** The Cash account disbursement funds from, when the default code is used. */
const CASH_ACCOUNT = { code: DEFAULT_DISBURSEMENT_CASH_CODE, name: 'Cash', type: 'asset' } as const;

/** The declarative description of a disbursement — drives store, CRUD, and the UI. */
export const SALARY_DISBURSEMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SALARY_DISBURSEMENTS_MODULE_ID,
  title: 'Salary Disbursements',
  singular: 'Salary Disbursement',
  plural: 'Salary Disbursements',
  icon: 'bank',
  description:
    'Clears a posted payroll run’s net pay — banked beneficiaries paid Dr Payable / Cr Cash, generic NEFT advice generated, unbanked held.',
  group: 'HR',
  titleField: 'disbursementNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: DISBURSE_ACTION, label: 'Disburse', icon: 'upload' }],
  fields: [
    { key: 'disbursementNumber', label: 'Disbursement #', type: 'text', readOnly: true },
    { key: 'payrollRunRef', label: 'Payroll Run', type: 'text', required: true, placeholder: 'Run number or id (must be posted)' },
    { key: 'creditAccount', label: 'Funding Account', type: 'text', default: DEFAULT_DISBURSEMENT_CASH_CODE, column: false, placeholder: '1000 (Cash)' },
    { key: 'valueDate', label: 'Value Date', type: 'date', format: 'date', column: false },
    { key: 'runNumber', label: 'Run #', type: 'text', readOnly: true, column: false },
    { key: 'periodKey', label: 'Period', type: 'text', readOnly: true },
    { key: 'totalDisbursable', label: 'Disbursable', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'bankedCount', label: 'Banked', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'unbankedCount', label: 'Held', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'unbankedNet', label: 'Held Amount', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'adviceJson', label: 'Advice (data)', type: 'textarea', readOnly: true, column: false },
    { key: 'bankAdvice', label: 'Bank Advice', type: 'textarea', readOnly: true, column: false },
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
        { value: 'disbursed', label: 'Disbursed', tone: 'green' },
      ],
    },
    { key: 'disbursedAt', label: 'Disbursed At', type: 'text', readOnly: true, column: false },
    { key: 'journalEntry', label: 'Journal Entry', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the live employee-id → current bank-details map from the employee store. */
function bankDetailsByEmployee(employeeStore: EnterpriseRecordStore): Map<string, EmployeeBankDetails> {
  const map = new Map<string, EmployeeBankDetails>();
  for (const r of employeeStore.list()) {
    if (r.status === 'deleted') continue;
    map.set(r.id, {
      accountNumber: str(r.fields.bankAccountNumber),
      ifsc: str(r.fields.bankIfsc),
      bankName: str(r.fields.bankName),
    });
  }
  return map;
}

/** Parse a run record's processed detail; null when absent/unreadable. */
function statutoryRunOf(record: { fields: Record<string, unknown> } | null): StatutoryPayrollRun | null {
  if (!record) return null;
  const raw = str(record.fields.statutoryJson);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StatutoryPayrollRun;
  } catch {
    return null;
  }
}

/** Ensure the two clearing accounts exist — created through the module, once. */
async function ensureClearingAccounts(
  ctx: EnterpriseModuleActionContext,
  defs: ReadonlyArray<{ code: string; name: string; type: string }>,
): Promise<boolean> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return false;
  await accounts.store.load();
  for (const def of defs) {
    if (accounts.store.list().some((r) => str(r.fields.code) === def.code)) continue;
    const validation = accounts.hooks.validate({
      fields: { code: def.code, name: def.name, class: def.type, currency: 'INR' },
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
 * Build the Salary Disbursements module. The payroll-run store resolves the
 * referenced run; the employee store supplies current bank details. GL posting
 * flows through the runtime action context (the W1 seam).
 */
export function createSalaryDisbursementModule(
  storePath: string,
  payrollRunStore: EnterpriseRecordStore,
  employeeStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SALARY_DISBURSEMENTS_MODULE_ID, SALARY_DISBURSEMENT_KIND);

  const findRun = (ref: string) => {
    if (!ref) return null;
    const byId = payrollRunStore.get(ref);
    if (byId && byId.status !== 'deleted') return byId;
    return payrollRunStore.list().find((r) => str(r.fields.runNumber) === ref) ?? null;
  };

  return defineEnterpriseModule({
    descriptor: SALARY_DISBURSEMENT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SALARY_DISBURSEMENT_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.disbursedAt)) {
          return {
            ok: false,
            errors: { status: 'This disbursement has posted — disbursed records are immutable payroll history.' },
            values: result.values,
          };
        }
        const ref = str(result.values.payrollRunRef).trim();
        const runRecord = findRun(ref);
        if (!runRecord) {
          return { ok: false, errors: { payrollRunRef: `No payroll run matches "${ref}".` }, values: result.values };
        }
        if (str(runRecord.fields.status) !== 'posted') {
          return {
            ok: false,
            errors: { payrollRunRef: 'Only a POSTED payroll run can be disbursed — post its accrual first.' },
            values: result.values,
          };
        }
        const run = statutoryRunOf(runRecord);
        if (!run) {
          return {
            ok: false,
            errors: { payrollRunRef: 'This run has no processed detail (pre-W6 accrual) — it cannot be disbursed through bank advice.' },
            values: result.values,
          };
        }
        const runNumber = str(runRecord.fields.runNumber);
        // One disbursement per run — a second disbursed record would double-pay.
        const already = store
          .list()
          .some((r) => str(r.fields.runNumber) === runNumber && str(r.fields.disbursedAt));
        if (already) {
          return {
            ok: false,
            errors: { payrollRunRef: `Run ${runNumber} is already disbursed — one disbursement per run.` },
            values: result.values,
          };
        }
        const advice = deriveBankAdvice(run, bankDetailsByEmployee(employeeStore));
        const periodKey = str(runRecord.fields.periodKey);
        const priorCount = store.list().filter((r) => str(r.fields.runNumber) === runNumber).length;
        result.values.disbursementNumber = `DISB-${runNumber}-${priorCount + 1}`;
        result.values.runNumber = runNumber;
        result.values.periodKey = periodKey;
        result.values.totalDisbursable = advice.totalDisbursable;
        result.values.bankedCount = advice.bankedCount;
        result.values.unbankedCount = advice.unbankedCount;
        result.values.unbankedNet = advice.unbankedNet;
        result.values.adviceJson = JSON.stringify(advice);
        result.values.creditAccount = str(result.values.creditAccount).trim() || DEFAULT_DISBURSEMENT_CASH_CODE;
        result.values.bankAdvice = formatBankAdvice(advice, {
          runNumber,
          periodKey,
          valueDate: str(result.values.valueDate) || periodKey,
          debitAccount: SALARIES_PAYABLE_CODE,
          creditAccount: str(result.values.creditAccount),
        });
        result.values.status = 'preview';
        result.values.note =
          advice.bankedCount === 0
            ? `nothing to disburse — ${advice.unbankedCount} beneficiary(ies) held for missing bank details`
            : `${advice.bankedCount} beneficiary(ies) banked` +
              (advice.unbankedCount > 0 ? `; ${advice.unbankedCount} held (${advice.unbankedNet}) — left in the payable, not paid` : '');
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const disbursed = Boolean(str(f.disbursedAt));
        const held = Number(f.unbankedCount ?? 0);
        return {
          moduleId: SALARY_DISBURSEMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.disbursementNumber)} · ${str(f.status)} · ${Number(f.totalDisbursable ?? 0).toLocaleString('en-US')} to ${Number(f.bankedCount ?? 0)}`,
          summary:
            `Run ${str(f.runNumber)} (${str(f.periodKey)}): ${Number(f.bankedCount ?? 0)} banked for ${Number(f.totalDisbursable ?? 0).toLocaleString('en-US')}` +
            (held > 0 ? `, ${held} held (${Number(f.unbankedNet ?? 0).toLocaleString('en-US')}) awaiting bank details` : '') +
            `. ${str(f.note)}.`,
          risk: held > 0 && !disbursed ? 'medium' : 'low',
          riskReason:
            held > 0
              ? 'Held beneficiaries stay owed in Salaries Payable until their bank details are captured and a follow-up disbursement runs.'
              : 'Every net-paid employee on this run has complete bank details.',
          executiveExplanation:
            'Disbursement clears the net-pay liability (Dr Salaries Payable / Cr Cash) for banked employees and emits the bank advice; NeuroPause generates the file, a human uploads it — there is no bank API here, stated.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== DISBURSE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const f = record.fields;
        if (str(f.disbursedAt)) return { ok: false, error: 'This disbursement has already posted.' };
        let advice: BankAdvice;
        try {
          advice = JSON.parse(str(f.adviceJson)) as BankAdvice;
        } catch {
          return { ok: false, error: 'The stored advice is unreadable — re-preview the disbursement before posting.' };
        }
        if (advice.totalDisbursable <= 0) {
          return {
            ok: false,
            error: `Nothing to disburse — ${advice.unbankedCount} beneficiary(ies) are held for missing bank details. Capture their bank accounts first.`,
          };
        }
        const runNumber = str(f.runNumber);
        const creditAccount = str(f.creditAccount) || DEFAULT_DISBURSEMENT_CASH_CODE;
        const defs: Array<{ code: string; name: string; type: string }> = [
          { code: PAYROLL_LIABILITY_ACCOUNT.code, name: PAYROLL_LIABILITY_ACCOUNT.name, type: PAYROLL_LIABILITY_ACCOUNT.type },
        ];
        if (creditAccount === CASH_ACCOUNT.code) defs.push({ code: CASH_ACCOUNT.code, name: CASH_ACCOUNT.name, type: CASH_ACCOUNT.type });
        const ready = await ensureClearingAccounts(actionCtx, defs);
        if (!ready) return { ok: false, error: 'The Ledger Accounts module is not available to ensure the clearing accounts.' };
        await applyGlDerivedEntries(
          [
            {
              entryNumber: disbursementEntryNumber(runNumber),
              memo: `Salary disbursement ${runNumber} — ${advice.bankedCount} beneficiary(ies), ${advice.totalDisbursable} cleared` +
                (advice.unbankedCount > 0 ? `; ${advice.unbankedCount} held` : ''),
              lines: disbursementClearingLines(advice.totalDisbursable, SALARIES_PAYABLE_CODE, creditAccount),
              sourceModule: SALARY_DISBURSEMENTS_MODULE_ID,
              sourceRef: record.id,
            },
          ],
          actionCtx,
        );
        store.update(record.id, {
          fields: { disbursedAt: actionCtx.now(), status: 'disbursed', journalEntry: disbursementEntryNumber(runNumber) },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message:
            `Disbursed ${advice.totalDisbursable} to ${advice.bankedCount} beneficiary(ies) — ${disbursementEntryNumber(runNumber)} posted Dr Salaries Payable / Cr ${creditAccount}. ` +
            (advice.unbankedCount > 0 ? `${advice.unbankedCount} held in the payable. ` : '') +
            'Bank advice is ready to upload — NeuroPause does not transmit to the bank, stated.',
        };
      },
    },
  });
}

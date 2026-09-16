/**
 * HR → Expense Claims — employee reimbursements on the Enterprise Module
 * Framework (FW-3). CRUD, RBAC (`operations:read` / `operations:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one out-of-pocket claim. Lifecycle is human-in-the-loop:
 * submitted → approved | rejected via explicit actions. APPROVING is the real
 * thing — it books the accrual into the W1 General Ledger through the same
 * seam payroll uses (`applyGlDerivedEntries`): Dr Employee Expenses (5330) /
 * Cr Expense Claims Payable (2260), idempotent `JE-EXP-<claim#>` entry, with
 * both accounts ENSURED first. A decided claim is immutable history.
 *
 * Boundary stated: reimbursement disbursement (Dr 2260 / Cr Cash) is a named
 * future wave — the payable stands visible in the ledger until then.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordValidation,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  EMPLOYEE_EXPENSES_ACCOUNT,
  EXPENSE_CATEGORIES,
  EXPENSE_CLAIM_KIND,
  EXPENSE_CLAIMS_MODULE_ID,
  EXPENSE_CLAIMS_PAYABLE_ACCOUNT,
  LEDGER_ACCOUNTS_MODULE_ID,
  deriveRecordTitle,
  expenseAccrualLines,
  expenseEntryNumber,
  normalizeClaimAmount,
  parseLeaveDate,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';
import { applyGlDerivedEntries } from '../finance/glPosting';

/** The descriptor action keys — approval posts the accrual; both are audited. */
export const APPROVE_CLAIM_ACTION = 'approve';
export const REJECT_CLAIM_ACTION = 'reject';

/** The declarative description of an expense claim — drives store, CRUD, and the UI. */
export const EXPENSE_CLAIM_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: EXPENSE_CLAIMS_MODULE_ID,
  title: 'Expense Claims',
  singular: 'Expense Claim',
  plural: 'Expense Claims',
  icon: 'wallet',
  description:
    'Employee out-of-pocket claims — approval books a real Dr Employee Expenses / Cr Claims Payable accrual, idempotent per claim.',
  group: 'HR',
  titleField: 'claimNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: APPROVE_CLAIM_ACTION, label: 'Approve & Post', icon: 'check' },
    { key: REJECT_CLAIM_ACTION, label: 'Reject', icon: 'x' },
  ],
  fields: [
    { key: 'claimNumber', label: 'Claim #', type: 'text', readOnly: true },
    { key: 'employee', label: 'Employee', type: 'text', required: true, placeholder: 'employee record id' },
    { key: 'employeeName', label: 'Name', type: 'text', readOnly: true },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      required: true,
      default: 'travel',
      filterable: true,
      options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) })),
    },
    { key: 'expenseDate', label: 'Expense Date', type: 'text', required: true, placeholder: '2026-08-05' },
    { key: 'amount', label: 'Amount', type: 'number', required: true, format: 'currency' },
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'receiptRef', label: 'Receipt Ref', type: 'text', column: false, placeholder: 'invoice / file pointer (optional)' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'submitted',
      badge: true,
      filterable: true,
      options: [
        { value: 'submitted', label: 'Submitted', tone: 'blue' },
        { value: 'approved', label: 'Approved', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'red' },
      ],
    },
    { key: 'journalEntry', label: 'Journal Entry', type: 'text', readOnly: true, column: false },
    { key: 'decidedBy', label: 'Decided By', type: 'text', readOnly: true, column: false },
    { key: 'decidedAt', label: 'Decided At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Ensure the two claim accrual accounts exist — created through the module, once. */
async function ensureClaimAccounts(ctx: EnterpriseModuleActionContext): Promise<boolean> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return false;
  await accounts.store.load();
  for (const def of [EMPLOYEE_EXPENSES_ACCOUNT, EXPENSE_CLAIMS_PAYABLE_ACCOUNT]) {
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
 * Build the Expense Claims module. The Employees store backs the
 * employee-exists guard; GL posting goes through the runtime action context
 * (the W1 seam). Injected, so tests run Electron-free.
 */
export function createExpenseClaimModule(
  storePath: string,
  employeeStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, EXPENSE_CLAIMS_MODULE_ID, EXPENSE_CLAIM_KIND);
  return defineEnterpriseModule({
    descriptor: EXPENSE_CLAIM_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(EXPENSE_CLAIM_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.decidedAt)) {
          return {
            ok: false,
            errors: { status: 'This claim has been decided — decided claims are immutable expense history.' },
            values: result.values,
          };
        }
        const employeeId = str(result.values.employee).trim();
        const employee = employeeStore.list().find((r) => r.id === employeeId && r.status !== 'deleted');
        if (!employee) {
          return {
            ok: false,
            errors: { employee: 'Employee not found — the claim must reference a real employee record id.' },
            values: result.values,
          };
        }
        if (str(employee.fields.exitedAt)) {
          return {
            ok: false,
            errors: { employee: 'This employee has exited — claims cover active employees.' },
            values: result.values,
          };
        }
        const category = str(result.values.category).trim();
        if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
          return {
            ok: false,
            errors: { category: `Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}.` },
            values: result.values,
          };
        }
        const expenseDate = str(result.values.expenseDate).trim();
        if (parseLeaveDate(expenseDate) === null) {
          return {
            ok: false,
            errors: { expenseDate: 'Expense date must be a real calendar day (YYYY-MM-DD).' },
            values: result.values,
          };
        }
        const amount = normalizeClaimAmount(result.values.amount);
        if (amount === null) {
          return {
            ok: false,
            errors: { amount: 'Amount must be a positive number.' },
            values: result.values,
          };
        }
        const priorCount = store.list().filter((r) => str(r.fields.employee).trim() === employeeId).length;
        result.values.expenseDate = expenseDate;
        result.values.amount = amount;
        result.values.claimNumber = `EXP-${expenseDate}-${str(employee.fields.employeeNumber) || employeeId}-${priorCount + 1}`;
        result.values.employeeName = str(employee.fields.name);
        result.values.status = 'submitted';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: EXPENSE_CLAIMS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.claimNumber)} · ${str(f.status)} · ${Number(f.amount ?? 0).toLocaleString('en-US')}`,
          summary:
            `${str(f.employeeName) || str(f.employee)} — ${str(f.category)} on ${str(f.expenseDate)}: ` +
            `${Number(f.amount ?? 0).toLocaleString('en-US')} (${str(f.status)}).` +
            (str(f.journalEntry) ? ` Accrued as ${str(f.journalEntry)}.` : ''),
          risk: str(f.status) === 'submitted' ? 'medium' : 'low',
          riskReason:
            str(f.status) === 'submitted'
              ? 'Undecided claims are unbooked liabilities — approve or reject to close the loop.'
              : 'Decided claims are settled history (accrued when approved).',
          executiveExplanation:
            'Approving a claim books Dr Employee Expenses / Cr Expense Claims Payable through the same idempotent seam payroll uses; reimbursement disbursement clears the payable in a future wave.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== APPROVE_CLAIM_ACTION && action !== REJECT_CLAIM_ACTION) {
          return { ok: false, error: `Unknown action "${action}".` };
        }
        const f = record.fields;
        if (str(f.status) !== 'submitted') {
          return { ok: false, error: `Only submitted claims can be decided — this one is ${str(f.status)}.` };
        }
        // S57 — segregation of duties on APPROVAL, using the repository's own declared
        // principle (BILL_APPROVAL_POLICY sod 'creator_cannot_approve' — "the creator of a
        // purchase cannot also wave through its payment"): the claim's creator may not
        // approve their own claim. Enforcing a declared principle is not invented policy.
        // REJECT stays open to the creator (rejecting your own claim is withdrawal, not
        // self-dealing). Rows with no recorded creator are not compared (importer shape).
        if (action === APPROVE_CLAIM_ACTION) {
          const creator = str(record.createdBy ?? '');
          if (creator !== '' && creator === actionCtx.actor()) {
            return { ok: false, message: 'A claim cannot be approved by its own creator — segregation of duties (another operator must decide it).' };
          }
        }
        if (action === REJECT_CLAIM_ACTION) {
          store.update(record.id, {
            fields: { status: 'rejected', decidedBy: actionCtx.actor(), decidedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: 'Rejected — no accrual booked; the claim is closed as history.' };
        }
        const amount = Number(f.amount ?? 0);
        if (amount <= 0) return { ok: false, error: 'Nothing to approve — the claim amount is not positive.' };
        const ready = await ensureClaimAccounts(actionCtx);
        if (!ready) return { ok: false, error: 'The Ledger Accounts module is not available to ensure the claim accounts.' };
        const claimNumber = str(f.claimNumber);
        await applyGlDerivedEntries(
          [
            {
              entryNumber: expenseEntryNumber(claimNumber),
              memo: `Expense claim ${claimNumber} — ${str(f.employeeName) || str(f.employee)}, ${str(f.category)}, ${str(f.expenseDate)}`,
              lines: expenseAccrualLines(amount),
              sourceModule: EXPENSE_CLAIMS_MODULE_ID,
              sourceRef: record.id,
            },
          ],
          actionCtx,
        );
        store.update(record.id, {
          fields: {
            status: 'approved',
            journalEntry: expenseEntryNumber(claimNumber),
            decidedBy: actionCtx.actor(),
            decidedAt: actionCtx.now(),
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message:
            `Approved — accrual ${expenseEntryNumber(claimNumber)} posted: Dr Employee Expenses / Cr Expense Claims Payable ${amount}. ` +
            'Reimbursement disbursement (Cr Cash) is a future wave, stated.',
        };
      },
    },
  });
}

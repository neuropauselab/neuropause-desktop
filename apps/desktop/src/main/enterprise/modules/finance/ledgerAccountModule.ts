/**
 * Finance → Chart of Accounts — the General Ledger's account registry, on the
 * Enterprise Module Framework like every other module: a descriptor + the
 * framework's record store + a `validate` hook + a deterministic `summarize`.
 * CRUD, RBAC (`operations:read` / `operations:manage`), audit, timeline, search,
 * offline persistence, and the entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC accounting, never AI, never user-forged: `normalBalance` is
 * stamped from the account class (asset/expense → debit; liability/equity/
 * revenue → credit — the ErpCore rule), account codes are unique, and the
 * read-only `debitTotal` / `creditTotal` / `balance` fields are reconciled from
 * POSTED journal entries by the Journal module's `onChange` hook — they are the
 * ledger speaking, never an editable opinion.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  LEDGER_ACCOUNTS_MODULE_ID,
  LEDGER_ACCOUNT_KIND,
  glAccountFromRecord,
  glAccountSummaryFallback,
  glNormalBalance,
  isGlAccountClass,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a ledger account — drives store, CRUD, and the UI. */
export const LEDGER_ACCOUNT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: LEDGER_ACCOUNTS_MODULE_ID,
  title: 'Chart of Accounts',
  singular: 'Ledger Account',
  plural: 'Ledger Accounts',
  icon: 'database',
  description: 'The General Ledger account registry — every posting resolves to an account here.',
  group: 'Finance',
  titleField: 'code',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'code', label: 'Code', type: 'text', required: true, placeholder: '1000' },
    { key: 'name', label: 'Account Name', type: 'text', required: true, placeholder: 'Cash' },
    {
      key: 'class',
      label: 'Class',
      type: 'select',
      required: true,
      default: 'asset',
      badge: true,
      filterable: true,
      options: [
        { value: 'asset', label: 'Asset', tone: 'blue' },
        { value: 'liability', label: 'Liability', tone: 'orange' },
        { value: 'equity', label: 'Equity', tone: 'neutral' },
        { value: 'revenue', label: 'Revenue', tone: 'green' },
        { value: 'expense', label: 'Expense', tone: 'teal' },
      ],
    },
    { key: 'normalBalance', label: 'Normal Balance', type: 'text', readOnly: true, column: false },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      required: true,
      default: 'USD',
      column: false,
      options: [
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
        { value: 'GBP', label: 'GBP' },
        { value: 'INR', label: 'INR' },
      ],
    },
    {
      // Additive (W6-B6): how this account's cash movement is classified in the direct-method
      // Cash Flow Statement. `auto` (the default) falls back to the class rule — equity → financing,
      // everything else → operating — so existing accounts need no change. Tag cash/bank accounts as
      // `cash` (the movement being explained), and fixed-asset / long-term-debt accounts as
      // investing / financing to make the split exact. Never a posting rule — reporting classification only.
      key: 'cashFlowCategory',
      label: 'Cash Flow Category',
      type: 'select',
      default: 'auto',
      column: false,
      options: [
        { value: 'auto', label: 'Auto (by class)' },
        { value: 'cash', label: 'Cash & Equivalents' },
        { value: 'operating', label: 'Operating' },
        { value: 'investing', label: 'Investing' },
        { value: 'financing', label: 'Financing' },
      ],
    },
    { key: 'debitTotal', label: 'Debits', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'creditTotal', label: 'Credits', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'balance', label: 'Balance', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'description', label: 'Description', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Chart of Accounts module. `normalBalance` is stamped from the class;
 * account codes are unique (case-sensitive, trimmed). The balance columns are
 * read-only here — the Journal module reconciles them from posted entries.
 */
export function createLedgerAccountModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, LEDGER_ACCOUNTS_MODULE_ID, LEDGER_ACCOUNT_KIND);
  return defineEnterpriseModule({
    descriptor: LEDGER_ACCOUNT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(LEDGER_ACCOUNT_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};

        const code = str(result.values.code).trim();
        if (!code) errors.code = 'An account code is required.';
        result.values.code = code;

        const cls = result.values.class;
        if (!isGlAccountClass(cls)) {
          errors.class = 'Class must be one of asset, liability, equity, revenue, expense.';
        } else {
          // The kernel rule, stamped — never user-supplied.
          result.values.normalBalance = glNormalBalance(cls);
        }

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const account = glAccountFromRecord(record);
        const fallback = glAccountSummaryFallback(account);
        // A balance opposite the account's normal side is unusual — flag, honestly.
        const contra =
          (account.debitTotal > 0 || account.creditTotal > 0) && account.balance < 0;
        return {
          moduleId: LEDGER_ACCOUNTS_MODULE_ID,
          recordId: record.id,
          headline: `${account.code} · ${account.name} · ${account.currency} ${Math.round(account.balance).toLocaleString('en-US')}`,
          summary: fallback.summary,
          risk: contra ? 'medium' : 'low',
          riskReason: contra
            ? 'Balance is opposite the account’s normal side — review recent postings.'
            : 'Balance follows the account’s normal side.',
          executiveExplanation: fallback.executiveExplanation,
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

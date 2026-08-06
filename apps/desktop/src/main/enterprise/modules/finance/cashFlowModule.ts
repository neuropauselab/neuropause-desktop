/**
 * Finance → Cash Flow Statement — immutable direct-method statements over the GL's
 * posted journal (W6-B6). CRUD (generate + read), RBAC (`operations:read` /
 * `operations:manage` — the Finance family's certified scopes), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * CREATING a statement generates it: validate reads the injected Ledger Accounts +
 * Journal stores, resolves each account's cash-flow role from its (additive)
 * `cashFlowCategory` tag, bounds the period via the certified `glPeriodBounds`, and
 * derives the statement through the pure `deriveCashFlowStatement`. Cash/bank accounts
 * (tagged `cash`, plus the seeded cash control account by default) are the movement
 * being explained; every other account's movement is classified operating / investing /
 * financing, defaulting honestly by class when left on `auto`. The three categories
 * RECONCILE to the period's actual cash movement — the statement records both and flags
 * any drift, never fabricates a balancing figure. A generated statement is immutable
 * (the W1 snapshot marker); the statement sequence is the period-over-period trend.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  CashFlowCategory,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  CASH_FLOW_MODULE_ID,
  CASH_FLOW_KIND,
  GL_CONTROL_ACCOUNTS,
  deriveCashFlowStatement,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  glPeriodBounds,
  resolveCashFlowCategory,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a cash flow statement — drives store, CRUD, and the UI. */
export const CASH_FLOW_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CASH_FLOW_MODULE_ID,
  title: 'Cash Flow Statement',
  singular: 'Cash Flow Statement',
  plural: 'Cash Flow Statements',
  icon: 'trending-up',
  description:
    'Immutable direct-method cash flow — operating / investing / financing derived from posted GL entries and reconciled to the actual change in cash; unclassified accounts default honestly by class.',
  group: 'Finance',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Statement #', type: 'text', readOnly: true },
    { key: 'period', label: 'Period', type: 'text', placeholder: 'YYYY-MM — defaults to current month' },
    { key: 'startDate', label: 'From', type: 'text', readOnly: true, column: false },
    { key: 'endDate', label: 'To', type: 'text', readOnly: true, column: false },
    { key: 'operating', label: 'Operating', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'investing', label: 'Investing', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'financing', label: 'Financing', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'netCashFlow', label: 'Net Cash Flow', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalCashMovement', label: 'Actual Cash Movement', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'reconciled', label: 'Reconciled', type: 'text', readOnly: true },
    { key: 'entryCount', label: 'Entries', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const money = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Build the Cash Flow Statement module. The Ledger Accounts + Journal stores are
 * injected so generation reads the real chart (for cash-flow tags) and the real
 * posted journal — the statement never invents figures.
 */
export function createCashFlowModule(
  storePath: string,
  accountStore: EnterpriseRecordStore,
  journalStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CASH_FLOW_MODULE_ID, CASH_FLOW_KIND);
  return defineEnterpriseModule({
    descriptor: CASH_FLOW_DESCRIPTOR,
    store,
    hooks: {
      // Creating a statement IS generating it; a generated statement is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CASH_FLOW_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Cash flow statements are immutable snapshots — generate a new statement instead.' },
            values: result.values,
          };
        }
        const period = str(result.values.period).trim() || new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
          return { ok: false, errors: { period: 'Period must be a month in YYYY-MM form.' }, values: result.values };
        }
        const { startDate, endDate } = glPeriodBounds(period);

        // Resolve each account's cash-flow role from the real chart. Cash/bank accounts
        // (explicitly tagged `cash`, or the seeded cash control account when left on auto)
        // are the movement being explained; every other account is classified O/I/F.
        const cashCodes = new Set<string>();
        const categoryByCode = new Map<string, CashFlowCategory>();
        for (const rec of accountStore.list()) {
          const account = glAccountFromRecord(rec);
          if (!account.code) continue;
          const tag = str(rec.fields.cashFlowCategory).trim().toLowerCase();
          const isCash = tag === 'cash' || ((tag === '' || tag === 'auto') && account.code === GL_CONTROL_ACCOUNTS.cash.code);
          if (isCash) cashCodes.add(account.code);
          else categoryByCode.set(account.code, resolveCashFlowCategory(tag, account.accountClass));
        }
        const entries = journalStore.list().map(glJournalEntryFromRecord);
        const statement = deriveCashFlowStatement(entries, categoryByCode, cashCodes, { startDate, endDate });
        const priorCount = store.list().filter((r) => str(r.fields.period) === period).length;

        result.values.period = period;
        result.values.reportNumber = `CF-${period}-${priorCount + 1}`;
        result.values.startDate = startDate;
        result.values.endDate = endDate;
        result.values.operating = statement.operating;
        result.values.investing = statement.investing;
        result.values.financing = statement.financing;
        result.values.netCashFlow = statement.netCashFlow;
        result.values.totalCashMovement = statement.totalCashMovement;
        result.values.reconciled = statement.reconciled ? 'yes' : 'no';
        result.values.entryCount = statement.entryCount;
        result.values.note =
          cashCodes.size === 0
            ? 'no cash/bank accounts tagged — tag accounts as “cash” under Chart of Accounts → Cash Flow Category so movement can be explained'
            : statement.entryCount === 0
              ? `no posted cash movement in ${period} — statement is empty, not fabricated`
              : `direct method over ${cashCodes.size} cash/bank account(s)` +
                (statement.reconciled
                  ? '; reconciles to the actual change in cash'
                  : '; DOES NOT reconcile to the actual change in cash — review account cash-flow tags') +
                '. Untagged accounts default by class (equity → financing, else operating); tag fixed-asset / long-term-debt accounts to refine the split.';
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const net = Number(f.netCashFlow ?? 0);
        const actual = Number(f.totalCashMovement ?? 0);
        const reconciled = str(f.reconciled) === 'yes';
        return {
          moduleId: CASH_FLOW_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · net ${money(net)} · ${reconciled ? 'reconciled' : 'drift'}`,
          summary:
            `Period ${str(f.period)}: operating ${money(Number(f.operating ?? 0))}, investing ${money(Number(f.investing ?? 0))}, ` +
            `financing ${money(Number(f.financing ?? 0))}; net ${money(net)} against actual cash movement ${money(actual)}. ${str(f.note)}.`,
          risk: reconciled ? 'low' : 'medium',
          riskReason: reconciled
            ? 'Operating/investing/financing reconcile to the actual change in cash.'
            : 'Categories do not reconcile to the actual change in cash — review the accounts’ cash-flow tags.',
          executiveExplanation:
            'Cash flow is derived directly from posted journal entries that touch cash/bank accounts and classified into operating, investing, and financing; the three categories reconcile to the real change in cash rather than a plugged total.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

/**
 * Finance → Financial Ratios — immutable ratio registers over the GL's own
 * financial-statement aggregates (W6-B5). CRUD (generate + read), RBAC
 * (`operations:read` / `operations:manage` — the Finance family's certified
 * scopes), audit, timeline, search, offline persistence, and the UI are all
 * inherited.
 *
 * CREATING a register generates it: validate reads the injected Ledger Accounts
 * + Journal stores, builds the statement through the certified `glStatement`,
 * and derives the class-total ratios via the pure `deriveFinancialRatios` — so
 * every figure reconciles to real posted balances. Undefined ratios (non-positive
 * denominators) are stored as NULL, never fabricated. A generated register is
 * immutable (the W1 snapshot marker); the register sequence is the ratio trend.
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
  FINANCIAL_RATIOS_MODULE_ID,
  FINANCIAL_RATIO_KIND,
  deriveFinancialRatios,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  glStatement,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a ratio register — drives store, CRUD, and the UI. */
export const FINANCIAL_RATIOS_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FINANCIAL_RATIOS_MODULE_ID,
  title: 'Financial Ratios',
  singular: 'Ratio Register',
  plural: 'Financial Ratios',
  icon: 'percent',
  description:
    'Immutable financial ratios derived from real posted balances — margins, returns, leverage; undefined ratios are null, not fabricated.',
  group: 'Finance',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Register #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'revenue', label: 'Revenue', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'expenses', label: 'Expenses', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'netIncome', label: 'Net Income', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalAssets', label: 'Total Assets', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'totalLiabilities', label: 'Total Liabilities', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'totalEquity', label: 'Total Equity', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'netProfitMargin', label: 'Net Margin %', type: 'number', readOnly: true },
    { key: 'returnOnAssets', label: 'ROA %', type: 'number', readOnly: true, column: false },
    { key: 'returnOnEquity', label: 'ROE %', type: 'number', readOnly: true, column: false },
    { key: 'debtToEquity', label: 'Debt / Equity', type: 'number', readOnly: true },
    { key: 'equityRatio', label: 'Equity Ratio %', type: 'number', readOnly: true, column: false },
    { key: 'expenseRatio', label: 'Expense Ratio %', type: 'number', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const money = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const show = (v: number | null): string => (v === null ? 'n/a' : String(v));

/**
 * Build the Financial Ratios module. The Ledger Accounts + Journal stores are
 * injected so generation reads the real chart and the real posted journal — the
 * ratios never invent figures.
 */
export function createFinancialRatiosModule(
  storePath: string,
  accountStore: EnterpriseRecordStore,
  journalStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FINANCIAL_RATIOS_MODULE_ID, FINANCIAL_RATIO_KIND);
  return defineEnterpriseModule({
    descriptor: FINANCIAL_RATIOS_DESCRIPTOR,
    store,
    hooks: {
      // Creating a register IS generating it; a generated register is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(FINANCIAL_RATIOS_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Ratio registers are immutable snapshots — generate a new register instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(Date.parse(asOfDate))) {
          return { ok: false, errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' }, values: result.values };
        }
        const accounts = accountStore.list().map(glAccountFromRecord);
        const entries = journalStore.list().map(glJournalEntryFromRecord).filter((e) => e.posted);
        const statement = glStatement(accounts, entries);
        const ratios = deriveFinancialRatios(statement);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;

        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `FR-${asOfDate}-${priorCount + 1}`;
        result.values.revenue = statement.revenue;
        result.values.expenses = statement.expenses;
        result.values.netIncome = statement.netIncome;
        result.values.totalAssets = statement.assets;
        result.values.totalLiabilities = statement.liabilities;
        result.values.totalEquity = statement.equity;
        result.values.netProfitMargin = ratios.netProfitMargin;
        result.values.returnOnAssets = ratios.returnOnAssets;
        result.values.returnOnEquity = ratios.returnOnEquity;
        result.values.debtToEquity = ratios.debtToEquity;
        result.values.equityRatio = ratios.equityRatio;
        result.values.expenseRatio = ratios.expenseRatio;
        const undefinedCount = Object.values(ratios).filter((v) => v === null).length;
        result.values.note = !statement.hasData
          ? 'no posted accounting data — ratios are empty, not fabricated'
          : `derived from real posted balances (lifetime-to-date)` +
            (undefinedCount > 0 ? `; ${undefinedCount} ratio(s) undefined (non-positive denominator) — reported as n/a, not zero` : '') +
            '. Current/quick ratios need a current-vs-non-current account split — a stated refinement.';
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const margin = f.netProfitMargin === null || f.netProfitMargin === undefined ? null : Number(f.netProfitMargin);
        const de = f.debtToEquity === null || f.debtToEquity === undefined ? null : Number(f.debtToEquity);
        return {
          moduleId: FINANCIAL_RATIOS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · net margin ${show(margin)}% · D/E ${show(de)}`,
          summary:
            `As of ${str(f.asOfDate)}: revenue ${money(Number(f.revenue ?? 0))}, net income ${money(Number(f.netIncome ?? 0))}. ` +
            `Net margin ${show(margin)}%, ROA ${show(f.returnOnAssets === null ? null : Number(f.returnOnAssets ?? 0))}%, ` +
            `ROE ${show(f.returnOnEquity === null ? null : Number(f.returnOnEquity ?? 0))}%, debt/equity ${show(de)}. ${str(f.note)}.`,
          risk: de !== null && de > 2 ? 'medium' : 'low',
          riskReason:
            de !== null && de > 2
              ? 'Leverage above 2× equity — watch solvency and interest cover.'
              : 'Ratios derive from posted balances; a register is a frozen point on the trend.',
          executiveExplanation:
            'Financial ratios are computed from the real posted ledger, not typed in; undefined ratios are shown as n/a rather than a misleading zero.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

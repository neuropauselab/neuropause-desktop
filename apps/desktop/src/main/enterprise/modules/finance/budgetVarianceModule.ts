/**
 * Finance → Budget Variance — a governed, immutable, point-in-time budget-variance register
 * on the Enterprise Module Framework, modelled on Payables Aging (`apAgingModule`) and the
 * S81 inventory snapshots: create = generate a portfolio snapshot of every budget's
 * budget/actual/variance/health at the as-of instant.
 *
 * It reuses the CANONICAL sources verbatim — the Finance → Budgets masters (`budgetStore`),
 * and, per budget, the SAME `deriveBudgetActuals` derivation the budget module itself uses
 * (posted journal entries only, account-class-aware sign). It adds no variance math, invents
 * no threshold, and mutates NOTHING: it never writes a journal, budget, PO, invoice, payment
 * or inventory record — it only writes its own immutable snapshot. Variance is analytical;
 * no GL is posted (there is no governed "post variance" command — see DECISION-MEMO-S83).
 *
 * Electron-free (store paths + source stores injected), so it unit-tests without the runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  GlAccountClass,
} from '@neuropause/shared';
import {
  deriveBudgetActuals,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { deriveBudgetVarianceSnapshot, type BudgetVarianceInput } from './budgetVarianceModel';

export const BUDGET_VARIANCE_MODULE_ID = 'finance-budget-variance';
export const BUDGET_VARIANCE_KIND = 'budgetVarianceReport';

export const BUDGET_VARIANCE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BUDGET_VARIANCE_MODULE_ID,
  title: 'Budget Variance',
  singular: 'Budget Variance Report',
  plural: 'Budget Variance Reports',
  icon: 'database',
  description:
    'Point-in-time budget-variance snapshots — every budget’s budget/actual/variance/health at the as-of instant, from posted journals only.',
  group: 'Finance',
  titleField: 'reportNumber',
  // Reuses the Finance → Budgets scopes exactly: any member reads, managers+ write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Report #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'budgetCount', label: 'Budgets', type: 'number', readOnly: true, default: 0 },
    { key: 'totalBudget', label: 'Budget', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalActual', label: 'Actual', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalVariance', label: 'Variance', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'overCount', label: 'Over', type: 'number', readOnly: true, default: 0 },
    { key: 'underCount', label: 'Under', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'onTrackCount', label: 'On Track', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'noActualsCount', label: 'No Actuals', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'rows', label: 'Variance Breakdown (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Budget Variance module. Budget masters + Journal + Chart-of-Accounts stores are
 * injected (the budget module's own pattern), so the register derives from the real books.
 */
export function createBudgetVarianceModule(
  storePath: string,
  budgetStore: EnterpriseRecordStore,
  journalStore: EnterpriseRecordStore,
  accountStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BUDGET_VARIANCE_MODULE_ID, BUDGET_VARIANCE_KIND);

  /** Resolve an account's class by code — the variance sign depends on it (budget module rule). */
  function accountClassFor(code: string): GlAccountClass | null {
    const holders = accountStore.list().filter((r) => str(r.fields.code).trim() === code);
    if (holders.length !== 1) return null;
    return glAccountFromRecord(holders[0]).accountClass;
  }

  /** Join every budget master to its live canonical actuals via `deriveBudgetActuals`. */
  function collectInputs(): BudgetVarianceInput[] {
    const entries = journalStore.list().map(glJournalEntryFromRecord);
    const inputs: BudgetVarianceInput[] = [];
    for (const b of budgetStore.list()) {
      if (b.status === 'deleted') continue;
      const accountCode = str(b.fields.accountCode).trim();
      const accountClass = accountClassFor(accountCode);
      if (!accountClass) continue; // an unresolvable account has no honest variance — omit, never fake
      const budgetAmount = Number(b.fields.budgetAmount ?? 0);
      const periodKey = str(b.fields.periodKey);
      const actuals = deriveBudgetActuals({ accountCode, accountClass, periodKey, budgetAmount, entries });
      inputs.push({
        budgetId: b.id,
        budgetName: str(b.fields.budgetName) || b.title,
        periodKey,
        accountCode,
        budgetAmount,
        actuals,
      });
    }
    return inputs;
  }

  return defineEnterpriseModule({
    descriptor: BUDGET_VARIANCE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BUDGET_VARIANCE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Variance reports are immutable snapshots — generate a new report instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
          return { ok: false, errors: { asOfDate: 'As-of must be a date (YYYY-MM-DD).' }, values: result.values };
        }
        const snap = deriveBudgetVarianceSnapshot(collectInputs(), asOfDate);
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `BUD-VAR-${asOfDate}-${priorCount + 1}`;
        result.values.budgetCount = snap.budgetCount;
        result.values.totalBudget = snap.totalBudget;
        result.values.totalActual = snap.totalActual;
        result.values.totalVariance = snap.totalVariance;
        result.values.overCount = snap.overCount;
        result.values.underCount = snap.underCount;
        result.values.onTrackCount = snap.onTrackCount;
        result.values.noActualsCount = snap.noActualsCount;
        result.values.rows = JSON.stringify(snap.rows);
        result.values.note =
          snap.budgetCount === 0
            ? 'no budgets with a resolvable account at the as-of date — the report is empty, not fabricated'
            : `derived from ${snap.budgetCount} budget(s) measured against posted journal entries at ${asOfDate}; base-currency totals (the budget model carries no currency dimension)`;
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const over = Number(f.overCount ?? 0);
        return {
          moduleId: BUDGET_VARIANCE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · variance ${Number(f.totalVariance ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.budgetCount ?? 0)} budget(s), ${Number(f.totalActual ?? 0).toLocaleString('en-US')} actual vs ${Number(f.totalBudget ?? 0).toLocaleString('en-US')} budget; ${over} over budget.`,
          risk: over > 0 ? 'medium' : 'low',
          riskReason: over > 0 ? 'One or more budgets are over budget beyond tolerance.' : 'No budgets over budget.',
          executiveExplanation:
            'Actuals are net posted movement in each account’s normal direction (never hand-entered); variance and health reuse the canonical budget derivation. Snapshots are immutable; no journal, budget or transaction is modified and no GL is posted.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

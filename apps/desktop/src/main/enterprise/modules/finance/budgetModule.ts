/**
 * Finance → Budgets — budget-vs-actual on the Enterprise Module Framework: a
 * descriptor + the framework's record store + a `validate` hook + a `refresh`
 * action + a LIVE-computing `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * A budget targets ONE ledger-account code for ONE monthly period. Its ACTUAL
 * is never typed in: the stored actual/variance columns are stamped by the
 * `refresh` action from POSTED journal entries only, and the AI summary always
 * recomputes LIVE from the books (so the stored columns can lag, but the
 * explanation never lies — it states both when they differ). Health follows
 * spending intuition per the account's normal side (`deriveBudgetActuals`).
 * Cost/profit-centre dimensions are deliberately absent until the journal
 * carries dimensions — stated, not faked.
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
  BUDGETS_MODULE_ID,
  BUDGET_KIND,
  deriveBudgetActuals,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
  type GlAccountClass,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a budget — drives store, CRUD, and the UI. */
export const BUDGET_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BUDGETS_MODULE_ID,
  title: 'Budgets',
  singular: 'Budget',
  plural: 'Budgets',
  icon: 'database',
  description: 'Period budgets per ledger account, measured only against posted journal entries.',
  group: 'Finance',
  titleField: 'budgetName',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: 'refresh', label: 'Refresh Actuals', icon: 'upload' }],
  fields: [
    { key: 'budgetName', label: 'Budget', type: 'text', required: true, placeholder: 'Aug Marketing Spend' },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'accountCode', label: 'Account', type: 'text', required: true, placeholder: '5000' },
    { key: 'budgetAmount', label: 'Budget', type: 'number', required: true, min: 0, format: 'currency' },
    {
      key: 'commitmentPolicy',
      label: 'PO Control',
      type: 'select',
      default: 'warn',
      column: false,
      options: [
        { value: 'off', label: 'Off (informational)' },
        { value: 'warn', label: 'Warn on overrun' },
        { value: 'block', label: 'Block on overrun' },
      ],
    },
    { key: 'actualAmount', label: 'Actual (books)', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'variance', label: 'Variance', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'variancePercent', label: 'Var %', type: 'number', readOnly: true, default: 0, column: false },
    {
      key: 'health',
      label: 'Health',
      type: 'select',
      readOnly: true,
      default: 'no-actuals',
      badge: true,
      filterable: true,
      options: [
        { value: 'no-actuals', label: 'No Actuals', tone: 'neutral' },
        { value: 'on-track', label: 'On Track', tone: 'green' },
        { value: 'under', label: 'Under', tone: 'blue' },
        { value: 'over', label: 'Over', tone: 'orange' },
      ],
    },
    { key: 'refreshedAt', label: 'Refreshed At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Budgets module. Journal + account stores are injected (the
 * Payments ← invoice-store pattern) so actuals derive from the real books.
 */
export function createBudgetModule(
  storePath: string,
  journalStore: EnterpriseRecordStore,
  accountStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BUDGETS_MODULE_ID, BUDGET_KIND);

  /** Resolve the budget's account class by code — the variance sign depends on it. */
  function accountClassFor(code: string): GlAccountClass | null {
    const holders = accountStore.list().filter((r) => str(r.fields.code).trim() === code);
    if (holders.length !== 1) return null;
    return glAccountFromRecord(holders[0]).accountClass;
  }

  function computeLive(record: { fields: Record<string, unknown> }): ReturnType<typeof deriveBudgetActuals> | null {
    const code = str(record.fields.accountCode).trim();
    const accountClass = accountClassFor(code);
    if (!accountClass) return null;
    return deriveBudgetActuals({
      accountCode: code,
      accountClass,
      periodKey: str(record.fields.periodKey),
      budgetAmount: Number(record.fields.budgetAmount ?? 0),
      entries: journalStore.list().map(glJournalEntryFromRecord),
    });
  }

  return defineEnterpriseModule({
    descriptor: BUDGET_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BUDGET_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};

        const periodKey = str(result.values.periodKey).trim();
        if (!isGlPeriodKey(periodKey)) {
          errors.periodKey = 'Period must be a YYYY-MM month key (e.g. 2026-08).';
        }
        result.values.periodKey = periodKey;

        const code = str(result.values.accountCode).trim();
        result.values.accountCode = code;
        if (code && !errors.periodKey) {
          const cls = accountClassFor(code);
          if (!cls) {
            errors.accountCode = `Account code "${code}" must resolve to exactly one ledger account.`;
          }
        }
        if (Number(result.values.budgetAmount ?? 0) <= 0) {
          errors.budgetAmount = 'Budget must be greater than zero.';
        }

        // Stored actuals are stamped ONLY by `refresh` — any validated edit
        // resets them (and cannot forge them), the bank-statement convention.
        result.values.actualAmount = 0;
        result.values.variance = 0;
        result.values.variancePercent = 0;
        result.values.health = 'no-actuals';
        result.values.refreshedAt = '';

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const live = computeLive(record);
        const budget = Number(f.budgetAmount ?? 0);
        if (!live) {
          return {
            moduleId: BUDGETS_MODULE_ID,
            recordId: record.id,
            headline: `${str(f.budgetName)} · ${str(f.periodKey)}`,
            summary: `Account "${str(f.accountCode)}" no longer resolves in the Chart of Accounts — fix the account before reading this budget.`,
            risk: 'medium',
            riskReason: 'Budget account unresolved.',
            executiveExplanation: 'Actuals derive from posted journal entries; without a resolvable account there is nothing honest to measure.',
            grounded: false,
            model: 'none',
          };
        }
        const stale = Math.round(Number(f.actualAmount ?? 0) * 100) !== Math.round(live.actualAmount * 100);
        return {
          moduleId: BUDGETS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.budgetName)} · ${str(f.periodKey)} · ${live.health}`,
          summary: `Budget ${budget.toLocaleString('en-US')}, live actual ${live.actualAmount.toLocaleString('en-US')} (${live.variancePercent}% variance).${stale ? ' Stored columns lag the books — run Refresh Actuals.' : ''}`,
          risk: live.health === 'over' ? 'medium' : 'low',
          riskReason:
            live.health === 'over'
              ? 'Actual spending exceeds budget beyond tolerance.'
              : live.health === 'no-actuals'
                ? 'No posted activity for this account in the period yet.'
                : 'Within tolerance of budget.',
          executiveExplanation:
            'Actuals are net posted movement in the account’s normal direction — never entered by hand. The summary recomputes live even when the stored columns lag.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== 'refresh') return { ok: false, error: `Unknown action "${action}".` };
        await journalStore.load();
        await accountStore.load();
        const live = computeLive(record);
        if (!live) {
          return { ok: false, message: `Account "${str(record.fields.accountCode)}" must resolve to exactly one ledger account.` };
        }
        const updated = store.update(record.id, {
          fields: {
            actualAmount: live.actualAmount,
            variance: live.variance,
            variancePercent: live.variancePercent,
            health: live.health,
            refreshedAt: actionCtx.now(),
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        if (!updated) return { ok: false, error: 'Budget not found.' };
        const self = actionCtx.moduleFor(BUDGETS_MODULE_ID);
        if (self) actionCtx.emit(self, 'updated', updated);
        return {
          ok: true,
          message: `Actuals refreshed: ${live.actualAmount.toLocaleString('en-US')} (${live.health}).`,
        };
      },
    },
  });
}

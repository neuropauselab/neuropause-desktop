/**
 * Sales → Commission Statements — immutable per-period commission snapshots on
 * the Enterprise Module Framework (W2.5), the Aging pattern applied to
 * bookings: CREATING a statement generates it. The validate hook derives, per
 * sales rep, the closed-won opportunity value inside the requested accounting
 * period and the commission the best matching plan grants — through the pure
 * `deriveCommissionStatement` engine, over the injected Opportunities + Plans
 * stores. CRUD, RBAC (`sales:read` / `sales:manage`), audit, timeline, search,
 * offline persistence, and the entire list/detail/form UI are all inherited.
 *
 * Statements are IMMUTABLE (the `generatedAt` marker refuses edits) and are
 * deliberately NOT superseded: late-closing deals mean a period can honestly
 * be re-run, and the sequence of runs is payout history. Reps with won
 * business but no plan appear at rate 0 — visible, never dropped. BOOKINGS
 * basis (won opportunities, not collected cash) is stated on every statement.
 * Statements never post to the General Ledger.
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
  COMMISSION_STATEMENTS_MODULE_ID,
  COMMISSION_STATEMENT_KIND,
  commissionPlanFromRecord,
  deriveCommissionStatement,
  isGlPeriodKey,
  opportunityFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a commission statement — drives store, CRUD, and the UI. */
export const COMMISSION_STATEMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: COMMISSION_STATEMENTS_MODULE_ID,
  title: 'Commission Statements',
  singular: 'Commission Statement',
  plural: 'Commission Statements',
  icon: 'clipboard',
  description:
    'Immutable per-period commission snapshots — closed-won bookings per rep × the plan book, generated on create.',
  group: 'Sales',
  titleField: 'statementNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'statementNumber', label: 'Statement #', type: 'text', readOnly: true },
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'repFilter', label: 'Rep Filter', type: 'text', column: false, placeholder: 'One rep only (optional)' },
    { key: 'repCount', label: 'Reps', type: 'number', readOnly: true, default: 0 },
    { key: 'totalWonValue', label: 'Won Value', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalCommission', label: 'Commission', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'rows', label: 'Rows', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Commission Statements module. The Opportunities + Plans stores are
 * injected so generation reads real records (the W1 snapshot pattern).
 */
export function createCommissionStatementModule(
  storePath: string,
  opportunityStore: EnterpriseRecordStore,
  planStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(
    storePath,
    COMMISSION_STATEMENTS_MODULE_ID,
    COMMISSION_STATEMENT_KIND,
  );
  return defineEnterpriseModule({
    descriptor: COMMISSION_STATEMENT_DESCRIPTOR,
    store,
    hooks: {
      // Creating a statement IS generating it; a generated statement is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(COMMISSION_STATEMENT_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Commission statements are immutable snapshots — generate a new statement instead.' },
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
        const repFilter = str(result.values.repFilter).trim();
        const statement = deriveCommissionStatement(
          opportunityStore.list().map(opportunityFromRecord),
          planStore.list().map(commissionPlanFromRecord),
          periodKey,
          repFilter,
        );
        const priorCount = store.list().filter((r) => str(r.fields.periodKey) === periodKey).length;
        result.values.periodKey = periodKey;
        result.values.statementNumber = `CS-${periodKey}-${priorCount + 1}`;
        result.values.repCount = statement.repCount;
        result.values.totalWonValue = statement.totalWonValue;
        result.values.totalCommission = statement.totalCommission;
        result.values.rows = JSON.stringify(statement.rows);
        const unpaid = statement.rows.filter((r) => r.planName === null).length;
        result.values.note =
          statement.repCount === 0
            ? `no closed-won bookings in ${periodKey}${repFilter ? ` for ${repFilter}` : ''} — the statement is empty, not fabricated`
            : `bookings basis: closed-won opportunities in ${periodKey}; plan book read at generation` +
              (unpaid > 0 ? `; ${unpaid} rep(s) have won business but NO matching plan (rate 0)` : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const unpaidNote = str(f.note).includes('NO matching plan');
        return {
          moduleId: COMMISSION_STATEMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.statementNumber)} · commission ${Number(f.totalCommission ?? 0).toLocaleString('en-US')}`,
          summary: `${str(f.periodKey)}: ${Number(f.totalCommission ?? 0).toLocaleString('en-US')} commission on ${Number(f.totalWonValue ?? 0).toLocaleString('en-US')} of closed-won bookings across ${Number(f.repCount ?? 0)} rep(s). ${str(f.note)}.`,
          risk: unpaidNote ? 'medium' : 'low',
          riskReason: unpaidNote
            ? 'Some reps have won business with no commission plan — fix the plan book and re-run.'
            : 'All reps on the statement have a matching plan.',
          executiveExplanation:
            'Statements are immutable snapshots on a bookings basis; re-running a period after late-closing deals is history, not correction.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}

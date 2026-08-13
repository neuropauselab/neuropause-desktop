/**
 * Finance → Accounting Periods — the General Ledger's close guard, on the
 * Enterprise Module Framework like every other module: a descriptor + the
 * framework's record store + a `validate` hook + `close`/`reopen` record
 * actions + a deterministic `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC, never user-forged: the period's start/end dates and label are
 * stamped from its `YYYY-MM` key, `status` is derived from `closedAt` (which
 * only the `close` action stamps), and a closed period is immutable through the
 * validated update path — `reopen` is the one way back. The Journal's `post`
 * action consults these records and refuses to book into a closed month
 * (`glDateInClosedPeriod`), auto-creating missing months as OPEN periods so
 * the guard is visible, not implicit.
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
  ACCOUNTING_PERIODS_MODULE_ID,
  ACCOUNTING_PERIOD_KIND,
  glPeriodBounds,
  glPeriodFromRecord,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of an accounting period — drives store, CRUD, and the UI. */
export const ACCOUNTING_PERIOD_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ACCOUNTING_PERIODS_MODULE_ID,
  title: 'Accounting Periods',
  singular: 'Accounting Period',
  plural: 'Accounting Periods',
  icon: 'database',
  description: 'Monthly accounting periods — closing a period locks its journal postings.',
  group: 'Finance',
  titleField: 'periodKey',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'close', label: 'Close Period', icon: 'close' },
    { key: 'reopen', label: 'Reopen', icon: 'upload' },
  ],
  fields: [
    { key: 'periodKey', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'label', label: 'Label', type: 'text', readOnly: true },
    { key: 'startDate', label: 'Starts', type: 'date', format: 'date', readOnly: true },
    { key: 'endDate', label: 'Ends', type: 'date', format: 'date', readOnly: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'open',
      badge: true,
      filterable: true,
      options: [
        { value: 'open', label: 'Open', tone: 'green' },
        { value: 'closed', label: 'Closed', tone: 'orange' },
      ],
    },
    { key: 'closedAt', label: 'Closed At', type: 'text', readOnly: true, column: false },
    { key: 'closedBy', label: 'Closed By', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Build the Accounting Periods module. Bounds + label are stamped from the
 * `YYYY-MM` key; `status` derives from `closedAt`; closed periods are immutable
 * through the validated update path (`reopen` is the one way back).
 */
export function createAccountingPeriodModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ACCOUNTING_PERIODS_MODULE_ID, ACCOUNTING_PERIOD_KIND);
  return defineEnterpriseModule({
    descriptor: ACCOUNTING_PERIOD_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(ACCOUNTING_PERIOD_DESCRIPTOR, input);
        if (!result.ok) return result;

        // closedAt is stamped exclusively by the `close` action (which bypasses
        // this hook by design). Reaching validate WITH a closedAt therefore means
        // an edit of a closed period (or a forged create) — both are refused.
        if (str(result.values.closedAt)) {
          return {
            ok: false,
            errors: { _: 'Closed periods are immutable — reopen the period first.' },
            values: result.values,
          };
        }
        result.values.status = 'open'; // derived, never user-forged
        result.values.closedBy = '';

        const key = str(result.values.periodKey).trim();
        if (!isGlPeriodKey(key)) {
          return {
            ok: false,
            errors: { periodKey: 'Period must be a YYYY-MM month key (e.g. 2026-08).' },
            values: result.values,
          };
        }
        result.values.periodKey = key;
        const bounds = glPeriodBounds(key);
        result.values.startDate = bounds.startDate;
        result.values.endDate = bounds.endDate;
        result.values.label = `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const period = glPeriodFromRecord(record);
        return {
          moduleId: ACCOUNTING_PERIODS_MODULE_ID,
          recordId: record.id,
          headline: `${period.periodKey} · ${period.closed ? 'Closed' : 'Open'}`,
          summary: period.closed
            ? `${period.label} is closed (${period.closedAt.slice(0, 10)} by ${period.closedBy || 'unknown'}); its journal postings are locked.`
            : `${period.label} is open; journal entries dated ${period.startDate} to ${period.endDate} may be posted.`,
          risk: 'low',
          riskReason: period.closed ? 'Locked period.' : 'Open period.',
          executiveExplanation:
            'Closing is reversible via Reopen, but every posting into a closed month is refused until then — the books cannot drift behind a close.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const period = glPeriodFromRecord(record);
        if (action === 'close') {
          if (period.closed) return { ok: false, message: `${period.periodKey} is already closed.` };
          const updated = store.update(record.id, {
            fields: { status: 'closed', closedAt: actionCtx.now(), closedBy: actionCtx.actor() ?? 'unknown' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Period not found.' };
          const self = actionCtx.moduleFor(ACCOUNTING_PERIODS_MODULE_ID);
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Period ${period.periodKey} closed — its postings are locked.` };
        }
        if (action === 'reopen') {
          if (!period.closed) return { ok: false, message: `${period.periodKey} is already open.` };
          const updated = store.update(record.id, {
            fields: { status: 'open', closedAt: '', closedBy: '' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Period not found.' };
          const self = actionCtx.moduleFor(ACCOUNTING_PERIODS_MODULE_ID);
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Period ${period.periodKey} reopened.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}

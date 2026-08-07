/**
 * HR → Attendance Periods — monthly attendance statements on the Enterprise
 * Module Framework (FW-1). CRUD, RBAC (`operations:read` / `operations:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one employee's attendance statement for one month. A DRAFT is
 * editable; CONFIRMING it (the explicit action) is the statement payroll
 * consumes — loss-of-pay days prorate that employee's pay on the calendar-day
 * factor and flow into the PF ECR as real NCP days. No confirmed statement for
 * a period means full-month pay, exactly as before FW-1 — stated, never
 * silently assumed both ways.
 *
 * Guards: valid month, a REAL active employee, non-negative day counts that
 * fit inside the month, and ONE live statement per employee per month (the
 * uniqueness rule that keeps "the statement" singular).
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordValidation,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  ATTENDANCE_KIND,
  ATTENDANCE_MODULE_ID,
  daysInPeriod,
  deriveLeavePeriodSummary,
  holidayDateSet,
  isGlPeriodKey,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key that turns a draft into the payroll-consumed statement. */
export const CONFIRM_ATTENDANCE_ACTION = 'confirm';
/** FW-2: prefill a DRAFT statement from approved leave + the holiday calendar. */
export const IMPORT_LEAVE_ACTION = 'importLeave';

/** The declarative description of an attendance period — drives store, CRUD, and the UI. */
export const ATTENDANCE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ATTENDANCE_MODULE_ID,
  title: 'Attendance Periods',
  singular: 'Attendance Period',
  plural: 'Attendance Periods',
  icon: 'calendar',
  description:
    'Monthly per-employee attendance statements — confirmed loss-of-pay days prorate payroll and feed ECR NCP days.',
  group: 'HR',
  titleField: 'statementNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: IMPORT_LEAVE_ACTION, label: 'Import Leave', icon: 'download' },
    { key: CONFIRM_ATTENDANCE_ACTION, label: 'Confirm Statement', icon: 'check' },
  ],
  fields: [
    { key: 'statementNumber', label: 'Statement #', type: 'text', readOnly: true },
    { key: 'employee', label: 'Employee', type: 'text', required: true, placeholder: 'employee record id' },
    { key: 'employeeName', label: 'Name', type: 'text', readOnly: true },
    { key: 'period', label: 'Period', type: 'text', required: true, placeholder: '2026-08' },
    { key: 'presentDays', label: 'Present', type: 'number', default: 0 },
    { key: 'paidLeaveDays', label: 'Paid Leave', type: 'number', default: 0, column: false },
    { key: 'lopDays', label: 'LOP Days', type: 'number', default: 0 },
    { key: 'daysInMonth', label: 'Month Days', type: 'number', readOnly: true, default: 0, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'blue' },
        { value: 'confirmed', label: 'Confirmed', tone: 'green' },
      ],
    },
    { key: 'confirmedAt', label: 'Confirmed At', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the Attendance Periods module. The Employees store backs the
 * employee-exists guard; the OPTIONAL leave + holiday stores (FW-2, additive)
 * power the Import Leave action — omitting them preserves FW-1 exactly.
 * (Injected, so tests run Electron-free.)
 */
export function createAttendanceModule(
  storePath: string,
  employeeStore: EnterpriseRecordStore,
  leaveStore?: EnterpriseRecordStore,
  holidayStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ATTENDANCE_MODULE_ID, ATTENDANCE_KIND);
  return defineEnterpriseModule({
    descriptor: ATTENDANCE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(ATTENDANCE_DESCRIPTOR, input);
        if (!result.ok) return result;
        // A confirmed statement is payroll history — immutable except through audit-visible re-creation.
        if (str(input.fields?.confirmedAt)) {
          return {
            ok: false,
            errors: { status: 'This statement is confirmed — confirmed attendance is immutable payroll input.' },
            values: result.values,
          };
        }
        const period = str(result.values.period).trim();
        if (!isGlPeriodKey(period)) {
          return { ok: false, errors: { period: 'Period must be a valid month (YYYY-MM).' }, values: result.values };
        }
        const monthDays = daysInPeriod(period);
        const employeeId = str(result.values.employee).trim();
        const employee = employeeStore.list().find((r) => r.id === employeeId && r.status !== 'deleted');
        if (!employee) {
          return {
            ok: false,
            errors: { employee: 'Employee not found — the statement must reference a real employee record id.' },
            values: result.values,
          };
        }
        if (str(employee.fields.exitedAt)) {
          return {
            ok: false,
            errors: { employee: 'This employee has exited — attendance statements cover active employees.' },
            values: result.values,
          };
        }
        const present = num(result.values.presentDays);
        const paidLeave = num(result.values.paidLeaveDays);
        const lop = num(result.values.lopDays);
        if (present < 0 || paidLeave < 0 || lop < 0) {
          return {
            ok: false,
            errors: { lopDays: 'Day counts cannot be negative.' },
            values: result.values,
          };
        }
        if (present + paidLeave + lop > monthDays) {
          return {
            ok: false,
            errors: {
              lopDays: `Present + paid leave + LOP (${present + paidLeave + lop}) exceeds the ${monthDays} days in ${period}.`,
            },
            values: result.values,
          };
        }
        // ONE live statement per employee per month — the singular source payroll reads.
        const duplicate = store
          .list()
          .some(
            (r) =>
              r.status !== 'deleted' &&
              str(r.fields.employee).trim() === employeeId &&
              str(r.fields.period).trim() === period,
          );
        if (duplicate) {
          return {
            ok: false,
            errors: { period: `An attendance statement for this employee already exists for ${period} — edit or delete it.` },
            values: result.values,
          };
        }
        result.values.statementNumber = `ATT-${period}-${str(employee.fields.employeeNumber) || employeeId}`;
        result.values.employeeName = str(employee.fields.name);
        result.values.daysInMonth = monthDays;
        result.values.status = 'draft';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const lop = num(f.lopDays);
        return {
          moduleId: ATTENDANCE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.statementNumber)} · ${str(f.status)} · LOP ${lop}`,
          summary:
            `${str(f.employeeName) || str(f.employee)} — ${str(f.period)}: ` +
            `${num(f.presentDays)} present, ${num(f.paidLeaveDays)} paid leave, ${lop} LOP of ${num(f.daysInMonth)} day(s). ` +
            (str(f.status) === 'confirmed'
              ? 'Confirmed — payroll prorates on this statement.'
              : 'Draft — payroll ignores drafts and pays full month until confirmed.'),
          risk: lop > 0 && str(f.status) === 'draft' ? 'medium' : 'low',
          riskReason:
            lop > 0 && str(f.status) === 'draft'
              ? 'LOP days recorded but the statement is unconfirmed — payroll will still pay the full month.'
              : 'Statement state and payroll behavior agree.',
          executiveExplanation:
            'Confirmed attendance statements are the loss-of-pay source of truth: they prorate the month’s pay and supply the PF ECR’s non-contributory days.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action === IMPORT_LEAVE_ACTION) {
          const f = record.fields;
          if (str(f.status) === 'confirmed') {
            return { ok: false, error: 'This statement is confirmed — import leave into drafts only.' };
          }
          if (!leaveStore) {
            return { ok: false, error: 'The Leave Requests module is not wired — nothing to import.' };
          }
          const period = str(f.period).trim();
          const employeeId = str(f.employee).trim();
          const holidays = holidayStore ? holidayDateSet(holidayStore.list()) : new Set<string>();
          const summary = deriveLeavePeriodSummary(leaveStore.list(), holidays, employeeId, period);
          const monthDays = daysInPeriod(period);
          const lop = Math.min(summary.unpaidLeaveDays, monthDays);
          const paidLeave = Math.min(summary.paidLeaveDays, monthDays - lop);
          store.update(record.id, {
            fields: {
              paidLeaveDays: paidLeave,
              lopDays: lop,
              note:
                summary.requestCount === 0
                  ? `No approved leave found for ${period} — statement left as entered.`
                  : `Imported from ${summary.requestCount} approved request(s): ${paidLeave} paid leave day(s), ${lop} unpaid (LOP) day(s); declared holidays excluded from LOP.`,
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message:
              summary.requestCount === 0
                ? `No approved leave for ${period} — nothing imported (drafted days unchanged at 0 unless you set them).`
                : `Imported ${summary.requestCount} approved request(s) → ${paidLeave} paid leave day(s), ${lop} LOP day(s). Review present days, then Confirm.`,
          };
        }
        if (action !== CONFIRM_ATTENDANCE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const f = record.fields;
        if (str(f.status) === 'confirmed') return { ok: false, error: 'This statement is already confirmed.' };
        store.update(record.id, {
          fields: { status: 'confirmed', confirmedAt: actionCtx.now() },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        const lop = num(f.lopDays);
        return {
          ok: true,
          message:
            lop > 0
              ? `Statement confirmed — payroll for ${str(f.period)} will prorate ${str(f.employeeName) || str(f.employee)} by ${lop} LOP day(s).`
              : `Statement confirmed — full attendance recorded for ${str(f.period)}; pay is unaffected, now on the record.`,
        };
      },
    },
  });
}

/**
 * HR → Leave Requests — employee leave on the Enterprise Module Framework
 * (FW-2). CRUD, RBAC (`operations:read` / `operations:manage`), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one leave request (paid | casual | sick | unpaid) with an
 * inclusive date range. Lifecycle is strictly human-in-the-loop:
 * pending → approved | rejected via explicit actions, each requiring the
 * write scope and stamping who/when. Only APPROVED requests reach the FW-2
 * leave engine — and from there pay is touched ONLY through the Attendance
 * statement's Import Leave action (FW-1's single payroll source of truth).
 *
 * Guards: a real active employee, strict dates in order, and NO overlapping
 * live request for the same employee (pending or approved — a rejected
 * request frees its dates).
 *
 * Boundaries stated: no accrual balances / carry-forward yet; weekend days
 * inside a span count as leave unless declared holidays.
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
  LEAVE_KIND,
  LEAVE_KINDS,
  LEAVE_MODULE_ID,
  leaveRangesOverlap,
  leaveSpanDays,
  parseLeaveDate,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys — approval is explicit and audited. */
export const APPROVE_LEAVE_ACTION = 'approve';
export const REJECT_LEAVE_ACTION = 'reject';

/** The declarative description of a leave request — drives store, CRUD, and the UI. */
export const LEAVE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: LEAVE_MODULE_ID,
  title: 'Leave Requests',
  singular: 'Leave Request',
  plural: 'Leave Requests',
  icon: 'calendar',
  description:
    'Employee leave with explicit approval — approved paid leave never docks pay; approved unpaid leave becomes loss-of-pay through the attendance statement.',
  group: 'HR',
  titleField: 'requestNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: APPROVE_LEAVE_ACTION, label: 'Approve', icon: 'check' },
    { key: REJECT_LEAVE_ACTION, label: 'Reject', icon: 'x' },
  ],
  fields: [
    { key: 'requestNumber', label: 'Request #', type: 'text', readOnly: true },
    { key: 'employee', label: 'Employee', type: 'text', required: true, placeholder: 'employee record id' },
    { key: 'employeeName', label: 'Name', type: 'text', readOnly: true },
    {
      key: 'kind',
      label: 'Kind',
      type: 'select',
      required: true,
      default: 'paid',
      filterable: true,
      options: [
        { value: 'paid', label: 'Paid', tone: 'green' },
        { value: 'casual', label: 'Casual', tone: 'green' },
        { value: 'sick', label: 'Sick', tone: 'green' },
        { value: 'unpaid', label: 'Unpaid (LOP)', tone: 'orange' },
      ],
    },
    { key: 'fromDate', label: 'From', type: 'text', required: true, placeholder: '2026-08-10' },
    { key: 'toDate', label: 'To', type: 'text', required: true, placeholder: '2026-08-12' },
    { key: 'days', label: 'Days', type: 'number', readOnly: true, default: 0 },
    { key: 'reason', label: 'Reason', type: 'text', column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'blue' },
        { value: 'approved', label: 'Approved', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'red' },
      ],
    },
    { key: 'decidedBy', label: 'Decided By', type: 'text', readOnly: true, column: false },
    { key: 'decidedAt', label: 'Decided At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Leave Requests module. The Employees store backs the
 * employee-exists guard (injected, so tests run Electron-free).
 */
export function createLeaveModule(
  storePath: string,
  employeeStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, LEAVE_MODULE_ID, LEAVE_KIND);
  return defineEnterpriseModule({
    descriptor: LEAVE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(LEAVE_DESCRIPTOR, input);
        if (!result.ok) return result;
        // A decided request is history — the record freezes at decision time.
        if (str(input.fields?.decidedAt)) {
          return {
            ok: false,
            errors: { status: 'This request has been decided — decided leave is immutable history.' },
            values: result.values,
          };
        }
        const employeeId = str(result.values.employee).trim();
        const employee = employeeStore.list().find((r) => r.id === employeeId && r.status !== 'deleted');
        if (!employee) {
          return {
            ok: false,
            errors: { employee: 'Employee not found — the request must reference a real employee record id.' },
            values: result.values,
          };
        }
        if (str(employee.fields.exitedAt)) {
          return {
            ok: false,
            errors: { employee: 'This employee has exited — leave covers active employees.' },
            values: result.values,
          };
        }
        const kind = str(result.values.kind).trim();
        if (!(LEAVE_KINDS as readonly string[]).includes(kind)) {
          return { ok: false, errors: { kind: `Kind must be one of: ${LEAVE_KINDS.join(', ')}.` }, values: result.values };
        }
        const fromDate = str(result.values.fromDate).trim();
        const toDate = str(result.values.toDate).trim();
        if (parseLeaveDate(fromDate) === null || parseLeaveDate(toDate) === null) {
          return {
            ok: false,
            errors: { fromDate: 'Dates must be real calendar days (YYYY-MM-DD).' },
            values: result.values,
          };
        }
        const days = leaveSpanDays(fromDate, toDate);
        if (days <= 0) {
          return {
            ok: false,
            errors: { toDate: 'The end date must be on or after the start date.' },
            values: result.values,
          };
        }
        // No overlapping LIVE request (pending or approved) for the same employee.
        const overlap = store.list().some(
          (r) =>
            r.status !== 'deleted' &&
            str(r.fields.employee).trim() === employeeId &&
            ['pending', 'approved'].includes(str(r.fields.status)) &&
            leaveRangesOverlap(fromDate, toDate, str(r.fields.fromDate), str(r.fields.toDate)),
        );
        if (overlap) {
          return {
            ok: false,
            errors: { fromDate: 'These dates overlap an existing pending or approved request for this employee.' },
            values: result.values,
          };
        }
        result.values.fromDate = fromDate;
        result.values.toDate = toDate;
        result.values.days = days;
        result.values.requestNumber = `LV-${fromDate}-${str(employee.fields.employeeNumber) || employeeId}`;
        result.values.employeeName = str(employee.fields.name);
        result.values.status = 'pending';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const unpaid = str(f.kind) === 'unpaid';
        return {
          moduleId: LEAVE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.requestNumber)} · ${str(f.kind)} · ${str(f.status)}`,
          summary:
            `${str(f.employeeName) || str(f.employee)} — ${str(f.kind)} leave ${str(f.fromDate)} → ${str(f.toDate)} ` +
            `(${Number(f.days ?? 0)} day(s)), ${str(f.status)}.` +
            (unpaid && str(f.status) === 'approved'
              ? ' Unpaid: becomes loss-of-pay when imported into the attendance statement.'
              : ''),
          risk: unpaid && str(f.status) === 'approved' ? 'medium' : 'low',
          riskReason:
            unpaid && str(f.status) === 'approved'
              ? 'Approved unpaid leave docks pay once the attendance statement imports it.'
              : 'Paid-kind or undecided leave does not affect pay.',
          executiveExplanation:
            'Leave is approved by a human, then reaches payroll only through the attendance statement — one source of truth, no double-counting.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== APPROVE_LEAVE_ACTION && action !== REJECT_LEAVE_ACTION) {
          return { ok: false, error: `Unknown action "${action}".` };
        }
        const f = record.fields;
        if (str(f.status) !== 'pending') {
          return { ok: false, error: `Only pending requests can be decided — this one is ${str(f.status)}.` };
        }
        const approved = action === APPROVE_LEAVE_ACTION;
        store.update(record.id, {
          fields: {
            status: approved ? 'approved' : 'rejected',
            decidedBy: actionCtx.actor(),
            decidedAt: actionCtx.now(),
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message: approved
            ? str(f.kind) === 'unpaid'
              ? `Approved — ${Number(f.days ?? 0)} unpaid day(s) will dock pay once imported into the period's attendance statement.`
              : `Approved — paid leave; pay is unaffected and the dates are on the record.`
            : 'Rejected — the dates are freed for a new request.',
        };
      },
    },
  });
}

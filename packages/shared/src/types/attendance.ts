/**
 * HR → Attendance — the pure attendance/LOP engine (Final Wave FW-1).
 *
 * Closes the named W6 boundary "attendance/LOP not tracked; NCP days
 * hardcoded 0; full-month pay assumed": one CONFIRMED attendance record per
 * employee per month feeds loss-of-pay proration into the statutory payroll
 * engine and real NCP (non-contributory-period) days into the PF ECR.
 *
 * Design rules, in the platform's own idiom:
 * - CALENDAR-DAY basis (Indian payroll convention): the LOP factor is
 *   (daysInMonth − lopDays) / daysInMonth. Working-day calendars are a later
 *   wave — named, not faked.
 * - ADDITIVE: everything here is consumed through OPTIONAL parameters; a
 *   workspace with no attendance records (or none confirmed for the period)
 *   pays full-month exactly as before, byte-identical, and says so.
 * - HONEST: a confirmed record with lopDays 0 is a real statement of full
 *   attendance — distinguished from "no attendance tracked".
 *
 * Pure (no I/O) so the backend hooks and tests share it.
 */

/** Module id + record kind for the Attendance Periods module. */
export const ATTENDANCE_MODULE_ID = 'hr-attendance';
export const ATTENDANCE_KIND = 'attendance_period';

/** Calendar days in a `YYYY-MM` period (28–31); 0 for an unparseable key. */
export function daysInPeriod(periodKey: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey).trim());
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return 0;
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** One employee's attendance statement for one month, as payroll consumes it. */
export interface AttendanceSummary {
  /** Loss-of-pay days — absent beyond leave balance; drives proration + ECR NCP. */
  lopDays: number;
  /** Days present (informational on the payslip note). */
  presentDays: number;
  /** Paid leave days (informational — paid, so NOT loss of pay). */
  paidLeaveDays: number;
}

/**
 * The pay-proration factor for a month: (days − lop) / days, clamped to
 * [0, 1]. A factor of 1 means full-month pay; 0 means a full-month LOP.
 */
export function prorationFactor(daysInMonth: number, lopDays: number): number {
  if (daysInMonth <= 0) return 1;
  const lop = Math.min(Math.max(lopDays, 0), daysInMonth);
  return (daysInMonth - lop) / daysInMonth;
}

/** The generic-record field shape the Attendance module stores. */
interface AttendanceRecordLike {
  status: string;
  fields: Record<string, unknown>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Fold the CONFIRMED attendance records for one period into the per-employee
 * map the payroll engine consumes. Drafts and deleted records are ignored —
 * only a CONFIRMED statement affects pay. If duplicates slip past validation,
 * the HIGHER lopDays wins (the conservative reading; never silently the lower).
 */
export function deriveAttendanceByEmployee(
  records: ReadonlyArray<AttendanceRecordLike>,
  periodKey: string,
): Map<string, AttendanceSummary> {
  const map = new Map<string, AttendanceSummary>();
  const period = String(periodKey).trim();
  for (const r of records) {
    if (r.status === 'deleted') continue;
    if (str(r.fields.status) !== 'confirmed') continue;
    if (str(r.fields.period).trim() !== period) continue;
    const employee = str(r.fields.employee).trim();
    if (!employee) continue;
    const next: AttendanceSummary = {
      lopDays: num(r.fields.lopDays),
      presentDays: num(r.fields.presentDays),
      paidLeaveDays: num(r.fields.paidLeaveDays),
    };
    const prior = map.get(employee);
    if (!prior || next.lopDays > prior.lopDays) map.set(employee, next);
  }
  return map;
}

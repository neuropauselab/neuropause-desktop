/**
 * HR → Leave + Holiday Calendar — the pure leave engine (Final Wave FW-2).
 *
 * Extends FW-1's attendance/LOP spine with the two records that DECIDE what
 * loss-of-pay means: approved leave requests (paid kinds never dock pay;
 * unpaid leave does) and the company holiday calendar (a declared holiday
 * inside an unpaid-leave span is NOT docked — the fairer default, stated).
 *
 * Design rules, in the platform's idiom:
 * - Leave affects pay ONLY through the attendance statement (FW-1's single
 *   payroll source of truth). The engine here COUNTS days; the Attendance
 *   module's "Import Leave" action writes them into a draft statement a human
 *   still confirms. No second path into payroll, no double-counting.
 * - Calendar-day basis, month-clipped: a request spanning months contributes
 *   only its days inside the asked period.
 * - Honest v1 boundaries: no accrual balances or carry-forward yet (named,
 *   not faked); weekends are counted as leave days unless declared holidays.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */

/** Module ids + record kinds (FW-2). */
export const LEAVE_MODULE_ID = 'hr-leave-requests';
export const LEAVE_KIND = 'leave_request';
export const HOLIDAYS_MODULE_ID = 'hr-holidays';
export const HOLIDAY_KIND = 'holiday';

/** Leave kinds — every kind except `unpaid` is paid (never loss-of-pay). */
export const LEAVE_KINDS = ['paid', 'casual', 'sick', 'unpaid'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a strict YYYY-MM-DD into a UTC ms timestamp; null when invalid. */
export function parseLeaveDate(value: unknown): number | null {
  const s = String(value ?? '').trim();
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  // Reject rollovers like 2026-02-30.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

const DAY_MS = 86_400_000;

/** Inclusive calendar days between two valid dates (1 when equal); 0 when reversed/invalid. */
export function leaveSpanDays(fromDate: string, toDate: string): number {
  const a = parseLeaveDate(fromDate);
  const b = parseLeaveDate(toDate);
  if (a === null || b === null || b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

/** True when the two inclusive date ranges overlap (all dates pre-validated). */
export function leaveRangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  const a1 = parseLeaveDate(aFrom), a2 = parseLeaveDate(aTo);
  const b1 = parseLeaveDate(bFrom), b2 = parseLeaveDate(bTo);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return false;
  return a1 <= b2 && b1 <= a2;
}

/**
 * Count a leave span's days INSIDE one YYYY-MM period, excluding any declared
 * holiday dates (set of YYYY-MM-DD). Month-clips both ends.
 */
export function leaveDaysInPeriod(
  fromDate: string,
  toDate: string,
  periodKey: string,
  holidayDates: ReadonlySet<string> = new Set(),
): number {
  const from = parseLeaveDate(fromDate);
  const to = parseLeaveDate(toDate);
  const pm = /^(\d{4})-(\d{2})$/.exec(String(periodKey).trim());
  if (from === null || to === null || to < from || !pm) return 0;
  const y = Number(pm[1]);
  const mo = Number(pm[2]);
  if (mo < 1 || mo > 12) return 0;
  const monthStart = Date.UTC(y, mo - 1, 1);
  const monthEnd = Date.UTC(y, mo, 0); // last day of the month
  const start = Math.max(from, monthStart);
  const end = Math.min(to, monthEnd);
  let days = 0;
  for (let t = start; t <= end; t += DAY_MS) {
    const d = new Date(t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!holidayDates.has(key)) days += 1;
  }
  return days;
}

/** The generic-record shape the Leave/Holiday modules store. */
interface RecordLike {
  status: string;
  fields: Record<string, unknown>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Fold the live holiday records into the set of YYYY-MM-DD dates the engine excludes. */
export function holidayDateSet(records: ReadonlyArray<RecordLike>): Set<string> {
  const set = new Set<string>();
  for (const r of records) {
    if (r.status === 'deleted') continue;
    const date = str(r.fields.date).trim();
    if (parseLeaveDate(date) !== null) set.add(date);
  }
  return set;
}

/** One employee's approved-leave totals inside one month, as attendance imports them. */
export interface LeavePeriodSummary {
  /** Approved paid-kind leave days in the month (never loss-of-pay). */
  paidLeaveDays: number;
  /** Approved unpaid leave days in the month (loss-of-pay), holidays excluded. */
  unpaidLeaveDays: number;
  /** Approved requests that contributed at least one day. */
  requestCount: number;
}

/**
 * Fold one employee's APPROVED leave requests into the month's paid/unpaid
 * day totals — the numbers the Attendance module's Import Leave action writes
 * into a draft statement. Drafts/rejected/deleted requests count nothing.
 */
export function deriveLeavePeriodSummary(
  leaveRecords: ReadonlyArray<RecordLike>,
  holidayDates: ReadonlySet<string>,
  employeeId: string,
  periodKey: string,
): LeavePeriodSummary {
  let paid = 0;
  let unpaid = 0;
  let requests = 0;
  for (const r of leaveRecords) {
    if (r.status === 'deleted') continue;
    if (str(r.fields.status) !== 'approved') continue;
    if (str(r.fields.employee).trim() !== employeeId) continue;
    const kind = str(r.fields.kind).trim() as LeaveKind;
    const days = leaveDaysInPeriod(str(r.fields.fromDate), str(r.fields.toDate), periodKey, holidayDates);
    if (days <= 0) continue;
    requests += 1;
    if (kind === 'unpaid') unpaid += days;
    else paid += days;
  }
  return { paidLeaveDays: paid, unpaidLeaveDays: unpaid, requestCount: requests };
}

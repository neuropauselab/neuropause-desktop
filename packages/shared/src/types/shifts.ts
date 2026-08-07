/**
 * HR → Shift Management — the pure shift engine (Final Wave FW-4).
 *
 * A shift template declares the working pattern: daily start/end times,
 * weekly off days, and a late-arrival grace. Assigned to an employee
 * (additive `shiftRef`), it makes the month's EXPECTED working days
 * computable — daysInMonth − weekly offs − declared holidays — which the
 * Attendance statement's Import Leave action uses to prefill present days:
 *   present = expectedWorkingDays − paidLeave − LOP, clamped ≥ 0.
 * No shift assigned = no prefill (FW-2 behavior preserved exactly).
 *
 * Boundaries stated: no rotation schedules or per-day rosters yet (a shift
 * is one weekly pattern); overnight shifts are declared (end < start) and
 * accepted, with hours computed across midnight; no clock-in capture — the
 * grace field is contractual metadata until a punch source exists.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */

/** Module id + record kind (FW-4). */
export const SHIFTS_MODULE_ID = 'hr-shifts';
export const SHIFT_KIND = 'shift';

/** Weekday tokens, Sunday-first to match JS getUTCDay(). */
export const WEEKDAY_TOKENS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type WeekdayToken = (typeof WEEKDAY_TOKENS)[number];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parse a strict HH:MM (24h) into minutes-from-midnight; null when invalid. */
export function parseShiftTime(value: unknown): number | null {
  const m = TIME_RE.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Shift length in minutes. An end at-or-before the start is an OVERNIGHT
 * shift (crosses midnight) — computed across it, never negative.
 */
export function shiftMinutes(startTime: string, endTime: string): number | null {
  const start = parseShiftTime(startTime);
  const end = parseShiftTime(endTime);
  if (start === null || end === null) return null;
  return end > start ? end - start : 24 * 60 - start + end;
}

/**
 * Parse a comma-separated weekly-off declaration ("SUN" or "SAT,SUN") into
 * weekday numbers (0=Sunday). Returns null on any unknown token; an empty
 * string is a valid zero-off pattern.
 */
export function parseWeeklyOffDays(value: unknown): number[] | null {
  const s = String(value ?? '').trim();
  if (s === '') return [];
  const out: number[] = [];
  for (const raw of s.split(',')) {
    const token = raw.trim().toUpperCase();
    const idx = (WEEKDAY_TOKENS as readonly string[]).indexOf(token);
    if (idx === -1) return null;
    if (!out.includes(idx)) out.push(idx);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Expected working days for one YYYY-MM under a weekly-off pattern, minus
 * declared holidays that fall on WORKING days (a holiday on a weekly off
 * never double-counts). 0 for an unparseable period.
 */
export function expectedWorkingDays(
  periodKey: string,
  weeklyOffDays: readonly number[],
  holidayDates: ReadonlySet<string> = new Set(),
): number {
  const pm = /^(\d{4})-(\d{2})$/.exec(String(periodKey).trim());
  if (!pm) return 0;
  const y = Number(pm[1]);
  const mo = Number(pm[2]);
  if (mo < 1 || mo > 12) return 0;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let days = 0;
  for (let d = 1; d <= last; d += 1) {
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (weeklyOffDays.includes(date.getUTCDay())) continue;
    const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (holidayDates.has(key)) continue;
    days += 1;
  }
  return days;
}

/** The generic-record shape the Shifts module stores. */
interface ShiftRecordLike {
  id: string;
  status: string;
  fields: Record<string, unknown>;
}

/**
 * Resolve one employee's live shift record → weekly-off day numbers.
 * Null when the ref is empty, the shift is missing/deleted, or its pattern
 * fails to parse — the caller falls back to "no prefill", never guesses.
 */
export function weeklyOffsForShift(
  shiftRecords: ReadonlyArray<ShiftRecordLike>,
  shiftRef: string,
): number[] | null {
  const ref = String(shiftRef ?? '').trim();
  if (!ref) return null;
  const shift = shiftRecords.find((r) => r.id === ref && r.status !== 'deleted');
  if (!shift) return null;
  return parseWeeklyOffDays(shift.fields.weeklyOffDays);
}

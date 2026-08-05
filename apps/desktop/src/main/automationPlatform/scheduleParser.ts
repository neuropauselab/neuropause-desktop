/**
 * Phase 6 Stage 8 — deterministic schedule-label parsing (D-3).
 *
 * The Automation Builder's `schedule` trigger stores a human label
 * ("daily 9am", "every 15 minutes") and its type doc says "parsed elsewhere" —
 * but nothing anywhere parses or fires it. This module is that parser: a
 * DECLARED deterministic subset (daily / weekly / hourly / interval + time).
 * Labels outside the subset return an explicit issue — a validation finding,
 * never a silent no-op. Pure; no timers live here (the tick lives in the
 * composition root on the EXISTING taskScheduler).
 */
import type { ParsedSchedule, ScheduleSpec } from '@neuropause/shared';

const DAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** "9am" / "9:30am" / "17:00" / "5pm" → minutes past midnight, or null. */
export function parseTimeToMinutes(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

/** Parse a Builder schedule label into the deterministic subset. */
export function parseScheduleLabel(label: string | undefined): ParsedSchedule {
  const raw = (label ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (raw.length === 0) return { spec: null, issue: 'schedule label is empty' };

  let m = /^every (\d{1,4}) (minute|minutes|min|mins)$/.exec(raw);
  if (m) {
    const every = Number(m[1]);
    if (every < 1) return { spec: null, issue: 'interval must be ≥ 1 minute' };
    return { spec: { kind: 'interval', everyMinutes: every }, issue: null };
  }
  m = /^every (\d{1,2}) (hour|hours|hr|hrs)$/.exec(raw);
  if (m) return { spec: { kind: 'interval', everyMinutes: Number(m[1]) * 60 }, issue: null };
  if (raw === 'hourly') return { spec: { kind: 'hourly', atMinute: 0 }, issue: null };
  m = /^hourly at :?(\d{1,2})$/.exec(raw);
  if (m) {
    const atMinute = Number(m[1]);
    if (atMinute > 59) return { spec: null, issue: 'hourly minute must be 0–59' };
    return { spec: { kind: 'hourly', atMinute }, issue: null };
  }
  m = /^daily(?: at)? (.+)$/.exec(raw);
  if (m) {
    const atMinutes = parseTimeToMinutes(m[1]);
    if (atMinutes === null) return { spec: null, issue: `unparseable time "${m[1]}"` };
    return { spec: { kind: 'daily', atMinutes }, issue: null };
  }
  if (raw === 'daily') return { spec: { kind: 'daily', atMinutes: 9 * 60 }, issue: null };
  m = /^(?:weekly |every )([a-z]+)(?:(?: at)? (.+))?$/.exec(raw);
  if (m && DAYS[m[1]] !== undefined) {
    const atMinutes = m[2] ? parseTimeToMinutes(m[2]) : 9 * 60;
    if (atMinutes === null) return { spec: null, issue: `unparseable time "${m[2]}"` };
    return { spec: { kind: 'weekly', dayOfWeek: DAYS[m[1]], atMinutes }, issue: null };
  }
  if (raw === 'weekly') return { spec: { kind: 'weekly', dayOfWeek: 1, atMinutes: 9 * 60 }, issue: null };

  return {
    spec: null,
    issue: `label "${label}" is outside the deterministic subset (daily/weekly/hourly/interval + time)`,
  };
}

/* ── due evaluation (local wall-clock, the delivery-engine convention) ────── */

export interface DueResult {
  due: boolean;
  /** Stable key for the occurrence (dedupe across ticks; in-memory, like the delivery engine). */
  occurrenceKey: string;
}

/** Minute-resolution due check against local wall-clock time. */
export function scheduleDue(spec: ScheduleSpec, nowMs: number): DueResult {
  const d = new Date(nowMs);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  switch (spec.kind) {
    case 'daily':
      return { due: minutes === spec.atMinutes, occurrenceKey: `daily:${dayKey}` };
    case 'weekly':
      return {
        due: d.getDay() === spec.dayOfWeek && minutes === spec.atMinutes,
        occurrenceKey: `weekly:${dayKey}`,
      };
    case 'hourly':
      return {
        due: d.getMinutes() === spec.atMinute,
        occurrenceKey: `hourly:${dayKey}:${d.getHours()}`,
      };
    case 'interval': {
      const bucket = Math.floor(nowMs / 60_000 / spec.everyMinutes);
      return { due: true, occurrenceKey: `interval:${bucket}` };
    }
    default:
      return { due: false, occurrenceKey: 'never' };
  }
}

/** Next due time (ISO) after `nowMs`, for catalog display. Deterministic. */
export function nextDueIso(spec: ScheduleSpec, nowMs: number): string {
  const d = new Date(nowMs);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const minutesNow = d.getHours() * 60 + d.getMinutes();
  switch (spec.kind) {
    case 'daily': {
      const todayAt = startOfDay + spec.atMinutes * 60_000;
      return new Date(minutesNow < spec.atMinutes ? todayAt : todayAt + 86_400_000).toISOString();
    }
    case 'weekly': {
      let delta = (spec.dayOfWeek - d.getDay() + 7) % 7;
      if (delta === 0 && minutesNow >= spec.atMinutes) delta = 7;
      return new Date(startOfDay + delta * 86_400_000 + spec.atMinutes * 60_000).toISOString();
    }
    case 'hourly': {
      const thisHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), spec.atMinute).getTime();
      return new Date(d.getMinutes() < spec.atMinute ? thisHour : thisHour + 3_600_000).toISOString();
    }
    case 'interval': {
      const everyMs = spec.everyMinutes * 60_000;
      return new Date(Math.ceil((nowMs + 1) / everyMs) * everyMs).toISOString();
    }
    default:
      return new Date(nowMs).toISOString();
  }
}

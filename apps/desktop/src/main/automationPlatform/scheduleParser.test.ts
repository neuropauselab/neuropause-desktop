/**
 * Phase 6 Stage 8 — the deterministic schedule parser (D-3): the declared
 * subset parses, everything else becomes an explicit issue (never a guess),
 * due-evaluation is minute-exact with stable occurrence keys, and next-due is
 * deterministic. All wall-clock tests build local Dates explicitly so they are
 * timezone-independent.
 */
import { describe, expect, it } from 'vitest';
import { nextDueIso, parseScheduleLabel, parseTimeToMinutes, scheduleDue } from './scheduleParser';

const local = (h: number, m: number, dayShift = 0): number => {
  // A fixed local date (Wed 2026-07-15) shifted by whole days.
  return new Date(2026, 6, 15 + dayShift, h, m, 0, 0).getTime();
};

describe('parseTimeToMinutes', () => {
  it('parses am/pm and 24h forms', () => {
    expect(parseTimeToMinutes('9am')).toBe(9 * 60);
    expect(parseTimeToMinutes('9:30am')).toBe(9 * 60 + 30);
    expect(parseTimeToMinutes('5pm')).toBe(17 * 60);
    expect(parseTimeToMinutes('12am')).toBe(0);
    expect(parseTimeToMinutes('12pm')).toBe(12 * 60);
    expect(parseTimeToMinutes('17:00')).toBe(17 * 60);
    expect(parseTimeToMinutes('0:05')).toBe(5);
  });
  it('rejects out-of-range and garbage', () => {
    expect(parseTimeToMinutes('25:00')).toBeNull();
    expect(parseTimeToMinutes('13pm')).toBeNull();
    expect(parseTimeToMinutes('9:75')).toBeNull();
    expect(parseTimeToMinutes('noon')).toBeNull();
  });
});

describe('parseScheduleLabel — the deterministic subset', () => {
  it('parses daily forms', () => {
    expect(parseScheduleLabel('daily 9am').spec).toEqual({ kind: 'daily', atMinutes: 540 });
    expect(parseScheduleLabel('Daily at 17:30').spec).toEqual({ kind: 'daily', atMinutes: 1050 });
    expect(parseScheduleLabel('daily').spec).toEqual({ kind: 'daily', atMinutes: 540 });
  });
  it('parses weekly forms', () => {
    expect(parseScheduleLabel('weekly monday 9am').spec).toEqual({ kind: 'weekly', dayOfWeek: 1, atMinutes: 540 });
    expect(parseScheduleLabel('every friday at 5pm').spec).toEqual({ kind: 'weekly', dayOfWeek: 5, atMinutes: 1020 });
    expect(parseScheduleLabel('weekly').spec).toEqual({ kind: 'weekly', dayOfWeek: 1, atMinutes: 540 });
  });
  it('parses hourly + interval forms', () => {
    expect(parseScheduleLabel('hourly').spec).toEqual({ kind: 'hourly', atMinute: 0 });
    expect(parseScheduleLabel('hourly at :30').spec).toEqual({ kind: 'hourly', atMinute: 30 });
    expect(parseScheduleLabel('every 15 minutes').spec).toEqual({ kind: 'interval', everyMinutes: 15 });
    expect(parseScheduleLabel('every 2 hours').spec).toEqual({ kind: 'interval', everyMinutes: 120 });
  });
  it('everything outside the subset is an explicit issue, never a guess', () => {
    for (const label of ['0 9 * * *', 'when the moon is full', 'sometimes', 'every blue monday maybe']) {
      const parsed = parseScheduleLabel(label);
      expect(parsed.spec).toBeNull();
      expect(parsed.issue).toBeTruthy();
    }
    expect(parseScheduleLabel(undefined).issue).toBe('schedule label is empty');
    expect(parseScheduleLabel('  ').issue).toBe('schedule label is empty');
    expect(parseScheduleLabel('daily at half past nine').issue).toContain('unparseable time');
  });
});

describe('scheduleDue — minute-exact with stable occurrence keys', () => {
  it('daily fires exactly at its minute, keyed by day', () => {
    const spec = { kind: 'daily', atMinutes: 540 } as const;
    expect(scheduleDue(spec, local(9, 0)).due).toBe(true);
    expect(scheduleDue(spec, local(9, 1)).due).toBe(false);
    expect(scheduleDue(spec, local(8, 59)).due).toBe(false);
    expect(scheduleDue(spec, local(9, 0)).occurrenceKey).toBe(scheduleDue(spec, local(9, 0)).occurrenceKey);
    expect(scheduleDue(spec, local(9, 0)).occurrenceKey).not.toBe(scheduleDue(spec, local(9, 0, 1)).occurrenceKey);
  });
  it('weekly requires the right weekday', () => {
    // 2026-07-15 is a Wednesday (day 3).
    const wedSpec = { kind: 'weekly', dayOfWeek: 3, atMinutes: 600 } as const;
    const monSpec = { kind: 'weekly', dayOfWeek: 1, atMinutes: 600 } as const;
    expect(scheduleDue(wedSpec, local(10, 0)).due).toBe(true);
    expect(scheduleDue(monSpec, local(10, 0)).due).toBe(false);
  });
  it('hourly fires at its minute each hour with per-hour keys', () => {
    const spec = { kind: 'hourly', atMinute: 30 } as const;
    expect(scheduleDue(spec, local(9, 30)).due).toBe(true);
    expect(scheduleDue(spec, local(9, 31)).due).toBe(false);
    expect(scheduleDue(spec, local(9, 30)).occurrenceKey).not.toBe(scheduleDue(spec, local(10, 30)).occurrenceKey);
  });
  it('interval is always due with a bucketed key (the tick dedupes per bucket)', () => {
    const spec = { kind: 'interval', everyMinutes: 15 } as const;
    const a = scheduleDue(spec, local(9, 0));
    const b = scheduleDue(spec, local(9, 10));
    const c = scheduleDue(spec, local(9, 16));
    expect(a.due && b.due && c.due).toBe(true);
    expect(a.occurrenceKey).toBe(b.occurrenceKey); // same 15-min bucket
    expect(a.occurrenceKey).not.toBe(c.occurrenceKey);
  });
});

describe('nextDueIso — deterministic display', () => {
  it('daily: today when still ahead, tomorrow when passed', () => {
    const spec = { kind: 'daily', atMinutes: 540 } as const;
    expect(nextDueIso(spec, local(8, 0))).toBe(new Date(2026, 6, 15, 9, 0).toISOString());
    expect(nextDueIso(spec, local(10, 0))).toBe(new Date(2026, 6, 16, 9, 0).toISOString());
  });
  it('weekly rolls to the next matching weekday', () => {
    const spec = { kind: 'weekly', dayOfWeek: 1, atMinutes: 540 } as const; // Monday
    // From Wed 2026-07-15 → Mon 2026-07-20.
    expect(nextDueIso(spec, local(10, 0))).toBe(new Date(2026, 6, 20, 9, 0).toISOString());
  });
  it('hourly: this hour when ahead, next hour when passed', () => {
    const spec = { kind: 'hourly', atMinute: 30 } as const;
    expect(nextDueIso(spec, local(9, 10))).toBe(new Date(2026, 6, 15, 9, 30).toISOString());
    expect(nextDueIso(spec, local(9, 45))).toBe(new Date(2026, 6, 15, 10, 30).toISOString());
  });
});

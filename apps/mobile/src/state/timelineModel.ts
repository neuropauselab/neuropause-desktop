/**
 * Timeline view-model (Mobile M1-11) — PURE day-grouping + paging helpers for
 * the Activity Timeline, split from the screen so they unit-test in plain Node.
 * Day keys are taken DIRECTLY from the ISO string (no Date/Date.now), so
 * grouping is deterministic and timezone-stable across the test host and device.
 */
import type { CompanionTimelineEntry } from '@neuropause/shared';

export interface TimelineDay {
  /** YYYY-MM-DD, taken from the entry's ISO timestamp. */
  day: string;
  /** Human label, e.g. "Aug 7, 2026". */
  label: string;
  entries: CompanionTimelineEntry[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar-day key (YYYY-MM-DD) from an ISO timestamp, or '' if malformed. */
export function dayKey(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
}

/** Deterministic human label for a day key (no Date, so no TZ drift). */
export function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return 'Unknown date';
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1] ?? mo} ${Number(d)}, ${y}`;
}

/** Clock label (HH:MM) taken from the ISO string, or '' if absent. */
export function timeLabel(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : '';
}

/** Group entries into days, preserving input order of both days and entries. */
export function groupByDay(entries: CompanionTimelineEntry[]): TimelineDay[] {
  const order: string[] = [];
  const byKey = new Map<string, TimelineDay>();
  for (const e of entries) {
    const key = dayKey(e.at);
    let day = byKey.get(key);
    if (!day) {
      day = { day: key, label: dayLabel(key), entries: [] };
      byKey.set(key, day);
      order.push(key);
    }
    day.entries.push(e);
  }
  return order.map((k) => byKey.get(k) as TimelineDay);
}

/** Append a fetched page, de-duplicating by id (first occurrence + order win). */
export function mergeEntries(
  existing: CompanionTimelineEntry[],
  incoming: CompanionTimelineEntry[],
): CompanionTimelineEntry[] {
  const seen = new Set(existing.map((e) => e.id));
  const merged = existing.slice();
  for (const e of incoming) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      merged.push(e);
    }
  }
  return merged;
}

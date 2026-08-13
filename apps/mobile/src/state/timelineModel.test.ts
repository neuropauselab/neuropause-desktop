/**
 * Mobile M1-11 — pure tests for the Timeline view-model.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionTimelineEntry } from '@neuropause/shared';
import { dayKey, dayLabel, groupByDay, mergeEntries, timeLabel } from './timelineModel';

const entry = (id: string, at: string): CompanionTimelineEntry => ({
  id,
  at,
  title: `event ${id}`,
  summary: null,
  category: 'work',
  kind: 'record.created',
  actorLabel: null,
});

describe('timelineModel', () => {
  it('extracts day and time keys from an ISO string without Date', () => {
    expect(dayKey('2026-08-07T09:30:00.000Z')).toBe('2026-08-07');
    expect(dayKey('nope')).toBe('');
    expect(timeLabel('2026-08-07T09:30:00.000Z')).toBe('09:30');
    expect(timeLabel('2026-08-07')).toBe('');
  });

  it('labels a day key deterministically', () => {
    expect(dayLabel('2026-08-07')).toBe('Aug 7, 2026');
    expect(dayLabel('2026-01-01')).toBe('Jan 1, 2026');
    expect(dayLabel('')).toBe('Unknown date');
  });

  it('groups entries by day preserving order', () => {
    const days = groupByDay([
      entry('a', '2026-08-07T10:00:00Z'),
      entry('b', '2026-08-07T09:00:00Z'),
      entry('c', '2026-08-06T23:00:00Z'),
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-08-07', '2026-08-06']);
    expect(days[0].label).toBe('Aug 7, 2026');
    expect(days[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(days[1].entries).toHaveLength(1);
  });

  it('merges a new page, de-duplicating by id', () => {
    const first = [entry('a', '2026-08-07T10:00:00Z'), entry('b', '2026-08-07T09:00:00Z')];
    const next = [entry('b', '2026-08-07T09:00:00Z'), entry('c', '2026-08-06T23:00:00Z')];
    const merged = mergeEntries(first, next);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

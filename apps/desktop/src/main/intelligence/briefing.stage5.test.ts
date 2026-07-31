/**
 * Phase 6 Stage 5 (D-2) — the additive `afternoon` briefing period: same-day
 * range (like morning), its own headline lead, and presence in the canonical
 * period list. The other four periods stay untouched.
 */
import { describe, expect, it } from 'vitest';
import { BRIEFING_PERIODS } from '@neuropause/shared';
import { rangeFor } from './classify';
import { generateBriefing } from './briefingGenerator';

const NOW = '2026-07-31T14:30:00.000Z';

describe('afternoon period', () => {
  it('is registered in BRIEFING_PERIODS between morning and evening', () => {
    expect(BRIEFING_PERIODS).toContain('afternoon');
    expect(BRIEFING_PERIODS.indexOf('afternoon')).toBeGreaterThan(BRIEFING_PERIODS.indexOf('morning'));
    expect(BRIEFING_PERIODS.indexOf('afternoon')).toBeLessThan(BRIEFING_PERIODS.indexOf('evening'));
  });

  it('uses the same-day window (identical to morning)', () => {
    const afternoon = rangeFor('afternoon', NOW);
    const morning = rangeFor('morning', NOW);
    expect(afternoon).toEqual(morning);
    expect(afternoon.until).toBe(NOW);
    expect(Date.parse(afternoon.since)).toBeLessThanOrEqual(Date.parse(NOW));
  });

  it('generates an honest empty afternoon brief from no data', () => {
    const b = generateBriefing('afternoon', { entities: [], events: [], now: NOW });
    expect(b.period).toBe('afternoon');
    expect(b.grounded).toBe(false);
    // ungrounded briefs keep the honest no-data headline (period-independent)
    expect(b.headline).toContain('No connected data');
  });

  it('uses the "So far today" lead once real data exists', () => {
    const task = {
      id: 't1',
      kind: 'task',
      connectorId: 'm365',
      accountId: 'a',
      sourceId: 't1',
      createdAt: NOW,
      updatedAt: NOW,
      syncState: 'active',
      syncedAt: NOW,
      metadata: {},
      title: 'Ship it',
      url: null,
      parentId: null,
      containerId: null,
      body: null,
      status: 'completed',
      author: null,
      timestamp: NOW,
      endTimestamp: null,
      labels: [],
    };
    const b = generateBriefing('afternoon', {
      entities: [task as never],
      events: [],
      now: NOW,
    });
    expect(b.grounded).toBe(true);
    expect(b.headline.startsWith('So far today')).toBe(true);
  });
});

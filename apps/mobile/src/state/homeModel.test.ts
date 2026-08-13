/**
 * Mobile M1-09 — pure tests for the Home view-model derivations.
 */
import { describe, expect, it } from 'vitest';
import type { CompanionBriefing } from '@neuropause/shared';
import { approvalsBand, compactCount, greeting, homeTiles, totalRecords } from './homeModel';

const briefing = (over: Partial<CompanionBriefing> = {}): CompanionBriefing => ({
  period: 'morning',
  generatedAt: '2026-08-08T06:00:00.000Z',
  headline: 'All systems steady.',
  kpis: [],
  pendingApprovals: 0,
  urgentApprovals: [],
  families: [
    { group: 'Finance', moduleCount: 6, recordCount: 1200 },
    { group: 'HR', moduleCount: 4, recordCount: 350 },
  ],
  ...over,
});

describe('homeModel', () => {
  it('greets by period', () => {
    expect(greeting('morning')).toBe('Good morning');
    expect(greeting('evening')).toBe('Good evening');
  });

  it('sums live records across families', () => {
    expect(totalRecords(briefing())).toBe(1550);
  });

  it('compacts large counts', () => {
    expect(compactCount(950)).toBe('950');
    expect(compactCount(1550)).toBe('1.6k');
    expect(compactCount(2_000_000)).toBe('2M');
  });

  it('bands the approvals tile by urgency', () => {
    expect(approvalsBand(0)).toBe('healthy');
    expect(approvalsBand(3)).toBe('watch');
    expect(approvalsBand(5)).toBe('at-risk');
  });

  it('builds three headline tiles from the briefing', () => {
    const tiles = homeTiles(briefing({ pendingApprovals: 3 }));
    expect(tiles.map((t) => t.key)).toEqual(['approvals', 'families', 'records']);
    const [approvals, families, records] = tiles;
    expect(approvals.value).toBe('3');
    expect(approvals.band).toBe('watch');
    expect(approvals.emphasis).toBe(true);
    expect(families.value).toBe('2');
    expect(records.value).toBe('1.6k');
  });

  it('marks the approvals tile calm when nothing is pending', () => {
    const [approvals] = homeTiles(briefing({ pendingApprovals: 0 }));
    expect(approvals.band).toBe('healthy');
    expect(approvals.emphasis).toBe(false);
  });
});

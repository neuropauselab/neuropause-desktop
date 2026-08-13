/**
 * IP-03 — the composed industry snapshot over the REAL canonical catalog.
 */
import { describe, expect, it } from 'vitest';
import { industrySnapshot } from './industrySnapshot';

describe('industrySnapshot', () => {
  it('composes the canonical catalog into a plain, desktop-ready snapshot', () => {
    const snap = industrySnapshot();
    expect(snap.source).toBe('catalog');
    expect(snap.version.length).toBeGreaterThan(0);
    expect(snap.industries.length).toBeGreaterThanOrEqual(20);
  });

  it('returns industries sorted by name, each with counts', () => {
    const names = industrySnapshot().industries.map((i) => i.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    expect(
      industrySnapshot().industries.every(
        (i) => typeof i.counts.objects === 'number' && typeof i.approvalWorkflows === 'number',
      ),
    ).toBe(true);
  });

  it('groups capabilities by area and reports a consistent readiness view', () => {
    const snap = industrySnapshot();
    expect(snap.capabilities.length).toBeGreaterThan(0);
    expect(snap.readiness.total).toBeGreaterThan(0);
    expect(snap.readiness.liveVerifiedPct).toBeGreaterThanOrEqual(0);
    expect(snap.readiness.liveVerifiedPct).toBeLessThanOrEqual(100);
  });
});

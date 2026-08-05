/**
 * Phase 6 Stage 12 — deterministic trends over RECORDED windows only: the
 * fixed direction rule (±1 stability), the two 90-day history series, the
 * Stage 10 decision-window deltas composed verbatim, insufficient-history
 * honesty, and the declared-untrendable point-in-time rows. No extrapolation
 * exists to test — and the disclosure says so.
 */
import { describe, expect, it } from 'vitest';
import { buildTrendReport, directionFor, STABLE_EPSILON, TREND_DISCLOSURE } from './trendAnalytics';
import { SERIES_REGISTRY } from './analyticsRegistry';

const NOW = '2026-08-01T09:00:00.000Z';

function days(values: [number, number][]): { day: string; overall: number; engineering: number }[] {
  return values.map(([overall, engineering], i) => ({
    day: `2026-07-${String(i + 1).padStart(2, '0')}`,
    overall,
    engineering,
  }));
}

describe('directionFor — the fixed deterministic rule', () => {
  it('is stable within ±STABLE_EPSILON, directional beyond it, unavailable on missing edges', () => {
    expect(STABLE_EPSILON).toBe(1);
    expect(directionFor(80, 80)).toEqual({ direction: 'stable', delta: 0 });
    expect(directionFor(80, 81)).toEqual({ direction: 'stable', delta: 1 });
    expect(directionFor(80, 79)).toEqual({ direction: 'stable', delta: -1 });
    expect(directionFor(80, 82)).toEqual({ direction: 'improving', delta: 2 });
    expect(directionFor(80, 77)).toEqual({ direction: 'regressing', delta: -3 });
    expect(directionFor(null, 80)).toEqual({ direction: 'unavailable', delta: null });
    expect(directionFor(80, null)).toEqual({ direction: 'unavailable', delta: null });
  });
});

describe('buildTrendReport — recorded windows only', () => {
  it('computes both history series over the recorded window (sorted by day)', () => {
    const r = buildTrendReport({
      nowIso: NOW,
      // Deliberately unsorted — the module sorts by day before comparing.
      history: [days([[70, 60], [75, 58], [78, 55]])[2], days([[70, 60], [75, 58], [78, 55]])[0], days([[70, 60], [75, 58], [78, 55]])[1]],
      valueDeltas: [],
      failures: {},
    });
    const org = r.rows.find((x) => x.seriesId === 'org-health-history')!;
    expect(org.direction).toBe('improving');
    expect(org.from).toBe(70);
    expect(org.to).toBe(78);
    expect(org.delta).toBe(8);
    expect(org.windowLabel).toContain('3 recorded day(s)');
    const eng = r.rows.find((x) => x.seriesId === 'engineering-health-history')!;
    expect(eng.direction).toBe('regressing');
    expect(eng.delta).toBe(-5);
  });

  it('a single recorded point is honestly unavailable — a trend needs at least two', () => {
    const r = buildTrendReport({ nowIso: NOW, history: days([[70, 60]]), valueDeltas: [], failures: {} });
    const org = r.rows.find((x) => x.seriesId === 'org-health-history')!;
    expect(org.direction).toBe('unavailable');
    expect(org.detail).toContain('at least two');
  });

  it('composes the Stage 10 decision-window deltas verbatim, missing edges declared not interpolated', () => {
    const r = buildTrendReport({
      nowIso: NOW,
      history: days([[70, 60], [72, 61]]),
      valueDeltas: [
        {
          decisionId: 'dec-1',
          title: 'Consolidate connectors',
          deltas: [
            { label: 'Org health', before: 70, after: 76 },
            { label: 'Engineering health', before: null, after: 61 },
          ],
        },
      ],
      failures: {},
    });
    const good = r.rows.find((x) => x.seriesId === 'decision:dec-1:Org health')!;
    expect(good.kind).toBe('decision-window');
    expect(good.direction).toBe('improving');
    expect(good.detail).toBe('70 → 76 over the decision window');
    const missing = r.rows.find((x) => x.seriesId === 'decision:dec-1:Engineering health')!;
    expect(missing.direction).toBe('unavailable');
    expect(missing.detail).toContain('not interpolated');
  });

  it('every point-in-time registry series appears ONLY as a declared-untrendable row', () => {
    const r = buildTrendReport({ nowIso: NOW, history: days([[70, 60], [72, 61]]), valueDeltas: [], failures: {} });
    for (const s of SERIES_REGISTRY.filter((x) => x.kind === 'point-in-time')) {
      const row = r.rows.find((x) => x.seriesId === s.id)!;
      expect(row.direction, s.id).toBe('unavailable');
      expect(row.delta, s.id).toBeNull();
      expect(row.detail, s.id).toContain('A snapshot is not a trend');
    }
  });

  it('unreadable sources are declared; totals count directions; the disclosure states the honesty rule', () => {
    const r = buildTrendReport({
      nowIso: NOW,
      history: null,
      valueDeltas: null,
      failures: { 'health-history': 'store threw', 's10-value': 'strategy read threw' },
    });
    expect(r.rows.find((x) => x.seriesId === 'org-health-history')!.direction).toBe('unavailable');
    expect(r.rows.find((x) => x.seriesId === 'decision-window-deltas')!.direction).toBe('unavailable');
    expect(r.unavailable).toHaveLength(2);
    expect(r.totals.improving + r.totals.stable + r.totals.regressing + r.totals.unavailable).toBe(r.rows.length);
    expect(r.disclosure).toBe(TREND_DISCLOSURE);
    expect(r.disclosure).toContain('No extrapolation');
  });
});

/**
 * Phase 6 Stage 9 — business processes: registry names join the MINED
 * assessment; not-mined registry processes and unregistered mined types BOTH
 * surface as gaps (nothing silently dropped); totals stay honest.
 */
import { describe, expect, it } from 'vitest';
import { buildProcessReport } from './businessProcesses';

const NOW_ISO = '2026-07-31T09:00:00.000Z';

describe('buildProcessReport', () => {
  it('joins mined metrics onto registry rows and flags the declared not-mined process', () => {
    const r = buildProcessReport({
      nowIso: NOW_ISO,
      mined: [
        { type: 'order_to_cash', cases: 12, medianDurationMs: 7_200_000, onTimeRate: 0.8 },
        { type: 'procure_to_pay', cases: 4, medianDurationMs: null, onTimeRate: null },
      ],
      failures: {},
    });
    const otc = r.rows.find((x) => x.processId === 'order-to-cash')!;
    expect(otc.status).toBe('mined');
    expect(otc.metrics?.cases).toBe(12);
    const mtc = r.rows.find((x) => x.processId === 'make-to-complete')!;
    expect(mtc.status).toBe('not-mined');
    expect(r.gaps.some((g) => g.subject === 'make-to-complete' && g.detail.includes('no "make_to_complete" cases'))).toBe(true);
    // The registry's declared-unmined process is a standing gap.
    expect(r.gaps.some((g) => g.subject === 'employee-onboarding' && g.detail.includes('mining has no such type'))).toBe(true);
  });

  it('mined types the registry does not name surface as unregistered rows + gaps', () => {
    const r = buildProcessReport({
      nowIso: NOW_ISO,
      mined: [{ type: 'mystery_flow', cases: 3, medianDurationMs: 1000, onTimeRate: 1 }],
      failures: {},
    });
    const un = r.rows.find((x) => x.processId === 'unregistered:mystery_flow')!;
    expect(un.status).toBe('unregistered');
    expect(r.gaps.some((g) => g.subject === 'mystery_flow' && g.detail.includes('registry does not name it'))).toBe(true);
    expect(r.totals.unregistered).toBe(1);
  });

  it('a null mining read produces registry rows without fake not-mined gaps', () => {
    const r = buildProcessReport({ nowIso: NOW_ISO, mined: null, failures: { 'process-mining': 'provider offline' } });
    expect(r.rows).toHaveLength(4);
    expect(r.rows.every((x) => x.status === 'not-mined')).toBe(true);
    // Only the declared-unmined registry gap exists; no per-type "no cases" gaps were invented.
    expect(r.gaps.filter((g) => g.detail.includes('no "')).length).toBe(0);
    expect(r.unavailable).toContainEqual({ system: 'process-mining', reason: 'provider offline' });
  });

  it('totals: registered counts the registry; mined counts joined + unregistered rows', () => {
    const r = buildProcessReport({
      nowIso: NOW_ISO,
      mined: [
        { type: 'order_to_cash', cases: 1, medianDurationMs: null, onTimeRate: null },
        { type: 'mystery_flow', cases: 2, medianDurationMs: null, onTimeRate: null },
      ],
      failures: {},
    });
    expect(r.totals).toEqual({ registered: 4, mined: 2, unregistered: 1 });
  });
});

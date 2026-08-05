/**
 * Phase 6 Stage 12 — the forecast inventory: registers ALL existing predictive
 * capability (never invents any), joins the currently-firing Stage 6 instances,
 * carries the P14 scenario count, registers capacity pressure as predicting
 * nothing, and counts live instances from heuristics only. The module computes
 * counts, never futures — and its disclosure says so.
 */
import { describe, expect, it } from 'vitest';
import { buildForecastInventory, FORECAST_DISCLOSURE } from './forecastInventory';
import { PREDICTION_REGISTRY, REAL_PREDICTION_KINDS } from './analyticsRegistry';

const NOW = '2026-08-01T09:00:00.000Z';

describe('buildForecastInventory — a register, never a forecaster', () => {
  it('registers every capability from the registry — nine entries, none invented, none dropped', () => {
    const f = buildForecastInventory({ nowIso: NOW, predictions: [], simulation: null, capacityPressure: null, failures: {} });
    expect(f.entries).toHaveLength(PREDICTION_REGISTRY.length);
    expect(f.entries.map((e) => e.id).sort()).toEqual(PREDICTION_REGISTRY.map((p) => p.id).sort());
    expect(f.totals.registered).toBe(9);
  });

  it('joins firing Stage 6 instances to their heuristic — count and likelihoods stated', () => {
    const f = buildForecastInventory({
      nowIso: NOW,
      predictions: [
        { kind: 'connector-instability', likelihood: 0.7 },
        { kind: 'connector-instability', likelihood: 0.55 },
        { kind: 'approval-backlog', likelihood: 0.6 },
      ],
      simulation: { scenarios: 3 },
      capacityPressure: 'elevated',
      failures: {},
    });
    const conn = f.entries.find((e) => e.id === 'connector-instability')!;
    expect(conn.live).toEqual({ count: 2, detail: '2 instance(s) firing (likelihood 0.70, 0.55)' });
    const idle = f.entries.find((e) => e.id === 'project-delay')!;
    expect(idle.live!.count).toBe(0);
    expect(idle.live!.detail).toContain('not firing');
    expect(f.totals.liveInstances).toBe(3);
  });

  it('a silent heuristic means "condition does not hold or history insufficient" — never invented', () => {
    const f = buildForecastInventory({ nowIso: NOW, predictions: [], simulation: null, capacityPressure: null, failures: {} });
    for (const kind of REAL_PREDICTION_KINDS) {
      const e = f.entries.find((x) => x.id === kind)!;
      expect(e.live!.count, kind).toBe(0);
      expect(e.live!.detail, kind).toContain('not firing');
    }
  });

  it('live instance totals count HEURISTIC instances only — scenarios and pressure are not predictions firing', () => {
    const f = buildForecastInventory({
      nowIso: NOW,
      predictions: [],
      simulation: { scenarios: 5 },
      capacityPressure: 'high',
      failures: {},
    });
    expect(f.totals.liveInstances).toBe(0);
    expect(f.entries.find((e) => e.id === 'p14-simulation')!.live!.detail).toContain('5 authored scenario(s)');
    const cap = f.entries.find((e) => e.id === 'capacity-pressure')!;
    expect(cap.live!.detail).toBe('present pressure: high');
    expect(cap.canPredict).toContain('Nothing');
  });

  it('an unreadable predictions feed leaves the heuristic joins null and declares the failure', () => {
    const f = buildForecastInventory({
      nowIso: NOW,
      predictions: null,
      simulation: null,
      capacityPressure: null,
      failures: { 'insight-predictions': 'insight read threw' },
    });
    for (const kind of REAL_PREDICTION_KINDS) expect(f.entries.find((x) => x.id === kind)!.live, kind).toBeNull();
    expect(f.unavailable).toContainEqual({ system: 'insight-predictions', reason: 'insight read threw' });
    expect(f.totals.liveInstances).toBe(0);
  });

  it('every entry states canPredict AND cannotPredict; the disclosure states no statistical/ML forecasting exists', () => {
    const f = buildForecastInventory({ nowIso: NOW, predictions: [], simulation: null, capacityPressure: null, failures: {} });
    for (const e of f.entries) {
      expect(e.canPredict.length, e.id).toBeGreaterThan(0);
      expect(e.cannotPredict.length, e.id).toBeGreaterThan(0);
      expect(e.basis.length, e.id).toBeGreaterThan(0);
    }
    expect(f.disclosure).toBe(FORECAST_DISCLOSURE);
    expect(f.disclosure).toContain('no statistical or ML forecasting');
    expect(f.disclosure).toContain('adds none');
  });
});

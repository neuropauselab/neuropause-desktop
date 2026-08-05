/**
 * Phase 6 Stage 12 — composition budgets, measured over a realistic seeded
 * fixture AFTER a warmup pass (the Stage 8–11 bench pattern): KPI catalog /
 * trends / forecasts / decisions component builds ≤ 100 ms each; the full
 * dashboard and the analytics report ≤ 500 ms; a warm read (inside the TTL)
 * ≤ 20 ms. The bench advances the injected clock to defeat the TTL per
 * measurement.
 */
import { describe, expect, it } from 'vitest';
import { initAnalyticsPlatform, type AnalyticsPlatformDeps } from './index';

const T0 = Date.parse('2026-08-01T09:00:00.000Z');

function mkDeps(): { deps: AnalyticsPlatformDeps; tick: () => void } {
  let nowMs = T0;
  // Realistic volume: 40 executive KPIs (plugins included), 12 process KPIs,
  // 90 recorded days, 25 decisions with windows, 30 firing predictions.
  const exec = Array.from({ length: 40 }, (_, i) => ({
    key: i < 6 ? ['org-health', 'engineering-health', 'ai-adoption', 'connector-health', 'license-status', 'active-members'][i] : `plugin.tile-${i}`,
    label: `KPI ${i}`,
    display: `${60 + (i % 40)}/100`,
    value: 60 + (i % 40),
    band: (['healthy', 'watch', 'at-risk', 'healthy'] as const)[i % 4],
  }));
  const proc = Array.from({ length: 12 }, (_, i) => ({
    key: `process-metric-${i}`,
    label: `Process ${i}`,
    display: `${i}h`,
    value: i,
    band: 'healthy',
  }));
  const history = Array.from({ length: 90 }, (_, i) => ({
    day: `2026-${String(5 + Math.floor(i / 30)).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
    overall: 70 + (i % 12),
    engineering: 65 + (i % 9),
  }));
  const valueDeltas = Array.from({ length: 25 }, (_, i) => ({
    decisionId: `d${i}`,
    title: `Decision ${i}`,
    deltas: [
      { label: 'Org health', before: 70 + (i % 5), after: 68 + (i % 9) },
      { label: 'Engineering health', before: 65, after: 66 },
    ],
  }));
  const predictions = Array.from({ length: 30 }, (_, i) => ({
    kind: ['approval-backlog', 'project-delay', 'connector-instability', 'automation-failure', 'inactivity', 'operational-drift', 'risk-trend'][i % 7],
    likelihood: 0.4 + (i % 5) * 0.1,
  }));
  const deps: AnalyticsPlatformDeps = {
    executiveKpis: () => exec,
    processKpis: () => proc,
    p14Kpis: () => exec.slice(0, 6),
    p18Kpis: () => exec.slice(0, 4),
    healthHistory: () => history,
    valueDeltas: () => valueDeltas,
    valueTotals: () => ({ delivered: 8, partial: 5, notYetObserved: 7, unmeasurable: 5 }),
    insightPredictions: () => predictions,
    p14Simulation: () => ({ scenarios: 4 }),
    capacityPressure: () => 'elevated',
    decisions: () => Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, status: ['approved', 'proposed', 'executed'][i % 3], fromRecommendationId: i % 2 === 0 ? `rec-${i}` : null })),
    insightOutcomes: () => Array.from({ length: 13 }, (_, i) => ({ id: `rec-${i * 2}`, stage: ['recommended', 'approved', 'executed', 'verified'][i % 4] })),
    strategyRecs: () => ({ count: 4, criticalOrHigh: 1 }),
    federationRecs: () => ({ count: 2, criticalOrHigh: 1 }),
    s8Monitor: () => ({ findings: 6, criticalOrHigh: 1 }),
    s9Slices: () => ({ slaTargets: 4, slaMet: 3, slaBreached: 1, readinessReady: 5, readinessNotReady: 2 }),
    s10Totals: () => ({ offTrack: 1, atRisk: 2, blocked: 1 }),
    s11Totals: () => ({ partners: 12, declaredAboveEvidence: 3 }),
    p18Benchmark: () => ({ position: 'average', healthBand: 'watch' }),
    registerSource: () => {},
    now: () => nowMs,
  };
  return { deps, tick: () => (nowMs += 10_000) };
}

function measure(fn: () => unknown): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe('composition budgets — measured, after warmup', () => {
  it('kpis / trends / forecasts / decisions cold builds ≤ 100 ms; dashboard / report ≤ 500 ms', () => {
    const { deps, tick } = mkDeps();
    const p = initAnalyticsPlatform(deps);
    p.dashboard(); // warmup pass

    tick();
    const kpis = measure(() => p.kpis());
    tick();
    const trends = measure(() => p.trends());
    tick();
    const forecasts = measure(() => p.forecasts());
    tick();
    const decisions = measure(() => p.decisions());
    tick();
    const dashboard = measure(() => p.dashboard());
    tick();
    const report = measure(() => p.report());

    expect(kpis, `kpi catalog build ${kpis.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(trends, `trend build ${trends.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(forecasts, `forecast inventory build ${forecasts.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(decisions, `decision rollup build ${decisions.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(dashboard, `dashboard build ${dashboard.toFixed(1)}ms`).toBeLessThanOrEqual(500);
    expect(report, `analytics report build ${report.toFixed(1)}ms`).toBeLessThanOrEqual(500);
  });

  it('a warm read (inside the TTL) is near-instant (≤ 20 ms)', () => {
    const { deps, tick } = mkDeps();
    const p = initAnalyticsPlatform(deps);
    tick();
    p.dashboard();
    const warm = measure(() => p.dashboard());
    expect(warm, `warm read ${warm.toFixed(1)}ms`).toBeLessThanOrEqual(20);
  });
});

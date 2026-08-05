/**
 * Phase 6 Stage 12 — registry integrity + the doc lock (the Stage 6–11
 * precedent): the analytics registries are structurally valid, cover the REAL
 * vocabularies exactly (the ten KPI producers, the six executive + four
 * specialist keys, the seven Stage 6 prediction kinds, the recorded vs
 * point-in-time series), and are locked to
 * docs/desktop/analytics/ANALYTICS-PLATFORM.md so code and documentation
 * cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EANA_QUESTION_KEYS, type InsightPredictionKind } from '@neuropause/shared';
import {
  analyticsRegistryIssues,
  BENCHMARK_SOURCE_REGISTRY,
  DASHBOARD_REGISTRY,
  DECISION_SOURCE_REGISTRY,
  KNOWN_KPI_PRODUCER_BY_KEY,
  KPI_PRODUCER_REGISTRY,
  PREDICTION_REGISTRY,
  REAL_EXEC_KPI_KEYS,
  REAL_PREDICTION_KINDS,
  REAL_SPECIALIST_KPI_KEYS,
  REPORT_REGISTRY,
  SERIES_REGISTRY,
} from './analyticsRegistry';

describe('registry integrity', () => {
  it('reports zero issues for the shipped registries', () => {
    expect(analyticsRegistryIssues()).toEqual([]);
  });

  it('registers exactly the ten verified KPI producers', () => {
    expect(KPI_PRODUCER_REGISTRY).toHaveLength(10);
    expect(KPI_PRODUCER_REGISTRY.map((p) => p.id).sort()).toEqual(
      [
        'executive-core',
        'work-intelligence-automation',
        'work-intelligence-knowledge',
        'workforce-performance',
        'enterprise-insights',
        'process-mining',
        'plugin-extensions',
        'p14-strategy-surface',
        'p18-network-surface',
        's9-kpi-catalog',
      ].sort(),
    );
  });

  it('the P14/P18 entries are reuse-surfaces and Stage 9 is the acknowledged partial catalog — never second producers', () => {
    expect(KPI_PRODUCER_REGISTRY.find((p) => p.id === 'p14-strategy-surface')!.kind).toBe('reuse-surface');
    expect(KPI_PRODUCER_REGISTRY.find((p) => p.id === 'p18-network-surface')!.kind).toBe('reuse-surface');
    expect(KPI_PRODUCER_REGISTRY.find((p) => p.id === 's9-kpi-catalog')!.kind).toBe('partial-catalog');
  });

  it('maps every static executive + specialist key to a registered producer', () => {
    for (const k of [...REAL_EXEC_KPI_KEYS, ...REAL_SPECIALIST_KPI_KEYS]) {
      expect(KNOWN_KPI_PRODUCER_BY_KEY.has(k), k).toBe(true);
    }
    expect(REAL_EXEC_KPI_KEYS).toHaveLength(6);
    expect(REAL_SPECIALIST_KPI_KEYS).toHaveLength(4);
  });

  it('the seven registered heuristic kinds ARE the shared InsightPredictionKind union — none invented, none missing', () => {
    // The union is a TYPE (no runtime array in shared) — the assignment below
    // makes TypeScript itself enforce that this list matches the union exactly.
    const KINDS: InsightPredictionKind[] = [
      'approval-backlog',
      'project-delay',
      'connector-instability',
      'automation-failure',
      'inactivity',
      'operational-drift',
      'risk-trend',
    ];
    expect([...REAL_PREDICTION_KINDS].sort()).toEqual([...KINDS].sort());
    const heuristics = PREDICTION_REGISTRY.filter((p) => p.kind === 'deterministic-heuristic');
    expect(heuristics.map((h) => h.id).sort()).toEqual([...KINDS].sort());
  });

  it('every predictive entry states what it CANNOT predict — including capacity pressure predicting nothing', () => {
    for (const p of PREDICTION_REGISTRY) {
      expect(p.canPredict.length, p.id).toBeGreaterThan(0);
      expect(p.cannotPredict.length, p.id).toBeGreaterThan(0);
      expect(p.basis.length, p.id).toBeGreaterThan(0);
    }
    const capacity = PREDICTION_REGISTRY.find((p) => p.id === 'capacity-pressure')!;
    expect(capacity.kind).toBe('present-state-composition');
    expect(capacity.canPredict).toContain('Nothing');
  });

  it('the series registry tags the ONLY recorded windows as such — everything else is point-in-time', () => {
    const recorded = SERIES_REGISTRY.filter((s) => s.kind !== 'point-in-time').map((s) => s.id);
    expect(recorded.sort()).toEqual(['decision-window-deltas', 'engineering-health-history', 'org-health-history'].sort());
    expect(SERIES_REGISTRY.filter((s) => s.kind === 'point-in-time').length).toBeGreaterThan(0);
  });

  it('reports/dashboards/decision-sources/benchmarks name the shipped surfaces', () => {
    expect(REPORT_REGISTRY.length).toBe(4);
    expect(DASHBOARD_REGISTRY.length).toBe(6);
    expect(DECISION_SOURCE_REGISTRY.length).toBe(5);
    expect(BENCHMARK_SOURCE_REGISTRY.map((b) => b.id)).toEqual(['p18-network-benchmarks']);
  });
});

describe('registry ↔ doc lock (docs/desktop/analytics/ANALYTICS-PLATFORM.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = readFileSync(join(here, '../../../../../docs/desktop/analytics/ANALYTICS-PLATFORM.md'), 'utf8');

  it('documents every producer id, static KPI key, prediction id, and series id', () => {
    for (const p of KPI_PRODUCER_REGISTRY) expect(doc).toContain(`\`${p.id}\``);
    for (const k of [...REAL_EXEC_KPI_KEYS, ...REAL_SPECIALIST_KPI_KEYS]) expect(doc).toContain(`\`${k}\``);
    for (const p of PREDICTION_REGISTRY) expect(doc).toContain(`\`${p.id}\``);
    for (const s of SERIES_REGISTRY) expect(doc).toContain(`\`${s.id}\``);
  });

  it('documents the six eana:* channels, the intelligence:read scope, and the watch source', () => {
    for (const ch of ['eana:kpis', 'eana:trends', 'eana:forecasts', 'eana:decisions', 'eana:dashboard', 'eana:report']) {
      expect(doc).toContain(`\`${ch}\``);
    }
    expect(doc).toContain('`intelligence:read`');
    expect(doc).toContain('`analytics-watch`');
  });

  it('documents all ten assistant question keys', () => {
    for (const k of EANA_QUESTION_KEYS) expect(doc).toContain(`\`${k}\``);
    expect(EANA_QUESTION_KEYS).toHaveLength(10);
  });

  it('states the structural honesty: no engine, recorded-only trends, registered-never-invented forecasting, authoritative producers', () => {
    expect(doc).toContain('NOT an analytics engine');
    expect(doc).toContain('no extrapolation');
    expect(doc).toContain('Stage 12 adds zero forecasting');
    expect(doc).toContain('producers stay');
    expect(doc).toContain('declared untrendable');
  });
});

/**
 * Phase 6 Stage 10 — executive planning: RELATIVE horizons computed from the
 * clock (never stored dates), horizon partition by objective/initiative
 * registry binding, and focus items that are STRUCTURALLY COMPLETE Stage 9
 * Principle-C recommendations (the same throwing guard) pointing only at
 * existing governed surfaces.
 */
import { describe, expect, it } from 'vitest';
// The Principle-C completeness checker is the SHARED one (the same checker
// mkRecommendation enforces at build time).
import { recommendationIssues } from '@neuropause/shared';
import { buildObjectivesReport, type MeasureSignals } from './objectiveModel';
import { buildPortfolio, type PortfolioSignals } from './initiativePortfolio';
import { buildPlanningReport, horizonWindow } from './executivePlanning';

const T_JUL = Date.parse('2026-07-31T12:00:00.000Z');
const T_DEC = Date.parse('2026-12-15T12:00:00.000Z');
const NOW = '2026-07-31T12:00:00.000Z';

describe('horizonWindow — relative, computed from the clock', () => {
  it('July → current quarter Q3, next quarter Q4, annual 2026', () => {
    expect(horizonWindow('current-quarter', T_JUL).label).toBe('Q3 2026');
    expect(horizonWindow('next-quarter', T_JUL).label).toBe('Q4 2026');
    expect(horizonWindow('annual', T_JUL).label).toBe('2026 (annual)');
  });

  it('December rolls the next quarter into Q1 of the FOLLOWING year', () => {
    expect(horizonWindow('current-quarter', T_DEC).label).toBe('Q4 2026');
    expect(horizonWindow('next-quarter', T_DEC).label).toBe('Q1 2027');
  });

  it('windows are coherent intervals (from < to), never stored dates', () => {
    for (const h of ['current-quarter', 'next-quarter', 'annual'] as const) {
      const w = horizonWindow(h, T_JUL);
      expect(Date.parse(w.fromIso)).toBeLessThan(Date.parse(w.toIso));
    }
  });
});

/* ── an integration fixture: one off-track objective + one blocked initiative ── */

function measureSignals(): MeasureSignals {
  const met = (targetId: string) => ({ targetId, status: 'met' as const, detail: `${targetId} within target` });
  return {
    kpis: [
      { key: 'org-health', band: 'healthy', display: '82' },
      { key: 'engineering-health', band: 'healthy', display: '78' },
      { key: 'ai-adoption', band: 'healthy', display: '64%' },
      { key: 'connector-health', band: 'healthy', display: '100%' },
    ],
    slaStatuses: [
      { targetId: 'exec-success-rate', status: 'breached', detail: 'success 82% BREACHED (target 90%)' },
      { targetId: 'exec-avg-runtime', status: 'breached', detail: 'avg runtime 9m over the 5m bar' },
      met('jobs-queue-depth'),
      met('approval-age'),
      met('automation-failure-ratio'),
      met('connector-healthy-ratio'),
      met('ai-engine-ready'),
    ],
    domains: [
      { key: 'workflows', band: 'at-risk', score: 40 },
      { key: 'organization', band: 'healthy', score: 88 },
      { key: 'projects', band: 'healthy', score: 90 },
      { key: 'approvals', band: 'healthy', score: 92 },
      { key: 'connectors', band: 'healthy', score: 95 },
      { key: 'automations', band: 'healthy', score: 91 },
    ],
  };
}

function portfolioSignals(): PortfolioSignals {
  const m = measureSignals();
  return {
    slaStatuses: m.slaStatuses,
    readiness: ['deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance'].map((key) => ({
      key,
      state: 'ready',
      detail: `${key} ready`,
    })),
    kpis: m.kpis,
    apFindings: [],
    playbooks: [
      { id: 'daily-ops-review', version: 1 },
      { id: 'incident-first-response', version: 1 },
      { id: 'weekly-maintenance-review', version: 1 },
      { id: 'quarterly-ops-report', version: 1 },
    ],
    s9Services: ['execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet', 'ai-runtime'].map(
      (serviceId) => ({ serviceId, state: 'operational', stateDetail: 'measured healthy' }),
    ),
    projects: [{ id: 'p1', title: 'Apollo', syncState: 'active', status: 'active' }],
    decisions: [{ id: 'd1', category: 'growth', status: 'completed' }],
    minedTypes: ['order_to_cash', 'procure_to_pay', 'make_to_complete'],
  };
}

const UNITS = [
  { id: 'u1', name: 'Operations', leadUserId: 'p1' },
  { id: 'u2', name: 'Engineering', leadUserId: null },
  { id: 'u3', name: 'AI Team', leadUserId: null },
  { id: 'u4', name: 'IT', leadUserId: null },
  { id: 'u5', name: 'Business', leadUserId: null },
  { id: 'u6', name: 'Legal', leadUserId: null },
  { id: 'u7', name: 'Support', leadUserId: null },
];

function mkPlanning(capacity: 'low' | 'elevated' | 'high' | 'unknown' | null = 'high') {
  const objectives = buildObjectivesReport({ nowIso: NOW, signals: measureSignals(), units: UNITS, users: [], failures: {} });
  const portfolio = buildPortfolio({ nowIso: NOW, signals: portfolioSignals(), units: UNITS, users: [], failures: {} });
  return {
    objectives,
    portfolio,
    report: buildPlanningReport({
      nowMs: T_JUL,
      nowIso: NOW,
      objectives,
      portfolio,
      signals: { capacityPressure: capacity, readinessMisses: [] },
      failures: {},
    }),
  };
}

describe('buildPlanningReport — horizons + focus', () => {
  it('partitions objectives and initiatives into their registry horizons', () => {
    const { report } = mkPlanning();
    const current = report.horizons.find((h) => h.horizon === 'current-quarter')!;
    expect(current.objectiveIds.sort()).toEqual(['co-dependable-integrations', 'co-governed-ai', 'co-reliable-execution']);
    expect(report.horizons.find((h) => h.horizon === 'next-quarter')!.objectiveIds).toEqual(['co-trustworthy-automation']);
    expect(report.horizons.find((h) => h.horizon === 'annual')!.objectiveIds).toEqual(['co-healthy-organization']);
    expect(current.initiativeIds).toContain('init-incident-response');
    expect(current.label).toBe('Q3 2026');
  });

  it('an off-track objective and a blocked initiative become focus items; capacity pressure joins the current quarter', () => {
    const { report } = mkPlanning('high');
    const current = report.horizons.find((h) => h.horizon === 'current-quarter')!;
    const ids = current.focus.map((f) => f.id);
    expect(ids).toContain('stratrec:objective:co-reliable-execution:current-quarter');
    expect(ids).toContain('stratrec:initiative:init-incident-response:current-quarter');
    expect(ids).toContain('stratrec:capacity:current-quarter');
    const obj = current.focus.find((f) => f.id.startsWith('stratrec:objective:co-reliable'))!;
    expect(obj.priority).toBe('critical'); // off-track → critical
    expect(current.summary).toContain('focus item(s)');
  });

  it('EVERY focus item is a structurally complete Principle-C recommendation (the Stage 9 guard)', () => {
    const { report } = mkPlanning('high');
    for (const h of report.horizons) {
      for (const f of h.focus) {
        expect(recommendationIssues(f), f.id).toEqual([]);
        expect(f.evidence.length, f.id).toBeGreaterThan(0);
        expect(f.rollbackImplications.length, f.id).toBeGreaterThan(0);
      }
    }
  });

  it('healthy signals + low pressure → horizons declare NO focus honestly', () => {
    const met = (targetId: string) => ({ targetId, status: 'met' as const, detail: 'within target' });
    const healthy: MeasureSignals = {
      kpis: measureSignals().kpis,
      slaStatuses: ['exec-success-rate', 'exec-avg-runtime', 'jobs-queue-depth', 'approval-age', 'automation-failure-ratio', 'connector-healthy-ratio', 'ai-engine-ready'].map(met),
      domains: measureSignals().domains!.map((d) => ({ ...d, band: 'healthy', score: 90 })),
    };
    const objectives = buildObjectivesReport({ nowIso: NOW, signals: healthy, units: UNITS, users: [], failures: {} });
    const p = portfolioSignals();
    p.slaStatuses = healthy.slaStatuses;
    const portfolio = buildPortfolio({ nowIso: NOW, signals: p, units: UNITS, users: [], failures: {} });
    const report = buildPlanningReport({
      nowMs: T_JUL,
      nowIso: NOW,
      objectives,
      portfolio,
      signals: { capacityPressure: 'low', readinessMisses: [] },
      failures: {},
    });
    for (const h of report.horizons) {
      expect(h.focus).toEqual([]);
      expect(h.summary).toContain('nothing requires executive focus');
    }
  });
});

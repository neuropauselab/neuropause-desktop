/**
 * Phase 6 Stage 13 — the platform twins (G-2).
 *
 * The single rule these tests exist to enforce: `steady` is a claim and
 * `unknown` is not, so an unreadable platform must never round up to `steady`.
 * Every one of the seven slices is exercised in all three states, `attention` is
 * locked to the owning platform having reported outstanding work (never to a
 * Stage 13 judgement), and P15's domain rows are checked to be a verbatim
 * re-labelling of `TwinService.domains()` rather than a recomputation.
 *
 * Everything here is deterministic: fixtures are literals, no clock is read.
 */
import { describe, expect, it } from 'vitest';
import type { EnterpriseTwinDomain, TwinBand, TwinDomainId, TwinDomains } from '@neuropause/shared';
import {
  buildPlatformTwins,
  PLATFORM_TWINS_DISCLOSURE,
  type PlatformSlices,
  type PlatformTwinsInput,
} from './platformTwins';
import { PLATFORM_REGISTRY } from './twinRegistry';

const NOW = '2026-08-01T09:00:00.000Z';

/** Every platform readable and reporting nothing outstanding. */
const CLEAN_SLICES: PlatformSlices = {
  s6Insight: { findings: 4, criticalOrHigh: 0 },
  s7Knowledge: { assets: 20, gaps: 0 },
  s8Automation: { automations: 8, failures: 0 },
  s9Operations: { posture: 'stable', bottlenecks: 0 },
  s10Strategy: { objectives: 6, atRisk: 0 },
  s11Federation: { partners: 3, degraded: 0 },
  s12Analytics: { kpis: 24, regressing: 0 },
};

/** Every platform readable and every one reporting outstanding work. */
const BUSY_SLICES: PlatformSlices = {
  s6Insight: { findings: 4, criticalOrHigh: 1 },
  s7Knowledge: { assets: 20, gaps: 2 },
  s8Automation: { automations: 8, failures: 3 },
  s9Operations: { posture: 'degraded', bottlenecks: 4 },
  s10Strategy: { objectives: 6, atRisk: 5 },
  s11Federation: { partners: 3, degraded: 6 },
  s12Analytics: { kpis: 24, regressing: 7 },
};

const NO_SLICES: PlatformSlices = {
  s6Insight: null,
  s7Knowledge: null,
  s8Automation: null,
  s9Operations: null,
  s10Strategy: null,
  s11Federation: null,
  s12Analytics: null,
};

function mkDomain(
  id: TwinDomainId,
  name: string,
  entityCount: number,
  band: TwinBand,
): EnterpriseTwinDomain {
  return {
    id,
    name,
    description: `${name} domain`,
    entityCount,
    band,
    status: 'ok',
    metrics: [],
    source: 'twinModel',
    live: true,
  };
}

const DOMAINS: TwinDomains = {
  domains: [
    mkDomain('enterprise', 'Enterprise', 12, 'healthy'),
    mkDomain('organization', 'Organization', 34, 'watch'),
    mkDomain('connector', 'Connectors', 0, 'at-risk'),
  ],
  totalEntities: 46,
  healthyDomains: 1,
  degradedDomains: 2,
};

function mkInput(over: Partial<PlatformTwinsInput> = {}): PlatformTwinsInput {
  return { nowIso: NOW, domains: DOMAINS, slices: CLEAN_SLICES, failures: {}, ...over };
}

describe('every registered platform gets exactly one row', () => {
  it('maps all seven registry ids to a row, in registry order', () => {
    const twins = buildPlatformTwins(mkInput());
    expect(twins.platforms.map((p) => p.id)).toEqual(PLATFORM_REGISTRY.map((p) => p.id));
    expect(twins.platforms).toHaveLength(7);
  });

  it('carries each platform’s stage, label and module from the registry, never from the slice', () => {
    const twins = buildPlatformTwins(mkInput());
    for (const def of PLATFORM_REGISTRY) {
      const row = twins.platforms.find((p) => p.id === def.id)!;
      expect(row.stage, def.id).toBe(def.stage);
      expect(row.label, def.id).toBe(def.label);
      expect(row.module, def.id).toBe(def.module);
    }
  });

  it('leaves no row without a summary — a platform row that says nothing is not a row', () => {
    for (const slices of [CLEAN_SLICES, BUSY_SLICES, NO_SLICES]) {
      for (const row of buildPlatformTwins(mkInput({ slices })).platforms) {
        expect(row.summary.length, row.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('unknown is never rounded up to steady', () => {
  it('gives every unreadable platform the UNKNOWN sentinel and NOT steady', () => {
    const twins = buildPlatformTwins(mkInput({ slices: NO_SLICES }));
    expect(twins.platforms).toHaveLength(7);
    for (const row of twins.platforms) {
      expect(row.state, row.id).toBe('unknown');
      expect(row.state, row.id).not.toBe('steady');
      expect(row.summary, row.id).toBe('Not readable this pass — no state is assumed.');
      expect(row.metrics, row.id).toEqual([]);
    }
    expect(twins.totals).toEqual({ platforms: 7, steady: 0, attention: 0, unknown: 7 });
  });

  it('isolates a single unreadable platform without disturbing the other six', () => {
    const twins = buildPlatformTwins(
      mkInput({ slices: { ...CLEAN_SLICES, s9Operations: null } }),
    );
    expect(twins.platforms.find((p) => p.id === 's9-operations')!.state).toBe('unknown');
    for (const row of twins.platforms.filter((p) => p.id !== 's9-operations')) {
      expect(row.state, row.id).toBe('steady');
    }
    expect(twins.totals).toEqual({ platforms: 7, steady: 6, attention: 0, unknown: 1 });
  });

  it('emits no metrics for an unknown row — an empty list, never a zero-valued one', () => {
    const twins = buildPlatformTwins(mkInput({ slices: NO_SLICES }));
    for (const row of twins.platforms) expect(row.metrics, row.id).toHaveLength(0);
  });
});

describe('attention means the owning platform reported outstanding work', () => {
  it('marks all seven rows attention when every platform reports something outstanding', () => {
    const twins = buildPlatformTwins(mkInput({ slices: BUSY_SLICES }));
    for (const row of twins.platforms) expect(row.state, row.id).toBe('attention');
    expect(twins.totals).toEqual({ platforms: 7, steady: 0, attention: 7, unknown: 0 });
  });

  it('marks all seven rows steady when every platform reports none', () => {
    const twins = buildPlatformTwins(mkInput({ slices: CLEAN_SLICES }));
    for (const row of twins.platforms) expect(row.state, row.id).toBe('steady');
    expect(twins.totals).toEqual({ platforms: 7, steady: 7, attention: 0, unknown: 0 });
  });

  it('keys attention off the outstanding-work field ALONE — a large healthy population is still steady', () => {
    // Every one of these has a big first number and a zero second number. If
    // Stage 13 were assessing rather than composing, one of them would trip.
    const twins = buildPlatformTwins(
      mkInput({
        slices: {
          s6Insight: { findings: 900, criticalOrHigh: 0 },
          s7Knowledge: { assets: 900, gaps: 0 },
          s8Automation: { automations: 900, failures: 0 },
          s9Operations: { posture: 'critical', bottlenecks: 0 },
          s10Strategy: { objectives: 900, atRisk: 0 },
          s11Federation: { partners: 900, degraded: 0 },
          s12Analytics: { kpis: 900, regressing: 0 },
        },
      }),
    );
    for (const row of twins.platforms) expect(row.state, row.id).toBe('steady');
  });

  it('trips attention at exactly one — the threshold is “any”, not a Stage 13 tolerance', () => {
    const one: PlatformSlices = {
      s6Insight: { findings: 1, criticalOrHigh: 1 },
      s7Knowledge: { assets: 1, gaps: 1 },
      s8Automation: { automations: 1, failures: 1 },
      s9Operations: { posture: 'stable', bottlenecks: 1 },
      s10Strategy: { objectives: 1, atRisk: 1 },
      s11Federation: { partners: 1, degraded: 1 },
      s12Analytics: { kpis: 1, regressing: 1 },
    };
    for (const row of buildPlatformTwins(mkInput({ slices: one })).platforms) {
      expect(row.state, row.id).toBe('attention');
    }
  });

  it('composes each summary and metric pair from the numbers the platform published', () => {
    const twins = buildPlatformTwins(mkInput({ slices: BUSY_SLICES }));
    const byId = new Map(twins.platforms.map((p) => [p.id, p]));
    expect(byId.get('s6-insight')!.summary).toBe('4 finding(s), 1 critical or high.');
    expect(byId.get('s7-knowledge')!.summary).toBe('20 asset(s) inventoried, 2 coverage gap(s).');
    expect(byId.get('s8-automation')!.summary).toBe('8 automation(s), 3 failing.');
    expect(byId.get('s9-operations')!.summary).toBe('Posture degraded; 4 capacity bottleneck(s).');
    expect(byId.get('s10-strategy')!.summary).toBe('6 objective(s), 5 at risk.');
    expect(byId.get('s11-federation')!.summary).toBe('3 partner(s), 6 degraded.');
    expect(byId.get('s12-analytics')!.summary).toBe('24 KPI(s) catalogued, 7 regressing.');

    expect(byId.get('s9-operations')!.metrics).toEqual([
      { label: 'Posture', value: 'degraded' },
      { label: 'Bottlenecks', value: '4' },
    ]);
    expect(byId.get('s12-analytics')!.metrics).toEqual([
      { label: 'KPIs', value: '24' },
      { label: 'Regressing', value: '7' },
    ]);
  });

  it('gives every readable row exactly two metrics', () => {
    for (const slices of [CLEAN_SLICES, BUSY_SLICES]) {
      for (const row of buildPlatformTwins(mkInput({ slices })).platforms) {
        expect(row.metrics, row.id).toHaveLength(2);
      }
    }
  });
});

describe('P15’s domain rows are composed verbatim', () => {
  it('maps name→label, entityCount→entities and band→band without touching the values', () => {
    const twins = buildPlatformTwins(mkInput());
    expect(twins.domains).toEqual([
      { id: 'enterprise', label: 'Enterprise', entities: 12, band: 'healthy' },
      { id: 'organization', label: 'Organization', entities: 34, band: 'watch' },
      { id: 'connector', label: 'Connectors', entities: 0, band: 'at-risk' },
    ]);
  });

  it('keeps a legitimately-empty domain at zero entities rather than dropping the row', () => {
    const twins = buildPlatformTwins(mkInput());
    const connector = twins.domains.find((d) => d.id === 'connector')!;
    expect(connector.entities).toBe(0);
    expect(twins.domains).toHaveLength(3);
  });

  it('carries P15’s own rollup totals through verbatim', () => {
    const twins = buildPlatformTwins(mkInput());
    expect(twins.domainTotals).toEqual({ domains: 3, entities: 46, healthy: 1, degraded: 2 });
  });

  it('reports domainTotals as null — never a zeroed rollup — when the twin could not be read', () => {
    const twins = buildPlatformTwins(mkInput({ domains: null }));
    expect(twins.domainTotals).toBeNull();
    expect(twins.domains).toEqual([]);
  });

  it('does not let an unreadable P15 change any platform row', () => {
    const withTwin = buildPlatformTwins(mkInput());
    const withoutTwin = buildPlatformTwins(mkInput({ domains: null }));
    expect(withoutTwin.platforms).toEqual(withTwin.platforms);
    expect(withoutTwin.totals).toEqual(withTwin.totals);
  });
});

describe('the view’s own contract', () => {
  it('projects every failure it was handed as a declared unavailability', () => {
    const twins = buildPlatformTwins(
      mkInput({ failures: { 'p15-twin': 'overview threw', 's9-operations': 'timed out' } }),
    );
    expect(twins.unavailable).toEqual([
      { system: 'p15-twin', reason: 'overview threw' },
      { system: 's9-operations', reason: 'timed out' },
    ]);
  });

  it('stamps the caller’s time and carries the disclosure', () => {
    const twins = buildPlatformTwins(mkInput());
    expect(twins.generatedAt).toBe(NOW);
    expect(twins.disclosure).toBe(PLATFORM_TWINS_DISCLOSURE);
    expect(twins.disclosure).toContain('never assumed steady');
  });

  it('keeps the three state counts summing to the platform total in every mix', () => {
    for (const slices of [CLEAN_SLICES, BUSY_SLICES, NO_SLICES, { ...CLEAN_SLICES, s8Automation: null }]) {
      const t = buildPlatformTwins(mkInput({ slices })).totals;
      expect(t.steady + t.attention + t.unknown).toBe(t.platforms);
    }
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(buildPlatformTwins(mkInput())).toEqual(buildPlatformTwins(mkInput()));
  });
});

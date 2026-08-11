/**
 * Phase 6 Stage 12 — the composition root: EXACTLY six read-only eana:*
 * channels (requireAuth + intelligence:read — the EXISTING Stage 6 read scope;
 * zero mutation surface; the insight:* cluster untouched), the 3 s TTL cache,
 * per-source failure isolation (a failing feed becomes an explicit
 * unavailable entry, never a fabricated value), the analytics-watch source
 * (governed ITEMS from critical/high recommendations, deduped), the
 * ten-question assistant port, and dispose().
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, type IntelligenceItem } from '@neuropause/shared';
import { initAnalyticsPlatform, type AnalyticsPlatformDeps } from './index';

/**
 * P13C ROUND 5 — the composed cache is tenant-keyed, so these suites name a
 * tenant. Every existing TTL and memoization assertion keeps its meaning:
 * repeated reads under ONE tenant must still be a single composition.
 */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = Date.parse('2026-08-01T09:00:00.000Z');

interface Harness {
  deps: AnalyticsPlatformDeps;
  sources: string[];
  produceWatch: () => Promise<IntelligenceItem[]>;
  setNow: (ms: number) => void;
  execReads: () => number;
}

function mkDeps(over: Partial<AnalyticsPlatformDeps> = {}): Harness {
  let nowMs = T0;
  let execReads = 0;
  const sources: string[] = [];
  let produce: () => Promise<IntelligenceItem[]> = () => Promise.resolve([]);
  const deps: AnalyticsPlatformDeps = {
  scope,
    executiveKpis: () => {
      execReads += 1;
      return [
        { key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: 'healthy' },
        { key: 'automation-success', label: 'Automation success', display: '96%', value: 96, band: 'healthy' },
      ];
    },
    processKpis: () => [{ key: 'process-cycle-hours', label: 'Median cycle', display: '18h', value: 18, band: 'healthy' }],
    p14Kpis: () => [{ key: 'org-health', label: 'Org health', display: '82/100', value: 82, band: 'healthy' }],
    p18Kpis: () => [],
    healthHistory: () => [
      { day: '2026-07-01', overall: 78, engineering: 70 },
      { day: '2026-07-31', overall: 82, engineering: 71 },
    ],
    valueDeltas: () => [
      { decisionId: 'd1', title: 'Consolidate connectors', deltas: [{ label: 'Org health', before: 76, after: 82 }] },
    ],
    valueTotals: () => ({ delivered: 1, partial: 0, notYetObserved: 1, unmeasurable: 0 }),
    insightPredictions: () => [{ kind: 'connector-instability', likelihood: 0.66 }],
    p14Simulation: () => ({ scenarios: 2 }),
    capacityPressure: () => 'low',
    decisions: () => [{ id: 'd1', status: 'approved', fromRecommendationId: 'rec-1' }],
    insightOutcomes: () => [{ id: 'rec-1', stage: 'verified' }],
    strategyRecs: () => ({ count: 1, criticalOrHigh: 0 }),
    federationRecs: () => ({ count: 0, criticalOrHigh: 0 }),
    s8Monitor: () => ({ findings: 2, criticalOrHigh: 0 }),
    s9Slices: () => ({ slaTargets: 2, slaMet: 2, slaBreached: 0, readinessReady: 7, readinessNotReady: 0 }),
    s10Totals: () => ({ offTrack: 0, atRisk: 1, blocked: 0 }),
    s11Totals: () => ({ partners: 1, declaredAboveEvidence: 0 }),
    p18Benchmark: () => ({ position: 'average', healthBand: 'healthy' }),
    registerSource: (source) => {
      sources.push(source.key);
      produce = () => source.produce() as Promise<IntelligenceItem[]>;
    },
    now: () => nowMs,
    ...over,
  };
  return { deps, sources, produceWatch: () => produce(), setNow: (ms) => (nowMs = ms), execReads: () => execReads };
}

describe('the IPC surface (D-9) — six read-only channels under the EXISTING intelligence:read scope', () => {
  it('registers EXACTLY the six eana:* channels, all requireAuth + intelligence:read', () => {
    const p = initAnalyticsPlatform(mkDeps().deps);
    expect(p.handlers.map((d) => d.channel).sort()).toEqual(
      [IpcChannel.EanaKpis, IpcChannel.EanaTrends, IpcChannel.EanaForecasts, IpcChannel.EanaDecisions, IpcChannel.EanaDashboard, IpcChannel.EanaReport].sort(),
    );
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('eana:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      expect(d.permission, String(d.channel)).toBe('intelligence:read');
    }
  });

  it('never touches the insight:* namespace and no channel name implies mutation', () => {
    const p = initAnalyticsPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('insight:')).toBe(false);
      expect(String(d.channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel|write|publish|revoke|install/);
    }
  });
});

describe('the composed views (healthy fixture)', () => {
  it('catalog, trends, forecasts, and decisions compose from the injected reads', () => {
    const p = initAnalyticsPlatform(mkDeps().deps);
    const kpis = p.kpis();
    expect(kpis.totals.total).toBe(3);
    expect(kpis.overlaps.map((o) => o.key)).toEqual(['org-health']); // exec + P14 reuse surface
    const trends = p.trends();
    expect(trends.rows.find((r) => r.seriesId === 'org-health-history')!.direction).toBe('improving');
    expect(trends.rows.find((r) => r.seriesId === 'decision:d1:Org health')!.direction).toBe('improving');
    expect(p.forecasts().totals.liveInstances).toBe(1);
    const decisions = p.decisions();
    expect(decisions.funnel.outcomeLoop.verified).toBe(1);
    expect(decisions.value?.delivered).toBe(1);
    const d = p.dashboard();
    expect(d.domains.map((x) => x.stage)).toEqual(['s8', 's9', 's10', 's11']);
    expect(d.domains.find((x) => x.stage === 's10')!.state).toBe('attention'); // 1 at-risk
    expect(d.benchmarks).toEqual({ position: 'average', healthBand: 'healthy' });
    expect(p.report().sections.length).toBeGreaterThanOrEqual(6);
  });
});

describe('the 3 s TTL cache', () => {
  it('reads within the TTL reuse one build; advancing the clock rebuilds; dispose clears', () => {
    const h = mkDeps();
    const p = initAnalyticsPlatform(h.deps);
    p.kpis();
    p.dashboard();
    p.trends();
    expect(h.execReads()).toBe(1);
    h.setNow(T0 + 2_999);
    p.report();
    expect(h.execReads()).toBe(1);
    h.setNow(T0 + 3_001);
    p.kpis();
    expect(h.execReads()).toBe(2);
    p.dispose();
    p.kpis();
    expect(h.execReads()).toBe(3);
  });
});

describe('failure isolation — explicit unavailability, never fabricated values', () => {
  it('a throwing executive feed degrades ONLY that feed; siblings stay composed', () => {
    const h = mkDeps({
      executiveKpis: () => {
        throw new Error('executive snapshot offline');
      },
    });
    const p = initAnalyticsPlatform(h.deps);
    const kpis = p.kpis();
    expect(kpis.rows.some((r) => r.key === 'process-cycle-hours')).toBe(true); // process feed survives
    expect(kpis.unavailable.some((u) => u.system === 'executive-kpis' && u.reason.includes('offline'))).toBe(true);
    expect(p.trends().rows.find((r) => r.seriesId === 'org-health-history')!.direction).toBe('improving'); // trends untouched
    expect(p.dashboard().unavailable.filter((u) => u.system === 'executive-kpis')).toHaveLength(1);
  });

  it('a throwing P18 benchmark read degrades ONLY the benchmark slice — declared, not defaulted', () => {
    const h = mkDeps({
      p18Benchmark: () => {
        throw new Error('p18 offline');
      },
    });
    const p = initAnalyticsPlatform(h.deps);
    expect(p.dashboard().benchmarks).toBeNull();
    expect(p.dashboard().unavailable.some((u) => u.system === 'p18-benchmarks')).toBe(true);
    expect(p.dashboard().kpis.total).toBe(3); // siblings computed
  });

  it('a throwing stage-slice read turns that domain unknown — never guessed steady', () => {
    const h = mkDeps({
      s9Slices: () => {
        throw new Error('s9 offline');
      },
    });
    const p = initAnalyticsPlatform(h.deps);
    const s9 = p.dashboard().domains.find((x) => x.stage === 's9')!;
    expect(s9.state).toBe('unknown');
    expect(s9.summary).toContain('unreadable');
    expect(p.dashboard().unavailable.some((u) => u.system === 's9-slices')).toBe(true);
  });
});

describe('the analytics-watch source — governed items, never actions', () => {
  it('registers exactly one source and stays quiet when nothing needs focus', async () => {
    const h = mkDeps();
    initAnalyticsPlatform(h.deps);
    expect(h.sources).toEqual(['analytics-watch']);
    expect(await h.produceWatch()).toEqual([]);
  });

  it('a regressing recorded series becomes a governed item once (deduped across produces)', async () => {
    const h = mkDeps({
      healthHistory: () => [
        { day: '2026-07-01', overall: 84, engineering: 70 },
        { day: '2026-07-31', overall: 71, engineering: 70 },
      ],
    });
    initAnalyticsPlatform(h.deps);
    const items = await h.produceWatch();
    expect(items.length).toBeGreaterThan(0);
    for (const it_ of items) {
      expect(it_.id.startsWith('eana:eanarec:')).toBe(true);
      expect(it_.deepLink).toBe('intelligence');
      expect(it_.governance?.evidence.length ?? 0).toBeGreaterThan(0);
      expect(it_.governance?.recommendedAction).toContain('existing governed flows');
    }
    expect(await h.produceWatch()).toEqual([]);
  });
});

describe('the assistant port — ten questions, sync, same composed pass', () => {
  it('routes a matched question to a grounded intelligence report; unmatched → null', () => {
    const p = initAnalyticsPlatform(mkDeps().deps);
    const r = p.answerQuestion('Show me the KPI catalog', new Date(T0).toISOString());
    expect(r?.kind).toBe('intelligence');
    expect(r?.grounded).toBe(true);
    expect(p.answerQuestion('draft an email', new Date(T0).toISOString())).toBeNull();
  });

  it('the analytics report answer reflects the live composition', () => {
    const p = initAnalyticsPlatform(mkDeps().deps);
    const r = p.answerQuestion('Prepare the analytics report', new Date(T0).toISOString())!;
    expect(r.title).toBe('Enterprise analytics — executive report');
    expect(r.sections.length).toBeGreaterThanOrEqual(6);
  });
});

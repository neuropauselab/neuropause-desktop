/**
 * Phase 6 Stage 13 — the Twin Platform tab's pure view-model.
 *
 * This file lives in `twinCenter/` while the model it tests lives in
 * `digitalTwinPlatform/`. That split is the repository convention, not an
 * accident: Stage 9 (`operationsPlatform/` + `operationsCenter/`), Stage 10
 * (`strategyPlatform/` + `strategyCenter/`), Stage 11 (`enterpriseFederation/`
 * + `federationCenter/`) and Stage 12 (`enterpriseAnalytics/` + `insightCenter/`)
 * all do exactly this — source in the stage-named platform directory, test in
 * the Center directory that the existing vitest glob already covers. See
 * FINDING #7 in `docs/desktop/twin/TWIN-PLATFORM.md`, which records that the
 * Stage 13 audit's §5.6 named the wrong directory and that the repository was
 * followed instead.
 *
 * What is tested here is the presentation edge of the three honesty rules the
 * main-process composition enforces, because the renderer is the last place a
 * `null` can quietly become a `0`:
 *   1. an unreadable number is WORDED as unreadable, never formatted as zero;
 *   2. `unknown` gets its own tone and its own words, and never reads as steady;
 *   3. a registered simulation always says it was never invoked.
 * Every fixture is literal and every assertion is exact — no clocks, no random
 * ids, no ordering left to chance.
 */
import { describe, expect, it } from 'vitest';
import type {
  EtwinCoverageMap,
  EtwinDashboard,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
} from '@neuropause/shared';
import {
  bandTone,
  countText,
  coverageRows,
  coverageTone,
  coverageTotalsLine,
  directionTone,
  domainRows,
  domainTotalsLine,
  durationText,
  etwinHeaderStats,
  etwinRecommendationRows,
  executionKindRows,
  executionSummary,
  historyRows,
  platformRows,
  recordedFootprintLine,
  sessionRows,
  simulationRows,
  simulationTotalsLine,
  supervisorRows,
  twinStateTone,
  unavailableLines,
  untrendableLines,
} from '../digitalTwinPlatform/etwinPlatformModel';

const NOW = '2026-08-01T09:00:00.000Z';

function mkDashboard(over: Partial<EtwinDashboard> = {}): EtwinDashboard {
  return {
    generatedAt: NOW,
    twin: {
      domainCount: 9,
      totalEntities: 214,
      overallHealth: 82,
      healthBand: 'healthy',
      criticalImpactNodes: 3,
      openDecisions: 5,
    },
    runtime: { available: true, activeSessions: 2, registeredKinds: 10, failed: 1, recovering: 0 },
    platforms: { total: 7, steady: 5, attention: 1, unknown: 1 },
    coverage: { total: 22, modelledByTwin: 9, modelledElsewhere: 10, notModelled: 3 },
    simulation: { registered: 4, liveInstances: 2 },
    history: { improving: 1, stable: 1, regressing: 1, unavailable: 4 },
    recommendations: [],
    disclosures: ['composition only'],
    unavailable: [],
    ...over,
  };
}

function mkRuntime(over: Partial<EtwinRuntimeTwin> = {}): EtwinRuntimeTwin {
  return {
    generatedAt: NOW,
    execution: {
      available: true,
      registeredKinds: ['workflow', 'sync'],
      activeCount: 1,
      historyCount: 3,
      kinds: [
        { kind: 'workflow', active: 1, historical: 2, failed: 1 },
        { kind: 'sync', active: 0, historical: 1, failed: 0 },
      ],
      active: [
        { id: 's1', kind: 'workflow', label: 'Nightly workflow', state: 'running', startedAt: NOW, durationMs: null },
      ],
      recent: [
        { id: 's2', kind: 'workflow', label: 'Prior workflow', state: 'failed', startedAt: NOW, durationMs: 95_000 },
        { id: 's3', kind: 'sync', label: 'Connector sync', state: 'completed', startedAt: NOW, durationMs: 450 },
      ],
      stats: { active: 1, queued: 0, completed: 2, failed: 1, cancelled: 0, successRate: 0.667, averageRuntimeMs: 47_725 },
    },
    supervisor: {
      available: true,
      status: {
        policies: { runtime: 'automatic', platform: 'automatic', automation: 'manual', voice: 'automatic', backend: 'disabled' },
        recovering: ['platform'],
        lastRecovery: null,
        recoveryCount: 2,
        recentFailures: 1,
      },
      rows: [
        { subsystem: 'runtime', policy: 'automatic', recovering: false, recoveries: 0, failures: 0, lastAt: null },
        { subsystem: 'platform', policy: 'automatic', recovering: true, recoveries: 2, failures: 1, lastAt: NOW },
        { subsystem: 'backend', policy: 'disabled', recovering: false, recoveries: 0, failures: 2, lastAt: NOW },
      ],
      historyCount: 2,
    },
    surfaces: [],
    disclosure: 'runtime composed verbatim',
    unavailable: [],
    ...over,
  };
}

function mkPlatforms(over: Partial<EtwinPlatformTwins> = {}): EtwinPlatformTwins {
  return {
    generatedAt: NOW,
    domains: [
      { id: 'organization', label: 'Organization', entities: 1, band: 'healthy' },
      { id: 'infrastructure', label: 'Infrastructure', entities: 42, band: 'at-risk' },
    ],
    domainTotals: { domains: 9, entities: 214, healthy: 7, degraded: 2 },
    platforms: [
      {
        id: 's12-analytics',
        stage: 'Stage 12',
        label: 'Analytics',
        module: 'analyticsPlatform/',
        state: 'steady',
        summary: '0 critical/high of 4 finding(s)',
        metrics: [{ label: 'KPIs', value: '12' }],
      },
      {
        id: 's9-operations',
        stage: 'Stage 9',
        label: 'Operations',
        module: 'operationsPlatform/',
        state: 'unknown',
        summary: 'operations slice unreadable this pass',
        metrics: [],
      },
    ],
    totals: { platforms: 2, steady: 1, attention: 0, unknown: 1 },
    disclosure: 'platform slices composed verbatim',
    unavailable: [],
    ...over,
  };
}

function mkCoverage(over: Partial<EtwinCoverageMap> = {}): EtwinCoverageMap {
  return {
    generatedAt: NOW,
    rows: [
      { id: 'energy-environmental', label: 'Energy', status: 'not-modelled', owner: 'a metering integration', evidence: 'search "energy" returned 0 main-process hits', live: null },
      { id: 'knowledge', label: 'Knowledge', status: 'modelled-elsewhere', owner: 'knowledgeAssets/', evidence: 'assetRegistry.ts:222', live: '31 asset(s)' },
      { id: 'organization', label: 'Organization', status: 'modelled-by-twin', owner: 'P15 buildOrganizationDomain', evidence: 'twinService.ts:118', live: '1 entity' },
      { id: 'supply-chain', label: 'Supply chain', status: 'modelled-elsewhere', owner: 'manufacturing twin', evidence: 'manufacturingDigitalTwin.ts', live: null },
    ],
    totals: { total: 4, modelledByTwin: 1, modelledElsewhere: 2, notModelled: 1 },
    notModelled: ['energy-environmental'],
    disclosure: 'coverage is a repository statement',
    unavailable: [],
    ...over,
  };
}

function mkSimulation(over: Partial<EtwinSimulationInventory> = {}): EtwinSimulationInventory {
  return {
    generatedAt: NOW,
    entries: [
      { id: 'manufacturing-what-if', label: 'Manufacturing what-if', kind: 'deterministic-what-if', module: 'manufacturingDigitalTwin.ts', scenarioCount: 15, live: { count: 0, detail: '0 running instance(s)' }, canSimulate: 'authored what-if scenarios', cannotSimulate: 'anything not authored', invoked: false },
      { id: 'p14-scenario-projection', label: 'Scenario projection', kind: 'scenario-projection', module: 'simulation/', scenarioCount: null, live: { count: 3, detail: '3 projection(s) recorded' }, canSimulate: 'advisory projections', cannotSimulate: 'applying a projection', invoked: false },
      { id: 'insight-heuristics', label: 'Insight heuristics', kind: 'deterministic-heuristic', module: 'insight/', scenarioCount: 7, live: null, canSimulate: 'seven deterministic rules', cannotSimulate: 'probabilistic forecasting', invoked: false },
    ],
    totals: { registered: 3, withScenarios: 2, liveInstances: 3 },
    disclosure: 'a register, not a simulator',
    unavailable: [],
    ...over,
  };
}

function mkHistory(over: Partial<EtwinHistoryView> = {}): EtwinHistoryView {
  return {
    generatedAt: NOW,
    rows: [
      { seriesId: 'twin-overall-health', label: 'Twin overall health', kind: 'point-in-time', windowLabel: 'no recorded series', from: null, to: null, delta: null, direction: 'unavailable', detail: 'composed per pass' },
      { seriesId: 'org-health-history', label: 'Org health', kind: 'daily-history', windowLabel: '7 day(s)', from: 70, to: 78, delta: 8, direction: 'improving', detail: '70 → 78' },
      { seriesId: 'decision-window-deltas', label: 'Decision windows', kind: 'decision-window', windowLabel: 'measured', from: 70, to: 68, delta: -2, direction: 'regressing', detail: '70 → 68' },
    ],
    totals: { improving: 1, stable: 0, regressing: 1, unavailable: 1 },
    untrendable: [{ seriesId: 'twin-overall-health', label: 'Twin overall health', reason: 'composed per pass; no recorded series exists' }],
    recordedDays: 14,
    recordedDecisions: 5,
    disclosure: 'Stage 12 owns delta computation',
    unavailable: [],
    ...over,
  };
}

/* ── tone maps ────────────────────────────────────────────────────────────── */

describe('tone maps (total)', () => {
  it('maps every band, twin state, direction and coverage status — unknown inputs go gray, never invented', () => {
    expect(bandTone('healthy')).toBe('green');
    expect(bandTone('watch')).toBe('blue');
    expect(bandTone('at-risk')).toBe('orange');
    expect(bandTone('critical')).toBe('red');
    expect(bandTone(null)).toBe('gray');
    expect(bandTone('a-band-p15-does-not-have')).toBe('gray');

    expect(directionTone('improving')).toBe('green');
    expect(directionTone('stable')).toBe('blue');
    expect(directionTone('regressing')).toBe('orange');
    expect(directionTone('unavailable')).toBe('gray');
  });

  /**
   * HONESTY RULE 2, at the tone layer. `unknown` means "could not be read". If
   * it shared a tone with `steady` the tab would render an unread platform as a
   * healthy one, which is precisely what the composition refuses to do upstream.
   */
  it('twinStateTone keeps unknown distinct from steady, and neither is the attention tone', () => {
    expect(twinStateTone('steady')).toBe('green');
    expect(twinStateTone('attention')).toBe('orange');
    expect(twinStateTone('unknown')).toBe('gray');
    expect(twinStateTone('unknown')).not.toBe(twinStateTone('steady'));
    expect(new Set(['steady', 'attention', 'unknown'].map((s) => twinStateTone(s as 'steady'))).size).toBe(3);
  });

  /**
   * A declared, evidenced gap is a statement about the repository, not a fault.
   * Toning it red would report the honest part of the registry as an alarm.
   */
  it('coverageTone does NOT alarm on not-modelled — a declared gap is not a failure', () => {
    expect(coverageTone('modelled-by-twin')).toBe('green');
    expect(coverageTone('modelled-elsewhere')).toBe('blue');
    expect(coverageTone('not-modelled')).toBe('gray');
    expect(coverageTone('not-modelled')).not.toBe('red');
  });
});

/* ── null-safe formatting ─────────────────────────────────────────────────── */

describe('countText + durationText (HONESTY RULE 1 — null is never zero)', () => {
  it('words an unreadable count instead of printing 0, and keeps the subject named', () => {
    expect(countText(0, 'failed session(s)')).toBe('0 failed session(s)');
    expect(countText(3, 'failed session(s)')).toBe('3 failed session(s)');
    expect(countText(null, 'failed session(s)')).toBe('failed session(s) unreadable this pass');
    // The distinction the whole rule exists for: observed-zero and unreadable
    // must not render the same, and neither may be mistaken for the other.
    expect(countText(null, 'x')).not.toBe(countText(0, 'x'));
    expect(countText(null, 'x')).not.toContain('0');
  });

  it('formats durations across ms/s/m and states an unrecorded one rather than zeroing it', () => {
    expect(durationText(0)).toBe('0 ms');
    expect(durationText(450)).toBe('450 ms');
    expect(durationText(1500)).toBe('1.5 s');
    expect(durationText(95_000)).toBe('1 m 35 s');
    expect(durationText(null)).toBe('duration not recorded');
    expect(durationText(null)).not.toContain('0');
  });
});

/* ── header stats ─────────────────────────────────────────────────────────── */

describe('etwinHeaderStats', () => {
  it('renders five stats, each carrying the attribution or limitation that makes it honest', () => {
    const stats = etwinHeaderStats(mkDashboard());
    expect(stats.map((s) => s.label)).toEqual([
      'Enterprise twin',
      'Runtime twin',
      'Platform twins',
      'State coverage',
      'Recorded history',
    ]);
    expect(stats[0].value).toBe('82/100 healthy');
    expect(stats[0].tone).toBe('green');
    expect(stats[0].hint).toContain('P15 composed verbatim');
    expect(stats[1].value).toBe('2 active · 10 kind(s)');
    expect(stats[1].tone).toBe('orange'); // one failed session
    expect(stats[2].value).toBe('5 steady · 1 attention');
    expect(stats[2].hint).toContain('never assumed steady');
    expect(stats[3].value).toBe('19/22 modelled');
    expect(stats[4].value).toBe('1↑ 1→ 1↓');
  });

  it('an unreadable P15 summary reads unreadable — no health, no band, no zero stands in for it', () => {
    const stats = etwinHeaderStats(mkDashboard({ twin: null }));
    expect(stats[0].value).toBe('unreadable');
    expect(stats[0].tone).toBe('gray');
    expect(stats[0].hint).toContain('declared, not defaulted');
    expect(stats[0].value).not.toContain('0');
  });

  /** The partial-engine rule, seen from the tab. */
  it('an unavailable engine states the partial-engine rule instead of showing zeros', () => {
    const stats = etwinHeaderStats(
      mkDashboard({ runtime: { available: false, activeSessions: 0, registeredKinds: 0, failed: null, recovering: null } }),
    );
    expect(stats[1].value).toBe('engine unreadable');
    expect(stats[1].tone).toBe('gray');
    expect(stats[1].hint).toContain('never half-composed');
    expect(stats[1].value).not.toContain('0');
  });

  it('a readable engine with unreadable sub-counts words them, and does not tone them as healthy-zero', () => {
    const stats = etwinHeaderStats(
      mkDashboard({ runtime: { available: true, activeSessions: 2, registeredKinds: 10, failed: null, recovering: null } }),
    );
    expect(stats[1].hint).toContain('failed session(s) unreadable this pass');
    expect(stats[1].hint).toContain('subsystem(s) recovering unreadable this pass');
    // `failed === null` is NOT `failed > 0`, so the tone must not be orange —
    // and it must not silently become the all-clear green either.
    expect(stats[1].tone).toBe('green');
    const cleanly = etwinHeaderStats(
      mkDashboard({ runtime: { available: true, activeSessions: 2, registeredKinds: 10, failed: 0, recovering: 0 } }),
    );
    expect(cleanly[1].hint).toContain('0 failed session(s)');
  });

  it('platform stat greys out when the only non-steady platforms are unreadable ones', () => {
    const stats = etwinHeaderStats(mkDashboard({ platforms: { total: 7, steady: 6, attention: 0, unknown: 1 } }));
    expect(stats[2].tone).toBe('gray');
    const allGood = etwinHeaderStats(mkDashboard({ platforms: { total: 7, steady: 7, attention: 0, unknown: 0 } }));
    expect(allGood[2].tone).toBe('green');
  });
});

/* ── runtime twin ─────────────────────────────────────────────────────────── */

describe('executionSummary (the partial-engine rule at the presentation edge)', () => {
  it('composes headline and verbatim engine statistics when the engine is readable', () => {
    const s = executionSummary(mkRuntime());
    expect(s.available).toBe(true);
    expect(s.headline).toBe('1 active · 3 historical · 2 registered kind(s)');
    expect(s.statsLines[0]).toContain('2 completed · 1 failed');
    expect(s.statsLines[1]).toContain('67%');
    expect(s.statsLines[1]).toContain('47.7 s');
  });

  it('an unavailable engine shows the reason and NO counts at all', () => {
    const r = mkRuntime();
    const s = executionSummary({ ...r, execution: { ...r.execution, available: false } });
    expect(s.available).toBe(false);
    expect(s.headline).toContain('partial-engine rule');
    expect(s.statsLines.join(' ')).toContain('rather than partially composed');
    // Not one fabricated figure survives the unavailable branch.
    expect(s.headline).not.toMatch(/\d/);
  });

  it('null statistics are worded, and a null success rate never reads as 0%', () => {
    const r = mkRuntime();
    const noStats = executionSummary({ ...r, execution: { ...r.execution, stats: null } });
    expect(noStats.statsLines).toEqual(['Engine statistics were unreadable this pass — declared, not defaulted.']);

    const nulls = executionSummary({
      ...r,
      execution: { ...r.execution, stats: { active: 0, queued: 0, completed: 0, failed: 0, cancelled: 0, successRate: null, averageRuntimeMs: null } },
    });
    expect(nulls.statsLines[1]).toContain('not computable from the recorded sessions');
    expect(nulls.statsLines[1]).toContain('not recorded');
    expect(nulls.statsLines[1]).not.toContain('0%');
  });
});

describe('executionKindRows + sessionRows + supervisorRows', () => {
  it('tones a kind by failures first, activity second', () => {
    const rows = executionKindRows(mkRuntime());
    expect(rows[0]).toEqual({ kind: 'workflow', activeText: '1 active', historicalText: '2 historical', failedText: '1 failed', tone: 'orange' });
    expect(rows[1].tone).toBe('gray');
  });

  /**
   * Active and recent are kept as two labelled lists in one array rather than
   * merged and re-sorted. The composition bounds them separately; a merged
   * ordering would assert a sequence the engine never published.
   */
  it('keeps active sessions ahead of recent ones and tags which list each came from', () => {
    const rows = sessionRows(mkRuntime());
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2', 's3']);
    expect(rows.map((r) => r.live)).toEqual([true, false, false]);
    expect(rows[0].durationText).toBe('duration not recorded'); // running, no duration yet
    expect(rows[0].tone).toBe('blue');
    expect(rows[1].tone).toBe('red'); // failed
    expect(rows[2].durationText).toBe('450 ms');
    expect(rows[2].tone).toBe('green');
  });

  it('supervisor rows state policy, recovery state and a never-recorded last time', () => {
    const rows = supervisorRows(mkRuntime());
    expect(rows[0]).toEqual({ subsystem: 'runtime', policy: 'automatic', stateText: 'steady', detailText: '0 recovery(ies) · 0 recent failure(s) · last never recorded', tone: 'green' });
    expect(rows[1].stateText).toBe('recovering');
    expect(rows[1].tone).toBe('orange');
    expect(rows[2].tone).toBe('blue'); // failures but not recovering
    expect(rows[2].policy).toBe('disabled');
  });
});

/* ── platform twins ───────────────────────────────────────────────────────── */

describe('domainRows + platformRows + domainTotalsLine', () => {
  it('renders P15 domains verbatim, with correct singular/plural entity wording', () => {
    const rows = domainRows(mkPlatforms());
    expect(rows[0]).toEqual({ id: 'organization', label: 'Organization', entitiesText: '1 entity', band: 'healthy', tone: 'green' });
    expect(rows[1].entitiesText).toBe('42 entities');
    expect(rows[1].tone).toBe('orange');
  });

  /** HONESTY RULE 2, at the row layer: unknown gets its own words, not a blank. */
  it('an unknown platform says it could not be read rather than leaving the cell empty', () => {
    const rows = platformRows(mkPlatforms());
    expect(rows[0].stateLabel).toBe('steady');
    expect(rows[0].metricsText).toBe('KPIs: 12');
    expect(rows[0].unknown).toBe(false);
    expect(rows[1].stateLabel).toBe('unknown (could not be read)');
    expect(rows[1].tone).toBe('gray');
    expect(rows[1].unknown).toBe(true);
    // An empty metric list must render as empty, not as an invented placeholder.
    expect(rows[1].metricsText).toBe('');
  });

  it('unreadable domain totals are declared, never zeroed', () => {
    expect(domainTotalsLine(mkPlatforms())).toContain('9 domain(s) · 214 entities · 7 healthy · 2 degraded');
    const line = domainTotalsLine(mkPlatforms({ domainTotals: null }));
    expect(line).toContain('declared, not defaulted');
    expect(line).not.toContain('0');
  });
});

/* ── coverage ─────────────────────────────────────────────────────────────── */

describe('coverageRows + coverageTotalsLine', () => {
  it('groups by status (twin, elsewhere, gaps) while preserving registry order inside each group', () => {
    const rows = coverageRows(mkCoverage());
    expect(rows.map((r) => r.id)).toEqual(['organization', 'knowledge', 'supply-chain', 'energy-environmental']);
    expect(rows.map((r) => r.status)).toEqual(['modelled-by-twin', 'modelled-elsewhere', 'modelled-elsewhere', 'not-modelled']);
    // Grouping never drops or duplicates a row.
    expect(rows).toHaveLength(mkCoverage().rows.length);
  });

  it('a gap row states what closing it would require, and every row keeps its evidence', () => {
    const rows = coverageRows(mkCoverage());
    expect(rows[0].ownerText).toBe('owned by P15 buildOrganizationDomain');
    expect(rows[3].ownerText).toBe('would require: a metering integration');
    expect(rows[3].gap).toBe(true);
    for (const r of rows) expect(r.evidence.length).toBeGreaterThan(0);
  });

  /** Nothing observable is a different claim from observed-and-it-was-zero. */
  it('a null live reading says nothing is observable rather than showing a count', () => {
    const rows = coverageRows(mkCoverage());
    expect(rows[1].liveText).toBe('31 asset(s)');
    expect(rows[1].liveTone).toBe('blue');
    expect(rows[2].liveText).toBe('nothing observable for this row this pass');
    expect(rows[2].liveTone).toBe('gray');
    expect(rows[2].liveText).not.toContain('0');
  });

  it('the totals line states coverage as a repository claim, not a score', () => {
    const line = coverageTotalsLine(mkCoverage());
    expect(line).toContain('4 enterprise state(s): 1 modelled by the twin · 2 modelled elsewhere · 1 not modelled');
    expect(line).toContain('not a score');
    expect(line).not.toContain('%');
  });
});

/* ── simulation ───────────────────────────────────────────────────────────── */

describe('simulationRows + simulationTotalsLine (HONESTY RULE 3)', () => {
  it('every row says registered-never-invoked — on all rows, not only when convenient', () => {
    const rows = simulationRows(mkSimulation());
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.invokedText).toBe('registered, never invoked — Stage 13 runs no simulation');
    }
    // The wording is uniform because `invoked` is false by construction; a row
    // that could differ would mean something in Stage 13 could invoke.
    expect(new Set(rows.map((r) => r.invokedText)).size).toBe(1);
  });

  it('carries CAN/CANNOT verbatim and distinguishes no-scenario-count from zero scenarios', () => {
    const rows = simulationRows(mkSimulation());
    expect(rows[0].scenarioText).toBe('15 authored scenario(s)');
    expect(rows[1].scenarioText).toBe('no authored scenario count declared');
    expect(rows[1].scenarioText).not.toContain('0');
    for (const r of rows) {
      expect(r.canSimulate.length).toBeGreaterThan(0);
      expect(r.cannotSimulate.length).toBeGreaterThan(0);
    }
  });

  it('an unreadable live join is gray and worded; an observed zero is not the same row', () => {
    const rows = simulationRows(mkSimulation());
    expect(rows[0].liveText).toBe('0 running instance(s)'); // observed zero, from the composition
    expect(rows[0].liveTone).toBe('gray');
    expect(rows[1].liveTone).toBe('blue');
    expect(rows[2].liveText).toBe('live join unreadable this pass');
    expect(rows[2].liveTone).toBe('gray');
    expect(rows[2].liveText).not.toBe(rows[0].liveText);
  });

  it('the totals line says it counts rather than simulates', () => {
    const line = simulationTotalsLine(mkSimulation());
    expect(line).toContain('3 registered capability(ies) · 2 with authored scenarios · 3 live instance(s)');
    expect(line).toContain('it counts, it does not simulate');
  });
});

/* ── history ──────────────────────────────────────────────────────────────── */

describe('historyRows + untrendableLines + recordedFootprintLine', () => {
  it('orders recorded windows before declared-untrendable point-in-time series', () => {
    const rows = historyRows(mkHistory());
    expect(rows.map((r) => r.seriesId)).toEqual(['org-health-history', 'decision-window-deltas', 'twin-overall-health']);
    expect(rows[0].pointInTime).toBe(false);
    expect(rows[2].pointInTime).toBe(true);
    expect(rows[2].tone).toBe('gray');
  });

  it('renders deltas with an explicit sign and states a missing window instead of 0 → 0', () => {
    const rows = historyRows(mkHistory());
    expect(rows[0].valueText).toBe('70 → 78 (+8)');
    expect(rows[1].valueText).toBe('70 → 68 (-2)');
    expect(rows[2].valueText).toBe('no recorded window for this series');
    expect(rows[2].valueText).not.toContain('0');
  });

  it('untrendable series carry the reason the platform gave', () => {
    expect(untrendableLines(mkHistory())).toEqual([
      'Twin overall health (twin-overall-health): composed per pass; no recorded series exists',
    ]);
    expect(untrendableLines(mkHistory({ untrendable: [] }))).toEqual([]);
  });

  it('the recorded footprint words unreadable stores and never shows them as empty', () => {
    expect(recordedFootprintLine(mkHistory())).toContain('14 day(s) of health history · 5 recorded decision(s)');
    const unreadable = recordedFootprintLine(mkHistory({ recordedDays: null, recordedDecisions: null }));
    expect(unreadable).toContain('day(s) of health history unreadable this pass');
    expect(unreadable).toContain('recorded decision(s) unreadable this pass');
    expect(unreadable).toContain('reads the footprint, never the records');
    // A store with zero records is a different sentence from an unreadable one.
    expect(recordedFootprintLine(mkHistory({ recordedDays: 0, recordedDecisions: 0 }))).toContain('0 day(s) of health history');
  });
});

/* ── recommendations + honesty strip ──────────────────────────────────────── */

describe('etwinRecommendationRows', () => {
  it('exposes the full Principle-C line and tones by priority', () => {
    const rows = etwinRecommendationRows(
      mkDashboard({
        recommendations: [
          {
            id: 'etwinrec:platform:unknown',
            title: '1 platform twin unreadable',
            detail: 's9-operations could not be read',
            priority: 'high',
            suggestedAction: 'Open the Operations Center.',
            evidence: ['s9-operations'],
            reasoning: 'The platform slice threw this pass.',
            confidence: 0.8,
            affectedSystems: ['operations'],
            operationalImpact: 'One platform twin is unknown.',
            expectedBusinessOutcome: 'Coverage of the platform estate is restored.',
            rollbackImplications: 'Recommendation only; nothing executes.',
          },
        ],
      }),
    );
    expect(rows[0].tone).toBe('orange');
    expect(rows[0].principleC).toContain('Impact: One platform twin is unknown.');
    expect(rows[0].principleC).toContain('Rollback: Recommendation only; nothing executes.');
    expect(rows[0].principleC).toContain('confidence 80%, 1 evidence ref(s)');
    expect(rows[0].suggestedAction).toBe('Open the Operations Center.');
  });

  it('is empty when the composition produced no recommendations — none are invented here', () => {
    expect(etwinRecommendationRows(mkDashboard())).toEqual([]);
  });
});

describe('unavailableLines', () => {
  it('dedups identical system:reason lines across every composed view, preserving first-seen order', () => {
    const lines = unavailableLines([
      mkRuntime({ unavailable: [{ system: 'execute-engine', reason: 'threw' }] }),
      mkPlatforms({ unavailable: [{ system: 'execute-engine', reason: 'threw' }, { system: 's9-operations', reason: 'unreadable' }] }),
      mkCoverage(),
    ]);
    expect(lines).toEqual(['execute-engine: threw', 's9-operations: unreadable']);
  });

  it('is empty when every view read cleanly — an empty strip means nothing failed, not that nothing was checked', () => {
    expect(unavailableLines([mkRuntime(), mkPlatforms(), mkCoverage(), mkSimulation(), mkHistory()])).toEqual([]);
  });
});

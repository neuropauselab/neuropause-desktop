/**
 * Phase 6 Stage 13 — the twin platform dashboard + report.
 *
 * The dashboard composes five already-computed views and computes nothing of
 * its own, so these tests are about composition discipline rather than
 * arithmetic. Three things are load-bearing.
 *
 * First, the null discipline survives the rollup: `runtime.failed` and
 * `runtime.recovering` are null — not zero — when the engine or the supervisor
 * could not be read, because "no failures" and "we could not tell" are
 * different answers and the dashboard is the last place they could be
 * conflated.
 *
 * Second, the platform rollup is mapped key by key, not spread.
 * `EtwinPlatformTwins.totals` names its count `platforms` while the dashboard
 * names every rollup count `total`; a spread would silently produce a
 * `total: undefined` field next to a stray `platforms` one, so the emitted key
 * set is asserted directly.
 *
 * Third, every recommendation goes through the throwing Principle-C guard, and
 * each of the five rules is checked both firing and silent — including the
 * evidence-starved execution case, where a failure the engine counted is no
 * longer visible per kind and an unguarded evidence array would take the whole
 * read-only dashboard down.
 *
 * Views are literal fixtures rather than the component builders' output, so a
 * change in a sibling module cannot quietly rewrite what this file asserts.
 * Nothing reads a clock; every case is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  recommendationIssues,
  type EtwinCoverageMap,
  type EtwinDomainRow,
  type EtwinHistoryView,
  type EtwinPlatformRow,
  type EtwinPlatformTwins,
  type EtwinRuntimeTwin,
  type EtwinSimulationInventory,
  type EtwinTwinState,
  type ExecutionStats,
  type SupervisorStatus,
  type TwinBand,
  type TwinSummary,
} from '@neuropause/shared';
import {
  composeTwinDashboard,
  composeTwinRecommendations,
  composeTwinReport,
  ETWIN_DISCLOSURES,
  type EtwinDashboardInputs,
} from './twinDashboard';
import { COVERAGE_DISCLOSURE } from './stateCoverage';
import { HISTORY_DISCLOSURE } from './twinHistory';
import { PLATFORM_TWINS_DISCLOSURE } from './platformTwins';
import { RUNTIME_TWIN_DISCLOSURE } from './runtimeTwin';
import { SIMULATION_DISCLOSURE } from './simulationInventory';

const NOW = '2026-08-01T09:00:00.000Z';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function mkStats(over: Partial<ExecutionStats> = {}): ExecutionStats {
  return {
    active: 2,
    queued: 1,
    completed: 40,
    failed: 0,
    cancelled: 1,
    successRate: 0.97,
    averageRuntimeMs: 1200,
    ...over,
  };
}

function mkStatus(over: Partial<SupervisorStatus> = {}): SupervisorStatus {
  return {
    policies: {
      runtime: 'automatic',
      platform: 'automatic',
      automation: 'manual',
      voice: 'disabled',
      backend: 'automatic',
    },
    recovering: [],
    lastRecovery: null,
    recoveryCount: 0,
    recentFailures: 0,
    ...over,
  };
}

/** A healthy runtime twin: engine and supervisor both readable, nothing wrong. */
function mkRuntime(
  exec: Partial<EtwinRuntimeTwin['execution']> = {},
  sup: Partial<EtwinRuntimeTwin['supervisor']> = {},
  over: Partial<EtwinRuntimeTwin> = {},
): EtwinRuntimeTwin {
  return {
    generatedAt: NOW,
    execution: {
      available: true,
      registeredKinds: ['decision', 'task', 'worker'],
      activeCount: 2,
      historyCount: 41,
      kinds: [
        { kind: 'decision', active: 0, historical: 5, failed: 0 },
        { kind: 'task', active: 2, historical: 30, failed: 0 },
        { kind: 'worker', active: 0, historical: 6, failed: 0 },
      ],
      active: [],
      recent: [],
      stats: mkStats(),
      ...exec,
    },
    supervisor: {
      available: true,
      status: mkStatus(),
      rows: [
        { subsystem: 'runtime', policy: 'automatic', recovering: false, recoveries: 0, failures: 0, lastAt: null },
        { subsystem: 'platform', policy: 'automatic', recovering: false, recoveries: 2, failures: 0, lastAt: '2026-07-31T22:00:00.000Z' },
      ],
      historyCount: 2,
      ...sup,
    },
    surfaces: [],
    disclosure: RUNTIME_TWIN_DISCLOSURE,
    unavailable: [],
    ...over,
  };
}

function mkPlatformRow(id: string, state: EtwinTwinState): EtwinPlatformRow {
  return {
    id,
    stage: `Stage for ${id}`,
    label: `${id} platform`,
    module: `apps/desktop/src/main/${id}/index.ts`,
    state,
    summary: `${id} summary.`,
    metrics: [],
  };
}

/** Totals are computed from the rows, so the fixture is never self-inconsistent. */
function mkPlatforms(
  rows: EtwinPlatformRow[] = [
    mkPlatformRow('s6-insight', 'steady'),
    mkPlatformRow('s7-workflow', 'steady'),
    mkPlatformRow('s8-operations', 'steady'),
  ],
  over: Partial<EtwinPlatformTwins> = {},
): EtwinPlatformTwins {
  const domains: EtwinDomainRow[] = [
    { id: 'enterprise', label: 'enterprise', entities: 10, band: 'healthy' },
    { id: 'organization', label: 'organization', entities: 20, band: 'watch' },
  ];
  return {
    generatedAt: NOW,
    domains,
    domainTotals: { domains: 2, entities: 30, healthy: 1, degraded: 1 },
    platforms: rows,
    totals: {
      platforms: rows.length,
      steady: rows.filter((p) => p.state === 'steady').length,
      attention: rows.filter((p) => p.state === 'attention').length,
      unknown: rows.filter((p) => p.state === 'unknown').length,
    },
    disclosure: PLATFORM_TWINS_DISCLOSURE,
    unavailable: [],
    ...over,
  };
}

function mkCoverage(over: Partial<EtwinCoverageMap> = {}): EtwinCoverageMap {
  return {
    generatedAt: NOW,
    rows: [],
    totals: { total: 22, modelledByTwin: 9, modelledElsewhere: 10, notModelled: 3 },
    notModelled: ['Physical sensor telemetry — None.', 'Energy & environmental — None.'],
    disclosure: COVERAGE_DISCLOSURE,
    unavailable: [],
    ...over,
  };
}

function mkSimulation(over: Partial<EtwinSimulationInventory> = {}): EtwinSimulationInventory {
  return {
    generatedAt: NOW,
    entries: [
      {
        id: 'manufacturing-what-if',
        label: 'Manufacturing deterministic what-if',
        kind: 'deterministic-what-if',
        module: 'packages/shared/src/types/manufacturingDigitalTwin.ts',
        scenarioCount: 15,
        live: null,
        canSimulate: 'Authored deterministic scenarios.',
        cannotSimulate: 'No main-process code imports it.',
        invoked: false,
      },
    ],
    totals: { registered: 4, withScenarios: 2, liveInstances: 10 },
    disclosure: SIMULATION_DISCLOSURE,
    unavailable: [],
    ...over,
  };
}

function mkHistory(over: Partial<EtwinHistoryView> = {}): EtwinHistoryView {
  return {
    generatedAt: NOW,
    rows: [],
    totals: { improving: 1, stable: 2, regressing: 1, unavailable: 0 },
    untrendable: [
      { seriesId: 'twin-overall-health', label: 'Twin overall health', reason: 'Computed per read.' },
    ],
    recordedDays: 91,
    recordedDecisions: 4,
    disclosure: HISTORY_DISCLOSURE,
    unavailable: [],
    ...over,
  };
}

function mkTwin(over: Partial<TwinSummary> = {}): TwinSummary {
  return {
    generatedAt: NOW,
    domainCount: 9,
    totalEntities: 450,
    overallHealth: 82,
    healthBand: 'healthy',
    overallRisk: 18,
    riskBand: 'healthy',
    criticalImpactNodes: 0,
    openDecisions: 3,
    liveDomains: 9,
    ...over,
  };
}

/** A pass in which nothing is wrong and nothing is unreadable. */
function mkInputs(over: Partial<EtwinDashboardInputs> = {}): EtwinDashboardInputs {
  return {
    nowIso: NOW,
    twin: mkTwin(),
    runtime: mkRuntime(),
    platforms: mkPlatforms(),
    coverage: mkCoverage(),
    simulation: mkSimulation(),
    history: mkHistory(),
    ...over,
  };
}

const ids = (inp: EtwinDashboardInputs): string[] =>
  composeTwinRecommendations(inp).map((r) => r.id);

/* ── the recommendation rules ─────────────────────────────────────────────── */

describe('a clean pass recommends nothing', () => {
  it('fires no rule when every platform is steady, the runtime is quiet and the twin is healthy', () => {
    expect(composeTwinRecommendations(mkInputs())).toEqual([]);
  });

  it('says so in the report rather than leaving the section blank', () => {
    const section = composeTwinReport(mkInputs()).sections.at(-1)!;
    expect(section.lines).toEqual(['No twin focus items by the composed values.']);
  });
});

describe('rule 1 — platform twins reporting outstanding work', () => {
  const withAttention = mkInputs({
    platforms: mkPlatforms([
      mkPlatformRow('s6-insight', 'steady'),
      mkPlatformRow('s7-workflow', 'attention'),
      mkPlatformRow('s9-continuity', 'attention'),
    ]),
  });

  it('fires once for all attention platforms together, naming each', () => {
    const rec = composeTwinRecommendations(withAttention).find(
      (r) => r.id === 'etwinrec:platform:attention',
    )!;
    expect(rec.title).toBe('2 platform twin(s) reporting outstanding work');
    expect(rec.detail).toBe('s7-workflow platform: s7-workflow summary. s9-continuity platform: s9-continuity summary.');
    expect(rec.priority).toBe('high');
    expect(rec.evidence).toEqual(['s7-workflow', 's9-continuity']);
    expect(rec.affectedSystems).toEqual(['s7-workflow', 's9-continuity']);
  });

  it('stays silent when no platform reports outstanding work', () => {
    expect(ids(mkInputs())).not.toContain('etwinrec:platform:attention');
  });

  it('does not fire on an unreadable platform — unknown is not attention', () => {
    const unknownOnly = mkInputs({
      platforms: mkPlatforms([mkPlatformRow('s6-insight', 'unknown')]),
    });
    expect(ids(unknownOnly)).not.toContain('etwinrec:platform:attention');
  });
});

describe('rule 2 — platform twins that could not be read', () => {
  const withUnknown = mkInputs({
    platforms: mkPlatforms([
      mkPlatformRow('s6-insight', 'steady'),
      mkPlatformRow('s10-strategy', 'unknown'),
    ]),
  });

  it('fires at medium priority and assumes no state', () => {
    const rec = composeTwinRecommendations(withUnknown).find(
      (r) => r.id === 'etwinrec:platform:unknown',
    )!;
    expect(rec.title).toBe('1 platform twin(s) unreadable this pass');
    expect(rec.detail).toBe('No state is assumed for: s10-strategy platform.');
    expect(rec.priority).toBe('medium');
    expect(rec.evidence).toEqual(['s10-strategy']);
  });

  it('stays silent when every platform was readable', () => {
    expect(ids(mkInputs())).not.toContain('etwinrec:platform:unknown');
  });

  it('is independent of rule 1 — a mixed pass fires both, each over its own rows', () => {
    const mixed = mkInputs({
      platforms: mkPlatforms([
        mkPlatformRow('s6-insight', 'attention'),
        mkPlatformRow('s10-strategy', 'unknown'),
        mkPlatformRow('s11-governance', 'steady'),
      ]),
    });
    const recs = composeTwinRecommendations(mixed);
    expect(recs.find((r) => r.id === 'etwinrec:platform:attention')!.evidence).toEqual(['s6-insight']);
    expect(recs.find((r) => r.id === 'etwinrec:platform:unknown')!.evidence).toEqual(['s10-strategy']);
  });
});

describe('rule 3 — failed execution sessions', () => {
  const withFailures = mkInputs({
    runtime: mkRuntime({
      stats: mkStats({ failed: 3 }),
      kinds: [
        { kind: 'decision', active: 0, historical: 5, failed: 0 },
        { kind: 'task', active: 2, historical: 30, failed: 3 },
      ],
    }),
  });

  it('fires on the engine’s own count and cites the failing kinds', () => {
    const rec = composeTwinRecommendations(withFailures).find(
      (r) => r.id === 'etwinrec:runtime:failed',
    )!;
    expect(rec.title).toBe('3 failed execution session(s) in the current process');
    expect(rec.detail).toBe('40 completed · 3 failed · 1 cancelled across 3 registered kind(s).');
    expect(rec.priority).toBe('high');
    expect(rec.evidence).toEqual(['kind:task']);
    expect(rec.affectedSystems).toEqual(['execute-engine']);
  });

  it('stays silent when the engine reports no failures', () => {
    expect(ids(mkInputs())).not.toContain('etwinrec:runtime:failed');
  });

  it('stays silent when the engine could not be read — unreadable is not a failure', () => {
    const blind = mkInputs({ runtime: mkRuntime({ available: false, stats: null }) });
    expect(ids(blind)).not.toContain('etwinrec:runtime:failed');
  });

  /**
   * FINDING — fixed in twinDashboard.ts, locked here.
   *
   * `stats` and the session history are two SEPARATE reads of a live engine, so
   * a failure the engine has counted need not still be visible per kind: the
   * history can be trimmed, or a session can fail between the two calls. The
   * rule previously passed the per-kind list straight through as evidence, so
   * that combination produced an empty evidence array, which makes the throwing
   * Principle-C guard reject the recommendation — taking the entire read-only
   * dashboard down with it. The evidence now falls back to naming the read that
   * reported the failure rather than claiming a kind the retained history
   * cannot support.
   */
  it('still composes when a counted failure is no longer visible per kind, citing the read that reported it', () => {
    const trimmed = mkInputs({
      runtime: mkRuntime({
        stats: mkStats({ failed: 2 }),
        kinds: [{ kind: 'task', active: 2, historical: 30, failed: 0 }],
      }),
    });
    expect(() => composeTwinDashboard(trimmed)).not.toThrow();
    const rec = composeTwinRecommendations(trimmed).find((r) => r.id === 'etwinrec:runtime:failed')!;
    expect(rec.evidence).toEqual(['execute-engine:stats']);
    expect(recommendationIssues(rec)).toEqual([]);
  });
});

describe('rule 4 — supervised subsystems recovering or failing to recover', () => {
  const recovering = mkInputs({
    runtime: mkRuntime(
      {},
      {
        rows: [
          { subsystem: 'runtime', policy: 'automatic', recovering: true, recoveries: 4, failures: 1, lastAt: '2026-08-01T08:00:00.000Z' },
          { subsystem: 'voice', policy: 'disabled', recovering: false, recoveries: 0, failures: 0, lastAt: null },
        ],
      },
    ),
  });

  const failedOnly = mkInputs({
    runtime: mkRuntime(
      {},
      {
        rows: [
          { subsystem: 'backend', policy: 'automatic', recovering: false, recoveries: 3, failures: 2, lastAt: '2026-08-01T07:00:00.000Z' },
        ],
      },
    ),
  });

  it('escalates to high while a subsystem is actively recovering', () => {
    const rec = composeTwinRecommendations(recovering).find(
      (r) => r.id === 'etwinrec:runtime:supervisor',
    )!;
    expect(rec.title).toBe('1 supervised subsystem(s) recovering or with recorded recovery failures');
    expect(rec.detail).toBe('runtime: recovering now, 1 failed recovery(ies) of 4');
    expect(rec.priority).toBe('high');
    expect(rec.evidence).toEqual(['subsystem:runtime']);
  });

  it('stays at medium for recorded failures with nothing recovering now', () => {
    const rec = composeTwinRecommendations(failedOnly).find(
      (r) => r.id === 'etwinrec:runtime:supervisor',
    )!;
    expect(rec.priority).toBe('medium');
    expect(rec.detail).toBe('backend: idle, 2 failed recovery(ies) of 3');
  });

  it('stays silent for a subsystem that recovered cleanly and is idle', () => {
    // The default fixture has a subsystem with 2 recoveries and 0 failures.
    expect(ids(mkInputs())).not.toContain('etwinrec:runtime:supervisor');
  });

  it('stays silent when the supervisor could not be read at all', () => {
    const blind = mkInputs({ runtime: mkRuntime({}, { available: false, status: null, rows: [] }) });
    expect(ids(blind)).not.toContain('etwinrec:runtime:supervisor');
  });
});

describe('rule 5 — the twin’s own health band', () => {
  it('fires at high on watch and at-risk', () => {
    for (const band of ['watch', 'at-risk'] as TwinBand[]) {
      const rec = composeTwinRecommendations(mkInputs({ twin: mkTwin({ healthBand: band }) })).find(
        (r) => r.id === 'etwinrec:twin:band',
      )!;
      expect(rec.priority, band).toBe('high');
      expect(rec.title, band).toBe(`The enterprise twin reports a ${band} health band`);
    }
  });

  it('escalates to critical only on the critical band', () => {
    const rec = composeTwinRecommendations(
      mkInputs({ twin: mkTwin({ healthBand: 'critical', overallHealth: 21, criticalImpactNodes: 4 }) }),
    ).find((r) => r.id === 'etwinrec:twin:band')!;
    expect(rec.priority).toBe('critical');
    expect(rec.detail).toBe('Overall health 21 across 9 domain(s) and 450 entity(ies); 4 critical impact node(s).');
    expect(rec.evidence).toEqual(['health:21', 'band:critical', 'impact-nodes:4']);
  });

  it('stays silent on a healthy band', () => {
    expect(ids(mkInputs())).not.toContain('etwinrec:twin:band');
  });

  it('stays silent when P15 could not be read — unreadable is not unhealthy', () => {
    expect(ids(mkInputs({ twin: null }))).not.toContain('etwinrec:twin:band');
  });
});

describe('every recommendation is complete by construction', () => {
  /** A pass in which all five rules fire at once. */
  const allFive = mkInputs({
    twin: mkTwin({ healthBand: 'critical' }),
    runtime: mkRuntime(
      { stats: mkStats({ failed: 3 }), kinds: [{ kind: 'task', active: 0, historical: 9, failed: 3 }] },
      {
        rows: [
          { subsystem: 'runtime', policy: 'automatic', recovering: true, recoveries: 4, failures: 1, lastAt: NOW },
        ],
      },
    ),
    platforms: mkPlatforms([
      mkPlatformRow('s6-insight', 'attention'),
      mkPlatformRow('s10-strategy', 'unknown'),
    ]),
  });

  it('passes the Principle-C guard on every rule, in rule order', () => {
    const recs = composeTwinRecommendations(allFive);
    expect(recs.map((r) => r.id)).toEqual([
      'etwinrec:platform:attention',
      'etwinrec:platform:unknown',
      'etwinrec:runtime:failed',
      'etwinrec:runtime:supervisor',
      'etwinrec:twin:band',
    ]);
    for (const rec of recs) expect(recommendationIssues(rec), rec.id).toEqual([]);
  });

  it('namespaces every id and never emits the same one twice', () => {
    const recs = composeTwinRecommendations(allFive);
    for (const rec of recs) expect(rec.id.startsWith('etwinrec:'), rec.id).toBe(true);
    expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
  });

  it('recommends only — every rule points at a surface that governs the work elsewhere', () => {
    for (const rec of composeTwinRecommendations(allFive)) {
      expect(rec.suggestedAction.length, rec.id).toBeGreaterThan(0);
      expect(rec.rollbackImplications.toLowerCase(), rec.id).toContain('recommendation only');
    }
  });

  it('hands the dashboard exactly what the rules produced', () => {
    expect(composeTwinDashboard(allFive).recommendations).toEqual(composeTwinRecommendations(allFive));
  });
});

/* ── the rollups ──────────────────────────────────────────────────────────── */

describe('the runtime rollup keeps unreadable distinct from zero', () => {
  it('reports null failures when the engine statistics could not be read', () => {
    const d = composeTwinDashboard(mkInputs({ runtime: mkRuntime({ available: false, stats: null }) }));
    expect(d.runtime.failed).toBeNull();
    expect(d.runtime.failed).not.toBe(0);
  });

  it('reports zero failures when the engine was read and had none', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.runtime.failed).toBe(0);
    expect(d.runtime.failed).not.toBeNull();
  });

  it('reports null recovering when the supervisor status could not be read', () => {
    const d = composeTwinDashboard(
      mkInputs({ runtime: mkRuntime({}, { available: false, status: null, rows: [] }) }),
    );
    expect(d.runtime.recovering).toBeNull();
    expect(d.runtime.recovering).not.toBe(0);
  });

  it('reports zero recovering when the supervisor was read and nothing was recovering', () => {
    expect(composeTwinDashboard(mkInputs()).runtime.recovering).toBe(0);
  });

  it('counts the subsystems the supervisor itself reported as recovering', () => {
    const d = composeTwinDashboard(
      mkInputs({ runtime: mkRuntime({}, { status: mkStatus({ recovering: ['runtime', 'backend'] }) }) }),
    );
    expect(d.runtime.recovering).toBe(2);
  });

  it('is available when either half is readable, and unavailable only when neither is', () => {
    const cases: [boolean, boolean, boolean][] = [
      [true, true, true],
      [true, false, true],
      [false, true, true],
      [false, false, false],
    ];
    for (const [exec, sup, expected] of cases) {
      const d = composeTwinDashboard(
        mkInputs({ runtime: mkRuntime({ available: exec }, { available: sup }) }),
      );
      expect(d.runtime.available, `${exec}/${sup}`).toBe(expected);
    }
  });

  it('carries the engine’s own session and kind counts without recomputing them', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.runtime.activeSessions).toBe(2);
    expect(d.runtime.registeredKinds).toBe(3);
  });
});

describe('the platform rollup is mapped key by key, never spread', () => {
  const distinct = mkInputs({
    platforms: mkPlatforms([
      mkPlatformRow('a', 'steady'),
      mkPlatformRow('b', 'steady'),
      mkPlatformRow('c', 'steady'),
      mkPlatformRow('d', 'steady'),
      mkPlatformRow('e', 'attention'),
      mkPlatformRow('f', 'attention'),
      mkPlatformRow('g', 'unknown'),
    ]),
  });

  it('renames the count to `total` and emits no stray `platforms` key', () => {
    const d = composeTwinDashboard(distinct);
    expect(d.platforms).toEqual({ total: 7, steady: 4, attention: 2, unknown: 1 });
    expect(Object.keys(d.platforms).sort()).toEqual(['attention', 'steady', 'total', 'unknown']);
    expect((d.platforms as Record<string, unknown>).platforms).toBeUndefined();
  });

  it('takes the total from the view’s own count rather than re-counting the rows', () => {
    const d = composeTwinDashboard(distinct);
    expect(d.platforms.total).toBe(distinct.platforms.totals.platforms);
  });

  it('keeps the coverage sibling’s four keys, which already name their count `total`', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.coverage).toEqual({ total: 22, modelledByTwin: 9, modelledElsewhere: 10, notModelled: 3 });
    expect(d.coverage).not.toBe(mkInputs().coverage.totals);
  });

  it('carries the simulation and history rollups through unchanged', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.simulation).toEqual({ registered: 4, liveInstances: 10 });
    expect(d.history).toEqual({ improving: 1, stable: 2, regressing: 1, unavailable: 0 });
  });

  it('carries P15’s summary verbatim, and reports null rather than a zeroed twin', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.twin).toEqual({
      domainCount: 9,
      totalEntities: 450,
      overallHealth: 82,
      healthBand: 'healthy',
      criticalImpactNodes: 0,
      openDecisions: 3,
    });
    expect(composeTwinDashboard(mkInputs({ twin: null })).twin).toBeNull();
  });
});

describe('unavailability is collected once per system', () => {
  it('merges the five views’ failures, keeping the first reason for a repeated system', () => {
    const d = composeTwinDashboard(
      mkInputs({
        runtime: mkRuntime({}, {}, { unavailable: [{ system: 'execute-engine', reason: 'not started' }] }),
        platforms: mkPlatforms(undefined, {
          unavailable: [
            { system: 'p15-twin', reason: 'overview threw' },
            { system: 'execute-engine', reason: 'read again, same failure' },
          ],
        }),
        coverage: mkCoverage({ unavailable: [{ system: 'p15-twin', reason: 'domains threw' }] }),
        simulation: mkSimulation({ unavailable: [{ system: 's6-insight', reason: 'predictions threw' }] }),
        history: mkHistory({ unavailable: [{ system: 's12-analytics', reason: 'trends threw' }] }),
      }),
    );
    expect(d.unavailable).toEqual([
      { system: 'execute-engine', reason: 'not started' },
      { system: 'p15-twin', reason: 'overview threw' },
      { system: 's6-insight', reason: 'predictions threw' },
      { system: 's12-analytics', reason: 'trends threw' },
    ]);
  });

  it('reports nothing unavailable when every view read cleanly', () => {
    expect(composeTwinDashboard(mkInputs()).unavailable).toEqual([]);
  });
});

describe('the disclosures travel with the composition', () => {
  it('carries one disclosure per composed view, in composition order', () => {
    expect(ETWIN_DISCLOSURES).toEqual([
      RUNTIME_TWIN_DISCLOSURE,
      PLATFORM_TWINS_DISCLOSURE,
      COVERAGE_DISCLOSURE,
      SIMULATION_DISCLOSURE,
      HISTORY_DISCLOSURE,
    ]);
    expect(ETWIN_DISCLOSURES).toHaveLength(5);
    expect(new Set(ETWIN_DISCLOSURES).size).toBe(5);
  });

  it('emits them on every dashboard as a copy, so a caller cannot edit the source', () => {
    const d = composeTwinDashboard(mkInputs());
    expect(d.disclosures).toEqual([...ETWIN_DISCLOSURES]);
    expect(d.disclosures).not.toBe(ETWIN_DISCLOSURES);
  });

  it('emits them even on a pass where nothing at all was readable', () => {
    const blind = composeTwinDashboard(
      mkInputs({
        twin: null,
        runtime: mkRuntime({ available: false, stats: null }, { available: false, status: null, rows: [] }),
      }),
    );
    expect(blind.disclosures).toHaveLength(5);
  });
});

/* ── the report ───────────────────────────────────────────────────────────── */

describe('the executive report', () => {
  it('emits the seven sections in order under a stable title', () => {
    const report = composeTwinReport(mkInputs());
    expect(report.title).toBe('Enterprise digital twin platform — executive report');
    expect(report.generatedAt).toBe(NOW);
    expect(report.sections.map((s) => s.title)).toEqual([
      'Enterprise twin (P15, composed verbatim)',
      'Runtime & execution twin (the estate P15 has no domain for)',
      'Platform twins (Stage 6–12)',
      'State coverage (what the twin does and does not model)',
      'Simulation capability (registered, never invoked)',
      'Recorded history (Stage 12’s deltas, composed verbatim)',
      'Twin focus (recommendations only — nothing executes from here)',
    ]);
  });

  it('says the twin was unreadable rather than reporting a zeroed one', () => {
    const lines = composeTwinReport(mkInputs({ twin: null })).sections[0].lines;
    expect(lines).toEqual(['The P15 enterprise twin was unreadable this pass — no health is assumed.']);
  });

  it('separates an unreadable statistic from a read one in the runtime line', () => {
    const readable = composeTwinReport(mkInputs()).sections[1].lines[0];
    expect(readable).toBe(
      '2 active session(s) across 3 registered kind(s) · 0 failed. 0 subsystem(s) recovering.',
    );

    const partial = composeTwinReport(
      mkInputs({ runtime: mkRuntime({ stats: null }, { status: null }) }),
    ).sections[1].lines[0];
    expect(partial).toBe(
      '2 active session(s) across 3 registered kind(s) · execution statistics unreadable. Supervisor unreadable.',
    );
  });

  it('reports a wholly unreadable runtime as unreadable, not as idle', () => {
    const lines = composeTwinReport(
      mkInputs({
        runtime: mkRuntime({ available: false, stats: null }, { available: false, status: null, rows: [] }),
      }),
    ).sections[1].lines;
    expect(lines[0]).toBe('Neither the Execute Engine nor the Runtime Supervisor was readable this pass.');
  });

  it('names each failing kind on its own line', () => {
    const lines = composeTwinReport(
      mkInputs({
        runtime: mkRuntime({
          stats: mkStats({ failed: 3 }),
          kinds: [
            { kind: 'decision', active: 0, historical: 5, failed: 0 },
            { kind: 'task', active: 2, historical: 30, failed: 3 },
          ],
        }),
      }),
    ).sections[1].lines;
    expect(lines).toContain('FAILING — task: 3 of 30 historical session(s).');
    expect(lines.some((l) => l.startsWith('FAILING — decision'))).toBe(false);
  });

  it('states the coverage gaps, and says so plainly when there are none', () => {
    const withGaps = composeTwinReport(mkInputs()).sections[3].lines;
    expect(withGaps[1]).toBe(
      'Not modelled anywhere: Physical sensor telemetry — None.; Energy & environmental — None..',
    );

    const noGaps = composeTwinReport(
      mkInputs({
        coverage: mkCoverage({
          notModelled: [],
          totals: { total: 22, modelledByTwin: 9, modelledElsewhere: 13, notModelled: 0 },
        }),
      }),
    ).sections[3].lines;
    expect(noGaps[1]).toBe('Every registered state kind has a named owner.');
  });

  it('states what each simulation capability cannot do', () => {
    const lines = composeTwinReport(mkInputs()).sections[4].lines;
    expect(lines[0]).toBe('4 registered capabilit(ies) · 10 live instance(s) observed.');
    expect(lines).toContain('Manufacturing deterministic what-if: No main-process code imports it.');
  });

  it('distinguishes an unreadable store from an empty one in the history section', () => {
    const readable = composeTwinReport(mkInputs()).sections[5].lines;
    expect(readable[1]).toBe('91 recorded day(s) of health history.');
    expect(readable[2]).toBe('4 recorded decision(s).');

    const unread = composeTwinReport(
      mkInputs({ history: mkHistory({ recordedDays: null, recordedDecisions: null }) }),
    ).sections[5].lines;
    expect(unread[1]).toBe('The health history store was unreadable this pass.');
    expect(unread[2]).toBe('The decision store was unreadable this pass.');

    const empty = composeTwinReport(
      mkInputs({ history: mkHistory({ recordedDays: 0, recordedDecisions: 0 }) }),
    ).sections[5].lines;
    expect(empty[1]).toBe('0 recorded day(s) of health history.');
    expect(empty[2]).toBe('0 recorded decision(s).');
  });

  it('declares every untrendable series in the history section', () => {
    const lines = composeTwinReport(mkInputs()).sections[5].lines;
    expect(lines).toContain('UNTRENDABLE — Twin overall health: Computed per read.');
  });

  it('lists each focus item with its priority and the action that governs it', () => {
    const lines = composeTwinReport(
      mkInputs({ twin: mkTwin({ healthBand: 'critical', overallHealth: 21 }) }),
    ).sections.at(-1)!.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('CRITICAL · The enterprise twin reports a critical health band → ')).toBe(true);
  });

  it('composes on a wholly blind pass without throwing', () => {
    const blind = mkInputs({
      twin: null,
      runtime: mkRuntime({ available: false, stats: null }, { available: false, status: null, rows: [] }),
      platforms: mkPlatforms([mkPlatformRow('s6-insight', 'unknown')]),
      coverage: mkCoverage({ notModelled: [] }),
      history: mkHistory({ recordedDays: null, recordedDecisions: null }),
    });
    expect(() => composeTwinReport(blind)).not.toThrow();
    expect(composeTwinReport(blind).sections).toHaveLength(7);
  });
});

describe('the composition’s own contract', () => {
  it('stamps the caller’s time on both the dashboard and the report', () => {
    expect(composeTwinDashboard(mkInputs()).generatedAt).toBe(NOW);
    expect(composeTwinReport(mkInputs()).generatedAt).toBe(NOW);
  });

  it('is deterministic — the same input composes byte-identical output', () => {
    expect(composeTwinDashboard(mkInputs())).toEqual(composeTwinDashboard(mkInputs()));
    expect(composeTwinReport(mkInputs())).toEqual(composeTwinReport(mkInputs()));
  });
});

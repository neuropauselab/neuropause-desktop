/**
 * Phase 6 Stage 13 — composition budgets, measured over a realistic seeded
 * fixture AFTER a warmup pass (the Stage 8–12 bench pattern): the runtime /
 * platform / coverage / simulation / history component builds ≤ 100 ms each;
 * the full dashboard and the twin report ≤ 500 ms; a warm read (inside the
 * 3 s TTL) ≤ 20 ms. The bench advances the INJECTED clock by 10 s between
 * measurements to defeat the TTL, so every figure below is a genuine cold
 * compose and not a cache hit wearing a cold build's name.
 *
 * Every number this file prints is MEASURED at run time and interpolated into
 * the assertion message — no throughput, latency or ratio is written down as a
 * literal anywhere. The only literals are the four budgets, which are the
 * Stage 8–12 budgets carried forward unchanged, and the fixture volumes.
 *
 * Fixture volume is stated rather than assumed, because a budget only means
 * something against a declared load. Stage 13 composes; the inputs that
 * actually scale are the engine's session lists, the supervisor's recovery
 * history, the P15 domain projection, Stage 12's trend rows and the insight
 * predictions. Those are seeded heavy; the rest of the surface is bounded by
 * construction (46 registry ids, 5 supervised subsystems, 7 stage slices, 10
 * execution kinds, ROW_LIMIT = 12 detail rows per runtime table).
 *
 * Deterministic INPUTS: injected clock, literal fixtures, no wall-clock read
 * outside `measure()`, no sleeps, no randomness. The VERDICT is not — and this
 * header used to say a flat "Deterministic", which was true of everything this
 * file controls and false of the thing it asserts. `≤ 100 ms` is a comparison
 * against elapsed real time, so it can go red from machine load alone with no
 * code change anywhere. FINDING #11 in `docs/desktop/twin/TWIN-PLATFORM.md`
 * records the measurement behind that correction: the Stage 7 bench, same
 * pattern, has failed three times in this environment (once at 124.19 ms against
 * its own 100 ms budget) while passing three of three in isolation. The finding
 * gives the failure COUNT rather than a rate on purpose — quoted as a ratio the
 * number went stale twice while being verified, since every run that checks it
 * also grows its denominator. It stood at three in ten at the time of writing
 * and has not risen since the eighth run. These three tests are the only
 * nondeterministic ones in Stage 13.
 *
 * What keeps them green is margin, not design: measured here, the runtime-twin
 * build lands at 1.3 ms against 100 ms and the dashboard at 0.3 ms against
 * 500 ms — roughly two orders of magnitude, where Stage 7 has none. The budgets
 * are left at the S8–S12 values on purpose. Raising them to buy safety would put
 * a number in the tree that no measurement supports, which is exactly what this
 * file exists to avoid.
 */
import { describe, expect, it } from 'vitest';
import {
  type EanaTrendReport,
  type ExecutionKind,
  type ExecutionSession,
  type ExecutionStats,
  type RecoveryPolicy,
  type RecoveryRecord,
  type SeriesKind,
  type SupervisedSubsystem,
  type SupervisorStatus,
  type TwinDomainId,
  type TwinDomains,
  type TwinSummary,
} from '@neuropause/shared';
import { initDigitalTwinPlatform, type EtwinPlatformDeps } from './index';

const T0 = Date.parse('2026-08-01T09:00:00.000Z');
const T0_ISO = '2026-08-01T09:00:00.000Z';

/* ── declared load ────────────────────────────────────────────────────────── */

/** Every kind the Execute Engine publishes — the rollup iterates all of them. */
const KINDS: readonly ExecutionKind[] = [
  'task',
  'worker',
  'automation',
  'decision',
  'workflow',
  'memory',
  'connector',
  'voice',
  'runtime',
  'executive',
];
const SUBSYSTEMS: readonly SupervisedSubsystem[] = ['runtime', 'platform', 'automation', 'voice', 'backend'];

const ACTIVE_SESSIONS = 40;
const HISTORICAL_SESSIONS = 400;
const RECOVERY_RECORDS = 60;
const TREND_ROWS = 30;
const PREDICTIONS = 30;

/**
 * All nine ids `TwinDomainId` publishes — the domain space is closed, so the
 * heaviest honest P15 projection is every domain present, not an invented count.
 */
const DOMAIN_IDS: readonly TwinDomainId[] = [
  'enterprise',
  'organization',
  'infrastructure',
  'workforce',
  'application',
  'connector',
  'marketplace',
  'federation',
  'strategy',
];
const TWIN_DOMAINS = DOMAIN_IDS.length;

const POLICIES: Record<SupervisedSubsystem, RecoveryPolicy> = {
  runtime: 'automatic',
  platform: 'manual',
  automation: 'automatic',
  voice: 'disabled',
  backend: 'automatic',
};

function mkSession(i: number, running: boolean): ExecutionSession {
  const kind = KINDS[i % KINDS.length]!;
  return {
    id: `${running ? 'a' : 'h'}${i}`,
    kind,
    label: `${kind} session ${i}`,
    state: running ? 'running' : (['completed', 'completed', 'completed', 'failed'] as const)[i % 4]!,
    steps: [],
    currentStep: running ? 0 : -1,
    startedAt: '2026-07-31T12:00:00.000Z',
    completedAt: running ? null : '2026-07-31T12:00:05.000Z',
    durationMs: running ? null : 5_000 + (i % 900),
    error: null,
    resultSummary: null,
    result: null,
  };
}

const ACTIVE: ExecutionSession[] = Array.from({ length: ACTIVE_SESSIONS }, (_, i) => mkSession(i, true));
const HISTORY: ExecutionSession[] = Array.from({ length: HISTORICAL_SESSIONS }, (_, i) => mkSession(i, false));

const STATS: ExecutionStats = {
  active: ACTIVE_SESSIONS,
  queued: 3,
  completed: 300,
  failed: 100,
  cancelled: 0,
  successRate: 0.75,
  averageRuntimeMs: 5_400,
};

const RECOVERIES: RecoveryRecord[] = Array.from({ length: RECOVERY_RECORDS }, (_, i) => ({
  id: `rec-${i}`,
  subsystem: SUBSYSTEMS[i % SUBSYSTEMS.length]!,
  reason: `subsystem ${SUBSYSTEMS[i % SUBSYSTEMS.length]!} stopped responding`,
  startedAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T04:00:00.000Z`,
  durationMs: 1_200 + i,
  ok: i % 5 !== 0,
  detail: i % 3 === 0 ? null : 'restarted in place',
}));

const STATUS: SupervisorStatus = {
  policies: POLICIES,
  recovering: ['backend'],
  lastRecovery: RECOVERIES[RECOVERY_RECORDS - 1]!,
  recoveryCount: RECOVERY_RECORDS,
  recentFailures: 4,
};

const DOMAINS: TwinDomains = {
  domains: DOMAIN_IDS.map((id, i) => ({
    id,
    name: `Domain ${id}`,
    description: `The ${id} domain of the P15 enterprise twin`,
    entityCount: 20 + i * 7,
    band: (['healthy', 'watch', 'at-risk'] as const)[i % 3]!,
    status: 'ok',
    metrics: [],
    source: 'twinModel',
    live: i % 4 !== 0,
  })),
  totalEntities: Array.from({ length: TWIN_DOMAINS }, (_, i) => 20 + i * 7).reduce((a, b) => a + b, 0),
  healthyDomains: 3,
  degradedDomains: 6,
};

const TWIN: TwinSummary = {
  generatedAt: T0_ISO,
  domainCount: TWIN_DOMAINS,
  totalEntities: DOMAINS.totalEntities,
  overallHealth: 71,
  healthBand: 'watch',
  overallRisk: 29,
  riskBand: 'watch',
  criticalImpactNodes: 2,
  openDecisions: 6,
  liveDomains: 7,
};

/** Mixed kinds on purpose: Stage 13 keeps two of the three and drops the rest. */
const TREND_KINDS: readonly SeriesKind[] = ['daily-history', 'decision-window', 'point-in-time'];

const TRENDS: EanaTrendReport = {
  generatedAt: T0_ISO,
  rows: Array.from({ length: TREND_ROWS }, (_, i) => {
    const kind = TREND_KINDS[i % TREND_KINDS.length]!;
    const readable = i % 7 !== 0;
    return {
      seriesId: `series-${i}`,
      label: `Series ${i}`,
      kind,
      windowLabel: `2026-05-03 → 2026-08-01 (91 recorded day(s))`,
      from: readable ? 60 + (i % 20) : null,
      to: readable ? 62 + (i % 25) : null,
      delta: readable ? (i % 25) - (i % 20) + 2 : null,
      direction: readable ? (['improving', 'stable', 'regressing'] as const)[i % 3]! : 'unavailable',
      detail: readable ? `${60 + (i % 20)} → ${62 + (i % 25)} over the recorded window` : 'No recorded series.',
    };
  }),
  totals: { improving: 10, stable: 9, regressing: 6, unavailable: 5 },
  disclosure: 'Stage 12 trend disclosure.',
  unavailable: [],
};

const PREDICTION_KINDS = [
  'approval-backlog',
  'project-delay',
  'connector-instability',
  'automation-failure',
  'inactivity',
  'operational-drift',
  'risk-trend',
];

/* ── the fixture ──────────────────────────────────────────────────────────── */

function mkDeps(): { deps: EtwinPlatformDeps; tick: () => void } {
  let nowMs = T0;
  const deps: EtwinPlatformDeps = {
    twinSummary: () => TWIN,
    twinDomains: () => DOMAINS,
    executionKinds: () => [...KINDS],
    executionActive: () => ACTIVE,
    executionHistory: () => HISTORY,
    executionStats: () => STATS,
    supervisorStatus: () => STATUS,
    supervisorHistory: () => RECOVERIES,
    s6Insight: () => ({ findings: 12, criticalOrHigh: 3 }),
    s7Knowledge: () => ({ assets: 140, gaps: 9 }),
    s8Automation: () => ({ automations: 26, failures: 2 }),
    s9Operations: () => ({ posture: 'degraded', bottlenecks: 5 }),
    s10Strategy: () => ({ objectives: 18, atRisk: 4 }),
    s11Federation: () => ({ partners: 12, degraded: 2 }),
    s12Analytics: () => ({ kpis: 52, regressing: 6 }),
    s12Trends: () => TRENDS,
    recordedDays: () => 91,
    recordedDecisions: () => 25,
    insightPredictions: () =>
      Array.from({ length: PREDICTIONS }, (_, i) => ({ kind: PREDICTION_KINDS[i % PREDICTION_KINDS.length]! })),
    p14Scenarios: () => ({ count: 6 }),
    s12Forecasts: () => ({ registered: 4 }),
    registerSource: () => {},
    now: () => nowMs,
  };
  // 10 s > BUILD_TTL_MS (3 s), so the next read is a genuine cold compose.
  return { deps, tick: () => (nowMs += 10_000) };
}

function measure(fn: () => unknown): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe('composition budgets — measured, after warmup', () => {
  it('runtime / platforms / coverage / simulation / history cold builds ≤ 100 ms; dashboard / report ≤ 500 ms', () => {
    const { deps, tick } = mkDeps();
    const p = initDigitalTwinPlatform(deps);
    p.dashboard(); // warmup pass — JIT, module init and first-touch allocation

    tick();
    const runtime = measure(() => p.runtime());
    tick();
    const platforms = measure(() => p.platforms());
    tick();
    const coverage = measure(() => p.coverage());
    tick();
    const simulation = measure(() => p.simulation());
    tick();
    const history = measure(() => p.history());
    tick();
    const dashboard = measure(() => p.dashboard());
    tick();
    const report = measure(() => p.report());

    expect(runtime, `runtime twin build ${runtime.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(platforms, `platform twins build ${platforms.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(coverage, `coverage map build ${coverage.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(simulation, `simulation inventory build ${simulation.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(history, `history view build ${history.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(dashboard, `dashboard build ${dashboard.toFixed(1)}ms`).toBeLessThanOrEqual(500);
    expect(report, `twin report build ${report.toFixed(1)}ms`).toBeLessThanOrEqual(500);
  });

  it('a warm read (inside the TTL) is near-instant (≤ 20 ms)', () => {
    const { deps, tick } = mkDeps();
    const p = initDigitalTwinPlatform(deps);
    tick();
    p.dashboard();
    const warm = measure(() => p.dashboard());
    expect(warm, `warm read ${warm.toFixed(1)}ms`).toBeLessThanOrEqual(20);
  });

  it('every view rides ONE composed pass — the seven surfaces cost a single build', () => {
    // Not a timing budget: a structural one. The TTL is only a bound on how
    // STALE a warm read may be; the reason seven channels do not cost seven
    // composes is that they share the pass. Asserted by counting the reads the
    // engine actually receives, so a future refactor that quietly recomposes
    // per view fails here rather than showing up as a slow dashboard later.
    let reads = 0;
    const { deps, tick } = mkDeps();
    const counted: EtwinPlatformDeps = {
      ...deps,
      executionHistory: () => {
        reads += 1;
        return HISTORY;
      },
    };
    const p = initDigitalTwinPlatform(counted);
    p.runtime();
    p.platforms();
    p.coverage();
    p.simulation();
    p.history();
    p.dashboard();
    p.report();
    expect(reads, 'seven surfaces inside one TTL window').toBe(1);

    tick();
    p.dashboard();
    expect(reads, 'a fresh window recomposes exactly once').toBe(2);
  });
});

/**
 * Phase 6 Stage 13 — the composition root: EXACTLY seven read-only `etwin:*`
 * channels (requireAuth + `twin:read` — P15's OWN existing read scope, no new
 * RBAC minted, zero mutation surface, `twin:*` untouched), the 3 s TTL cache,
 * the partial-engine rule, per-port failure isolation with exact failure keys,
 * the ONE `twin-watch` delivery source (governed ITEMS from critical/high
 * recommendations, deduped), the ten-question assistant port, and dispose().
 *
 * FINDING #4 (real defect, found while writing this file, fixed in `index.ts`,
 * locked by the named test below). The coverage map's `runtime-execution` row
 * is fed by the COMPOSITE `execution` slice, which the partial-engine rule
 * nulls when ANY of the four engine reads fails. But `buildCoverageMap` was
 * handed `pick(failures, ['twin-domains', 'execute-engine'])` — one engine key
 * of four. So a failing `executionActive`, `executionHistory` or
 * `executionStats` reached the coverage view as a silent `live: null` with an
 * EMPTY `unavailable` list, while a failing `executionKinds` was declared:
 * the same cause, disclosed in one case out of four. The dashboard hid the
 * asymmetry, because it merges the runtime view's failures first and dedups by
 * system, so only the standalone `etwin:coverage` channel exposed it. Every
 * other `pick` list in the composition root is exactly the set of reads that
 * feeds its view; this was the sole under-specified list, which is the
 * signature of an oversight rather than a decision. Verified by probe before
 * the claim was made, and re-verified after the fix. Widened to all four
 * engine keys — nothing computed changes, only what the view DECLARES.
 *
 * FINDING #5 (real gap, found here, deferred on purpose, RESOLVED at the
 * renderer wiring). `report()` was on the subsystem interface and reachable
 * through the assistant's `twin-report` question, but no `etwin:report` channel
 * existed — `IpcChannel` published six `etwin:*` names and none was the report.
 * That was internally consistent, but not consistent with the Stage 12
 * precedent: `EanaPlatformTab.tsx` fetches `eana:report` over IPC, so the
 * pending Stage 13 tab would have had no way to fetch its own report. Minting a
 * channel with no consumer would have been the silent architectural change this
 * stage is forbidden to make, so the six-channel shape was asserted EXPLICITLY
 * rather than assumed, precisely so a seventh could only arrive deliberately.
 * The consumer now exists, and the seventh channel arrived through that
 * tripwire: the test below is the same test, inverted and annotated, never
 * deleted. The audit tabulated six (§5.3) while also giving `etwin:dashboard`
 * the cell "Composed dashboard + report" — a shape it could not have; the
 * separate report channel is what `estrat:`, `efed:` and `eana:` all publish.
 * The COUNT changed. The namespace, the scope, the request shape and the zero-
 * mutation guarantee did not.
 *
 * Everything here is deterministic: every read is a literal fixture, the clock
 * is injected, and no test reads the wall clock or sleeps.
 */
import { describe, expect, it } from 'vitest';
import {
  IpcChannel,
  type EanaTrendReport,
  type EtwinUnavailable,
  type ExecutionKind,
  type ExecutionSession,
  type ExecutionStats,
  type IntelligenceItem,
  type IntelligenceSource,
  type RecoveryPolicy,
  type RecoveryRecord,
  type SupervisedSubsystem,
  type SupervisorStatus,
  type TwinDomains,
  type TwinSummary,
} from '@neuropause/shared';
import { ETWIN_QUESTION_KEYS } from '@neuropause/shared';
import { initDigitalTwinPlatform, type EtwinPlatformDeps, type EtwinPlatformSubsystem } from './index';

/**
 * P13C ROUND 5 — the composed cache is tenant-keyed, so these suites name a
 * tenant. Every existing TTL and memoization assertion keeps its meaning:
 * repeated reads under ONE tenant must still be a single composition.
 */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = Date.parse('2026-08-01T09:00:00.000Z');
const T0_ISO = '2026-08-01T09:00:00.000Z';

/* ── fixtures: literals only, so every assertion below is reproducible ────── */

const POLICIES: Record<SupervisedSubsystem, RecoveryPolicy> = {
  runtime: 'automatic',
  platform: 'manual',
  automation: 'automatic',
  voice: 'disabled',
  backend: 'automatic',
};

/** The calm supervisor: nothing recovering, nothing recorded. */
const CALM_STATUS: SupervisorStatus = {
  policies: POLICIES,
  recovering: [],
  lastRecovery: null,
  recoveryCount: 0,
  recentFailures: 0,
};

/** Composed VERBATIM by the runtime twin — asserted by identity, not by shape. */
const CALM_STATS: ExecutionStats = {
  active: 1,
  queued: 0,
  completed: 6,
  failed: 0,
  cancelled: 0,
  successRate: 1,
  averageRuntimeMs: 4_100,
};

function mkSession(
  over: Partial<ExecutionSession> & { id: string; kind: ExecutionKind },
): ExecutionSession {
  return {
    label: `session ${over.id}`,
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: '2026-07-31T12:00:00.000Z',
    completedAt: '2026-07-31T12:00:05.000Z',
    durationMs: 5_000,
    error: null,
    resultSummary: null,
    result: null,
    ...over,
  };
}

const ACTIVE_SESSION = mkSession({
  id: 'a1',
  kind: 'decision',
  state: 'running',
  completedAt: null,
  durationMs: null,
});

const DOMAINS: TwinDomains = {
  domains: [
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'Enterprise domain',
      entityCount: 12,
      band: 'healthy',
      status: 'ok',
      metrics: [],
      source: 'twinModel',
      live: true,
    },
    {
      id: 'organization',
      name: 'Organization',
      description: 'Organization domain',
      entityCount: 34,
      band: 'watch',
      status: 'ok',
      metrics: [],
      source: 'twinModel',
      live: true,
    },
  ],
  totalEntities: 46,
  healthyDomains: 1,
  degradedDomains: 1,
};

/** P15's own summary, healthy — so no `etwinrec:twin:band` fires on the baseline. */
const CALM_TWIN: TwinSummary = {
  generatedAt: T0_ISO,
  domainCount: 9,
  totalEntities: 450,
  overallHealth: 84,
  healthBand: 'healthy',
  overallRisk: 16,
  riskBand: 'healthy',
  criticalImpactNodes: 0,
  openDecisions: 1,
  liveDomains: 9,
};

const TRENDS: EanaTrendReport = {
  generatedAt: T0_ISO,
  rows: [
    {
      seriesId: 'org-health-history',
      label: 'Org health (90-day daily history)',
      kind: 'daily-history',
      windowLabel: '2026-05-03 → 2026-08-01 (91 recorded day(s))',
      from: 62,
      to: 71,
      delta: 9,
      direction: 'improving',
      detail: '62 → 71 (+9) over the recorded window',
    },
  ],
  totals: { improving: 1, stable: 0, regressing: 0, unavailable: 0 },
  disclosure: 'Stage 12 trend disclosure.',
  unavailable: [],
};

/* ── the harness ──────────────────────────────────────────────────────────── */

interface Harness {
  deps: EtwinPlatformDeps;
  sources: IntelligenceSource[];
  produceWatch: () => Promise<IntelligenceItem[]>;
  setNow: (ms: number) => void;
  /**
   * Composed passes so far. Counted on `twinSummary`, which `build()` reads
   * exactly once per pass BEFORE any other read — so the count is correct even
   * when a test replaces that read with a throwing one.
   */
  builds: () => number;
}

/** The baseline: every read succeeds and nothing anywhere is outstanding. */
function mkDeps(over: Partial<EtwinPlatformDeps> = {}): Harness {
  let nowMs = T0;
  let builds = 0;
  const sources: IntelligenceSource[] = [];
  let produce: () => Promise<IntelligenceItem[]> = () => Promise.resolve([]);

  const base: EtwinPlatformDeps = {
    twinSummary: () => CALM_TWIN,
    twinDomains: () => DOMAINS,
    executionKinds: () => ['task', 'decision'],
    executionActive: () => [ACTIVE_SESSION],
    executionHistory: () => [mkSession({ id: 'h1', kind: 'task' })],
    executionStats: () => CALM_STATS,
    supervisorStatus: () => CALM_STATUS,
    supervisorHistory: () => [],
    s6Insight: () => ({ findings: 4, criticalOrHigh: 0 }),
    s7Knowledge: () => ({ assets: 20, gaps: 0 }),
    s8Automation: () => ({ automations: 8, failures: 0 }),
    s9Operations: () => ({ posture: 'stable', bottlenecks: 0 }),
    s10Strategy: () => ({ objectives: 6, atRisk: 0 }),
    s11Federation: () => ({ partners: 3, degraded: 0 }),
    s12Analytics: () => ({ kpis: 24, regressing: 0 }),
    s12Trends: () => TRENDS,
    recordedDays: () => 91,
    recordedDecisions: () => 4,
    insightPredictions: () => [{ kind: 'approval-backlog' }],
    p14Scenarios: () => ({ count: 5 }),
    s12Forecasts: () => ({ registered: 3 }),
    registerSource: (source) => {
      sources.push(source);
      produce = () => source.produce() as Promise<IntelligenceItem[]>;
    },
    now: () => nowMs,
    ...over,
  };

  // The build counter wraps the merged read, so an override is still counted.
  const counted = base.twinSummary;
  const deps: EtwinPlatformDeps = {
  scope,
    ...base,
    twinSummary: () => {
      builds += 1;
      return counted();
    },
  };

  return {
    deps,
    sources,
    produceWatch: () => produce(),
    setNow: (ms) => (nowMs = ms),
    builds: () => builds,
  };
}

/**
 * Overrides that put every recommendation rule into its firing state at once:
 * one platform reporting outstanding work (high), one unreadable (medium), a
 * failed execution session (high), a recovering subsystem (high), and P15
 * itself in the critical band (critical).
 */
const FAILED_RECOVERY: RecoveryRecord = {
  id: 'r1',
  subsystem: 'backend',
  reason: 'unhealthy',
  startedAt: '2026-07-31T23:00:00.000Z',
  durationMs: 120,
  ok: false,
  detail: 'restart failed',
};

const TROUBLED: Partial<EtwinPlatformDeps> = {
  twinSummary: () => ({
    ...CALM_TWIN,
    overallHealth: 41,
    healthBand: 'critical',
    overallRisk: 59,
    riskBand: 'critical',
    criticalImpactNodes: 2,
    openDecisions: 3,
  }),
  executionHistory: () => [
    mkSession({ id: 'h1', kind: 'task' }),
    mkSession({ id: 'h2', kind: 'task', state: 'failed', error: 'boom' }),
  ],
  executionStats: () => ({ ...CALM_STATS, failed: 2, cancelled: 1, completed: 6, successRate: 0.75 }),
  supervisorStatus: () => ({
    ...CALM_STATUS,
    recovering: ['backend'],
    lastRecovery: FAILED_RECOVERY,
    recoveryCount: 3,
    recentFailures: 1,
  }),
  supervisorHistory: () => [FAILED_RECOVERY],
  s8Automation: () => ({ automations: 8, failures: 2 }),
  s11Federation: () => {
    throw new Error('federation slice offline');
  },
};

const thrower = (name: string): (() => never) => {
  return () => {
    throw new Error(`${name} offline`);
  };
};

/* ── the IPC surface (D-2, D-3, D-9) ──────────────────────────────────────── */

const ETWIN_CHANNELS = [
  IpcChannel.EtwinRuntime,
  IpcChannel.EtwinPlatforms,
  IpcChannel.EtwinCoverage,
  IpcChannel.EtwinSimulation,
  IpcChannel.EtwinHistory,
  IpcChannel.EtwinDashboard,
  IpcChannel.EtwinReport,
];

describe('the IPC surface — seven read-only channels under P15’s EXISTING twin:read scope', () => {
  it('registers EXACTLY the seven etwin:* channels', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    expect(p.handlers.map((d) => String(d.channel)).sort()).toEqual(ETWIN_CHANNELS.map(String).sort());
    expect(p.handlers).toHaveLength(7);
  });

  it('publishes seven etwin:* names and no more — the channel table and the handler list agree', () => {
    const published = Object.values(IpcChannel).filter((c) => String(c).startsWith('etwin:'));
    expect(published.sort()).toEqual(ETWIN_CHANNELS.map(String).sort());
    const p = initDigitalTwinPlatform(mkDeps().deps);
    expect(new Set(p.handlers.map((d) => String(d.channel)))).toEqual(new Set(published.map(String)));
  });

  it('guards every channel with requireAuth and the EXISTING twin:read permission — no new scope is minted', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('etwin:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      // The permission is P15's own read scope, verbatim. A permission that
      // merely LOOKED like the twin's (an `etwin:read`) would be a new RBAC
      // scope wearing a familiar name, so the string is pinned exactly.
      expect(d.permission, String(d.channel)).toBe('twin:read');
      expect(String(d.permission).startsWith('etwin'), String(d.channel)).toBe(false);
    }
  });

  it('leaves the authoritative twin:* namespace untouched (D-2) and implies no mutation anywhere', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('twin:'), String(d.channel)).toBe(false);
      expect(String(d.channel)).not.toMatch(
        /save|set|run\b|delete|execute|create|update|cancel|write|publish|revoke|install/,
      );
    }
  });

  it('takes no request body on any channel — a read-only surface has nothing to accept', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    const schemas = new Set(p.handlers.map((d) => d.schema));
    expect(schemas.size).toBe(1); // all seven share the one EmptyRequest schema
    for (const d of p.handlers) {
      expect(d.schema.safeParse({}).success, String(d.channel)).toBe(true);
    }
  });

  it('serves each channel from the same composed pass its accessor uses', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    const byChannel = new Map(p.handlers.map((d) => [String(d.channel), d]));
    expect(byChannel.get('etwin:runtime')!.handler({})).toBe(p.runtime());
    expect(byChannel.get('etwin:platforms')!.handler({})).toBe(p.platforms());
    expect(byChannel.get('etwin:coverage')!.handler({})).toBe(p.coverage());
    expect(byChannel.get('etwin:simulation')!.handler({})).toBe(p.simulation());
    expect(byChannel.get('etwin:history')!.handler({})).toBe(p.history());
    expect(byChannel.get('etwin:dashboard')!.handler({})).toBe(p.dashboard());
    expect(byChannel.get('etwin:report')!.handler({})).toBe(p.report());
    expect(h.builds()).toBe(1); // …one pass served all fourteen reads
  });

  /**
   * FINDING #5, RESOLVED — this test is the record of what changed and why.
   *
   * It used to assert the opposite: that `etwin:report` did not exist. That was
   * the honest shape while the report had no consumer, and it was written as a
   * tripwire so a seventh channel could only ever appear as a deliberate act.
   * The consumer now exists (the Twin Center Platform tab), so the channel is
   * minted here and the tripwire is inverted rather than deleted — deleting it
   * would have erased the fact that the surface ever changed.
   *
   * The deviation is stated plainly: the audit's §5.3 tabulated SIX channels.
   * It also gave `etwin:dashboard` the cell "Composed dashboard + report", which
   * the six-channel shape cannot satisfy — `EtwinDashboard` and `EtwinReport`
   * are separate types and the handler returned only the first. Of the two ways
   * to close that, a composite payload would have been unique in the whole
   * channel table; a report channel is exactly what `estrat:`, `efed:` and
   * `eana:` already do. The count moved from six to seven. Nothing else did:
   * same namespace, same `twin:read`, same `EmptyRequest`, still zero mutation.
   */
  it('FINDING #5 resolved — report() is served on its own channel, in the sibling shape', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    expect(Object.values(IpcChannel)).toContain('etwin:report');
    const report = p.handlers.filter((d) => String(d.channel).includes('report'));
    expect(report).toHaveLength(1); // one report channel, not a family of them
    expect(report[0].requireAuth).toBe(true);
    expect(report[0].permission).toBe('twin:read'); // still P15's scope, still no new one

    // The channel serves the SAME composed report the subsystem and the
    // assistant serve. A channel that recomposed its own would be a second
    // producer wearing the same name.
    expect(report[0].handler({})).toBe(p.report());
    expect(p.report().sections.length).toBeGreaterThan(0);
    expect(p.answerQuestion('Prepare the twin report', T0_ISO)).not.toBeNull();

    // And it stayed a read. The seventh channel is the only one Stage 13 added
    // after the audit, so it is the one most worth re-proving is inert.
    expect(String(report[0].channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel|write/);
    expect(report[0].schema.safeParse({}).success).toBe(true);
  });
});

/* ── the composed views on the calm fixture ───────────────────────────────── */

describe('the composed views (calm fixture)', () => {
  it('composes the runtime twin from the engine and the supervisor', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    const r = p.runtime();
    expect(r.execution.available).toBe(true);
    expect(r.execution.registeredKinds).toEqual(['decision', 'task']); // sorted by the builder
    expect(r.execution.activeCount).toBe(1);
    expect(r.execution.historyCount).toBe(1);
    // Composed VERBATIM: the same object the engine handed over, not a copy.
    expect(r.execution.stats).toBe(CALM_STATS);
    expect(r.supervisor.available).toBe(true);
    expect(r.supervisor.status).toBe(CALM_STATUS);
    expect(r.supervisor.rows.map((x) => x.subsystem)).toEqual([
      'automation',
      'backend',
      'platform',
      'runtime',
      'voice',
    ]);
  });

  it('composes the platform twins, the coverage map, the inventory and the history view', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    expect(p.platforms().totals).toEqual({ platforms: 7, steady: 7, attention: 0, unknown: 0 });
    expect(p.platforms().domains.map((d) => d.id)).toEqual(['enterprise', 'organization']);
    expect(p.coverage().totals).toEqual({
      total: 22,
      modelledByTwin: 9,
      modelledElsewhere: 10,
      notModelled: 3,
    });
    expect(p.coverage().notModelled).toHaveLength(3); // the gaps are stated, not omitted
    expect(p.coverage().rows.find((r) => r.id === 'runtime-execution')!.live).toBe(
      '1 active session(s) across 2 registered kind(s)',
    );
    expect(p.simulation().totals.registered).toBe(4);
    // Structural, not conditional — Stage 13 has no simulation call site.
    for (const e of p.simulation().entries) expect(e.invoked, e.id).toBe(false);
    expect(p.history().recordedDays).toBe(91);
    expect(p.history().recordedDecisions).toBe(4);
    expect(p.history().rows.map((r) => r.seriesId)).toEqual(['org-health-history']);
  });

  it('composes a dashboard and a report with nothing outstanding', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    const d = p.dashboard();
    expect(d.twin).toEqual({
      domainCount: 9,
      totalEntities: 450,
      overallHealth: 84,
      healthBand: 'healthy',
      criticalImpactNodes: 0,
      openDecisions: 1,
    });
    expect(d.runtime).toEqual({
      available: true,
      activeSessions: 1,
      registeredKinds: 2,
      failed: 0,
      recovering: 0,
    });
    expect(d.recommendations).toEqual([]);
    expect(d.unavailable).toEqual([]);
    expect(d.disclosures).toHaveLength(5);
    expect(p.report().title).toBe('Enterprise digital twin platform — executive report');
    expect(p.report().sections).toHaveLength(7);
  });

  it('stamps every view with the injected clock — nothing here reads the wall clock', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    for (const at of [
      p.runtime().generatedAt,
      p.platforms().generatedAt,
      p.coverage().generatedAt,
      p.simulation().generatedAt,
      p.history().generatedAt,
      p.dashboard().generatedAt,
      p.report().generatedAt,
    ]) {
      expect(at).toBe(T0_ISO);
    }
  });

  it('is deterministic — two subsystems over the same fixture compose identically', () => {
    const a = initDigitalTwinPlatform(mkDeps().deps);
    const b = initDigitalTwinPlatform(mkDeps().deps);
    expect(a.dashboard()).toEqual(b.dashboard());
    expect(a.report()).toEqual(b.report());
    expect(a.coverage()).toEqual(b.coverage());
  });
});

/* ── the 3 s TTL cache ────────────────────────────────────────────────────── */

describe('the 3 s TTL cache', () => {
  it('reads within the TTL reuse one pass; 2 999 ms still hits; 3 001 ms rebuilds; dispose clears', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    p.runtime();
    p.platforms();
    p.coverage();
    p.simulation();
    p.history();
    p.dashboard();
    p.report();
    expect(h.builds()).toBe(1);

    h.setNow(T0 + 2_999); // the last millisecond inside the window
    p.dashboard();
    expect(h.builds()).toBe(1);

    h.setNow(T0 + 3_001); // …and the first outside it
    p.dashboard();
    expect(h.builds()).toBe(2);

    p.dispose();
    p.dashboard();
    expect(h.builds()).toBe(3);
  });

  it('hands back the SAME composed objects inside the window and fresh ones after it', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    const first = p.dashboard();
    expect(p.dashboard()).toBe(first);
    h.setNow(T0 + 3_001);
    const second = p.dashboard();
    expect(second).not.toBe(first);
    expect(second.generatedAt).toBe(new Date(T0 + 3_001).toISOString());
  });

  it('dispose() clears the cache without unregistering anything — the handlers still serve', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    p.dashboard();
    p.dispose();
    p.dispose(); // idempotent
    expect(h.builds()).toBe(1);
    expect(p.handlers).toHaveLength(7);
    expect(p.handlers[0].handler({})).toBeDefined();
    expect(h.builds()).toBe(2);
  });
});

/* ── the partial-engine rule ──────────────────────────────────────────────── */

const ENGINE_READS = [
  ['executionKinds', 'execute-engine'],
  ['executionActive', 'execute-engine-active'],
  ['executionHistory', 'execute-engine-history'],
  ['executionStats', 'execute-engine-stats'],
] as const;

describe('the partial-engine rule — an engine that half-answered is unreadable, not half-composed', () => {
  for (const [dep, system] of ENGINE_READS) {
    it(`a throwing ${dep} nulls the WHOLE execution slice, and the supervisor survives`, () => {
      const p = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(dep) }).deps);
      const r = p.runtime();
      expect(r.execution.available).toBe(false);
      expect(r.execution.registeredKinds).toEqual([]);
      expect(r.execution.activeCount).toBe(0);
      expect(r.execution.historyCount).toBe(0);
      expect(r.execution.kinds).toEqual([]);
      expect(r.execution.active).toEqual([]);
      expect(r.execution.recent).toEqual([]);
      // Null, never 0 — "the engine did not answer" is not "nothing happened".
      expect(r.execution.stats).toBeNull();
      // The supervisor is a separate system and is unaffected.
      expect(r.supervisor.available).toBe(true);
      expect(r.supervisor.status).toBe(CALM_STATUS);
      expect(r.unavailable).toEqual([{ system, reason: `${dep} offline` }]);
    });

    it(`a throwing ${dep} leaves the dashboard's failed count null, never zero`, () => {
      const p = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(dep) }).deps);
      const d = p.dashboard();
      expect(d.runtime.failed).toBeNull();
      expect(d.runtime.activeSessions).toBe(0);
      expect(d.runtime.registeredKinds).toBe(0);
      // The supervisor still reads, so the runtime view as a whole is available.
      expect(d.runtime.available).toBe(true);
      expect(d.runtime.recovering).toBe(0);
    });

    /**
     * FINDING #4, test-locked. Before the fix only `executionKinds` put an entry
     * in `coverage().unavailable`; the other three left the row's null `live`
     * unexplained on the `etwin:coverage` channel.
     */
    it(`FINDING #4 — a throwing ${dep} makes the coverage runtime row null AND says why`, () => {
      const p = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(dep) }).deps);
      const cov = p.coverage();
      expect(cov.rows.find((r) => r.id === 'runtime-execution')!.live).toBeNull();
      expect(cov.unavailable).toEqual([{ system, reason: `${dep} offline` }]);
    });
  }

  it('FINDING #4 — the fix changed only what the coverage view declares, not the dashboard', () => {
    // The dashboard merges the runtime view's failures FIRST and dedups by
    // system, so widening the coverage pick must not double-count anything.
    for (const [dep, system] of ENGINE_READS) {
      const d = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(dep) }).deps).dashboard();
      expect(d.unavailable.filter((u) => u.system === system), dep).toHaveLength(1);
      expect(d.unavailable, dep).toHaveLength(1);
    }
  });

  it('the rule is scoped to the engine — a throwing supervisor read leaves execution composed', () => {
    for (const [dep, system] of [
      ['supervisorStatus', 'runtime-supervisor'],
      ['supervisorHistory', 'runtime-supervisor-history'],
    ] as const) {
      const r = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(dep) }).deps).runtime();
      expect(r.supervisor.available, dep).toBe(false);
      expect(r.supervisor.status, dep).toBeNull();
      expect(r.supervisor.rows, dep).toEqual([]);
      expect(r.execution.available, dep).toBe(true);
      expect(r.execution.stats, dep).toBe(CALM_STATS);
      expect(r.unavailable, dep).toEqual([{ system, reason: `${dep} offline` }]);
    }
  });

  it('a wholly unreadable runtime is declared unavailable, not reported as an idle one', () => {
    const p = initDigitalTwinPlatform(
      mkDeps({
        executionKinds: thrower('executionKinds'),
        executionActive: thrower('executionActive'),
        executionHistory: thrower('executionHistory'),
        executionStats: thrower('executionStats'),
        supervisorStatus: thrower('supervisorStatus'),
        supervisorHistory: thrower('supervisorHistory'),
      }).deps,
    );
    const d = p.dashboard();
    expect(d.runtime.available).toBe(false);
    expect(d.runtime.failed).toBeNull();
    expect(d.runtime.recovering).toBeNull();
    expect(d.unavailable.map((u) => u.system).sort()).toEqual([
      'execute-engine',
      'execute-engine-active',
      'execute-engine-history',
      'execute-engine-stats',
      'runtime-supervisor',
      'runtime-supervisor-history',
    ]);
    // …and the report says so in words rather than printing zeroes.
    const runtimeSection = p.report().sections.find((s) => s.title.startsWith('Runtime & execution twin'))!;
    expect(runtimeSection.lines[0]).toContain('Neither the Execute Engine nor the Runtime Supervisor was readable');
  });
});

/* ── per-port failure isolation ───────────────────────────────────────────── */

type ViewName = 'runtime' | 'platforms' | 'coverage' | 'simulation' | 'history';

const VIEW: Record<ViewName, (p: EtwinPlatformSubsystem) => EtwinUnavailable[]> = {
  runtime: (p) => p.runtime().unavailable,
  platforms: (p) => p.platforms().unavailable,
  coverage: (p) => p.coverage().unavailable,
  simulation: (p) => p.simulation().unavailable,
  history: (p) => p.history().unavailable,
};

/**
 * Every injected read, the failure key the composition root records for it, and
 * the views that declare that key. `twinSummary` declares in NO component view
 * — no component consumes P15's summary, so the root pushes it straight onto
 * the dashboard, which is asserted separately below.
 */
const FAILURE_MAP: [keyof EtwinPlatformDeps, string, ViewName[]][] = [
  ['twinSummary', 'enterprise-twin', []],
  ['twinDomains', 'twin-domains', ['platforms', 'coverage']],
  ['executionKinds', 'execute-engine', ['runtime', 'coverage']],
  ['executionActive', 'execute-engine-active', ['runtime', 'coverage']],
  ['executionHistory', 'execute-engine-history', ['runtime', 'coverage']],
  ['executionStats', 'execute-engine-stats', ['runtime', 'coverage']],
  ['supervisorStatus', 'runtime-supervisor', ['runtime']],
  ['supervisorHistory', 'runtime-supervisor-history', ['runtime']],
  ['s6Insight', 's6-insight', ['platforms']],
  ['s7Knowledge', 's7-knowledge', ['platforms']],
  ['s8Automation', 's8-automation', ['platforms']],
  ['s9Operations', 's9-operations', ['platforms']],
  ['s10Strategy', 's10-strategy', ['platforms']],
  ['s11Federation', 's11-federation', ['platforms']],
  ['s12Analytics', 's12-analytics', ['platforms']],
  ['s12Trends', 's12-trends', ['history']],
  ['recordedDays', 'health-history', ['history']],
  ['recordedDecisions', 'decision-store', ['history']],
  ['insightPredictions', 'insight-predictions', ['simulation']],
  ['p14Scenarios', 'p14-scenarios', ['simulation']],
  ['s12Forecasts', 's12-forecasts', ['simulation']],
];

describe('failure isolation — explicit unavailability, never a fabricated value', () => {
  it('covers EVERY injected read — a read missing from this table is an untested failure path', () => {
    // `scope` joins `now` and `registerSource` as a dep that is not a READ —
    // it resolves the caller's tenant, so there is no upstream to fail.
    const injected = Object.keys(mkDeps().deps).filter(
      (k) => k !== 'registerSource' && k !== 'now' && k !== 'scope',
    );
    expect(FAILURE_MAP).toHaveLength(21);
    expect(FAILURE_MAP.map(([dep]) => dep).sort()).toEqual(injected.sort());
  });

  it('records a distinct failure key per read — no two reads share one', () => {
    const keys = FAILURE_MAP.map(([, system]) => system);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const [dep, system, views] of FAILURE_MAP) {
    it(`a throwing ${dep} degrades exactly the views fed by it, and no others`, () => {
      const p = initDigitalTwinPlatform(mkDeps({ [dep]: thrower(String(dep)) }).deps);
      for (const name of Object.keys(VIEW) as ViewName[]) {
        const entries = VIEW[name](p);
        if (views.includes(name)) {
          expect(entries, `${dep} → ${name}`).toEqual([{ system, reason: `${dep} offline` }]);
        } else {
          expect(entries, `${dep} → ${name}`).toEqual([]);
        }
      }
      // …and the dashboard names it once, whichever views contributed it.
      const d = p.dashboard();
      expect(d.unavailable.filter((u) => u.system === system)).toHaveLength(1);
      expect(d.unavailable).toHaveLength(1);
    });
  }

  it('the P15 summary is the one read no component consumes — the root declares it itself', () => {
    const h = mkDeps({ twinSummary: thrower('twinSummary') });
    const p = initDigitalTwinPlatform(h.deps);
    const d = p.dashboard();
    expect(d.twin).toBeNull(); // null, never a zeroed summary
    expect(d.unavailable).toEqual([{ system: 'enterprise-twin', reason: 'twinSummary offline' }]);
    // The push happens once per composed pass, so re-reading inside the TTL
    // cannot accumulate duplicates on the cached dashboard.
    expect(p.dashboard().unavailable).toHaveLength(1);
    expect(p.dashboard().unavailable).toHaveLength(1);
    expect(h.builds()).toBe(1);
    expect(p.report().sections[0].lines[0]).toContain('unreadable this pass');
  });

  it('an unreadable platform slice is unknown, never assumed steady', () => {
    const p = initDigitalTwinPlatform(mkDeps({ s11Federation: thrower('s11Federation') }).deps);
    const row = p.platforms().platforms.find((x) => x.id === 's11-federation')!;
    expect(row.state).toBe('unknown');
    expect(row.summary).toContain('no state is assumed');
    expect(row.metrics).toEqual([]);
    expect(p.platforms().totals).toEqual({ platforms: 7, steady: 6, attention: 0, unknown: 1 });
    // …and the sibling slices are all still composed from their own reads.
    expect(p.platforms().platforms.filter((x) => x.state === 'steady')).toHaveLength(6);
  });

  it('an unreadable recorded-evidence read stays null rather than collapsing to zero', () => {
    const p = initDigitalTwinPlatform(
      mkDeps({ recordedDays: thrower('recordedDays'), recordedDecisions: thrower('recordedDecisions') }).deps,
    );
    expect(p.history().recordedDays).toBeNull();
    expect(p.history().recordedDecisions).toBeNull();
    expect(p.history().rows).toHaveLength(1); // Stage 12's own deltas are untouched
  });

  it('every read failing at once still composes a dashboard — degraded, declared, and never thrown', () => {
    const over: Partial<EtwinPlatformDeps> = {};
    for (const [dep] of FAILURE_MAP) {
      (over as Record<string, () => never>)[String(dep)] = thrower(String(dep));
    }
    const p = initDigitalTwinPlatform(mkDeps(over).deps);
    const d = p.dashboard();
    expect(d.unavailable.map((u) => u.system).sort()).toEqual(FAILURE_MAP.map(([, s]) => s).sort());
    expect(d.twin).toBeNull();
    expect(d.runtime.available).toBe(false);
    expect(d.platforms).toEqual({ total: 7, steady: 0, attention: 0, unknown: 7 });
    expect(p.report().sections).toHaveLength(7); // the report still publishes
  });
});

/* ── the twin-watch source ────────────────────────────────────────────────── */

describe('the twin-watch source — governed items, never actions', () => {
  it('registers exactly ONE source, keyed twin-watch, on a daily 09:45 cadence', () => {
    const h = mkDeps();
    initDigitalTwinPlatform(h.deps);
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0].key).toBe('twin-watch');
    expect(h.sources[0].label).toBe('Twin Watch');
    expect(h.sources[0].cadence).toEqual({ kind: 'daily', atMinutes: 585 });
  });

  it('stays quiet when the composed values say nothing needs focus', async () => {
    const h = mkDeps();
    initDigitalTwinPlatform(h.deps);
    expect(await h.produceWatch()).toEqual([]);
  });

  it('delivers one governed item per critical/high recommendation, prefixed etwin:', async () => {
    const h = mkDeps(TROUBLED);
    const p = initDigitalTwinPlatform(h.deps);
    const items = await h.produceWatch();
    expect(items.map((i) => i.id)).toEqual([
      'etwin:etwinrec:platform:attention',
      'etwin:etwinrec:runtime:failed',
      'etwin:etwinrec:runtime:supervisor',
      'etwin:etwinrec:twin:band',
    ]);
    for (const item of items) {
      expect(item.deepLink, item.id).toBe('twin');
      expect(item.producedAt, item.id).toBe(T0_ISO); // the injected clock
      expect(item.title.length, item.id).toBeGreaterThan(0);
      expect(item.governance?.evidence.length ?? 0, item.id).toBeGreaterThan(0);
      expect(item.governance?.sourceSystems.length ?? 0, item.id).toBeGreaterThan(0);
      expect(item.governance?.reasoning.length ?? 0, item.id).toBeGreaterThan(0);
    }
    // Every rule fired, so the dashboard carries one more than the watch does.
    expect(p.dashboard().recommendations).toHaveLength(5);
  });

  it('never invents an action — each item repeats its recommendation’s own suggestion', async () => {
    const h = mkDeps(TROUBLED);
    const p = initDigitalTwinPlatform(h.deps);
    const byId = new Map(p.dashboard().recommendations.map((r) => [`etwin:${r.id}`, r]));
    for (const item of await h.produceWatch()) {
      const rec = byId.get(item.id)!;
      expect(rec, item.id).toBeDefined();
      expect(item.governance?.recommendedAction, item.id).toBe(rec.suggestedAction);
      expect(item.governance?.confidence, item.id).toBe(rec.confidence);
      expect(item.governance?.reasoning, item.id).toBe(rec.reasoning);
      expect(item.body, item.id).toContain(rec.suggestedAction);
    }
  });

  it('delivers only critical and high — a medium recommendation stays on the dashboard', async () => {
    const h = mkDeps(TROUBLED);
    const p = initDigitalTwinPlatform(h.deps);
    const medium = p.dashboard().recommendations.filter((r) => r.priority === 'medium');
    expect(medium.map((r) => r.id)).toEqual(['etwinrec:platform:unknown']);
    const ids = (await h.produceWatch()).map((i) => i.id);
    for (const r of medium) expect(ids).not.toContain(`etwin:${r.id}`);
    expect(ids).toHaveLength(4);
  });

  it('maps priority and urgency from the recommendation, never from a guess', async () => {
    const h = mkDeps(TROUBLED);
    initDigitalTwinPlatform(h.deps);
    const items = await h.produceWatch();
    const critical = items.find((i) => i.id === 'etwin:etwinrec:twin:band')!;
    expect(critical.priority).toBe('critical');
    expect(critical.impact).toEqual({ business: 0.6, urgency: 0.8, confidence: 0.9 });
    const high = items.find((i) => i.id === 'etwin:etwinrec:runtime:failed')!;
    expect(high.priority).toBe('high');
    expect(high.impact?.urgency).toBe(0.6);
  });

  it('dedupes across produces — a standing condition is delivered once, not every cadence', async () => {
    const h = mkDeps(TROUBLED);
    initDigitalTwinPlatform(h.deps);
    expect(await h.produceWatch()).toHaveLength(4);
    expect(await h.produceWatch()).toEqual([]);
    h.setNow(T0 + 86_400_000); // a day later, the same conditions still hold
    expect(await h.produceWatch()).toEqual([]);
  });

  it('caps governance evidence at eight entries when a rule has more', async () => {
    // Nine of the ten execution kinds failing gives the runtime rule nine
    // evidence entries — the only rule in this stage whose evidence can exceed
    // the cap (the others are bounded by 7 platforms, 5 subsystems and 3 fields).
    const kinds: ExecutionKind[] = [
      'task',
      'worker',
      'automation',
      'decision',
      'workflow',
      'memory',
      'connector',
      'voice',
      'runtime',
    ];
    const h = mkDeps({
      executionKinds: () => [...kinds],
      executionHistory: () => kinds.map((kind, i) => mkSession({ id: `h${i}`, kind, state: 'failed', error: 'boom' })),
      executionStats: () => ({ ...CALM_STATS, failed: 9, completed: 0, successRate: 0 }),
    });
    const p = initDigitalTwinPlatform(h.deps);
    const rec = p.dashboard().recommendations.find((r) => r.id === 'etwinrec:runtime:failed')!;
    expect(rec.evidence).toHaveLength(9); // the recommendation keeps all of them…
    const item = (await h.produceWatch()).find((i) => i.id === 'etwin:etwinrec:runtime:failed')!;
    expect(item.governance?.evidence).toHaveLength(8); // …the delivered item is capped
    expect(item.governance?.evidence).toEqual(rec.evidence.slice(0, 8));
  });

  it('produces from the same composed pass the channels serve', async () => {
    const h = mkDeps(TROUBLED);
    const p = initDigitalTwinPlatform(h.deps);
    p.dashboard();
    expect(h.builds()).toBe(1);
    await h.produceWatch();
    expect(h.builds()).toBe(1);
  });
});

/* ── the assistant port ───────────────────────────────────────────────────── */

describe('the assistant port — ten questions, sync, on the existing intelligence kind', () => {
  it('routes every published question key to a grounded intelligence report', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    const PHRASINGS: [string, string][] = [
      ['Twin status, please', 'twin-status'],
      ['Show me the runtime twin', 'runtime-twin'],
      ['Show the execution twin', 'execution-twin'],
      ['Show me the platform twins', 'platform-twins'],
      ['State coverage, please', 'state-coverage'],
      ['What is not modelled?', 'what-is-not-modelled'],
      ['What can we simulate?', 'simulation-capability'],
      ['Show me the twin history', 'twin-history'],
      ['twin drift, please', 'twin-drift'],
      ['Prepare the twin report', 'twin-report'],
    ];
    expect(PHRASINGS).toHaveLength(ETWIN_QUESTION_KEYS.length);
    for (const [text] of PHRASINGS) {
      const r = p.answerQuestion(text, T0_ISO);
      expect(r, text).not.toBeNull();
      expect(r!.kind, text).toBe('intelligence');
      expect(r!.grounded, text).toBe(true);
      expect(r!.sections.length, text).toBeGreaterThan(0);
    }
  });

  it('returns null for anything it does not own — including earlier stages’ canonical asks', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    for (const text of [
      'draft an email',
      '',
      '   ',
      'morning brief', // S5
      'Show me the KPI catalog', // S12
      'Which business capability is weakest?', // S10
      'simulation capability', // S10 (FINDING #3)
    ]) {
      expect(p.answerQuestion(text, T0_ISO), JSON.stringify(text)).toBeNull();
    }
  });

  it('costs nothing when the question is not the twin’s — an unmatched ask composes no pass', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    expect(p.answerQuestion('draft an email', T0_ISO)).toBeNull();
    expect(h.builds()).toBe(0);
    p.answerQuestion('Twin status, please', T0_ISO);
    expect(h.builds()).toBe(1);
  });

  // FINDING #6 (documented; NO code change). `answerQuestion(text, nowIso)`
  // threads the CALLER's clock into `TwinQuestionContext.nowIso` — and no answer
  // branch reads it. `twinPlatformModel.ts` holds exactly one `nowIso` reference
  // (the interface field itself) and zero `Date`/`now(` references: every answer
  // is a pure function of the composed views. Nor is there anywhere to surface
  // it — `AssistantStructuredReport` is `{kind,title,sections,grounded}`, with no
  // timestamp field.
  //
  // This is NOT a Stage 13 defect and is deliberately left alone. It is the
  // established shape: S10 strategyModel:62, S11 federationModel:57 and S12
  // analyticsModel:48 all declare `nowIso` on their question context and never
  // read it; S7 knowledgeModel:359 is the one stage whose answers need a clock
  // (a 30-day cutoff), which is why the field exists at all. "Correcting" it
  // would mean either adding a timestamp to a shared type four other stages
  // render, or deleting a hook S7 depends on — both silent architectural
  // changes, and the second would weaken an earlier stage.
  //
  // The consequence is real, so it is stated rather than hidden: an answer
  // served from a warm pass carries numbers up to BUILD_TTL_MS (3 s) old, and
  // nothing in the payload says so. Dating rides the assistant envelope, which
  // the assistant layer stamps. The bound is the TTL, and the test below is what
  // holds that bound honest: same TTL window, same answer, caller's clock or not.
  it('answers from the cached pass — the caller’s clock changes nothing inside the TTL', () => {
    const h = mkDeps();
    const p = initDigitalTwinPlatform(h.deps);
    p.dashboard();
    const later = '2026-08-01T09:00:02.000Z'; // inside the TTL
    const answer = p.answerQuestion('Twin status, please', later)!;
    expect(h.builds()).toBe(1); // served from the warm pass, not recomposed

    // The composed views keep the PASS's clock. Asking two seconds later does
    // not re-date them — stale numbers are never restamped as fresh.
    expect(p.dashboard().generatedAt).toBe(T0_ISO);
    expect(h.builds()).toBe(1);

    // And the answer is byte-identical to the one the pass's own clock produces,
    // because no branch consults `ctx.nowIso`. If a future branch starts reading
    // it, this assertion fails and the staleness question gets re-opened here.
    expect(answer).toEqual(p.answerQuestion('Twin status, please', T0_ISO));

    // No independent timestamp on the payload: dating is the envelope's job.
    expect(Object.keys(answer).sort()).toEqual(['grounded', 'kind', 'sections', 'title']);
  });

  it('reflects the live composition rather than a fixed script', () => {
    const calm = initDigitalTwinPlatform(mkDeps().deps).answerQuestion('twin drift, please', T0_ISO)!;
    const troubled = initDigitalTwinPlatform(mkDeps(TROUBLED).deps).answerQuestion('twin drift, please', T0_ISO)!;
    expect(calm).not.toEqual(troubled);
    expect(JSON.stringify(troubled.sections)).toContain('CRITICAL');
  });

  it('re-emits the report answer as the report itself — no second, divergent version', () => {
    const p = initDigitalTwinPlatform(mkDeps().deps);
    const answer = p.answerQuestion('Prepare the twin report', T0_ISO)!;
    expect(answer.title).toBe(p.report().title);
    expect(answer.sections).toEqual(p.report().sections.filter((s) => s.lines.length > 0));
  });
});

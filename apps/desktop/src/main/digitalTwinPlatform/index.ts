/**
 * Phase 6 Stage 13 — the Enterprise Digital Twin Platform composition root.
 *
 * ONE new subsystem that COMPOSES the two digital twins the repository already
 * ships plus the runtime estate and the Stage 6–12 platforms. It is NOT a
 * digital twin: P15 (`main/twin/`) stays the authoritative Enterprise Digital
 * Twin and the manufacturing digital twin stays the authoritative what-if
 * model — neither is rewritten, wrapped, or re-derived here. This layer owns no
 * engine, no store, no scheduler, no executor, and no mutation surface:
 *
 *   - the runtime & execution twin (the Execute Engine + Runtime Supervisor —
 *     the live estate P15 has no domain for; statistics composed VERBATIM),
 *   - the platform twins (a pre-composed slice of each Stage 6–12 platform,
 *     alongside P15's own nine domains carried through unchanged),
 *   - the enterprise state-coverage map (what is modelled by the twin, what is
 *     modelled elsewhere, and the three kinds nothing models — each gap citing
 *     the repository search that proved it),
 *   - the simulation inventory (registers existing simulation capability with
 *     what it can and cannot do; `invoked` is false on every entry by
 *     construction — Stage 13 has no simulation call site),
 *   - the recorded-history view (Stage 12's deltas composed VERBATIM plus the
 *     twin's own untrendable declarations and its recorded-evidence footprint),
 *   - the platform dashboard + executive report,
 *   - SEVEN read-only `etwin:*` IPC channels (RBAC `twin:read` — the EXISTING
 *     P15 read scope; fail-closed; zero mutation, zero new scope). The audit
 *     tabulated six; `etwin:report` is the seventh, minted with its consumer
 *     (the Twin Center Platform tab) and in the shape `estrat:`, `efed:` and
 *     `eana:` already publish. FINDING #5, resolved — see the test file header,
 *   - ONE `twin-watch` delivery source (governed recommendation ITEMS — never
 *     actions),
 *   - the assistant's ten twin questions (in-process port; answers ride the
 *     existing 'intelligence' report kind).
 *
 * Electron-free by construction: every read is an injected port; a failing port
 * becomes an explicit unavailable entry, never a fabricated value.
 */
import {
  EmptyRequest,
  IpcChannel,
  type AssistantStructuredReport,
  type EtwinCoverageMap,
  type EtwinDashboard,
  type EtwinHistoryView,
  type EtwinPlatformTwins,
  type EtwinReport,
  type EtwinRuntimeTwin,
  type EtwinSimulationInventory,
  type EanaTrendReport,
  type ExecutionSession,
  type ExecutionStats,
  type IntelligenceItem,
  type IntelligenceSource,
  type RecoveryRecord,
  type SupervisorStatus,
  type TwinDomains,
  type TwinSummary,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { buildPlatformTwins, type PlatformSlices, type PlatformTwinsInput } from './platformTwins';
import { buildRuntimeTwin } from './runtimeTwin';
import { buildCoverageMap } from './stateCoverage';
import { buildSimulationInventory } from './simulationInventory';
import { buildHistoryView } from './twinHistory';
import { composeTwinDashboard, composeTwinReport, type EtwinDashboardInputs } from './twinDashboard';
import { answerTwinQuestion, resolveTwinQuestion, type TwinQuestionContext } from './twinPlatformModel';
import { onWorkspaceSwitch } from '../tenancy/workspaceSwitchHub';

const log = createLogger('digital-twin-platform');

const BUILD_TTL_MS = 3_000;

/* ── deps (every read injected; all sync — Stage 13 composes, never computes) ─ */

export interface EtwinPlatformDeps {
  /** P15's own summary + domain projection, composed verbatim. Never recomputed. */
  twinSummary: () => TwinSummary | null;
  twinDomains: () => TwinDomains | null;
  /** The Execute Engine's own reads — no session state is tracked here. */
  executionKinds: () => string[] | null;
  executionActive: () => ExecutionSession[] | null;
  executionHistory: () => ExecutionSession[] | null;
  executionStats: () => ExecutionStats | null;
  /** The Runtime Supervisor's own reads — no recovery is started or policied. */
  supervisorStatus: () => SupervisorStatus | null;
  supervisorHistory: () => RecoveryRecord[] | null;
  /** The seven Stage 6–12 pre-composed slices (no dashboard logic duplicated). */
  s6Insight: () => { findings: number; criticalOrHigh: number } | null;
  s7Knowledge: () => { assets: number; gaps: number } | null;
  s8Automation: () => { automations: number; failures: number } | null;
  // `bottlenecks`, not a recommendation count: Stage 9 composes its
  // recommendations inside `dashboard()`, which is async (continuity awaits the
  // local-backup list), and every Stage 13 dep is synchronous. `capacity()` is a
  // sync port carrying BOTH fields, so posture and its attention count come from
  // ONE snapshot rather than two independently-cached reads — and they are the
  // same pair Stage 9's own dashboard publishes as its capacity slice.
  s9Operations: () => { posture: string; bottlenecks: number } | null;
  s10Strategy: () => { objectives: number; atRisk: number } | null;
  s11Federation: () => { partners: number; degraded: number } | null;
  s12Analytics: () => { kpis: number; regressing: number } | null;
  /** Stage 12 owns delta computation; its report is composed verbatim. */
  s12Trends: () => EanaTrendReport | null;
  /** The recorded-evidence footprint — counts only, never the records. */
  recordedDays: () => number | null;
  recordedDecisions: () => number | null;
  /** Existing simulation capability, registered but never invoked. */
  insightPredictions: () => { kind: string }[] | null;
  p14Scenarios: () => { count: number } | null;
  s12Forecasts: () => { registered: number } | null;
  registerSource: (source: IntelligenceSource) => void;
  now?: () => number;
}

export interface EtwinPlatformSubsystem {
  handlers: SecureHandlerDef[];
  runtime: () => EtwinRuntimeTwin;
  platforms: () => EtwinPlatformTwins;
  coverage: () => EtwinCoverageMap;
  simulation: () => EtwinSimulationInventory;
  history: () => EtwinHistoryView;
  dashboard: () => EtwinDashboard;
  report: () => EtwinReport;
  /** Assistant port: answer one of the ten twin questions, or null. */
  answerQuestion: (text: string, nowIso: string) => AssistantStructuredReport | null;
  dispose: () => void;
}

interface BuildArtifacts {
  at: number;
  nowIso: string;
  runtime: EtwinRuntimeTwin;
  platforms: EtwinPlatformTwins;
  coverage: EtwinCoverageMap;
  simulation: EtwinSimulationInventory;
  history: EtwinHistoryView;
  dashboard: EtwinDashboard;
  report: EtwinReport;
}

function safeRead<T>(system: string, fn: () => T, failures: Record<string, string>): T | null {
  try {
    return fn();
  } catch (err) {
    failures[system] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The subset of recorded failures relevant to one view (the dashboard dedups). */
function pick(failures: Record<string, string>, systems: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of systems) {
    const v = failures[s];
    if (v !== undefined) out[s] = v;
  }
  return out;
}

export function initDigitalTwinPlatform(deps: EtwinPlatformDeps): EtwinPlatformSubsystem {
  const now = deps.now ?? ((): number => Date.now());
  let cache: BuildArtifacts | null = null;

  const build = (): BuildArtifacts => {
    const nowMs = now();
    if (cache && nowMs - cache.at < BUILD_TTL_MS) return cache;
    const nowIso = new Date(nowMs).toISOString();
    const failures: Record<string, string> = {};

    const twinSummary = safeRead('enterprise-twin', () => deps.twinSummary(), failures);
    const twinDomains = safeRead('twin-domains', () => deps.twinDomains(), failures);
    const execKinds = safeRead('execute-engine', () => deps.executionKinds(), failures);
    const execActive = safeRead('execute-engine-active', () => deps.executionActive(), failures);
    const execHistory = safeRead('execute-engine-history', () => deps.executionHistory(), failures);
    const execStats = safeRead('execute-engine-stats', () => deps.executionStats(), failures);
    const supStatus = safeRead('runtime-supervisor', () => deps.supervisorStatus(), failures);
    const supHistory = safeRead('runtime-supervisor-history', () => deps.supervisorHistory(), failures);
    const trends = safeRead('s12-trends', () => deps.s12Trends(), failures);
    const recordedDays = safeRead('health-history', () => deps.recordedDays(), failures);
    const recordedDecisions = safeRead('decision-store', () => deps.recordedDecisions(), failures);
    const predictions = safeRead('insight-predictions', () => deps.insightPredictions(), failures);
    const scenarios = safeRead('p14-scenarios', () => deps.p14Scenarios(), failures);
    const forecasts = safeRead('s12-forecasts', () => deps.s12Forecasts(), failures);

    const slices: PlatformSlices = {
      s6Insight: safeRead('s6-insight', () => deps.s6Insight(), failures),
      s7Knowledge: safeRead('s7-knowledge', () => deps.s7Knowledge(), failures),
      s8Automation: safeRead('s8-automation', () => deps.s8Automation(), failures),
      s9Operations: safeRead('s9-operations', () => deps.s9Operations(), failures),
      s10Strategy: safeRead('s10-strategy', () => deps.s10Strategy(), failures),
      s11Federation: safeRead('s11-federation', () => deps.s11Federation(), failures),
      s12Analytics: safeRead('s12-analytics', () => deps.s12Analytics(), failures),
    };

    // The execution slice is present only when the engine answered every read —
    // a partial engine is reported unreadable rather than half-composed.
    const execution =
      execKinds === null || execActive === null || execHistory === null || execStats === null
        ? null
        : { registeredKinds: execKinds, active: execActive, history: execHistory, stats: execStats };
    const supervisor = supStatus === null || supHistory === null ? null : { status: supStatus, history: supHistory };

    const runtime = buildRuntimeTwin({
      nowIso,
      execution,
      supervisor,
      failures: pick(failures, [
        'execute-engine',
        'execute-engine-active',
        'execute-engine-history',
        'execute-engine-stats',
        'runtime-supervisor',
        'runtime-supervisor-history',
      ]),
    });

    const platformInputs: PlatformTwinsInput = {
      nowIso,
      domains: twinDomains,
      slices,
      failures: pick(failures, [
        'twin-domains',
        's6-insight',
        's7-knowledge',
        's8-automation',
        's9-operations',
        's10-strategy',
        's11-federation',
        's12-analytics',
      ]),
    };
    const platforms = buildPlatformTwins(platformInputs);

    const coverage = buildCoverageMap({
      nowIso,
      domains: twinDomains,
      runtime:
        execution === null
          ? null
          : { activeSessions: execution.active.length, registeredKinds: execution.registeredKinds.length },
      // FINDING #4. The coverage map's `runtime-execution` row is fed by the
      // COMPOSITE `execution` slice, which the partial-engine rule above nulls
      // when ANY of the four engine reads fails — not just `execute-engine`.
      // Picking only that one key meant three of the four failure modes reached
      // this view as a silent `live: null` with nothing in `unavailable` to say
      // why, while the fourth was declared. The dashboard hid it, because it
      // merges the runtime view's own failures first and dedups by system; only
      // the standalone `etwin:coverage` channel showed the gap. Every other
      // `pick` list here is exactly the set of reads that feeds its view; this
      // one was the sole under-specified list. Widened to all four so a null
      // runtime row always carries its reason. Nothing computed changes.
      failures: pick(failures, [
        'twin-domains',
        'execute-engine',
        'execute-engine-active',
        'execute-engine-history',
        'execute-engine-stats',
      ]),
    });

    const simulation = buildSimulationInventory({
      nowIso,
      predictions,
      scenarios,
      forecasts,
      failures: pick(failures, ['insight-predictions', 'p14-scenarios', 's12-forecasts']),
    });

    const history = buildHistoryView({
      nowIso,
      trends,
      recordedDays,
      recordedDecisions,
      failures: pick(failures, ['s12-trends', 'health-history', 'decision-store']),
    });

    const dashInputs: EtwinDashboardInputs = {
      nowIso,
      twin: twinSummary,
      runtime,
      platforms,
      coverage,
      simulation,
      history,
    };
    const dashboard = composeTwinDashboard(dashInputs);
    // Root-level reads no component picks still declare their misses here.
    for (const [system, reason] of Object.entries(pick(failures, ['enterprise-twin']))) {
      if (!dashboard.unavailable.some((u) => u.system === system)) dashboard.unavailable.push({ system, reason });
    }
    const reportView = composeTwinReport(dashInputs);

    cache = { at: nowMs, nowIso, runtime, platforms, coverage, simulation, history, dashboard, report: reportView };
    return cache;
  };

  /* ── the assistant port (ten questions; sync; same composed pass) ────────── */
  const answerQuestion = (text: string, nowIso: string): AssistantStructuredReport | null => {
    const key = resolveTwinQuestion(text);
    if (!key) return null;
    const b = build();
    const ctx: TwinQuestionContext = {
      runtime: b.runtime,
      platforms: b.platforms,
      coverage: b.coverage,
      simulation: b.simulation,
      history: b.history,
      dashboard: b.dashboard,
      report: b.report,
      nowIso,
    };
    return answerTwinQuestion(key, ctx);
  };

  /* ── monitoring: ONE governed watch source (items only, never actions) ──── */
  const deliveredWatch = new Set<string>();
  const watchSource: IntelligenceSource = {
    key: 'twin-watch',
    label: 'Twin Watch',
    cadence: { kind: 'daily', atMinutes: 9 * 60 + 45 },
    produce: async (): Promise<IntelligenceItem[]> => {
      const b = build();
      const items: IntelligenceItem[] = [];
      for (const r of b.dashboard.recommendations) {
        if (r.priority !== 'critical' && r.priority !== 'high') continue;
        if (deliveredWatch.has(r.id)) continue;
        deliveredWatch.add(r.id);
        items.push({
          id: `etwin:${r.id}`,
          title: r.title,
          body: `${r.detail} Suggested: ${r.suggestedAction}`,
          priority: r.priority === 'critical' ? 'critical' : 'high',
          impact: { business: 0.6, urgency: r.priority === 'critical' ? 0.8 : 0.6, confidence: r.confidence },
          deepLink: 'twin',
          producedAt: new Date(now()).toISOString(),
          governance: {
            evidence: r.evidence.slice(0, 8),
            sourceSystems: r.affectedSystems.length > 0 ? r.affectedSystems : ['digital-twin-platform'],
            confidence: r.confidence,
            reasoning: r.reasoning,
            recommendedAction: r.suggestedAction,
          },
        });
      }
      return items;
    },
  };
  deps.registerSource(watchSource);

  /* ── the seven read-only IPC channels (the EXISTING twin:read, fail-closed) ─ */
  /**
   * P13C Round 2 — H7. DROP THE TENANT-DERIVED SNAPSHOT ON A TENANT SWITCH.
   *
   * This cache holds a fully composed, tenant-derived read model behind a short
   * TTL, and it was cleared only in `dispose()`. Switching organization changes
   * none of the backing stores this subsystem watches, so the memo survived the
   * switch — and the renderer's reload after a switch lands INSIDE the TTL.
   * Opening a dashboard right after switching is the single most common
   * multi-tenant action there is, so the window was not theoretical.
   *
   * Registered on the same residue seam every other subsystem uses, rather than
   * a second invalidation mechanism.
   */
  onWorkspaceSwitch(() => {
    cache = null;
  });

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.EtwinRuntime,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().runtime,
    },
    {
      channel: IpcChannel.EtwinPlatforms,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().platforms,
    },
    {
      channel: IpcChannel.EtwinCoverage,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().coverage,
    },
    {
      channel: IpcChannel.EtwinSimulation,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().simulation,
    },
    {
      channel: IpcChannel.EtwinHistory,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().history,
    },
    {
      channel: IpcChannel.EtwinDashboard,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().dashboard,
    },
    {
      // FINDING #5, resolved here rather than papered over: the report was
      // composed on every pass and reachable only from the subsystem object and
      // the assistant, so the renderer tab had no way to fetch it. Same pass,
      // same scope, same empty request — the report is served, never recomputed
      // for the channel.
      channel: IpcChannel.EtwinReport,
      schema: EmptyRequest,
      requireAuth: true,
      permission: 'twin:read',
      handler: () => build().report,
    },
  ];

  log.info('Enterprise Digital Twin Platform ready', { channels: handlers.length, sources: 1 });

  return {
    handlers,
    runtime: () => build().runtime,
    platforms: () => build().platforms,
    coverage: () => build().coverage,
    simulation: () => build().simulation,
    history: () => build().history,
    dashboard: () => build().dashboard,
    report: () => build().report,
    answerQuestion,
    dispose: () => {
      cache = null;
    },
  };
}

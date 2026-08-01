/**
 * Phase 6 Stage 13 — Enterprise Digital Twin Platform types.
 *
 * The additive enterprise COMPOSITION layer over the two digital twins the
 * repository already ships (P15 `main/twin/` and the manufacturing digital
 * twin) plus the runtime/execution estate and the Stage 6–12 platforms. These
 * types describe a composition: registry data about what EXISTS, and views
 * computed per read from injected reads. Nothing here models a store, an
 * engine, a scheduler, an executor, or a mutation.
 *
 * Every exported name carries the `Etwin` prefix — the Stage 10 TS2308 barrel
 * lesson applied preemptively, since `Twin*` is already owned by
 * `enterpriseTwin.ts` (P15) and `manufacturingDigitalTwin.ts`.
 */
import type { ExecutionStats } from './executeEngine';
import type { OperationsRecommendation } from './operationsPlatform';
import type { RecoveryPolicy, SupervisedSubsystem, SupervisorStatus } from './runtimeSupervisor';

/** A dependency that could not be read this pass. Declared, never defaulted. */
export interface EtwinUnavailable {
  system: string;
  reason: string;
}

/* ── registry: typed data about what EXISTS ───────────────────────────────── */

/**
 * What kind of surface a registered twin/runtime surface is.
 *
 * Every variant is exercised by SURFACE_REGISTRY, so `twinRegistryIssues()` can
 * lock kind coverage as a real integrity property. The Stage 6–12 platforms are
 * deliberately NOT a surface kind — they are registered separately as
 * `EtwinPlatformDef` because Stage 13 reads a pre-composed slice of each rather
 * than a twin projection.
 */
export type EtwinSurfaceKind =
  | 'enterprise-twin' // P15 — the authoritative Enterprise Digital Twin
  | 'manufacturing-twin' // the deterministic manufacturing what-if model
  | 'runtime-surface' // runtime supervision / adapters
  | 'execution-surface' // the execute engine + its store
  | 'observation-surface'; // timelines, monitors, recorded history

export interface EtwinSurfaceDef {
  id: string;
  label: string;
  kind: EtwinSurfaceKind;
  /** The REAL module path this surface lives at. */
  module: string;
  /** The phase/stage that shipped it. */
  stage: string;
  /** How Stage 13 composes it — composition only, never a rebuild. */
  reuse: string;
}

/** The seven Stage 6–12 platforms the twin never saw (G-2). */
export interface EtwinPlatformDef {
  id: string;
  stage: string;
  label: string;
  module: string;
  /** The pre-composed slice Stage 13 reads — no dashboard logic is duplicated. */
  slice: string;
}

/** Honest series tagging: only recorded series can be trended. */
export type EtwinSeriesKind = 'daily-history' | 'decision-window' | 'point-in-time';

export interface EtwinSeriesDef {
  id: string;
  label: string;
  kind: EtwinSeriesKind;
  module: string;
  /** False for every point-in-time composition — declared, not inferred. */
  trendable: boolean;
  detail: string;
}

/** The kinds of simulation capability that already exist. */
export type EtwinSimulationKind =
  | 'scenario-projection' // P14 SimulationReport (advisory; never applied)
  | 'deterministic-what-if' // the manufacturing twin's fifteen scenarios
  | 'deterministic-heuristic' // Stage 6's seven prediction rules
  | 'capability-register'; // Stage 12's forecast inventory (a register of registers)

export interface EtwinSimulationDef {
  id: string;
  label: string;
  kind: EtwinSimulationKind;
  module: string;
  /** Authored scenario count where the capability declares one; null otherwise. */
  scenarioCount: number | null;
  canSimulate: string;
  cannotSimulate: string;
}

/** Whether an enterprise state kind is modelled, and by whom. */
export type EtwinCoverageStatus = 'modelled-by-twin' | 'modelled-elsewhere' | 'not-modelled';

export interface EtwinStateDef {
  id: string;
  label: string;
  status: EtwinCoverageStatus;
  /** The named owning surface — or, for `not-modelled`, what would be required. */
  owner: string;
  evidence: string;
}

/* ── computed: the runtime + execution twin (G-1) ─────────────────────────── */

export interface EtwinExecutionKindRow {
  kind: string;
  active: number;
  historical: number;
  failed: number;
}

export interface EtwinSessionRow {
  id: string;
  kind: string;
  label: string;
  state: string;
  startedAt: string;
  durationMs: number | null;
}

export interface EtwinSupervisorRow {
  subsystem: SupervisedSubsystem;
  policy: RecoveryPolicy;
  recovering: boolean;
  recoveries: number;
  failures: number;
  lastAt: string | null;
}

export interface EtwinRuntimeTwin {
  generatedAt: string;
  execution: {
    available: boolean;
    registeredKinds: string[];
    activeCount: number;
    historyCount: number;
    kinds: EtwinExecutionKindRow[];
    active: EtwinSessionRow[];
    recent: EtwinSessionRow[];
    /** The engine's own statistics, composed VERBATIM; null when unreadable. */
    stats: ExecutionStats | null;
  };
  supervisor: {
    available: boolean;
    /** The supervisor's own status, composed VERBATIM; null when unreadable. */
    status: SupervisorStatus | null;
    rows: EtwinSupervisorRow[];
    historyCount: number;
  };
  /** The registered runtime/execution surfaces this projection covers. */
  surfaces: EtwinSurfaceDef[];
  disclosure: string;
  unavailable: EtwinUnavailable[];
}

/* ── computed: the platform twins (G-2) ───────────────────────────────────── */

export type EtwinTwinState = 'attention' | 'steady' | 'unknown';

export interface EtwinPlatformRow {
  id: string;
  stage: string;
  label: string;
  module: string;
  state: EtwinTwinState;
  summary: string;
  metrics: { label: string; value: string }[];
}

/** One of P15's own nine domains, composed verbatim — never recomputed. */
export interface EtwinDomainRow {
  id: string;
  label: string;
  entities: number;
  band: string;
}

export interface EtwinPlatformTwins {
  generatedAt: string;
  domains: EtwinDomainRow[];
  domainTotals: {
    domains: number;
    entities: number;
    healthy: number;
    degraded: number;
  } | null;
  platforms: EtwinPlatformRow[];
  totals: { platforms: number; steady: number; attention: number; unknown: number };
  disclosure: string;
  unavailable: EtwinUnavailable[];
}

/* ── computed: the state coverage map (G-3) ───────────────────────────────── */

export interface EtwinCoverageRow {
  id: string;
  label: string;
  status: EtwinCoverageStatus;
  owner: string;
  evidence: string;
  /** What was actually observed this pass, or null when nothing is observable. */
  live: string | null;
}

export interface EtwinCoverageMap {
  generatedAt: string;
  rows: EtwinCoverageRow[];
  totals: {
    total: number;
    modelledByTwin: number;
    modelledElsewhere: number;
    notModelled: number;
  };
  /** The honest gap list — stated limitations, never silent omissions. */
  notModelled: string[];
  disclosure: string;
  unavailable: EtwinUnavailable[];
}

/* ── computed: the simulation inventory (G-4, simulation half) ────────────── */

export interface EtwinSimulationEntry {
  id: string;
  label: string;
  kind: EtwinSimulationKind;
  module: string;
  scenarioCount: number | null;
  /** Live instances observed this pass, or null when nothing is observable. */
  live: { count: number; detail: string } | null;
  canSimulate: string;
  cannotSimulate: string;
  /** Always false — Stage 13 executes nothing and invokes no simulation. */
  invoked: boolean;
}

export interface EtwinSimulationInventory {
  generatedAt: string;
  entries: EtwinSimulationEntry[];
  totals: { registered: number; withScenarios: number; liveInstances: number };
  disclosure: string;
  unavailable: EtwinUnavailable[];
}

/* ── computed: the recorded-history view (G-4, temporal half) ─────────────── */

export type EtwinHistoryDirection = 'improving' | 'stable' | 'regressing' | 'unavailable';

export interface EtwinHistoryRow {
  seriesId: string;
  label: string;
  kind: EtwinSeriesKind;
  windowLabel: string;
  from: number | null;
  to: number | null;
  delta: number | null;
  direction: EtwinHistoryDirection;
  detail: string;
}

export interface EtwinHistoryView {
  generatedAt: string;
  rows: EtwinHistoryRow[];
  totals: { improving: number; stable: number; regressing: number; unavailable: number };
  /** Series the platform does not record — declared untrendable, never inferred. */
  untrendable: { seriesId: string; label: string; reason: string }[];
  /** Recorded days in the health history store; null when it is unreadable. */
  recordedDays: number | null;
  /** Recorded decisions in the decision store; null when it is unreadable. */
  recordedDecisions: number | null;
  disclosure: string;
  unavailable: EtwinUnavailable[];
}

/* ── computed: the twin platform dashboard + report ───────────────────────── */

export interface EtwinDashboard {
  generatedAt: string;
  /** P15's own summary, composed VERBATIM; null when unreadable. */
  twin: {
    domainCount: number;
    totalEntities: number;
    overallHealth: number;
    healthBand: string;
    criticalImpactNodes: number;
    openDecisions: number;
  } | null;
  runtime: {
    available: boolean;
    activeSessions: number;
    registeredKinds: number;
    failed: number | null;
    recovering: number | null;
  };
  platforms: { total: number; steady: number; attention: number; unknown: number };
  coverage: { total: number; modelledByTwin: number; modelledElsewhere: number; notModelled: number };
  simulation: { registered: number; liveInstances: number };
  history: { improving: number; stable: number; regressing: number; unavailable: number };
  recommendations: OperationsRecommendation[];
  disclosures: string[];
  unavailable: EtwinUnavailable[];
}

export interface EtwinReport {
  generatedAt: string;
  title: string;
  sections: { title: string; lines: string[] }[];
}

/* ── assistant questions (D-8 — the ninth port) ───────────────────────────── */

export type EtwinQuestionKey =
  | 'twin-status'
  | 'runtime-twin'
  | 'execution-twin'
  | 'platform-twins'
  | 'state-coverage'
  | 'what-is-not-modelled'
  | 'simulation-capability'
  | 'twin-history'
  | 'twin-drift'
  | 'twin-report';

export const ETWIN_QUESTION_KEYS: readonly EtwinQuestionKey[] = [
  'twin-status',
  'runtime-twin',
  'execution-twin',
  'platform-twins',
  'state-coverage',
  'what-is-not-modelled',
  'simulation-capability',
  'twin-history',
  'twin-drift',
  'twin-report',
] as const;

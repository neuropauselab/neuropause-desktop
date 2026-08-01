/**
 * Phase 6 Stage 13 — the Twin Platform Registry (typed, versioned data;
 * doc-locked to docs/desktop/twin/TWIN-PLATFORM.md by test — the S6–S12
 * precedent).
 *
 * EVERY reference names something REAL in the repository at cf3cfc5:
 *   • SURFACE_REGISTRY    → the two shipped digital twins plus the runtime,
 *                           execution and observation surfaces they never saw.
 *   • PLATFORM_REGISTRY   → the seven Phase 6 Stage 6–12 platforms.
 *   • SERIES_REGISTRY     → the recorded and point-in-time series, each tagged
 *                           `trendable` honestly (a point-in-time composition
 *                           has no history and is declared untrendable).
 *   • SIMULATION_REGISTRY → the simulation capabilities that already exist,
 *                           with authored scenario counts where one is declared.
 *   • STATE_REGISTRY      → the enterprise state-coverage map. Every
 *                           `not-modelled` row below was proved by repository
 *                           search before it was written; no gap is asserted
 *                           without evidence and no coverage is claimed without
 *                           a named owning module.
 *
 * `twinRegistryIssues()` locks referential integrity; the doc lock keeps code
 * and documentation in sync. The registries store nothing and compute nothing —
 * they are data about what already exists.
 */
import type {
  EtwinPlatformDef,
  EtwinSeriesDef,
  EtwinSimulationDef,
  EtwinStateDef,
  EtwinSurfaceDef,
} from '@neuropause/shared';

/** The five surface kinds. Every one must be exercised by SURFACE_REGISTRY. */
export const ETWIN_SURFACE_KINDS = [
  'enterprise-twin',
  'manufacturing-twin',
  'runtime-surface',
  'execution-surface',
  'observation-surface',
] as const;

export const ETWIN_SERIES_KINDS = ['daily-history', 'decision-window', 'point-in-time'] as const;

export const ETWIN_SIMULATION_KINDS = [
  'scenario-projection',
  'deterministic-what-if',
  'deterministic-heuristic',
  'capability-register',
] as const;

export const ETWIN_COVERAGE_STATUSES = [
  'modelled-by-twin',
  'modelled-elsewhere',
  'not-modelled',
] as const;

/**
 * The twin/runtime/observation surfaces Stage 13 composes.
 *
 * P15 and the manufacturing twin are AUTHORITATIVE and untouched — Stage 13
 * reads them and never rewrites them. The runtime, execution and observation
 * surfaces are the estate the twin subsystem has no domain for, which is
 * precisely the gap this composition layer closes.
 */
export const SURFACE_REGISTRY: readonly EtwinSurfaceDef[] = [
  {
    id: 'p15-enterprise-twin',
    label: 'Enterprise Digital Twin',
    kind: 'enterprise-twin',
    module: 'apps/desktop/src/main/twin/twinService.ts (TwinService.overview)',
    stage: 'P15 — Enterprise Digital Twin & Scenario Modeling Platform',
    reuse: 'Overview, domains and summary are composed VERBATIM. Nothing in main/twin/ is modified.',
  },
  {
    id: 'manufacturing-twin',
    label: 'Manufacturing Digital Twin',
    kind: 'manufacturing-twin',
    module: 'packages/shared/src/types/manufacturingDigitalTwin.ts (TWIN_SCENARIO_TYPES)',
    stage: 'Manufacturing Digital Twin — read-only deterministic what-if simulation',
    reuse: 'Registered as a simulation capability with its authored scenario count. Never invoked.',
  },
  {
    id: 'execute-engine',
    label: 'Execute Engine',
    kind: 'execution-surface',
    module: 'apps/desktop/src/main/executeEngine.ts (ExecuteEngine)',
    stage: 'V5.4 — Execute Engine, unified execution pipeline',
    reuse: 'registeredKinds/activeSessions/getHistory/stats are read; the engine executes nothing for Stage 13.',
  },
  {
    id: 'runtime-supervisor',
    label: 'Runtime Supervisor',
    kind: 'runtime-surface',
    module: 'apps/desktop/src/main/runtimeSupervisor.ts (RuntimeSupervisor)',
    stage: 'V5.3 — NeuroCore Runtime Supervisor, autonomous recovery loop',
    reuse: 'status()/getHistory() are read. Stage 13 never starts, stops or re-policies the supervisor.',
  },
  {
    id: 'health-history',
    label: 'Health History Store',
    kind: 'observation-surface',
    module: 'apps/desktop/src/main/enterprise/healthHistoryStore.ts',
    stage: 'V3.0 — Weekly Trends, health-history store',
    reuse:
      'Only the recorded-day count is read (all().length). Every delta over the series comes from the Stage 12 trend report, which already owns trend computation.',
  },
  {
    id: 'decision-store',
    label: 'Executive Decision Store',
    kind: 'observation-surface',
    module: 'apps/desktop/src/main/enterprise/decisionStore.ts',
    stage: 'V3.3 — Executive Decision Intelligence, decision store',
    reuse:
      'Only the recorded-decision count is read (all().length), as the twin’s recorded-evidence footprint. Decision intelligence itself stays Stage 12’s view.',
  },
] as const;

/**
 * The seven Phase 6 platforms built AFTER P15 — the reason a composition layer
 * is needed at all. The twin subsystem predates every one of them and has no
 * domain that covers them.
 */
export const PLATFORM_REGISTRY: readonly EtwinPlatformDef[] = [
  {
    id: 's6-insight',
    stage: 'Stage 6',
    label: 'Enterprise Intelligence Layer',
    module: 'apps/desktop/src/main/insight/index.ts',
    slice: 'The ranked recommendation summary from report() (count, critical-or-high by priority) — already computed by Stage 6. Stage 13 calls them findings because that is its own word for "what a platform surfaced"; Stage 6 calls them recommendations.',
  },
  {
    id: 's7-knowledge',
    stage: 'Stage 7',
    label: 'Enterprise Knowledge & Decision Platform',
    module: 'apps/desktop/src/main/knowledgeAssets/index.ts',
    slice: 'The coverage summary (assets, gaps) — already computed by Stage 7.',
  },
  {
    id: 's8-automation',
    stage: 'Stage 8',
    label: 'Enterprise Automation Platform',
    module: 'apps/desktop/src/main/automationPlatform/index.ts',
    slice: 'The catalog entry count + the monitor\'s `failed-run` findings — already computed by Stage 8. "Failures" is that one finding kind, not every finding: a stuck execution or an unparseable schedule is a finding Stage 8 raised, not a run that failed.',
  },
  {
    id: 's9-operations',
    stage: 'Stage 9',
    label: 'Enterprise Operations Platform',
    module: 'apps/desktop/src/main/operationsPlatform/index.ts',
    slice: 'The capacity view summary (posture, bottlenecks) — already computed by Stage 9. Not the dashboard summary: Stage 9 composes that asynchronously, and every Stage 13 read is synchronous.',
  },
  {
    id: 's10-strategy',
    stage: 'Stage 10',
    label: 'Enterprise Strategy Platform',
    module: 'apps/desktop/src/main/strategyPlatform/index.ts',
    slice: 'The strategy health summary (objectives, at-risk) — already computed by Stage 10.',
  },
  {
    id: 's11-federation',
    stage: 'Stage 11',
    label: 'Enterprise Federation Platform',
    module: 'apps/desktop/src/main/enterpriseFederation/index.ts',
    slice: 'The federation dashboard summary (partners, degraded) — already computed by Stage 11.',
  },
  {
    id: 's12-analytics',
    stage: 'Stage 12',
    label: 'Enterprise Analytics Platform',
    module: 'apps/desktop/src/main/analyticsPlatform/index.ts',
    slice: 'The KPI catalog + trend report — already computed by Stage 12; Stage 13 recomputes neither.',
  },
] as const;

/**
 * Series the platform can show over time — and, honestly, the ones it cannot.
 *
 * `trendable: true` means a RECORDED series exists and Stage 12 already trends
 * it. `trendable: false` means the value is a point-in-time composition with no
 * persisted history; Stage 13 declares that rather than inventing a delta.
 */
export const SERIES_REGISTRY: readonly EtwinSeriesDef[] = [
  {
    id: 'org-health-history',
    label: 'Organization health',
    kind: 'daily-history',
    module: 'apps/desktop/src/main/enterprise/healthHistoryStore.ts',
    trendable: true,
    detail: 'Recorded daily. Trended by the Stage 12 trend report, which Stage 13 composes verbatim.',
  },
  {
    id: 'engineering-health-history',
    label: 'Engineering health',
    kind: 'daily-history',
    module: 'apps/desktop/src/main/enterprise/healthHistoryStore.ts',
    trendable: true,
    detail: 'Recorded daily. Trended by the Stage 12 trend report, which Stage 13 composes verbatim.',
  },
  {
    id: 'decision-window-deltas',
    label: 'Executive decision window',
    kind: 'decision-window',
    module: 'apps/desktop/src/main/strategyPlatform/businessOutcome.ts (windowDeltas)',
    trendable: true,
    detail:
      'Measured before/after health across each governed decision window. Stage 10 measures it, Stage 12 trends it, Stage 13 composes the result verbatim.',
  },
  {
    id: 'twin-domain-entities',
    label: 'Twin domain entity counts',
    kind: 'point-in-time',
    module: 'apps/desktop/src/main/twin/twinService.ts (TwinService.domains)',
    trendable: false,
    detail: 'P15 composes domain entity counts per read. No history is persisted, so no delta exists.',
  },
  {
    id: 'twin-overall-health',
    label: 'Twin overall health',
    kind: 'point-in-time',
    module: 'apps/desktop/src/main/twin/twinService.ts (TwinService.overview)',
    trendable: false,
    detail: 'P15 computes overall health per read. No twin health history is stored anywhere.',
  },
  {
    id: 'execution-sessions',
    label: 'Execution sessions',
    kind: 'point-in-time',
    module: 'apps/desktop/src/main/executeEngine.ts (ExecuteEngine.getHistory)',
    trendable: false,
    detail: 'An in-memory session event log, not a recorded metric series. It resets with the process.',
  },
  {
    id: 'supervisor-recoveries',
    label: 'Supervisor recoveries',
    kind: 'point-in-time',
    module: 'apps/desktop/src/main/runtimeSupervisor.ts (RuntimeSupervisor.getHistory)',
    trendable: false,
    detail: 'An in-memory recovery record list, not a recorded metric series. It resets with the process.',
  },
] as const;

/**
 * Simulation capability that ALREADY exists. Stage 13 registers it and never
 * invokes it — `invoked` is a constant false on every computed entry.
 */
export const SIMULATION_REGISTRY: readonly EtwinSimulationDef[] = [
  {
    id: 'p14-scenario-projection',
    label: 'Enterprise scenario projection',
    kind: 'scenario-projection',
    module: 'apps/desktop/src/main/twin/twinService.ts (TwinService.scenario)',
    scenarioCount: null,
    canSimulate: 'Advisory projections over the composed enterprise snapshot, surfaced by the Twin Center.',
    cannotSimulate: 'Nothing is applied. A projection never mutates the enterprise it projects.',
  },
  {
    id: 'manufacturing-what-if',
    label: 'Manufacturing deterministic what-if',
    kind: 'deterministic-what-if',
    module: 'packages/shared/src/types/manufacturingDigitalTwin.ts (TWIN_SCENARIO_TYPES)',
    scenarioCount: 15,
    canSimulate: 'Fifteen authored scenario types over a manufacturing baseline, deterministically.',
    cannotSimulate:
      'No main-process code imports it — the capability is declared and typed but never invoked at runtime.',
  },
  {
    id: 'insight-heuristics',
    label: 'Intelligence prediction rules',
    kind: 'deterministic-heuristic',
    module: 'apps/desktop/src/main/insight/index.ts',
    scenarioCount: 7,
    canSimulate: 'Seven deterministic prediction rules over the live signal registry.',
    cannotSimulate: 'Heuristics, not a model. They project no scenario and fit no curve.',
  },
  {
    id: 's12-forecast-inventory',
    label: 'Forecast-capability inventory',
    kind: 'capability-register',
    module: 'apps/desktop/src/main/analyticsPlatform/forecastInventory.ts',
    scenarioCount: null,
    canSimulate: 'Registers which forecasting capabilities exist and what each honestly claims.',
    cannotSimulate: 'A register of registers. It forecasts nothing itself.',
  },
] as const;

/**
 * The enterprise state-coverage map.
 *
 * `modelled-by-twin` = one of P15's own nine domains (apps/desktop/src/main/
 * twin/twinModel.ts:164 `buildTwinDomains`). `modelled-elsewhere` = a real
 * system of record exists outside the twin. `not-modelled` = proved absent by
 * repository search; each such row names the search that proved it.
 */
export const STATE_REGISTRY: readonly EtwinStateDef[] = [
  {
    id: 'enterprise-posture',
    label: 'Enterprise posture',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `enterprise`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:167 — buildTwinDomains',
  },
  {
    id: 'organization',
    label: 'Organization',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `organization`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:183 — buildTwinDomains',
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `infrastructure`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:199 — buildTwinDomains',
  },
  {
    id: 'workforce',
    label: 'Workforce',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `workforce`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:214 — buildTwinDomains',
  },
  {
    id: 'application',
    label: 'Applications',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `application`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:229 — buildTwinDomains',
  },
  {
    id: 'connectors',
    label: 'Connectors',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `connector`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:244 — buildTwinDomains',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `marketplace`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:260 — buildTwinDomains',
  },
  {
    id: 'federation',
    label: 'Federation',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `federation`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:274 — buildTwinDomains',
  },
  {
    id: 'strategy',
    label: 'Strategy',
    status: 'modelled-by-twin',
    owner: 'P15 twin domain `strategy`',
    evidence: 'apps/desktop/src/main/twin/twinModel.ts:289 — buildTwinDomains',
  },
  {
    id: 'runtime-execution',
    label: 'Runtime & execution',
    status: 'modelled-elsewhere',
    owner: 'Execute Engine + Runtime Supervisor',
    evidence:
      'apps/desktop/src/main/executeEngine.ts, apps/desktop/src/main/runtimeSupervisor.ts — P15 has no runtime domain; Stage 13 composes one.',
  },
  {
    id: 'commercial-financial',
    label: 'Commercial & financial',
    status: 'modelled-elsewhere',
    owner: 'P20 Commercial Platform + the finance enterprise module',
    evidence:
      'apps/desktop/src/main/commercial/commercialModel.ts (plans/seats/licenses/purchases/invoice), apps/desktop/src/main/enterprise/modules/finance/',
  },
  {
    id: 'customer-crm',
    label: 'Customers & CRM',
    status: 'modelled-elsewhere',
    owner: 'P20 Commercial customer health + the CRM enterprise module',
    evidence:
      'apps/desktop/src/main/commercial/commercialModel.ts (customer health), apps/desktop/src/main/enterprise/modules/crm/',
  },
  {
    id: 'manufacturing-operations',
    label: 'Manufacturing operations',
    status: 'modelled-elsewhere',
    owner: 'The manufacturing enterprise module (MES shop-floor execution)',
    evidence:
      'apps/desktop/src/main/enterprise/modules/manufacturing/executionModule.ts — dispatched → running → inspection → completed, posting through the Inventory Ledger.',
  },
  {
    id: 'supply-chain',
    label: 'Supply chain',
    status: 'modelled-elsewhere',
    owner: 'The inventory, procurement and warehouse enterprise modules',
    evidence:
      'apps/desktop/src/main/enterprise/modules/inventory/, .../procurement/, .../warehouse/',
  },
  {
    id: 'governance-compliance',
    label: 'Governance & compliance',
    status: 'modelled-elsewhere',
    owner: 'Enterprise Governance',
    evidence: 'apps/desktop/src/main/enterprise/governance/enterpriseGovernance.ts',
  },
  {
    id: 'security-audit',
    label: 'Security & audit',
    status: 'modelled-elsewhere',
    owner: 'The audit chain and secure store',
    evidence:
      'apps/desktop/src/main/security/auditChain.ts, apps/desktop/src/main/security/secureStore.ts — mechanisms, not a scored posture.',
  },
  {
    id: 'knowledge',
    label: 'Knowledge assets',
    status: 'modelled-elsewhere',
    owner: 'Stage 7 — Enterprise Knowledge & Decision Platform',
    evidence: 'apps/desktop/src/main/knowledgeAssets/index.ts',
  },
  {
    id: 'automation',
    label: 'Automation',
    status: 'modelled-elsewhere',
    owner: 'Stage 8 — Enterprise Automation Platform',
    evidence: 'apps/desktop/src/main/automationPlatform/index.ts',
  },
  {
    id: 'analytics-kpi',
    label: 'Analytics & KPIs',
    status: 'modelled-elsewhere',
    owner: 'Stage 12 — Enterprise Analytics Platform',
    evidence: 'apps/desktop/src/main/analyticsPlatform/index.ts',
  },
  {
    id: 'physical-sensor-telemetry',
    label: 'Physical sensor telemetry',
    status: 'not-modelled',
    owner: 'None. Would require a telemetry ingestion path and a time-series store.',
    evidence:
      'Searching apps/desktop/src/main/**/*.ts for iot|sensor|scada|plc matches ONLY industry/industryModel.ts:153-154,426, where those names are external-system labels in the P13 solution-pack catalog. No ingestion, no state model, no store.',
  },
  {
    id: 'physical-facility-geography',
    label: 'Facilities & geography',
    status: 'not-modelled',
    owner: 'None. Would require a spatial model (sites, layouts, coordinates).',
    evidence:
      'Searching apps/desktop/src/main/**/*.ts for floor.?plan|facility|facilities|geospatial|latitude|warehouse layout returns zero matches.',
  },
  {
    id: 'energy-environmental',
    label: 'Energy & environmental',
    status: 'not-modelled',
    owner: 'None. Would require metered consumption input.',
    evidence:
      'Searching apps/desktop/src/main/**/*.ts for thermal|kilowatt|energy consumption|physics returns zero matches.',
  },
] as const;

/**
 * Referential integrity over the registries. Returns the empty array when every
 * registry is internally consistent; the Stage 13 test asserts exactly that.
 */
export function twinRegistryIssues(): string[] {
  const issues: string[] = [];

  const surfaceIds = new Set<string>();
  const seenSurfaceKinds = new Set<string>();
  for (const s of SURFACE_REGISTRY) {
    if (surfaceIds.has(s.id)) issues.push(`surfaces: duplicate ${s.id}`);
    surfaceIds.add(s.id);
    if (!(ETWIN_SURFACE_KINDS as readonly string[]).includes(s.kind)) {
      issues.push(`surface ${s.id}: unknown kind ${s.kind}`);
    }
    seenSurfaceKinds.add(s.kind);
    if (s.module.length === 0) issues.push(`surface ${s.id}: no module`);
    if (s.stage.length === 0) issues.push(`surface ${s.id}: no stage`);
    if (s.reuse.length === 0) issues.push(`surface ${s.id}: no reuse statement`);
    if (s.label.length === 0) issues.push(`surface ${s.id}: no label`);
  }
  for (const kind of ETWIN_SURFACE_KINDS) {
    if (!seenSurfaceKinds.has(kind)) issues.push(`surfaces: kind ${kind} has no entry`);
  }

  const platformIds = new Set<string>();
  for (const p of PLATFORM_REGISTRY) {
    if (platformIds.has(p.id)) issues.push(`platforms: duplicate ${p.id}`);
    platformIds.add(p.id);
    if (p.module.length === 0) issues.push(`platform ${p.id}: no module`);
    if (p.slice.length === 0) issues.push(`platform ${p.id}: no slice`);
    if (!/^Stage \d+$/.test(p.stage)) issues.push(`platform ${p.id}: malformed stage ${p.stage}`);
    if (p.label.length === 0) issues.push(`platform ${p.id}: no label`);
  }

  const seriesIds = new Set<string>();
  const seenSeriesKinds = new Set<string>();
  for (const s of SERIES_REGISTRY) {
    if (seriesIds.has(s.id)) issues.push(`series: duplicate ${s.id}`);
    seriesIds.add(s.id);
    if (!(ETWIN_SERIES_KINDS as readonly string[]).includes(s.kind)) {
      issues.push(`series ${s.id}: unknown kind ${s.kind}`);
    }
    seenSeriesKinds.add(s.kind);
    if (s.module.length === 0) issues.push(`series ${s.id}: no module`);
    if (s.detail.length === 0) issues.push(`series ${s.id}: no detail`);
    // A point-in-time composition has no persisted history; claiming it is
    // trendable would be the exact dishonesty this registry exists to prevent.
    if (s.kind === 'point-in-time' && s.trendable) {
      issues.push(`series ${s.id}: point-in-time cannot be trendable`);
    }
  }
  for (const kind of ETWIN_SERIES_KINDS) {
    if (!seenSeriesKinds.has(kind)) issues.push(`series: kind ${kind} has no entry`);
  }

  const simIds = new Set<string>();
  const seenSimKinds = new Set<string>();
  for (const s of SIMULATION_REGISTRY) {
    if (simIds.has(s.id)) issues.push(`simulations: duplicate ${s.id}`);
    simIds.add(s.id);
    if (!(ETWIN_SIMULATION_KINDS as readonly string[]).includes(s.kind)) {
      issues.push(`simulation ${s.id}: unknown kind ${s.kind}`);
    }
    seenSimKinds.add(s.kind);
    if (s.module.length === 0) issues.push(`simulation ${s.id}: no module`);
    if (s.canSimulate.length === 0) issues.push(`simulation ${s.id}: no canSimulate`);
    if (s.cannotSimulate.length === 0) issues.push(`simulation ${s.id}: no cannotSimulate`);
    if (s.scenarioCount !== null && s.scenarioCount <= 0) {
      issues.push(`simulation ${s.id}: non-positive scenarioCount`);
    }
  }
  for (const kind of ETWIN_SIMULATION_KINDS) {
    if (!seenSimKinds.has(kind)) issues.push(`simulations: kind ${kind} has no entry`);
  }

  const stateIds = new Set<string>();
  const seenStatuses = new Set<string>();
  for (const s of STATE_REGISTRY) {
    if (stateIds.has(s.id)) issues.push(`states: duplicate ${s.id}`);
    stateIds.add(s.id);
    if (!(ETWIN_COVERAGE_STATUSES as readonly string[]).includes(s.status)) {
      issues.push(`state ${s.id}: unknown status ${s.status}`);
    }
    seenStatuses.add(s.status);
    if (s.label.length === 0) issues.push(`state ${s.id}: no label`);
    if (s.owner.length === 0) issues.push(`state ${s.id}: no owner`);
    // Every row carries evidence — a coverage claim without a citation is the
    // kind of unverified assertion this map is built to make impossible.
    if (s.evidence.length === 0) issues.push(`state ${s.id}: no evidence`);
    if (s.status === 'modelled-by-twin' && !s.owner.startsWith('P15 twin domain ')) {
      issues.push(`state ${s.id}: modelled-by-twin must name the P15 domain`);
    }
    if (s.status === 'not-modelled' && !s.owner.startsWith('None.')) {
      issues.push(`state ${s.id}: not-modelled must declare what would be required`);
    }
  }
  for (const status of ETWIN_COVERAGE_STATUSES) {
    if (!seenStatuses.has(status)) issues.push(`states: status ${status} has no entry`);
  }

  // The nine P15 domains are the twin's own; the coverage map must carry all of
  // them and never claim a tenth.
  const twinRows = STATE_REGISTRY.filter((s) => s.status === 'modelled-by-twin');
  if (twinRows.length !== 9) {
    issues.push(`states: expected the nine P15 domains, found ${twinRows.length}`);
  }

  return issues;
}

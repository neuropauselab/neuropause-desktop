/**
 * Phase 6 Stage 12 — the Analytics Registry (typed, versioned data; doc-locked
 * to docs/desktop/analytics/ANALYTICS-PLATFORM.md by test — the S6–S11
 * precedent).
 *
 * EVERY reference names something REAL in the repository at 59c2e3c:
 *   - KPI producers  → the ten verified producing/reusing modules,
 *   - static keys    → the six executive + four specialist keys those modules emit,
 *   - series         → the recorded windows (90-day health history, Stage 10
 *                      decision windows) and the point-in-time compositions,
 *                      each HONESTLY kind-tagged,
 *   - predictions    → the seven Stage 6 heuristic kinds (the shared
 *                      InsightPredictionKind union) + P14 scenario projection +
 *                      capacity pressure, each with canPredict / cannotPredict,
 *   - reports/dashboards/decision sources/benchmarks → the shipped surfaces.
 * `analyticsRegistryIssues()` locks referential integrity; the doc lock keeps
 * code and documentation in sync. The registries store nothing and compute
 * nothing — they are data about what already exists.
 */
import type {
  DashboardProducerDef,
  DecisionSourceDef,
  KpiProducerDef,
  PredictionProducerDef,
  ReportProducerDef,
  SeriesDef,
} from '@neuropause/shared';

/* ── the REAL vocabularies this registry may reference ────────────────────── */

export const REAL_EXEC_KPI_KEYS: readonly string[] = [
  'org-health', 'engineering-health', 'ai-adoption', 'connector-health', 'license-status', 'active-members',
] as const;
export const REAL_SPECIALIST_KPI_KEYS: readonly string[] = [
  'automation-success', 'knowledge-graph', 'workforce-performance', 'enterprise-intelligence',
] as const;
/** The seven Stage 6 prediction kinds (the shared InsightPredictionKind union). */
export const REAL_PREDICTION_KINDS: readonly string[] = [
  'approval-backlog', 'project-delay', 'connector-instability', 'automation-failure', 'inactivity', 'operational-drift', 'risk-trend',
] as const;
export const REAL_SURFACES: readonly string[] = [
  'mission-control', 'insight-center', 'operations-center', 'strategy-center', 'federation-center', 'network-center', 'decision-center', 'plugin-surfaces', 'process-explorer',
] as const;

/* ── KPI producers (the ten verified modules) ─────────────────────────────── */

export const KPI_PRODUCER_REGISTRY: readonly KpiProducerDef[] = [
  { id: 'executive-core', module: 'enterprise/executiveCenter.ts (composeExecutiveSnapshot)', kind: 'producer', keys: [...REAL_EXEC_KPI_KEYS], surfaces: ['mission-control'], detail: 'The six core executive KPIs with bands + deep links.' },
  { id: 'work-intelligence-automation', module: 'enterprise/workIntelligenceKpis.ts (automationSuccessKpi)', kind: 'producer', keys: ['automation-success'], surfaces: ['mission-control'], detail: 'Automation success ratio KPI, fed into the executive snapshot.' },
  { id: 'work-intelligence-knowledge', module: 'enterprise/workIntelligenceKpis.ts (knowledgeGraphKpi)', kind: 'producer', keys: ['knowledge-graph'], surfaces: ['mission-control'], detail: 'Knowledge-graph size KPI, fed into the executive snapshot.' },
  { id: 'workforce-performance', module: 'workforce/intelligence/workforcePerformanceKpi.ts', kind: 'producer', keys: ['workforce-performance'], surfaces: ['mission-control'], detail: 'Workforce performance KPI, fed into the executive snapshot.' },
  { id: 'enterprise-insights', module: 'enterprise/intelligence/enterpriseKpi.ts (enterpriseInsightsKpi)', kind: 'producer', keys: ['enterprise-intelligence'], surfaces: ['mission-control'], detail: 'P7 enterprise-insights KPI, fed into the executive snapshot.' },
  { id: 'process-mining', module: 'enterprise/processMiningProvider.ts (getProcessExplorerKpis)', kind: 'producer', keys: 'dynamic', surfaces: ['process-explorer', 'operations-center'], detail: 'Process KPIs mined from real events (data-driven keys).' },
  { id: 'plugin-extensions', module: 'plugins/pluginExtensionConsumers.ts (executive_kpi extensions)', kind: 'producer', keys: 'dynamic', surfaces: ['plugin-surfaces', 'mission-control'], detail: 'Plugin-contributed executive KPI tiles (data-driven keys).' },
  { id: 'p14-strategy-surface', module: 'strategy (StrategyOverview.kpis)', kind: 'reuse-surface', keys: 'dynamic', surfaces: ['strategy-center'], detail: 'REUSES platform ExecutiveKpi values on the P14 surface — no recomputation.' },
  { id: 'p18-network-surface', module: 'intelligenceNetwork (IntelNetworkOverview.kpis)', kind: 'reuse-surface', keys: 'dynamic', surfaces: ['network-center'], detail: 'REUSES platform ExecutiveKpi values on the P18 surface — no recomputation.' },
  { id: 's9-kpi-catalog', module: 'operationsPlatform/operationsModel.ts (buildKpiCatalog)', kind: 'partial-catalog', keys: 'dynamic', surfaces: ['operations-center'], detail: 'The Stage 9 partial catalog: executive + process feeds joined with source tags and key dedup — the pattern Stage 12 extends by composition.' },
] as const;

export const KNOWN_KPI_PRODUCER_BY_KEY: ReadonlyMap<string, string> = new Map([
  ...REAL_EXEC_KPI_KEYS.map((k): [string, string] => [k, 'executive-core']),
  ['automation-success', 'work-intelligence-automation'],
  ['knowledge-graph', 'work-intelligence-knowledge'],
  ['workforce-performance', 'workforce-performance'],
  ['enterprise-intelligence', 'enterprise-insights'],
]);

/* ── series (recorded windows vs point-in-time — honestly kind-tagged) ────── */

export const SERIES_REGISTRY: readonly SeriesDef[] = [
  { id: 'org-health-history', label: 'Org health (90-day daily history)', kind: 'daily-history', source: 'enterprise/healthHistoryStore.ts', detail: 'The one long daily series the platform records (day/overall/engineering).' },
  { id: 'engineering-health-history', label: 'Engineering health (90-day daily history)', kind: 'daily-history', source: 'enterprise/healthHistoryStore.ts', detail: 'The engineering component of the same recorded series.' },
  { id: 'decision-window-deltas', label: 'Decision-window value deltas (Stage 10)', kind: 'decision-window', source: 'strategyPlatform/businessOutcome.ts (windowDeltas)', detail: 'Measured before/after health over each governed decision window.' },
  { id: 'sla-status', label: 'SLA statuses (Stage 9)', kind: 'point-in-time', source: 'operationsPlatform/slaFramework.ts', detail: 'Measured against targets per pass — no recorded status series exists.' },
  { id: 'kpi-bands', label: 'Executive KPI bands', kind: 'point-in-time', source: 'enterprise/executiveCenter.ts', detail: 'Live bands per pass — no recorded band series exists.' },
  { id: 'capability-conditions', label: 'Capability conditions (Stage 10)', kind: 'point-in-time', source: 'strategyPlatform/capabilityMap.ts', detail: 'Composed per pass from declared evidence — no recorded series exists.' },
] as const;

/* ── the platform's predictive capability (registered, never invented) ────── */

const HEURISTIC_LIMITS =
  'Fires only when its stated condition holds on real records; silent when history is insufficient — a missing prediction means "not enough evidence", never "no risk". No ML, no model, no randomness.';

export const PREDICTION_REGISTRY: readonly PredictionProducerDef[] = [
  { id: 'approval-backlog', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'An approval backlog forming from the recorded queue trajectory.', cannotPredict: 'Whether any specific approval will be granted, or backlog beyond the recorded window.', basis: HEURISTIC_LIMITS },
  { id: 'project-delay', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'Delay risk on projects whose recorded activity has stalled.', cannotPredict: 'Delivery dates — the platform records no commitments to project against.', basis: HEURISTIC_LIMITS },
  { id: 'connector-instability', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'Instability on connectors with recorded recent failures.', cannotPredict: 'Provider-side outages that have left no local record.', basis: HEURISTIC_LIMITS },
  { id: 'automation-failure', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'Failure risk on rules with a recorded failing run pattern.', cannotPredict: 'Failures of rules that have never run or never failed.', basis: HEURISTIC_LIMITS },
  { id: 'inactivity', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'Inactivity drift where recorded activity has stopped.', cannotPredict: 'The reason for the inactivity.', basis: HEURISTIC_LIMITS },
  { id: 'operational-drift', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'Operational drift visible in the recorded health history.', cannotPredict: 'Drift in metrics the platform does not record.', basis: HEURISTIC_LIMITS },
  { id: 'risk-trend', kind: 'deterministic-heuristic', source: 'insight/predictions.ts', canPredict: 'A deteriorating risk trend across the recorded 90-day history.', cannotPredict: 'Point-in-time shocks with no historical precursor.', basis: HEURISTIC_LIMITS },
  { id: 'p14-simulation', kind: 'scenario-projection', source: 'strategy (SimulationReport)', canPredict: 'Deterministic what-if projections (cost/risk/time/utilization/compliance/probability) for comparison between authored scenarios.', cannotPredict: 'Actual outcomes — projections are advisory comparisons; nothing is applied and no probability is measured.', basis: 'Deterministic scenario arithmetic over declared inputs; the surface itself states "compare and choose; nothing is applied".' },
  { id: 'capacity-pressure', kind: 'present-state-composition', source: 'operationsPlatform/capacityPlanner.ts', canPredict: 'Nothing — it composes PRESENT pressure from live queue/backlog/bottleneck signals.', cannotPredict: 'Future capacity; it is a present-state reading and is registered here to say so.', basis: 'Threshold composition over live signals (low/elevated/high/unknown).' },
] as const;

/* ── reports, dashboards, decision sources, benchmarks (shipped surfaces) ─── */

export const REPORT_REGISTRY: readonly ReportProducerDef[] = [
  { id: 'briefing-generator', label: 'Executive briefs (morning/afternoon/evening/weekly/monthly)', source: 'intelligence/briefingGenerator.ts' },
  { id: 's10-board-report', label: 'Strategy board brief', source: 'strategyPlatform/executiveDashboard.ts' },
  { id: 's11-federation-report', label: 'Federation board brief', source: 'enterpriseFederation/federationDashboard.ts' },
  { id: 'quarterly-ops-report', label: 'Quarterly ops report playbook', source: 'automationPlatform (PLAYBOOK_REGISTRY)' },
] as const;

export const DASHBOARD_REGISTRY: readonly DashboardProducerDef[] = [
  { id: 'executive-snapshot', label: 'Executive snapshot', source: 'enterprise/executiveCenter.ts' },
  { id: 'insight-dashboard', label: 'Insight dashboard (Stage 6)', source: 'insight/index.ts' },
  { id: 's8-automation-dashboard', label: 'Automation platform dashboard', source: 'automationPlatform/index.ts' },
  { id: 's9-operations-dashboard', label: 'Operations platform dashboard', source: 'operationsPlatform/index.ts' },
  { id: 's10-strategy-dashboard', label: 'Strategy platform dashboard', source: 'strategyPlatform/index.ts' },
  { id: 's11-federation-dashboard', label: 'Federation platform dashboard', source: 'enterpriseFederation/index.ts' },
] as const;

export const DECISION_SOURCE_REGISTRY: readonly DecisionSourceDef[] = [
  { id: 'decision-store', label: 'Executive decision store', source: 'decisionStore' },
  { id: 's6-outcome-loop', label: 'Outcome verification loop', source: 'insight (InsightOutcome)' },
  { id: 's10-business-value', label: 'Computed business value', source: 'strategyPlatform/businessOutcome.ts' },
  { id: 's10-strategy-recommendations', label: 'Strategy focus recommendations', source: 'strategyPlatform (dashboard)' },
  { id: 's11-federation-recommendations', label: 'Federation recommendations', source: 'enterpriseFederation (dashboard)' },
] as const;

export const BENCHMARK_SOURCE_REGISTRY: readonly DecisionSourceDef[] = [
  { id: 'p18-network-benchmarks', label: 'Sanitized network benchmarks (composes the P13 industry reference)', source: 'intelligenceNetwork (IntelNetworkSummary.benchmarkPosition)' },
] as const;

/* ── integrity (mirrors the S6–S11 registry locks) ────────────────────────── */

export function analyticsRegistryIssues(): string[] {
  const issues: string[] = [];

  const producerIds = new Set<string>();
  for (const p of KPI_PRODUCER_REGISTRY) {
    if (producerIds.has(p.id)) issues.push(`kpi producers: duplicate ${p.id}`);
    producerIds.add(p.id);
    if (p.module.length === 0) issues.push(`kpi producer ${p.id}: no module`);
    if (p.surfaces.length === 0) issues.push(`kpi producer ${p.id}: no surfaces`);
    for (const s of p.surfaces) if (!REAL_SURFACES.includes(s)) issues.push(`kpi producer ${p.id}: unknown surface ${s}`);
    if (p.keys !== 'dynamic') {
      for (const k of p.keys) {
        if (![...REAL_EXEC_KPI_KEYS, ...REAL_SPECIALIST_KPI_KEYS].includes(k)) issues.push(`kpi producer ${p.id}: unknown static key ${k}`);
      }
    }
  }
  for (const [key, producer] of KNOWN_KPI_PRODUCER_BY_KEY) {
    if (!producerIds.has(producer)) issues.push(`kpi key map ${key}: unknown producer ${producer}`);
  }
  for (const k of [...REAL_EXEC_KPI_KEYS, ...REAL_SPECIALIST_KPI_KEYS]) {
    if (!KNOWN_KPI_PRODUCER_BY_KEY.has(k)) issues.push(`kpi key map: static key ${k} unmapped`);
  }

  const seriesIds = new Set<string>();
  for (const s of SERIES_REGISTRY) {
    if (seriesIds.has(s.id)) issues.push(`series: duplicate ${s.id}`);
    seriesIds.add(s.id);
    if (!['daily-history', 'decision-window', 'point-in-time'].includes(s.kind)) issues.push(`series ${s.id}: unknown kind`);
    if (s.source.length === 0) issues.push(`series ${s.id}: no source`);
  }

  const predIds = new Set<string>();
  for (const p of PREDICTION_REGISTRY) {
    if (predIds.has(p.id)) issues.push(`predictions: duplicate ${p.id}`);
    predIds.add(p.id);
    if (p.canPredict.length === 0) issues.push(`prediction ${p.id}: canPredict missing`);
    if (p.cannotPredict.length === 0) issues.push(`prediction ${p.id}: cannotPredict missing`);
    if (p.basis.length === 0) issues.push(`prediction ${p.id}: basis missing`);
  }
  for (const k of REAL_PREDICTION_KINDS) {
    if (!predIds.has(k)) issues.push(`predictions: Stage 6 kind ${k} unregistered`);
  }

  for (const list of [REPORT_REGISTRY, DASHBOARD_REGISTRY, DECISION_SOURCE_REGISTRY, BENCHMARK_SOURCE_REGISTRY] as const) {
    const seen = new Set<string>();
    for (const e of list) {
      if (seen.has(e.id)) issues.push(`registry: duplicate id ${e.id}`);
      seen.add(e.id);
      if (e.source.length === 0) issues.push(`registry ${e.id}: no source`);
    }
  }
  return issues;
}

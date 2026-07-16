/**
 * Autonomous Enterprise Intelligence (P14) — the pure strategic model.
 *
 * All non-trivial strategy logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It projects a composed snapshot of the EXISTING platform intelligence — the P7
 * Enterprise Intelligence report (health/risk/dependencies/capacity/incidents/recommendations/KPIs),
 * the Cloud Control Plane, the AI Workforce, Connectors, the Marketplace, the Industry Platform,
 * Federation trust, and Governance approval chains — into strategic VIEW MODELS: a Goal Manager, a
 * long-horizon Planning Engine, a Reasoning Engine, an Optimization Engine, a deterministic
 * Simulation Engine, and an advisory Decision queue. It NEVER executes, mutates, or auto-applies
 * anything: every recommendation is advisory, evidence-backed, and approval-aware (it references the
 * real governance approval chains). No new runtime, engine, store, or parallel architecture.
 */
import type {
  StrategyApprovalRequirement as ApprovalRequirement,
  ApprovalTrigger,
  StrategyBand as Band,
  CollaborationPeer,
  DecisionQueue,
  ExecutiveKpi,
  GoalCategory,
  GoalManager,
  IntelRecommendation,
  OptimizationArea,
  OptimizationEngine,
  OptimizationOpportunity,
  PlanHorizon,
  PlanningEngine,
  PlanStep,
  ReasoningDimension,
  ReasoningFinding,
  ReasoningReport,
  ScenarioProjection,
  SimulationReport,
  SimulationScenario,
  StrategicDecision,
  StrategicGoal,
  StrategicObjective,
  StrategyHorizon,
  StrategyMilestone,
  StrategyOverview,
  StrategyPriority,
  StrategyStatus,
  StrategySummary,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the service from live sources) ── */

export interface StrategyState {
  generatedAt: string;
  health: { overall: number; band: Band; scores: { key: string; label: string; score: number; band: Band }[] };
  risk: {
    overall: number;
    band: Band;
    byCategory: Record<string, number>;
    topRisks: { id: string; label: string; risk: number; reason: string }[];
    confidence: number;
  };
  dependencies: { spofs: number; cycles: number; bottlenecks: number; criticalCount: number; topSpofs: { id: string; label: string; blastRadius: number }[] };
  capacity: { utilizationAvg: number | null; costTotal: number; pressureScore: number; costOutliers: { id: string; label: string; cost: number | null }[] };
  incidents: { open: number; total: number };
  recommendations: IntelRecommendation[];
  cloud: { monthlySpend: number; currency: string; quotas: { resource: string; used: number; limit: number; utilizationPct: number }[]; fleetStatus: string; deployments: number; healthyDeployments: number; regions: number };
  workforce: { totalWorkers: number; overallSuccessRate: number; bottlenecks: { scope: string; key: string; kind: string; reason: string }[]; healthy: number; degraded: number; unhealthy: number };
  connectors: { total: number; connected: number; healthy: number; degraded: number; down: number };
  industry: { ready: number; partial: number; planned: number; averageActivation: number; entries: { id: string; name: string; status: string; activation: number }[] };
  marketplace: { published: number; certified: number; byKind: Record<string, number> };
  compliance: { score: number; band: Band; frameworks: number; failing: number; passing: number };
  approvalChains: { id: string; appliesTo: ApprovalTrigger; name: string; enabled: boolean; steps: { roleId: string; order: number }[] }[];
  collaboration: { peerOrg: string; peerOrgName: string; trustLevel: string; decision: 'allow' | 'deny' | 'require_approval'; reason: string }[];
}

/* ── small helpers ── */

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = (n: number): number => Math.round(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Map a 0..100 "badness" score to a health band (higher = worse). */
function badnessBand(score: number): Band {
  return score >= 70 ? 'critical' : score >= 50 ? 'at-risk' : score >= 30 ? 'watch' : 'healthy';
}
/** Map a 0..100 "goodness" score to a health band (higher = better). */
function goodnessBand(score: number): Band {
  return score < 30 ? 'critical' : score < 50 ? 'at-risk' : score < 70 ? 'watch' : 'healthy';
}

function statusFromProgress(progress: number): StrategyStatus {
  return progress >= 0.75 ? 'on_track' : progress >= 0.4 ? 'at_risk' : 'off_track';
}

/** Direction-aware attainment (0..1) of `current` toward `target`. */
function attainment(current: number, target: number, direction: 'up' | 'down'): number {
  if (direction === 'up') {
    if (target <= 0) return current >= target ? 1 : 0;
    return clamp01(current / target);
  }
  // down: lower is better
  if (current <= target) return 1;
  if (target <= 0) return 0; // current > 0 and target 0 → not met
  return clamp01(target / current);
}

/* ── Approval awareness — references the EXISTING governance approval chains ── */

/**
 * Maps a P14 advisory action-kind onto the governance `ApprovalTrigger` category it would fall under.
 * P14 does not invent approvals: it classifies the action, then reads the live approval chains.
 */
const ACTION_TRIGGER: Record<string, ApprovalTrigger> = {
  scale_workforce: 'workforce_side_effect',
  reassign_workers: 'workforce_side_effect',
  remediate_incident: 'workforce_side_effect',
  mitigate_risk: 'workforce_side_effect',
  reconnect_connector: 'workforce_side_effect',
  optimize_workflow: 'workforce_side_effect',
  adjust_cloud_spend: 'spend',
  optimize_budget: 'spend',
  update_governance: 'governance_change',
  restructure_org: 'org_structure_change',
  share_cross_org: 'data_export',
  export_data: 'data_export',
};

export function approvalFor(action: string, chains: StrategyState['approvalChains']): ApprovalRequirement {
  const trigger: ApprovalTrigger = ACTION_TRIGGER[action] ?? 'workforce_side_effect';
  const chain = chains.find((c) => c.enabled && c.appliesTo === trigger) ?? null;
  if (!chain) {
    return {
      trigger,
      governed: false,
      chainName: null,
      steps: 0,
      note: `No enabled approval chain governs "${trigger}". Configure one in Governance before this action can be executed.`,
    };
  }
  return {
    trigger,
    governed: true,
    chainName: chain.name,
    steps: chain.steps.length,
    note: `Requires approval via "${chain.name}" (${chain.steps.length} step(s)) before execution.`,
  };
}

/* ── Goal Manager ── */

interface GoalDef {
  id: string;
  category: GoalCategory;
  name: string;
  description: string;
  horizon: StrategyHorizon;
  unit: string;
  target: number;
  direction: 'up' | 'down';
  successMetric: string;
  dependencies: string[];
  current: (s: StrategyState) => number;
  objectives: (s: StrategyState) => StrategicObjective[];
  evidence: (s: StrategyState) => string[];
}

function objective(id: string, label: string, metric: string, target: number, current: number, unit: string, direction: 'up' | 'down'): StrategicObjective {
  const progress = round2(attainment(current, target, direction));
  return { id, label, metric, target, current: round2(current), unit, progress, status: statusFromProgress(progress) };
}

const GOAL_DEFS: GoalDef[] = [
  {
    id: 'goal-risk',
    category: 'security',
    name: 'Reduce enterprise risk',
    description: 'Bring the composite enterprise risk index into the healthy band.',
    horizon: '90d',
    unit: 'index',
    target: 40,
    direction: 'down',
    successMetric: 'Enterprise risk index < 40',
    dependencies: [],
    current: (s) => s.risk.overall,
    objectives: (s) =>
      Object.entries(s.risk.byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([cat, v]) => objective(`goal-risk-${cat}`, `${cat} risk`, `${cat} risk score`, 40, v, 'index', 'down')),
    evidence: (s) => s.risk.topRisks.slice(0, 3).map((r) => r.id),
  },
  {
    id: 'goal-health',
    category: 'operational',
    name: 'Sustain enterprise health',
    description: 'Keep the composite enterprise health score in the healthy band.',
    horizon: '90d',
    unit: 'score',
    target: 80,
    direction: 'up',
    successMetric: 'Enterprise health score ≥ 80',
    dependencies: ['goal-risk'],
    current: (s) => s.health.overall,
    objectives: (s) => s.health.scores.slice(0, 2).map((sc) => objective(`goal-health-${sc.key}`, sc.label, `${sc.label} score`, 80, sc.score, 'score', 'up')),
    evidence: (s) => s.health.scores.map((sc) => `health:${sc.key}`),
  },
  {
    id: 'goal-workforce',
    category: 'workforce',
    name: 'Raise workforce reliability',
    description: 'Drive the AI workforce job success rate above 90%.',
    horizon: '90d',
    unit: '%',
    target: 90,
    direction: 'up',
    successMetric: 'Workforce success rate ≥ 90%',
    dependencies: [],
    current: (s) => round(s.workforce.overallSuccessRate * 100),
    objectives: (s) => [
      objective('goal-workforce-success', 'Job success rate', 'succeeded / decided jobs', 90, round(s.workforce.overallSuccessRate * 100), '%', 'up'),
      objective('goal-workforce-healthy', 'Healthy workers', 'workers in healthy band', s.workforce.totalWorkers, s.workforce.healthy, 'workers', 'up'),
    ],
    evidence: (s) => s.workforce.bottlenecks.map((b) => `${b.scope}:${b.key}`),
  },
  {
    id: 'goal-cloud-cost',
    category: 'financial',
    name: 'Improve cloud cost efficiency',
    description: 'Raise utilization of paid cloud capacity so spend is not wasted on idle headroom (a measurable proxy for cost efficiency; P14 stores no baseline).',
    horizon: '180d',
    unit: '%',
    target: 70,
    direction: 'up',
    successMetric: 'Cloud capacity utilization ≥ 70%',
    dependencies: [],
    current: (s) => avgUtil(s),
    objectives: (s) => [objective('goal-cloud-under', 'Under-utilized quotas', 'quotas below 40% utilization', 0, s.cloud.quotas.filter((q) => q.utilizationPct < 40).length, 'quotas', 'down')],
    evidence: (s) => s.cloud.quotas.map((q) => `quota:${q.resource}`),
  },
  {
    id: 'goal-compliance',
    category: 'compliance',
    name: 'Close compliance control gaps',
    description: 'Enable the governance controls backing each compliance framework across the estate.',
    horizon: '30d',
    unit: 'frameworks',
    target: 0,
    direction: 'down',
    successMetric: 'Zero frameworks with control gaps',
    dependencies: [],
    current: (s) => s.compliance.failing,
    objectives: (s) => [objective('goal-compliance-score', 'Compliance score', 'compliance health score', 80, s.compliance.score, 'score', 'up')],
    evidence: () => ['health:compliance'],
  },
  {
    id: 'goal-capacity',
    category: 'infrastructure',
    name: 'Relieve capacity pressure',
    description: 'Keep infrastructure capacity pressure in the low band.',
    horizon: '90d',
    unit: 'score',
    target: 30,
    direction: 'down',
    successMetric: 'Capacity pressure score < 30',
    dependencies: ['goal-cloud-cost'],
    current: (s) => s.capacity.pressureScore,
    objectives: (s) => [objective('goal-capacity-outliers', 'Cost outliers', 'high-cost resources', 0, s.capacity.costOutliers.length, 'resources', 'down')],
    evidence: (s) => s.capacity.costOutliers.slice(0, 3).map((o) => o.id),
  },
  {
    id: 'goal-incidents',
    category: 'operational',
    name: 'Drive incidents to zero',
    description: 'Resolve and prevent open enterprise incidents.',
    horizon: '30d',
    unit: 'incidents',
    target: 0,
    direction: 'down',
    successMetric: 'Zero open incidents',
    dependencies: ['goal-risk'],
    current: (s) => s.incidents.open,
    objectives: (s) => [objective('goal-incidents-open', 'Open incidents', 'incidents severity > info', 0, s.incidents.open, 'incidents', 'down')],
    evidence: () => ['incidents:open'],
  },
  {
    id: 'goal-industry',
    category: 'growth',
    name: 'Expand industry readiness',
    description: 'Activate industry solution suites across target verticals.',
    horizon: '365d',
    unit: '%',
    target: 60,
    direction: 'up',
    successMetric: 'Average industry activation ≥ 60%',
    dependencies: ['goal-workforce'],
    current: (s) => round(s.industry.averageActivation * 100),
    objectives: (s) => [objective('goal-industry-ready', 'Ready suites', 'suites in ready state', s.industry.ready + s.industry.partial + s.industry.planned, s.industry.ready, 'suites', 'up')],
    evidence: (s) => s.industry.entries.slice(0, 3).map((e) => `industry:${e.id}`),
  },
  {
    id: 'goal-resilience',
    category: 'infrastructure',
    name: 'Eliminate single points of failure',
    description: 'Remove architectural single points of failure across the enterprise graph.',
    horizon: 'multi_year',
    unit: 'SPOFs',
    target: 0,
    direction: 'down',
    successMetric: 'Zero single points of failure',
    dependencies: ['goal-capacity'],
    current: (s) => s.dependencies.spofs,
    objectives: (s) => [objective('goal-resilience-spofs', 'Single points of failure', 'graph SPOF count', 0, s.dependencies.spofs, 'nodes', 'down')],
    evidence: (s) => s.dependencies.topSpofs.slice(0, 3).map((n) => n.id),
  },
];

/** Goal id → improvement direction, so downstream projections can reason about impact direction. */
const GOAL_DIRECTION: Record<string, 'up' | 'down'> = Object.fromEntries(GOAL_DEFS.map((d) => [d.id, d.direction]));

function avgUtil(s: StrategyState): number {
  if (s.cloud.quotas.length === 0) return 0;
  return round(s.cloud.quotas.reduce((n, q) => n + q.utilizationPct, 0) / s.cloud.quotas.length);
}

function milestonesFor(goalId: string, horizon: StrategyHorizon, progress: number): StrategyMilestone[] {
  return [
    { id: `${goalId}-m1`, label: '25% checkpoint', horizon, status: progress >= 0.25 ? 'on_track' : 'at_risk' },
    { id: `${goalId}-m2`, label: '50% checkpoint', horizon, status: progress >= 0.5 ? 'on_track' : progress >= 0.25 ? 'at_risk' : 'off_track' },
    { id: `${goalId}-target`, label: 'Target', horizon, status: statusFromProgress(progress) },
  ];
}

export function resolveGoal(def: GoalDef, s: StrategyState): StrategicGoal {
  const current = def.current(s);
  const progress = round2(attainment(current, def.target, def.direction));
  return {
    id: def.id,
    category: def.category,
    name: def.name,
    description: def.description,
    horizon: def.horizon,
    successMetric: def.successMetric,
    target: def.target,
    current: round2(current),
    unit: def.unit,
    progress,
    status: statusFromProgress(progress),
    objectives: def.objectives(s),
    dependencies: def.dependencies,
    milestones: milestonesFor(def.id, def.horizon, progress),
    evidence: def.evidence(s),
  };
}

const GOAL_CATEGORIES: GoalCategory[] = ['financial', 'operational', 'security', 'growth', 'compliance', 'workforce', 'infrastructure'];

export function buildGoalManager(s: StrategyState): GoalManager {
  const goals = GOAL_DEFS.map((d) => resolveGoal(d, s));
  const byCategory = GOAL_CATEGORIES.map((category) => ({ category, count: goals.filter((g) => g.category === category).length })).filter((c) => c.count > 0);
  const onTrack = goals.filter((g) => g.status === 'on_track').length;
  const atRisk = goals.filter((g) => g.status === 'at_risk').length;
  const offTrack = goals.filter((g) => g.status === 'off_track').length;
  const overallProgress = goals.length > 0 ? round2(goals.reduce((n, g) => n + g.progress, 0) / goals.length) : 0;
  return { goals, byCategory, onTrack, atRisk, offTrack, overallProgress };
}

/* ── Long-horizon Planning ── */

const HORIZON_ORDER: StrategyHorizon[] = ['30d', '90d', '180d', '365d', 'multi_year'];
const HORIZON_LABEL: Record<StrategyHorizon, string> = { '30d': '30 days', '90d': '90 days', '180d': '180 days', '365d': '365 days', multi_year: 'Multi-year' };

/** An advisory execution step for an off-track goal, carrying its required approval. */
function planStepFor(goal: StrategicGoal, chains: StrategyState['approvalChains']): PlanStep {
  const action = PLAN_ACTION_BY_CATEGORY[goal.category];
  return {
    id: `plan-${goal.id}`,
    label: `Advance "${goal.name}"`,
    action,
    requiredApproval: approvalFor(action, chains),
    evidence: goal.evidence.slice(0, 3),
  };
}

const PLAN_ACTION_BY_CATEGORY: Record<GoalCategory, string> = {
  financial: 'optimize_budget',
  operational: 'optimize_workflow',
  security: 'mitigate_risk',
  growth: 'optimize_workflow',
  compliance: 'update_governance',
  workforce: 'scale_workforce',
  infrastructure: 'adjust_cloud_spend',
};

export function buildPlanningEngine(s: StrategyState): PlanningEngine {
  const goals = buildGoalManager(s).goals;
  const horizons: PlanHorizon[] = HORIZON_ORDER.map((horizon) => {
    const horizonGoals = goals.filter((g) => g.horizon === horizon);
    const milestones = horizonGoals.flatMap((g) => g.milestones);
    // Only goals that are not yet on-track need an execution step within the horizon.
    const steps = horizonGoals.filter((g) => g.status !== 'on_track').map((g) => planStepFor(g, s.approvalChains));
    const summary = horizonGoals.length === 0
      ? `No strategic goals scheduled in the ${HORIZON_LABEL[horizon]} horizon.`
      : `${horizonGoals.length} goal(s) over ${HORIZON_LABEL[horizon]}; ${steps.length} require execution steps (all approval-gated).`;
    return { horizon, goalIds: horizonGoals.map((g) => g.id), milestones, steps, summary };
  });
  return {
    horizons,
    totalGoals: goals.length,
    totalMilestones: horizons.reduce((n, h) => n + h.milestones.length, 0),
    totalSteps: horizons.reduce((n, h) => n + h.steps.length, 0),
  };
}

/* ── Reasoning Engine ── */

function finding(dimension: ReasoningDimension, title: string, detail: string, severity: Band, confidence: number, evidence: string[]): ReasoningFinding {
  return { dimension, title, detail, severity, confidence, evidence };
}

const SEVERITY_RANK: Record<Band, number> = { critical: 3, 'at-risk': 2, watch: 1, healthy: 0 };

export function buildReasoningReport(s: StrategyState): ReasoningReport {
  const findings: ReasoningFinding[] = [];

  // Dependencies
  if (s.dependencies.spofs > 0) {
    findings.push(finding('dependencies', `${s.dependencies.spofs} single point(s) of failure`, `The enterprise graph has ${s.dependencies.spofs} SPOF(s) and ${s.dependencies.criticalCount} critical dependency node(s).`, badnessBand(Math.min(100, s.dependencies.spofs * 20)), 0.8, s.dependencies.topSpofs.map((n) => n.id)));
  }
  if (s.dependencies.cycles > 0) {
    findings.push(finding('dependencies', `${s.dependencies.cycles} dependency cycle(s)`, `Circular dependencies increase blast radius and complicate recovery.`, badnessBand(Math.min(100, s.dependencies.cycles * 25)), 0.7, ['dependencies:cycles']));
  }

  // Risks
  for (const r of s.risk.topRisks.slice(0, 3)) {
    findings.push(finding('risks', `Elevated risk: ${r.label}`, r.reason, badnessBand(r.risk), round2(s.risk.confidence), [r.id]));
  }

  // Resources
  if (s.capacity.pressureScore >= 30) {
    findings.push(finding('resources', `Capacity pressure ${s.capacity.pressureScore}`, `${s.capacity.costOutliers.length} cost outlier(s); average utilization ${s.capacity.utilizationAvg ?? 'n/a'}.`, badnessBand(s.capacity.pressureScore), 0.75, s.capacity.costOutliers.slice(0, 3).map((o) => o.id)));
  }

  // Costs
  if (s.cloud.monthlySpend > 0) {
    findings.push(finding('costs', `Monthly cloud spend ${s.cloud.currency} ${round(s.cloud.monthlySpend)}`, `${s.cloud.quotas.filter((q) => q.utilizationPct < 40).length} under-utilized quota(s) suggest right-sizing headroom.`, s.cloud.quotas.some((q) => q.utilizationPct < 40) ? 'watch' : 'healthy', 0.7, s.cloud.quotas.map((q) => `quota:${q.resource}`)));
  }

  // Compliance
  if (s.compliance.failing > 0) {
    findings.push(finding('compliance', `${s.compliance.failing} failing compliance framework(s)`, `Compliance health score ${s.compliance.score}. Close control gaps to reach attestation readiness.`, badnessBand(100 - s.compliance.score), 0.8, ['health:compliance']));
  }

  // Performance
  const weakScores = s.health.scores.filter((sc) => sc.band === 'at-risk' || sc.band === 'critical');
  for (const sc of weakScores.slice(0, 2)) {
    findings.push(finding('performance', `${sc.label} degraded`, `${sc.label} score ${sc.score} is in the ${sc.band} band.`, sc.band, 0.75, [`health:${sc.key}`]));
  }
  for (const b of s.workforce.bottlenecks.slice(0, 2)) {
    findings.push(finding('performance', `Workforce bottleneck (${b.kind})`, b.reason, b.kind === 'high_failure' ? 'at-risk' : 'watch', 0.7, [`${b.scope}:${b.key}`]));
  }

  const dims: ReasoningDimension[] = ['dependencies', 'risks', 'resources', 'costs', 'compliance', 'performance'];
  const byDimension = dims.map((dimension) => ({ dimension, count: findings.filter((f) => f.dimension === dimension).length })).filter((d) => d.count > 0);
  const priorityOrder = [...dims]
    .map((dimension) => {
      const fs = findings.filter((f) => f.dimension === dimension);
      const maxSev = fs.reduce((m, f) => Math.max(m, SEVERITY_RANK[f.severity]), -1);
      return { dimension, maxSev, count: fs.length };
    })
    .filter((d) => d.count > 0)
    .sort((a, b) => b.maxSev - a.maxSev || b.count - a.count)
    .map((d) => d.dimension);
  const confidence = findings.length > 0 ? round2(findings.reduce((n, f) => n + f.confidence, 0) / findings.length) : 1;
  return { findings, byDimension, priorityOrder, confidence };
}

/* ── Optimization Engine ── */

function priorityFromScore(score: number): StrategyPriority {
  return score >= 70 ? 'critical' : score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low';
}

export function buildOptimizationEngine(s: StrategyState): OptimizationEngine {
  const opportunities: OptimizationOpportunity[] = [];

  // Cloud / budget — under-utilized paid capacity is recoverable spend.
  const underUtilized = s.cloud.quotas.filter((q) => q.limit > 0 && q.utilizationPct < 40);
  if (s.cloud.monthlySpend > 0 && underUtilized.length > 0) {
    const saving = round(s.cloud.monthlySpend * 0.15);
    opportunities.push({
      id: 'opt-cloud-rightsize',
      area: 'cloud',
      title: 'Right-size under-utilized cloud capacity',
      detail: `${underUtilized.length} quota(s) below 40% utilization while spend is ${s.cloud.currency} ${round(s.cloud.monthlySpend)}/mo.`,
      currentValue: s.cloud.monthlySpend,
      targetValue: round(s.cloud.monthlySpend * 0.85),
      unit: s.cloud.currency,
      potentialSavingUsd: saving,
      confidence: 0.7,
      evidence: underUtilized.map((q) => `quota:${q.resource}`),
      recommendedAction: 'adjust_cloud_spend',
      requiredApproval: approvalFor('adjust_cloud_spend', s.approvalChains),
      priority: priorityFromScore(50),
    });
  }

  // Workforce — bottlenecks are throughput/quality losses.
  for (const b of s.workforce.bottlenecks.slice(0, 3)) {
    const score = b.kind === 'high_failure' ? 60 : b.kind === 'backlog' ? 45 : 35;
    opportunities.push({
      id: `opt-workforce-${b.scope}-${b.key}`,
      area: 'workforce',
      title: `Resolve workforce ${b.kind} (${b.key})`,
      detail: b.reason,
      currentValue: round(s.workforce.overallSuccessRate * 100),
      targetValue: 90,
      unit: '%',
      potentialSavingUsd: 0,
      confidence: 0.7,
      evidence: [`${b.scope}:${b.key}`],
      recommendedAction: b.kind === 'backlog' ? 'scale_workforce' : 'reassign_workers',
      requiredApproval: approvalFor(b.kind === 'backlog' ? 'scale_workforce' : 'reassign_workers', s.approvalChains),
      priority: priorityFromScore(score),
    });
  }

  // Connectors — degraded/down connectors starve grounded execution.
  const impaired = s.connectors.degraded + s.connectors.down;
  if (impaired > 0) {
    opportunities.push({
      id: 'opt-connector-health',
      area: 'connector',
      title: `Restore ${impaired} impaired connector(s)`,
      detail: `${s.connectors.down} down + ${s.connectors.degraded} degraded of ${s.connectors.total}; reconnect to keep workers grounded.`,
      currentValue: s.connectors.healthy,
      targetValue: s.connectors.total,
      unit: 'connectors',
      potentialSavingUsd: 0,
      confidence: 0.75,
      evidence: ['connectors:health'],
      recommendedAction: 'reconnect_connector',
      requiredApproval: approvalFor('reconnect_connector', s.approvalChains),
      priority: priorityFromScore(s.connectors.down > 0 ? 55 : 35),
    });
  }

  // Resource — high-cost outliers.
  if (s.capacity.costOutliers.length > 0) {
    opportunities.push({
      id: 'opt-resource-outliers',
      area: 'resource',
      title: `Review ${s.capacity.costOutliers.length} high-cost resource(s)`,
      detail: `Cost outliers concentrate spend and blast radius; consolidate or decommission.`,
      currentValue: s.capacity.costOutliers.length,
      targetValue: 0,
      unit: 'resources',
      potentialSavingUsd: round(s.capacity.costTotal * 0.1),
      confidence: 0.6,
      evidence: s.capacity.costOutliers.slice(0, 3).map((o) => o.id),
      recommendedAction: 'optimize_budget',
      requiredApproval: approvalFor('optimize_budget', s.approvalChains),
      priority: priorityFromScore(40),
    });
  }

  // Execution — open incidents are workflow drag.
  if (s.incidents.open > 0) {
    opportunities.push({
      id: 'opt-execution-incidents',
      area: 'execution',
      title: `Clear ${s.incidents.open} open incident(s)`,
      detail: `Open incidents slow execution and raise risk; run remediation playbooks.`,
      currentValue: s.incidents.open,
      targetValue: 0,
      unit: 'incidents',
      potentialSavingUsd: 0,
      confidence: 0.65,
      evidence: ['incidents:open'],
      recommendedAction: 'remediate_incident',
      requiredApproval: approvalFor('remediate_incident', s.approvalChains),
      priority: priorityFromScore(s.incidents.open >= 3 ? 60 : 40),
    });
  }

  const areas: OptimizationArea[] = ['resource', 'budget', 'cloud', 'workforce', 'connector', 'workflow', 'execution'];
  const byArea = areas.map((area) => ({ area, count: opportunities.filter((o) => o.area === area).length })).filter((a) => a.count > 0);
  const totalPotentialSavingUsd = opportunities.reduce((n, o) => n + o.potentialSavingUsd, 0);
  const rank: Record<StrategyPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };
  opportunities.sort((a, b) => rank[b.priority] - rank[a.priority] || b.potentialSavingUsd - a.potentialSavingUsd);
  return { opportunities, byArea, totalPotentialSavingUsd, count: opportunities.length };
}

/* ── Simulation Engine (deterministic what-if; NEVER auto-applied) ── */

function baselineProjection(s: StrategyState): ScenarioProjection {
  const util = s.cloud.quotas.length > 0 ? avgUtil(s) : 50;
  const offTrack = buildGoalManager(s).offTrack;
  return {
    costUsd: round(s.cloud.monthlySpend),
    riskScore: round(s.risk.overall),
    timeDays: 30 + offTrack * 15,
    resourceUtilizationPct: util,
    complianceScore: round(s.compliance.score),
    probabilityPct: round(clamp01(s.risk.confidence) * 100),
  };
}

function deltaOf(scenario: ScenarioProjection, baseline: ScenarioProjection): ScenarioProjection {
  return {
    costUsd: round(scenario.costUsd - baseline.costUsd),
    riskScore: round(scenario.riskScore - baseline.riskScore),
    timeDays: round(scenario.timeDays - baseline.timeDays),
    resourceUtilizationPct: round(scenario.resourceUtilizationPct - baseline.resourceUtilizationPct),
    complianceScore: round(scenario.complianceScore - baseline.complianceScore),
    probabilityPct: round(scenario.probabilityPct - baseline.probabilityPct),
  };
}

export function buildSimulationReport(s: StrategyState): SimulationReport {
  const base = baselineProjection(s);
  const baseline: SimulationScenario = {
    id: 'baseline',
    name: 'Baseline (status quo)',
    description: 'Current trajectory with no strategic intervention.',
    focus: 'baseline',
    projected: base,
    deltaVsBaseline: deltaOf(base, base),
    evidence: ['strategy:baseline'],
    applied: false,
  };

  // Deterministic scenario transforms — fixed formulas from the baseline, no randomness.
  const costFocus: ScenarioProjection = {
    costUsd: round(base.costUsd * 0.8),
    riskScore: Math.min(100, round(base.riskScore + 5)),
    timeDays: round(base.timeDays + 15),
    resourceUtilizationPct: Math.min(100, round(base.resourceUtilizationPct + 12)),
    complianceScore: base.complianceScore,
    probabilityPct: Math.max(0, round(base.probabilityPct - 5)),
  };
  const capacityFocus: ScenarioProjection = {
    costUsd: round(base.costUsd * 1.2),
    riskScore: Math.max(0, round(base.riskScore - 12)),
    timeDays: Math.max(1, round(base.timeDays - 12)),
    resourceUtilizationPct: Math.max(0, round(base.resourceUtilizationPct - 8)),
    complianceScore: base.complianceScore,
    probabilityPct: Math.min(100, round(base.probabilityPct + 8)),
  };
  const riskFocus: ScenarioProjection = {
    costUsd: round(base.costUsd * 1.08),
    riskScore: Math.max(0, round(base.riskScore - 20)),
    timeDays: round(base.timeDays + 5),
    resourceUtilizationPct: base.resourceUtilizationPct,
    complianceScore: Math.min(100, round(base.complianceScore + 8)),
    probabilityPct: Math.min(100, round(base.probabilityPct + 4)),
  };

  const scenarios: SimulationScenario[] = [
    { id: 'scenario-cost', name: 'A — Cost optimization', description: 'Right-size capacity and cut discretionary spend.', focus: 'budget', projected: costFocus, deltaVsBaseline: deltaOf(costFocus, base), evidence: ['strategy:cloud', 'strategy:capacity'], applied: false },
    { id: 'scenario-capacity', name: 'B — Capacity scale-up', description: 'Add capacity/workers to reduce risk and delivery time.', focus: 'cloud', projected: capacityFocus, deltaVsBaseline: deltaOf(capacityFocus, base), evidence: ['strategy:cloud', 'strategy:workforce'], applied: false },
    { id: 'scenario-risk', name: 'C — Risk reduction', description: 'Invest in resilience and compliance to cut risk.', focus: 'workforce', projected: riskFocus, deltaVsBaseline: deltaOf(riskFocus, base), evidence: ['strategy:risk', 'strategy:compliance'], applied: false },
  ];

  const all = [baseline, ...scenarios];
  const minMetrics: (keyof ScenarioProjection)[] = ['costUsd', 'riskScore', 'timeDays'];
  const maxMetrics: (keyof ScenarioProjection)[] = ['resourceUtilizationPct', 'complianceScore', 'probabilityPct'];
  const labelOf: Record<keyof ScenarioProjection, string> = {
    costUsd: 'Lowest cost',
    riskScore: 'Lowest risk',
    timeDays: 'Fastest',
    resourceUtilizationPct: 'Best utilization',
    complianceScore: 'Best compliance',
    probabilityPct: 'Highest confidence',
  };
  const comparison = [
    ...minMetrics.map((metric) => {
      const best = all.reduce((b, sc) => (sc.projected[metric] < b.projected[metric] ? sc : b));
      return { metric, label: labelOf[metric], bestScenarioId: best.id, bestValue: best.projected[metric] };
    }),
    ...maxMetrics.map((metric) => {
      const best = all.reduce((b, sc) => (sc.projected[metric] > b.projected[metric] ? sc : b));
      return { metric, label: labelOf[metric], bestScenarioId: best.id, bestValue: best.projected[metric] };
    }),
  ];

  return {
    baseline,
    scenarios,
    comparison,
    note: 'Simulations are deterministic what-if projections. Results are advisory only and are NEVER applied or executed automatically.',
  };
}

/* ── Decision queue (advisory candidates; approval-aware; never auto-executed) ── */

const PRIORITY_RANK: Record<StrategyPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function buildDecisionQueue(s: StrategyState): DecisionQueue {
  const decisions: StrategicDecision[] = [];

  // Top risk → mitigation decision.
  const topRisk = s.risk.topRisks[0];
  if (topRisk) {
    const action = 'mitigate_risk';
    decisions.push({
      id: `decision-risk-${topRisk.id}`,
      title: `Mitigate elevated risk: ${topRisk.label}`,
      category: 'security',
      recommendation: `Prioritize remediation of ${topRisk.label} to lower the enterprise risk index.`,
      rationale: topRisk.reason,
      tradeOffs: ['Diverts workforce capacity from growth work', 'May require short-term spend on remediation'],
      confidence: round2(s.risk.confidence),
      evidence: [topRisk.id, 'risk:overall'],
      requiredApprovals: [approvalFor(action, s.approvalChains)],
      expectedImpact: { metric: 'enterprise risk index', direction: 'decrease', magnitude: Math.min(20, round(topRisk.risk / 5)), unit: 'index' },
      priority: priorityFromScore(topRisk.risk),
      status: 'candidate',
      sourceSystems: ['Enterprise Intelligence', 'AI Workforce', 'Governance'],
    });
  }

  // Top optimization → decision.
  const opt = buildOptimizationEngine(s).opportunities[0];
  if (opt) {
    decisions.push({
      id: `decision-opt-${opt.id}`,
      title: opt.title,
      category: opt.area === 'cloud' || opt.area === 'budget' || opt.area === 'resource' ? 'financial' : opt.area === 'workforce' ? 'workforce' : 'operational',
      recommendation: opt.detail,
      rationale: `Optimization opportunity in ${opt.area}; estimated benefit ${opt.potentialSavingUsd > 0 ? `${s.cloud.currency} ${opt.potentialSavingUsd}/mo` : 'operational'}.`,
      tradeOffs: ['Requires change-window and approval', 'Benefit is an estimate, not a guarantee'],
      confidence: round2(opt.confidence),
      evidence: opt.evidence,
      requiredApprovals: [opt.requiredApproval],
      expectedImpact: opt.potentialSavingUsd > 0 ? { metric: 'monthly spend', direction: 'decrease', magnitude: opt.potentialSavingUsd, unit: s.cloud.currency } : { metric: opt.unit, direction: 'increase', magnitude: 0, unit: opt.unit },
      priority: opt.priority,
      status: 'candidate',
      sourceSystems: ['Cloud Control Plane', 'AI Workforce', 'Governance'],
    });
  }

  // Most off-track goal → decision.
  const offTrack = buildGoalManager(s).goals.filter((g) => g.status === 'off_track').sort((a, b) => a.progress - b.progress)[0];
  if (offTrack) {
    const action = PLAN_ACTION_BY_CATEGORY[offTrack.category];
    const dir = GOAL_DIRECTION[offTrack.id] ?? 'up';
    decisions.push({
      id: `decision-goal-${offTrack.id}`,
      title: `Recover off-track goal: ${offTrack.name}`,
      category: offTrack.category,
      recommendation: `Invest to move "${offTrack.name}" toward ${offTrack.successMetric}.`,
      rationale: `Goal is at ${Math.round(offTrack.progress * 100)}% attainment (off track).`,
      tradeOffs: ['Competes with other strategic goals for resources'],
      confidence: 0.7,
      evidence: offTrack.evidence,
      requiredApprovals: [approvalFor(action, s.approvalChains)],
      // Impact direction follows the goal's improvement direction (down-goals improve by decreasing).
      expectedImpact: { metric: offTrack.name, direction: dir === 'down' ? 'decrease' : 'increase', magnitude: Math.abs(offTrack.target - offTrack.current), unit: offTrack.unit },
      priority: 'high',
      status: 'candidate',
      sourceSystems: ['Enterprise Intelligence', 'Industry Platform', 'Governance'],
    });
  }

  const priorities: StrategyPriority[] = ['critical', 'high', 'medium', 'low'];
  const byPriority = priorities.map((priority) => ({ priority, count: decisions.filter((d) => d.priority === priority).length })).filter((p) => p.count > 0);
  decisions.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.confidence - a.confidence);
  // Every candidate is approval-gated before execution (governed by a chain, or flagged ungoverned).
  const requiresApprovalCount = decisions.filter((d) => d.requiredApprovals.length > 0).length;
  return {
    decisions,
    byPriority,
    count: decisions.length,
    requiresApprovalCount,
    note: 'These are advisory decision candidates. P14 never advances, approves, or executes a decision. Disposition and execution flow through the existing approval chains and the decision-execution handoff, under their own RBAC.',
  };
}

/* ── Cross-org collaboration (gated by real federation trust policy) ── */

export function buildCollaboration(s: StrategyState): CollaborationPeer[] {
  return s.collaboration.map((c) => ({
    peerOrg: c.peerOrg,
    peerOrgName: c.peerOrgName,
    trustLevel: c.trustLevel,
    decision: c.decision,
    allowed: c.decision === 'allow',
    reason: c.reason,
  }));
}

/* ── Strategic KPIs (reuse ExecutiveKpi) ── */

function kpiBand(pct: number): 'healthy' | 'watch' | 'at-risk' | 'critical' {
  return pct >= 75 ? 'healthy' : pct >= 50 ? 'watch' : pct >= 25 ? 'at-risk' : 'critical';
}

export function buildStrategyKpis(s: StrategyState): ExecutiveKpi[] {
  const goals = buildGoalManager(s);
  const opt = buildOptimizationEngine(s);
  const decisions = buildDecisionQueue(s);
  const onTrackPct = goals.goals.length > 0 ? round((goals.onTrack / goals.goals.length) * 100) : 0;
  return [
    { key: 'strategy.goals.onTrack', label: 'Goals on track', value: onTrackPct, display: `${goals.onTrack}/${goals.goals.length}`, band: kpiBand(onTrackPct) },
    { key: 'strategy.goals.progress', label: 'Overall goal progress', value: round(goals.overallProgress * 100), display: `${round(goals.overallProgress * 100)}%`, band: kpiBand(round(goals.overallProgress * 100)) },
    { key: 'strategy.health', label: 'Enterprise health', value: round(s.health.overall), display: `${round(s.health.overall)}/100`, band: goodnessBand(s.health.overall) },
    { key: 'strategy.risk', label: 'Enterprise risk', value: round(s.risk.overall), display: `${round(s.risk.overall)}/100`, band: badnessBand(s.risk.overall) },
    { key: 'strategy.optimization', label: 'Optimization opportunities', value: null, display: `${opt.count}`, trend: 'flat' },
    { key: 'strategy.savings', label: 'Potential monthly savings', value: null, display: `${s.cloud.currency} ${opt.totalPotentialSavingUsd}`, trend: 'flat' },
    { key: 'strategy.decisions', label: 'Open decisions', value: null, display: `${decisions.count}`, trend: 'flat' },
  ];
}

/* ── Overview bundle ── */

export function buildStrategySummary(s: StrategyState): StrategySummary {
  const goals = buildGoalManager(s);
  const opt = buildOptimizationEngine(s);
  const decisions = buildDecisionQueue(s);
  const planning = buildPlanningEngine(s);
  const collaboration = buildCollaboration(s);
  return {
    generatedAt: s.generatedAt,
    overallHealth: round(s.health.overall),
    healthBand: s.health.band,
    overallRisk: round(s.risk.overall),
    riskBand: s.risk.band,
    goalsOnTrack: goals.onTrack,
    goalsTotal: goals.goals.length,
    overallProgress: goals.overallProgress,
    openDecisions: decisions.count,
    decisionsRequiringApproval: decisions.requiresApprovalCount,
    optimizationOpportunities: opt.count,
    potentialSavingUsd: opt.totalPotentialSavingUsd,
    horizonsPlanned: planning.horizons.filter((h) => h.goalIds.length > 0).length,
    collaborationPeers: collaboration.length,
  };
}

export function buildStrategyOverview(s: StrategyState): StrategyOverview {
  return {
    summary: buildStrategySummary(s),
    goals: buildGoalManager(s),
    planning: buildPlanningEngine(s),
    reasoning: buildReasoningReport(s),
    optimization: buildOptimizationEngine(s),
    simulation: buildSimulationReport(s),
    decisions: buildDecisionQueue(s),
    recommendations: s.recommendations,
    collaboration: buildCollaboration(s),
    kpis: buildStrategyKpis(s),
  };
}

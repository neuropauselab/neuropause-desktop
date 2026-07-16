/**
 * Autonomous Enterprise Intelligence (P14) — strategic view-model types.
 *
 * P14 is a READ-ONLY strategic reasoning/projection LAYER over the existing platform. It composes
 * the already-computed Enterprise Intelligence report (health/risk/dependencies/capacity/incidents/
 * recommendations/KPIs), the Cloud Control Plane, the AI Workforce, Connectors, the Marketplace, the
 * Industry Platform, Federation trust, and Governance approval chains into: a Goal Manager, a
 * long-horizon Planning Engine, a Reasoning Engine, an Optimization Engine, a deterministic
 * Simulation Engine, and an advisory Decision queue. It introduces NO new AI/worker/graph/memory/
 * connector/marketplace/search/governance/execution runtime. Every output is advisory,
 * evidence-backed, approval-aware, and NEVER auto-executed — dispositioning and execution flow
 * through the EXISTING approval + decision-execution-handoff systems, which P14 references, not
 * replaces. It reuses the platform's `IntelRecommendation`, `ExecutiveKpi`, `ApprovalTrigger`, and
 * `Band` types rather than forking them.
 */
import type { ApprovalTrigger } from './enterprise';
import type { ExecutiveKpi } from './executiveCenter';
import type { IntelRecommendation } from '../intelligence/enterpriseRecommendation';

/** Health/risk band, mirrored locally so the strategy layer needn't import an internal (unexported) type. */
export type StrategyBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/** Strategic planning horizons. */
export type StrategyHorizon = '30d' | '90d' | '180d' | '365d' | 'multi_year';

export const STRATEGY_HORIZONS: readonly StrategyHorizon[] = ['30d', '90d', '180d', '365d', 'multi_year'] as const;

/** Goal/objective progress band. */
export type StrategyStatus = 'on_track' | 'at_risk' | 'off_track';

/** The strategic domains enterprise goals fall into. */
export type GoalCategory =
  | 'financial'
  | 'operational'
  | 'security'
  | 'growth'
  | 'compliance'
  | 'workforce'
  | 'infrastructure';

/* ── Goals & objectives ── */

export interface StrategicObjective {
  id: string;
  label: string;
  /** Human metric this objective tracks (from a real platform signal). */
  metric: string;
  target: number;
  current: number;
  unit: string;
  /** 0..1 attainment toward target (direction-aware). */
  progress: number;
  status: StrategyStatus;
}

export interface StrategyMilestone {
  id: string;
  label: string;
  horizon: StrategyHorizon;
  status: StrategyStatus;
}

export interface StrategicGoal {
  id: string;
  category: GoalCategory;
  name: string;
  description: string;
  horizon: StrategyHorizon;
  /** The headline success metric (human string, e.g. "Enterprise risk < 40"). */
  successMetric: string;
  target: number;
  current: number;
  unit: string;
  progress: number;
  status: StrategyStatus;
  objectives: StrategicObjective[];
  /** ids of other goals this goal depends on. */
  dependencies: string[];
  milestones: StrategyMilestone[];
  /** real platform ids / signal keys backing the current value. */
  evidence: string[];
}

export interface GoalManager {
  goals: StrategicGoal[];
  byCategory: { category: GoalCategory; count: number }[];
  onTrack: number;
  atRisk: number;
  offTrack: number;
  /** mean goal progress (0..1). */
  overallProgress: number;
}

/* ── Approval awareness (references the EXISTING governance approval chains) ── */

export interface StrategyApprovalRequirement {
  /** The governance trigger category the recommended action maps to. */
  trigger: ApprovalTrigger;
  /** Whether an enabled approval chain currently governs this trigger. */
  governed: boolean;
  /** The governing chain's name, or null when no enabled chain covers the trigger. */
  chainName: string | null;
  /**
   * Number of approval steps in the governing chain (0 when ungoverned). Only the step COUNT is
   * surfaced — the exact approver role graph is a governance internal kept behind `governance:read`.
   */
  steps: number;
  note: string;
}

/* ── Long-horizon planning ── */

export interface PlanStep {
  id: string;
  label: string;
  /** The action-kind this step would perform (advisory; never executed by P14). */
  action: string;
  requiredApproval: StrategyApprovalRequirement;
  evidence: string[];
}

export interface PlanHorizon {
  horizon: StrategyHorizon;
  /** ids of the goals due within this horizon. */
  goalIds: string[];
  milestones: StrategyMilestone[];
  steps: PlanStep[];
  summary: string;
}

export interface PlanningEngine {
  horizons: PlanHorizon[];
  totalGoals: number;
  totalMilestones: number;
  totalSteps: number;
}

/* ── Reasoning ── */

export type ReasoningDimension = 'dependencies' | 'risks' | 'resources' | 'costs' | 'compliance' | 'performance';

export interface ReasoningFinding {
  dimension: ReasoningDimension;
  title: string;
  detail: string;
  severity: StrategyBand;
  confidence: number;
  evidence: string[];
}

export interface ReasoningReport {
  findings: ReasoningFinding[];
  byDimension: { dimension: ReasoningDimension; count: number }[];
  /** dimensions ordered by resolved priority (most pressing first). */
  priorityOrder: ReasoningDimension[];
  confidence: number;
}

/* ── Optimization ── */

export type OptimizationArea = 'resource' | 'budget' | 'cloud' | 'workforce' | 'connector' | 'workflow' | 'execution';

export type StrategyPriority = 'critical' | 'high' | 'medium' | 'low';

export interface OptimizationOpportunity {
  id: string;
  area: OptimizationArea;
  title: string;
  detail: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  /** Estimated monthly USD saving (0 when the gain is non-monetary). */
  potentialSavingUsd: number;
  confidence: number;
  evidence: string[];
  recommendedAction: string;
  requiredApproval: StrategyApprovalRequirement;
  priority: StrategyPriority;
}

export interface OptimizationEngine {
  opportunities: OptimizationOpportunity[];
  byArea: { area: OptimizationArea; count: number }[];
  totalPotentialSavingUsd: number;
  count: number;
}

/* ── Simulation (deterministic what-if; NEVER auto-applied) ── */

export interface ScenarioProjection {
  costUsd: number;
  riskScore: number;
  timeDays: number;
  resourceUtilizationPct: number;
  complianceScore: number;
  probabilityPct: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  focus: OptimizationArea | 'baseline';
  projected: ScenarioProjection;
  /** Signed deltas vs the baseline (0 for the baseline itself). */
  deltaVsBaseline: ScenarioProjection;
  evidence: string[];
  /** Always false — simulation outcomes are advisory and never executed by P14. */
  applied: false;
}

export interface ScenarioComparison {
  metric: keyof ScenarioProjection;
  label: string;
  bestScenarioId: string;
  bestValue: number;
}

export interface SimulationReport {
  baseline: SimulationScenario;
  scenarios: SimulationScenario[];
  comparison: ScenarioComparison[];
  /** Safety note surfaced in the UI. */
  note: string;
}

/* ── Decision queue (advisory candidates; approval-aware; never auto-executed) ── */

export interface ExpectedImpact {
  metric: string;
  direction: 'increase' | 'decrease';
  magnitude: number;
  unit: string;
}

export interface StrategicDecision {
  id: string;
  title: string;
  category: GoalCategory;
  recommendation: string;
  rationale: string;
  tradeOffs: string[];
  confidence: number;
  evidence: string[];
  requiredApprovals: StrategyApprovalRequirement[];
  expectedImpact: ExpectedImpact;
  priority: StrategyPriority;
  /** Always 'candidate' — P14 never advances or executes a decision autonomously. */
  status: 'candidate';
  /** The existing platform systems this decision draws on. */
  sourceSystems: string[];
}

export interface DecisionQueue {
  decisions: StrategicDecision[];
  byPriority: { priority: StrategyPriority; count: number }[];
  count: number;
  requiresApprovalCount: number;
  /** Safety note surfaced in the UI. */
  note: string;
}

/* ── Cross-org collaboration (gated by real federation trust policy) ── */

export interface CollaborationPeer {
  peerOrg: string;
  peerOrgName: string;
  trustLevel: string;
  /** The federation policy decision for strategic collaboration. */
  decision: 'allow' | 'deny' | 'require_approval';
  allowed: boolean;
  reason: string;
}

/* ── Overview bundle ── */

export interface StrategySummary {
  generatedAt: string;
  overallHealth: number;
  healthBand: StrategyBand;
  overallRisk: number;
  riskBand: StrategyBand;
  goalsOnTrack: number;
  goalsTotal: number;
  overallProgress: number;
  openDecisions: number;
  decisionsRequiringApproval: number;
  optimizationOpportunities: number;
  potentialSavingUsd: number;
  horizonsPlanned: number;
  collaborationPeers: number;
}

export interface StrategyOverview {
  summary: StrategySummary;
  goals: GoalManager;
  planning: PlanningEngine;
  reasoning: ReasoningReport;
  optimization: OptimizationEngine;
  simulation: SimulationReport;
  decisions: DecisionQueue;
  /** Reused, unmodified P7 intelligence recommendations surfaced strategically. */
  recommendations: IntelRecommendation[];
  collaboration: CollaborationPeer[];
  /** Strategic success metrics, reusing the platform ExecutiveKpi type. */
  kpis: ExecutiveKpi[];
}

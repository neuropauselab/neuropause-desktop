/**
 * P19 — Autonomous Enterprise Operations: the view-model types for the closed-loop operations LAYER.
 *
 * This layer OBSERVES, RECOMMENDS, PLANS, and COORDINATES enterprise operations over the EXISTING
 * ExecuteEngine, Workforce Runtime, Approval Engine, Knowledge Fabric, Digital Twin, Cloud Control Plane,
 * Global Orchestration, and Enterprise Intelligence Network — it introduces NO new runtime, execution
 * engine, or governance. Every operation it proposes is ADVISORY: it exposes Reason, Evidence, Risk,
 * Expected Outcome, Rollback Plan, and Required Approvals, and is marked auto-executable ONLY when an
 * existing approval policy explicitly permits it (the default is always approval-required). Nothing here
 * executes; execution continues to flow through the existing runtime, gated by the existing approvals.
 */
import type { ExecutiveKpi } from './executiveCenter';

export type OpsBand = 'healthy' | 'watch' | 'at-risk' | 'critical';
export type OpsRisk = 'low' | 'medium' | 'high' | 'critical';

/* ── Approval-awareness (every operation carries this) ── */

export interface OpsApprovalRequirement {
  /** ApprovalTrigger (workforce_side_effect / spend / data_export / …) or 'policy'. */
  trigger: string;
  /** Whether an enterprise approval chain governs this trigger. */
  governed: boolean;
  /** The governing chain name, when one applies. */
  chainName: string | null;
  /** Number of approval steps in the chain (0 when ungoverned). */
  steps: number;
}

/* ── Autonomous Operations: the generated operational plans ── */

export type PlanCategory = 'execution' | 'recovery' | 'optimization' | 'maintenance' | 'capacity' | 'operational';
export type PlanApprovalStatus = 'candidate' | 'awaiting_approval' | 'approved' | 'rejected';

/**
 * A single generated operational plan. It NEVER executes on its own: `autoExecutable` is true only when an
 * existing policy explicitly permits autonomous execution; otherwise the plan waits on `requiredApprovals`.
 */
export interface OperationalPlan {
  id: string;
  category: PlanCategory;
  title: string;
  /** WHY this operation is proposed. */
  reason: string;
  /** Evidence-ref KINDS backing the plan (never raw entity ids) + a count. */
  evidenceKinds: string[];
  evidenceCount: number;
  risk: OpsRisk;
  /** WHAT is expected to change if the plan is approved and executed. */
  expectedOutcome: string;
  /** HOW to revert (advisory — synthesized per category; no first-class rollback record exists upstream). */
  rollbackPlan: string;
  requiredApprovals: OpsApprovalRequirement[];
  /** 0..1 model confidence in the recommendation. */
  confidence: number;
  band: OpsBand;
  /** Auto-executable ONLY when an existing policy explicitly permits; default false. */
  autoExecutable: boolean;
  approvalStatus: PlanApprovalStatus;
  /** Originating platform systems (provenance). */
  sources: string[];
}

export interface AutoOpsPlans {
  plans: OperationalPlan[];
  byCategory: { category: PlanCategory; count: number }[];
  autoExecutableCount: number;
  approvalRequiredCount: number;
  note: string;
}

/* ── Execution Coordinator (observes the existing ExecuteEngine + Workforce jobs) ── */

export interface OpsExecutionRow {
  id: string;
  label: string;
  kind: string;
  state: string;
  band: OpsBand;
  worker: string | null;
  awaitingApproval: boolean;
  correlationId: string | null;
  startedAt: string | null;
  durationMs: number | null;
}

export interface AutoOpsExecution {
  active: OpsExecutionRow[];
  awaitingApproval: OpsExecutionRow[];
  recentHistory: OpsExecutionRow[];
  activeCount: number;
  awaitingCount: number;
  /** 0..1 success rate over recent executions, or null when none. */
  successRate: number | null;
  throughput: number;
  band: OpsBand;
  note: string;
}

/* ── Recovery Manager (recommends over the existing recovery mechanisms) ── */

export type OpsRecoveryKind = 'rollback' | 'retry' | 'failover' | 'escalation' | 'alternative';

export interface OpsRecoveryRecommendation {
  id: string;
  kind: OpsRecoveryKind;
  target: string;
  reason: string;
  risk: OpsRisk;
  rollbackPlan: string;
  requiredApprovals: OpsApprovalRequirement[];
  autoExecutable: boolean;
  confidence: number;
  band: OpsBand;
  sources: string[];
}

export interface SupervisorRecoveryRow {
  subsystem: string;
  reason: string;
  ok: boolean;
  at: string;
  durationMs: number;
}

export interface AutoOpsRecovery {
  recommendations: OpsRecoveryRecommendation[];
  supervisorRecoveries: SupervisorRecoveryRow[];
  escalations: string[];
  recoveryCount: number;
  recentFailures: number;
  band: OpsBand;
  note: string;
}

/* ── Optimization Manager (projects the existing Strategy optimization + capacity) ── */

export interface OptimizationRow {
  id: string;
  area: string;
  title: string;
  detail: string;
  potentialSavingUsd: number;
  confidence: number;
  band: OpsBand;
  risk: OpsRisk;
  requiredApprovals: OpsApprovalRequirement[];
  autoExecutable: boolean;
  evidenceKinds: string[];
  recommendedAction: string;
}

export interface AutoOpsOptimization {
  opportunities: OptimizationRow[];
  byArea: { area: string; count: number }[];
  totalPotentialSavingUsd: number;
  count: number;
  band: OpsBand;
  note: string;
}

/* ── Incident Manager (projects the existing P7 incident/root-cause report) ── */

export interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  band: OpsBand;
  blastRadius: number;
  confidence: number;
  rootCause: string | null;
  recommendedActions: string[];
  open: boolean;
}

export interface AutoOpsIncidents {
  incidents: IncidentRow[];
  open: number;
  critical: number;
  total: number;
  band: OpsBand;
  note: string;
}

/* ── Approval Coordinator (projects the existing approval surfaces; never resolves them) ── */

export interface PendingApprovalRow {
  id: string;
  source: 'workforce' | 'federation' | 'enterprise' | 'strategy';
  title: string;
  risk: OpsRisk;
  band: OpsBand;
  requestedBy: string | null;
  status: string;
  requiredApprovals: OpsApprovalRequirement[];
}

export interface ApprovalChainRow {
  name: string;
  appliesTo: string;
  steps: number;
  enabled: boolean;
}

export interface AutoOpsApprovals {
  pending: PendingApprovalRow[];
  chains: ApprovalChainRow[];
  pendingCount: number;
  bySource: { source: string; count: number }[];
  autoExecutablePlans: number;
  approvalRequiredPlans: number;
  band: OpsBand;
  note: string;
}

/* ── Monitoring (continuous observation across every operational dimension) ── */

export type MonitorDimension = 'execution' | 'health' | 'capacity' | 'costs' | 'security' | 'compliance' | 'sla';

export interface MonitorSignal {
  dimension: MonitorDimension;
  label: string;
  /** 0..100 normalized band value. */
  value: number;
  display: string;
  band: OpsBand;
  detail: string;
  source: string;
}

export interface AutoOpsMonitoring {
  signals: MonitorSignal[];
  healthyCount: number;
  watchCount: number;
  atRiskCount: number;
  criticalCount: number;
  overall: number;
  overallBand: OpsBand;
  note: string;
}

/* ── Operational Analytics ── */

export interface OpsMetric {
  key: string;
  label: string;
  value: number;
  display: string;
  band: OpsBand;
}

export interface AutoOpsAnalytics {
  metrics: OpsMetric[];
  planCount: number;
  recoveryCount: number;
  optimizationCount: number;
  incidentCount: number;
  approvalRequired: number;
  autoExecutable: number;
  note: string;
}

/* ── Security / governance posture ── */

export interface OpsScopeRow {
  system: string;
  permission: string;
}

export interface AutoOpsGovernance {
  opsScope: string;
  neverBypass: string;
  autoExecutionPolicy: string;
  scopes: OpsScopeRow[];
  auditSources: string[];
  redactions: string[];
  approvalIntegration: string;
  note: string;
}

/* ── Modules + summary + overview ── */

export interface OpsModuleStatus {
  id: string;
  name: string;
  coordinates: string;
  entityCount: number;
  band: OpsBand;
  live: boolean;
  source: string;
  note: string;
}

export interface AutoOpsSummary {
  generatedAt: string;
  modules: number;
  liveModules: number;
  operationalPlans: number;
  autoExecutablePlans: number;
  approvalRequiredPlans: number;
  openIncidents: number;
  recoveryActions: number;
  optimizationOpportunities: number;
  pendingApprovals: number;
  overallHealth: number;
  healthBand: OpsBand;
}

export interface AutoOpsOverview {
  summary: AutoOpsSummary;
  modules: OpsModuleStatus[];
  kpis: ExecutiveKpi[];
}

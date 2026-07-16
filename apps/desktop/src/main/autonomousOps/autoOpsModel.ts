/**
 * Autonomous Enterprise Operations (P19) — the pure projection model.
 *
 * All non-trivial operations logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It projects a composed, sanitized snapshot of the EXISTING platform — the P7 report
 * (health/risk/capacity/incidents/recommendations), the ExecuteEngine + Workforce Runtime execution state,
 * the RuntimeSupervisor recovery signals, the P14 Strategy optimization, the P16 Knowledge Fabric
 * evidence, the Cloud Control Plane SLAs/costs, and the existing approval surfaces — into ADVISORY
 * operations VIEW MODELS: operational plans, execution coordination, recovery, optimization, incidents,
 * approval coordination, monitoring, analytics, and a governance/security posture.
 *
 * THE CARDINAL INVARIANT: nothing here executes, and no operation is ever marked auto-executable unless an
 * existing approval policy EXPLICITLY permits it AND no governing approval chain applies — the default is
 * always approval-required (`computeAutoExecutable`). Every plan exposes Reason, Evidence, Risk, Expected
 * Outcome, Rollback Plan, and Required Approvals. It introduces NO new runtime, execution engine, or
 * governance; the composition root injects read-only accessors and imports zero mutators.
 */
import type {
  AutoOpsAnalytics,
  AutoOpsApprovals,
  AutoOpsExecution,
  AutoOpsGovernance,
  AutoOpsIncidents,
  AutoOpsMonitoring,
  AutoOpsOptimization,
  AutoOpsOverview,
  AutoOpsPlans,
  AutoOpsRecovery,
  AutoOpsSummary,
  ApprovalChainRow,
  ExecutiveKpi,
  IncidentRow,
  MonitorDimension,
  MonitorSignal,
  OperationalPlan,
  OpsApprovalRequirement,
  OpsBand,
  OpsExecutionRow,
  OpsModuleStatus,
  OpsRisk,
  OptimizationRow,
  PendingApprovalRow,
  PlanApprovalStatus,
  PlanCategory,
  OpsRecoveryKind,
  OpsRecoveryRecommendation,
  SupervisorRecoveryRow,
} from '@neuropause/shared';

/* ── The composed, sanitized snapshot the projections read (assembled by the composition root) ── */

export interface PlanSeed {
  id: string;
  category: PlanCategory;
  title: string;
  reason: string;
  risk: OpsRisk;
  confidence: number;
  /** Evidence-ref KINDS only — never entity ids. */
  evidenceKinds: string[];
  evidenceCount: number;
  expectedOutcome: string;
  sources: string[];
  /** ApprovalTrigger the plan maps to (used to look up the governing chain + auto-exec policy). */
  approvalTrigger: string;
}

export interface ExecRowInput {
  id: string;
  label: string;
  kind: string;
  state: string;
  worker: string | null;
  awaitingApproval: boolean;
  correlationId: string | null;
  startedAt: string | null;
  durationMs: number | null;
  /** Terminal outcome for success-rate (null when non-terminal). */
  success: boolean | null;
}

export interface RecoverySeed {
  id: string;
  kind: OpsRecoveryKind;
  target: string;
  reason: string;
  risk: OpsRisk;
  confidence: number;
  sources: string[];
  approvalTrigger: string;
}

export interface OptSeed {
  id: string;
  area: string;
  title: string;
  detail: string;
  potentialSavingUsd: number;
  confidence: number;
  risk: OpsRisk;
  evidenceKinds: string[];
  recommendedAction: string;
  approvalTrigger: string;
}

export interface IncidentInput {
  id: string;
  title: string;
  severity: string;
  blastRadius: number;
  confidence: number;
  rootCause: string | null;
  recommendedActions: string[];
  open: boolean;
}

export interface PendingInput {
  id: string;
  source: PendingApprovalRow['source'];
  title: string;
  risk: OpsRisk;
  requestedBy: string | null;
  status: string;
  approvalTrigger: string;
}

export interface ChainInput {
  name: string;
  appliesTo: string;
  steps: number;
  enabled: boolean;
}

export interface MonitorInput {
  dimension: MonitorDimension;
  label: string;
  /** 0..100, normalized health-oriented (100 = good) so banding is uniform. */
  value: number;
  display: string;
  detail: string;
  source: string;
}

export interface AutoOpsState {
  generatedAt: string;
  health: { overall: number; band: OpsBand };
  planSeeds: PlanSeed[];
  execution: {
    active: ExecRowInput[];
    awaiting: ExecRowInput[];
    history: ExecRowInput[];
    total: number;
    completed: number;
    failed: number;
  };
  supervisorRecoveries: SupervisorRecoveryRow[];
  escalations: string[];
  recoveryCount: number;
  recentFailures: number;
  recoverySeeds: RecoverySeed[];
  optSeeds: OptSeed[];
  incidents: IncidentInput[];
  pendingApprovals: PendingInput[];
  chains: ChainInput[];
  monitorSignals: MonitorInput[];
  /** ApprovalTriggers an existing policy EXPLICITLY permits to auto-execute (else approval-required). */
  autoAllowedTriggers: string[];
  auditSources: string[];
  redactions: string[];
  kpis: ExecutiveKpi[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);
const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);
const clamp100 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 100 ? 100 : n);

/** Score (0..100) → band; the universal ≥75/≥50/≥25 cutoff shared across P13–P18. */
export function bandFor(score: number): OpsBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}
/** Confidence (0..1) → band. */
export function confBand(c: number): OpsBand {
  return c >= 0.75 ? 'healthy' : c >= 0.5 ? 'watch' : c >= 0.25 ? 'at-risk' : 'critical';
}
/** Risk → band (higher risk → worse band). */
export function riskBand(r: OpsRisk): OpsBand {
  return r === 'critical' ? 'critical' : r === 'high' ? 'at-risk' : r === 'medium' ? 'watch' : 'healthy';
}
/** Incident/event severity → band. */
export function severityBand(sev: string): OpsBand {
  const s = sev.toLowerCase();
  return s === 'critical' ? 'critical' : s === 'high' || s === 'warning' || s === 'warn' ? 'at-risk' : s === 'medium' ? 'watch' : 'healthy';
}

const ROLLBACK: Record<PlanCategory, string> = {
  execution: 'Cancel the in-flight execution; the ExecuteEngine marks interrupted sessions and never reruns them, restoring the prior job state.',
  recovery: 'Re-invoke the existing Recovery Center to restore the last verified backup or repair state — recovery actions are idempotent and re-runnable.',
  optimization: 'Revert the configuration/allocation change to the prior baseline captured before the optimization was applied.',
  maintenance: 'Reschedule or cancel the maintenance window and restore the prior service configuration.',
  capacity: 'Scale the resource back to its prior allocation; capacity changes are reversible through the same Cloud Control Plane control.',
  operational: 'Halt the operation and restore the prior state; the change is approval-gated and leaves an audit-trail entry for reversal.',
};

const RECOVERY_ROLLBACK: Record<OpsRecoveryKind, string> = {
  rollback: 'The rollback itself restores a prior verified state; re-run the Recovery Center if the restore is incomplete.',
  retry: 'A retry is non-destructive — abandon the retry to leave the last failed attempt untouched for inspection.',
  failover: 'Fail back to the primary once healthy; the existing failover mechanism is symmetric and reversible.',
  escalation: 'Escalation notifies an approver and performs no state change — no rollback required.',
  alternative: 'Discard the alternative plan and re-plan; the existing recovery planner preserves already-succeeded steps.',
};

/**
 * THE CARDINAL GUARD. An operation is auto-executable ONLY when an existing policy explicitly permits its
 * trigger AND no governing approval chain applies. The default (no explicit allow) is always false —
 * autonomous execution is never assumed. Governance always wins over an allow.
 */
export function computeAutoExecutable(
  trigger: string,
  requiredApprovals: OpsApprovalRequirement[],
  autoAllowedTriggers: string[],
): boolean {
  const explicitlyAllowed = autoAllowedTriggers.includes(trigger);
  const governed = requiredApprovals.some((r) => r.governed);
  return explicitlyAllowed && !governed;
}

/** Every operation exposes Required Approvals — the governing chain when one applies, else an ungoverned marker. */
export function requiredApprovalsFor(trigger: string, chains: ChainInput[]): OpsApprovalRequirement[] {
  const match = chains.find((c) => c.appliesTo === trigger && c.enabled);
  if (match) return [{ trigger, governed: true, chainName: match.name, steps: match.steps }];
  return [{ trigger, governed: false, chainName: null, steps: 0 }];
}

/** The enterprise approval triggers an auto-execution policy may name (the ApprovalTrigger vocabulary). */
export const OPS_APPROVAL_TRIGGERS = ['workforce_side_effect', 'governance_change', 'org_structure_change', 'spend', 'data_export'];

/**
 * Derive the triggers an EXISTING policy explicitly opts into autonomous execution for. Convention: an enabled
 * policy with effect 'allow' and action of the EXACT form `autonomous:<trigger>` names exactly that trigger,
 * validated against the known ApprovalTrigger vocabulary. This is precise (not a loose keyword match), so a
 * normal allow-policy can NEVER accidentally opt an operation into autonomous execution — the set is empty
 * unless a policy is deliberately authored to permit it. This is the explicit source of `autoAllowedTriggers`.
 */
export function deriveAutoAllowedTriggers(policies: { effect: string; enabled: boolean; action: string }[]): string[] {
  const allowed = new Set<string>();
  for (const p of policies) {
    if (!p.enabled || p.effect !== 'allow') continue;
    const m = /^autonomous:([a-z_]+)$/.exec(p.action.trim());
    if (m && OPS_APPROVAL_TRIGGERS.includes(m[1])) allowed.add(m[1]);
  }
  return [...allowed].sort();
}

/** An incident is open when its severity is not informational — matching the P7 IncidentReport.open count. */
export function isIncidentOpen(severity: string): boolean {
  return severity.toLowerCase() !== 'info';
}

const cleanKinds = (kinds: string[]): string[] => [...new Set(kinds.filter((k) => /^[a-z]+$/.test(k)))].sort();

/* ── Autonomous Operations: the generated operational plans ── */

export function buildOperationalPlan(seed: PlanSeed, state: AutoOpsState): OperationalPlan {
  const requiredApprovals = requiredApprovalsFor(seed.approvalTrigger, state.chains);
  const autoExecutable = computeAutoExecutable(seed.approvalTrigger, requiredApprovals, state.autoAllowedTriggers);
  return {
    id: seed.id,
    category: seed.category,
    title: seed.title,
    reason: seed.reason,
    evidenceKinds: cleanKinds(seed.evidenceKinds),
    evidenceCount: seed.evidenceCount,
    risk: seed.risk,
    expectedOutcome: seed.expectedOutcome,
    rollbackPlan: ROLLBACK[seed.category],
    requiredApprovals,
    confidence: Number(clamp01(seed.confidence).toFixed(2)),
    band: confBand(seed.confidence),
    // Advisory candidate always — plans never advance themselves (the P14 status:'candidate' invariant).
    approvalStatus: 'candidate' as PlanApprovalStatus,
    autoExecutable,
    sources: seed.sources,
  };
}

const RISK_RANK: Record<OpsRisk, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function buildAutoOpsPlans(state: AutoOpsState): AutoOpsPlans {
  const plans = state.planSeeds
    .map((s) => buildOperationalPlan(s, state))
    .sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const byCategoryMap = new Map<PlanCategory, number>();
  for (const p of plans) byCategoryMap.set(p.category, (byCategoryMap.get(p.category) ?? 0) + 1);
  return {
    plans,
    byCategory: [...byCategoryMap.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    autoExecutableCount: plans.filter((p) => p.autoExecutable).length,
    approvalRequiredCount: plans.filter((p) => !p.autoExecutable).length,
    note: 'Operational plans are ADVISORY projections over the existing intelligence — each exposes reason, evidence, risk, expected outcome, rollback plan, and required approvals. A plan is auto-executable ONLY when an existing policy explicitly permits its trigger and no approval chain governs it; the default is approval-required. Nothing executes here — execution flows through the existing ExecuteEngine + Workforce Runtime under the existing approvals.',
  };
}

/* ── Execution Coordinator ── */

function execRow(r: ExecRowInput): OpsExecutionRow {
  const failed = r.success === false || r.state === 'failed';
  const band: OpsBand = r.awaitingApproval ? 'watch' : failed ? 'critical' : r.success === true || r.state === 'completed' ? 'healthy' : 'watch';
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    state: r.state,
    band,
    worker: r.worker,
    awaitingApproval: r.awaitingApproval,
    correlationId: r.correlationId,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
  };
}

export function buildAutoOpsExecution(state: AutoOpsState): AutoOpsExecution {
  const e = state.execution;
  const active = e.active.map(execRow);
  const awaitingApproval = e.awaiting.map(execRow);
  const recentHistory = e.history.map(execRow).slice(0, 40);
  const terminal = e.completed + e.failed;
  const successRate = terminal > 0 ? Number((e.completed / terminal).toFixed(2)) : null;
  const band: OpsBand = successRate == null ? 'watch' : bandFor(successRate * 100);
  return {
    active,
    awaitingApproval,
    recentHistory,
    activeCount: active.length,
    awaitingCount: awaitingApproval.length,
    successRate,
    throughput: e.total,
    band,
    note: 'Execution coordination OBSERVES the existing ExecuteEngine sessions and Workforce jobs (active, awaiting-approval, recent history) — read-only. It never dispatches, approves, or cancels; those flow through the existing runtime under the existing approval gate.',
  };
}

/* ── Recovery Manager ── */

export function buildRecoveryRecommendation(seed: RecoverySeed, state: AutoOpsState): OpsRecoveryRecommendation {
  const requiredApprovals = requiredApprovalsFor(seed.approvalTrigger, state.chains);
  const autoExecutable = computeAutoExecutable(seed.approvalTrigger, requiredApprovals, state.autoAllowedTriggers);
  return {
    id: seed.id,
    kind: seed.kind,
    target: seed.target,
    reason: seed.reason,
    risk: seed.risk,
    rollbackPlan: RECOVERY_ROLLBACK[seed.kind],
    requiredApprovals,
    autoExecutable,
    confidence: Number(clamp01(seed.confidence).toFixed(2)),
    band: confBand(seed.confidence),
    sources: seed.sources,
  };
}

export function buildAutoOpsRecovery(state: AutoOpsState): AutoOpsRecovery {
  const recommendations = state.recoverySeeds
    .map((s) => buildRecoveryRecommendation(s, state))
    .sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const band: OpsBand = state.recentFailures >= 3 ? 'at-risk' : state.escalations.length > 0 ? 'watch' : 'healthy';
  return {
    recommendations,
    supervisorRecoveries: [...state.supervisorRecoveries].slice(0, 40),
    escalations: [...state.escalations].sort(),
    recoveryCount: state.recoveryCount,
    recentFailures: state.recentFailures,
    band,
    note: 'Recovery recommendations (rollback / retry / failover / escalation / alternative) are projected over the EXISTING recovery mechanisms — the RuntimeSupervisor, the Workforce retry/recovery planner, and the Recovery Center. Each carries its own rollback note and required approvals. The layer recommends; it never invokes recover(), retry, or failover itself.',
  };
}

/* ── Optimization Manager ── */

export function buildAutoOpsOptimization(state: AutoOpsState): AutoOpsOptimization {
  const opportunities: OptimizationRow[] = state.optSeeds
    .map((s) => {
      const requiredApprovals = requiredApprovalsFor(s.approvalTrigger, state.chains);
      return {
        id: s.id,
        area: s.area,
        title: s.title,
        detail: s.detail,
        potentialSavingUsd: round(s.potentialSavingUsd),
        confidence: Number(clamp01(s.confidence).toFixed(2)),
        band: confBand(s.confidence),
        risk: s.risk,
        requiredApprovals,
        autoExecutable: computeAutoExecutable(s.approvalTrigger, requiredApprovals, state.autoAllowedTriggers),
        evidenceKinds: cleanKinds(s.evidenceKinds),
        recommendedAction: s.recommendedAction,
      };
    })
    .sort((a, b) => b.potentialSavingUsd - a.potentialSavingUsd || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const byAreaMap = new Map<string, number>();
  for (const o of opportunities) byAreaMap.set(o.area, (byAreaMap.get(o.area) ?? 0) + 1);
  const totalPotentialSavingUsd = opportunities.reduce((n, o) => n + o.potentialSavingUsd, 0);
  return {
    opportunities,
    byArea: [...byAreaMap.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
    totalPotentialSavingUsd,
    count: opportunities.length,
    band: opportunities.length === 0 ? 'healthy' : bandFor(Math.min(100, opportunities.reduce((n, o) => n + o.confidence, 0) / opportunities.length * 100)),
    note: 'Optimization opportunities project the EXISTING P14 Strategy optimization engine and P7 capacity/cost recommendations — each an advisory action with potential saving, confidence, evidence, and required approvals. Applying any of them flows through the existing approval + execution path.',
  };
}

/* ── Incident Manager ── */

export function buildAutoOpsIncidents(state: AutoOpsState): AutoOpsIncidents {
  const incidents: IncidentRow[] = state.incidents
    .map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      band: severityBand(i.severity),
      blastRadius: round(i.blastRadius),
      confidence: Number(clamp01(i.confidence).toFixed(2)),
      rootCause: i.rootCause,
      recommendedActions: i.recommendedActions,
      open: i.open,
    }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.blastRadius - a.blastRadius || a.id.localeCompare(b.id));
  const open = incidents.filter((i) => i.open).length;
  const critical = incidents.filter((i) => i.band === 'critical').length;
  const band: OpsBand = critical > 0 ? 'critical' : open > 0 ? 'at-risk' : 'healthy';
  return {
    incidents,
    open,
    critical,
    total: incidents.length,
    band,
    note: 'Incidents project the EXISTING P7 incident/root-cause correlation — severity, blast radius, root cause, and the pre-computed recommended actions. The Incident Manager surfaces them for coordination; remediation flows through the existing recovery + approval path.',
  };
}

/* ── Approval Coordinator ── */

export function buildAutoOpsApprovals(state: AutoOpsState): AutoOpsApprovals {
  const pending: PendingApprovalRow[] = state.pendingApprovals
    .map((p) => ({
      id: p.id,
      source: p.source,
      title: p.title,
      risk: p.risk,
      band: riskBand(p.risk),
      requestedBy: p.requestedBy,
      status: p.status,
      requiredApprovals: requiredApprovalsFor(p.approvalTrigger, state.chains),
    }))
    .sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || a.id.localeCompare(b.id));
  const chains: ApprovalChainRow[] = [...state.chains]
    .map((c) => ({ name: c.name, appliesTo: c.appliesTo, steps: c.steps, enabled: c.enabled }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const bySourceMap = new Map<string, number>();
  for (const p of pending) bySourceMap.set(p.source, (bySourceMap.get(p.source) ?? 0) + 1);
  const plans = buildAutoOpsPlans(state);
  const band: OpsBand = pending.some((p) => p.risk === 'critical') ? 'at-risk' : pending.length > 0 ? 'watch' : 'healthy';
  return {
    pending,
    chains,
    pendingCount: pending.length,
    bySource: [...bySourceMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    autoExecutablePlans: plans.autoExecutableCount,
    approvalRequiredPlans: plans.approvalRequiredCount,
    band,
    note: 'The Approval Coordinator projects the EXISTING approval surfaces — workforce awaiting-approval jobs, federation delegated approvals, and enterprise approval chains — read-only. It never approves or rejects; it surfaces what is pending and which chains govern each operation so the existing approval engine remains the sole decision point.',
  };
}

/* ── Monitoring ── */

export function buildAutoOpsMonitoring(state: AutoOpsState): AutoOpsMonitoring {
  const signals: MonitorSignal[] = state.monitorSignals
    .map((m) => ({
      dimension: m.dimension,
      label: m.label,
      value: round(clamp100(m.value)),
      display: m.display,
      band: bandFor(clamp100(m.value)),
      detail: m.detail,
      source: m.source,
    }))
    .sort((a, b) => a.value - b.value || a.dimension.localeCompare(b.dimension));
  const healthyCount = signals.filter((s) => s.band === 'healthy').length;
  const watchCount = signals.filter((s) => s.band === 'watch').length;
  const atRiskCount = signals.filter((s) => s.band === 'at-risk').length;
  const criticalCount = signals.filter((s) => s.band === 'critical').length;
  const overall = signals.length ? round(signals.reduce((n, s) => n + s.value, 0) / signals.length) : 0;
  return {
    signals,
    healthyCount,
    watchCount,
    atRiskCount,
    criticalCount,
    overall,
    overallBand: signals.length ? bandFor(overall) : 'watch',
    note: 'Monitoring continuously OBSERVES every operational dimension — execution, health, capacity, costs, security, compliance, and SLAs — by reusing the existing read accessors (P7 health/risk/capacity, Cloud Control Plane deployments/regions/usage, Digital Twin, Orchestration). Every figure is an existing aggregate; the layer adds no new metrics engine.',
  };
}

/* ── Operational Analytics ── */

export function buildAutoOpsAnalytics(state: AutoOpsState): AutoOpsAnalytics {
  const plans = buildAutoOpsPlans(state);
  const exec = buildAutoOpsExecution(state);
  const opt = buildAutoOpsOptimization(state);
  const inc = buildAutoOpsIncidents(state);
  const mon = buildAutoOpsMonitoring(state);
  const metrics = [
    { key: 'execution.success', label: 'Execution success', value: exec.successRate == null ? 0 : round(exec.successRate * 100), display: exec.successRate == null ? 'n/a' : `${round(exec.successRate * 100)}%`, band: exec.successRate == null ? ('watch' as OpsBand) : bandFor(exec.successRate * 100) },
    { key: 'operations.health', label: 'Operational health', value: round(state.health.overall), display: `${round(state.health.overall)}/100`, band: state.health.band },
    { key: 'monitoring.overall', label: 'Monitoring index', value: mon.overall, display: `${mon.overall}/100`, band: mon.overallBand },
    { key: 'plans.autoexec', label: 'Auto-executable plans', value: plans.autoExecutableCount, display: `${plans.autoExecutableCount}/${plans.plans.length}`, band: 'healthy' as OpsBand },
    { key: 'incidents.open', label: 'Open incidents', value: inc.open, display: `${inc.open}`, band: inc.band },
  ];
  return {
    metrics,
    planCount: plans.plans.length,
    recoveryCount: state.recoverySeeds.length,
    optimizationCount: opt.count,
    incidentCount: inc.total,
    approvalRequired: plans.approvalRequiredCount,
    autoExecutable: plans.autoExecutableCount,
    note: 'Operational analytics aggregate the projected operations — plan volume, execution success, recovery/optimization/incident counts, and the approval split. Every figure derives from the existing read accessors; no raw records are combined.',
  };
}

/* ── Security / governance posture ── */

export function buildAutoOpsGovernance(state: AutoOpsState): AutoOpsGovernance {
  const plans = buildAutoOpsPlans(state);
  return {
    opsScope: 'autonomousops:read',
    neverBypass: 'No autonomous bypass. Every operation is advisory: it recommends, plans, and coordinates, but execution flows only through the existing ExecuteEngine + Workforce Runtime under the existing approval engine. The layer invokes no execute / dispatch / approve / recover / rollback operation — it reads and recommends only.',
    autoExecutionPolicy: `Auto-execution is never the default. An operation is auto-executable ONLY when an existing policy explicitly permits its trigger and no governing approval chain applies. Currently ${plans.autoExecutableCount} of ${plans.plans.length} projected plans are policy-permitted; the remaining ${plans.approvalRequiredCount} require approval.`,
    scopes: [
      { system: 'Execution (ExecuteEngine + Workforce jobs)', permission: 'workforce:operate' },
      { system: 'Incidents / health / capacity (P7)', permission: 'intelligence:read' },
      { system: 'Optimization (P14 Strategy)', permission: 'strategy:read' },
      { system: 'Costs / SLA (Cloud Control Plane)', permission: 'cloud:read' },
      { system: 'Evidence / lineage (P16 Knowledge Fabric)', permission: 'knowledge:read' },
      { system: 'Approvals + governance chains', permission: 'governance:read' },
    ].sort((a, b) => a.system.localeCompare(b.system)),
    auditSources: [...state.auditSources].sort(),
    redactions: [...state.redactions],
    approvalIntegration: 'Reuses the workforce governance verdict, the federation delegated-approval store, and the enterprise approval chains. Required approvals on every operation are derived from those chains; the layer never resolves an approval.',
    note: 'Operations governance reuses the existing RBAC, approval engine, timeline, and audit. All channels require autonomousops:read; each underlying source keeps its own production scope. The layer adds no new governance engine and performs no autonomous action.',
  };
}

/* ── Modules + summary + overview ── */

export function buildOpsModules(state: AutoOpsState): OpsModuleStatus[] {
  const plans = buildAutoOpsPlans(state);
  const exec = buildAutoOpsExecution(state);
  const rec = buildAutoOpsRecovery(state);
  const opt = buildAutoOpsOptimization(state);
  const inc = buildAutoOpsIncidents(state);
  const appr = buildAutoOpsApprovals(state);
  const mon = buildAutoOpsMonitoring(state);
  return [
    { id: 'execution-coordinator', name: 'Execution Coordinator', coordinates: 'Active + awaiting-approval executions', entityCount: exec.activeCount + exec.awaitingCount, band: exec.band, live: exec.activeCount + exec.awaitingCount > 0, source: 'ExecuteEngine + Workforce Runtime', note: 'Observes; never dispatches.' },
    { id: 'recovery-manager', name: 'Recovery Manager', coordinates: 'Rollback / retry / failover / escalation', entityCount: rec.recommendations.length, band: rec.band, live: rec.recommendations.length > 0 || rec.supervisorRecoveries.length > 0, source: 'RuntimeSupervisor + recovery planner', note: 'Recommends over existing recovery.' },
    { id: 'optimization-manager', name: 'Optimization Manager', coordinates: 'Cost / capacity / workflow', entityCount: opt.count, band: opt.band, live: opt.count > 0, source: 'P14 Strategy + P7 capacity', note: 'Advisory opportunities.' },
    { id: 'incident-manager', name: 'Incident Manager', coordinates: 'Open incidents + root cause', entityCount: inc.total, band: inc.band, live: inc.total > 0, source: 'P7 incident/root-cause', note: 'Surfaces; never remediates.' },
    { id: 'approval-coordinator', name: 'Approval Coordinator', coordinates: 'Pending approvals + chains', entityCount: appr.pendingCount, band: appr.band, live: appr.pendingCount > 0 || appr.chains.length > 0, source: 'Workforce + Federation + Enterprise', note: 'Never resolves approvals.' },
    { id: 'monitoring', name: 'Monitoring', coordinates: 'Execution / health / capacity / cost / SLA', entityCount: mon.signals.length, band: mon.overallBand, live: mon.signals.length > 0, source: 'P7 + Cloud + Twin + Orchestration', note: 'Reused read accessors.' },
    { id: 'operational-analytics', name: 'Operational Analytics', coordinates: 'Plans / success / approvals', entityCount: plans.plans.length, band: plans.plans.length > 0 ? 'healthy' : 'watch', live: plans.plans.length > 0, source: 'Aggregate projections', note: 'No raw records combined.' },
  ];
}

export function buildAutoOpsSummary(state: AutoOpsState): AutoOpsSummary {
  const modules = buildOpsModules(state);
  const plans = buildAutoOpsPlans(state);
  const inc = buildAutoOpsIncidents(state);
  const opt = buildAutoOpsOptimization(state);
  const appr = buildAutoOpsApprovals(state);
  return {
    generatedAt: state.generatedAt,
    modules: modules.length,
    liveModules: modules.filter((m) => m.live).length,
    operationalPlans: plans.plans.length,
    autoExecutablePlans: plans.autoExecutableCount,
    approvalRequiredPlans: plans.approvalRequiredCount,
    openIncidents: inc.open,
    recoveryActions: state.recoverySeeds.length,
    optimizationOpportunities: opt.count,
    pendingApprovals: appr.pendingCount,
    overallHealth: round(state.health.overall),
    healthBand: state.health.band,
  };
}

export function buildAutoOpsOverview(state: AutoOpsState): AutoOpsOverview {
  return {
    summary: buildAutoOpsSummary(state),
    modules: buildOpsModules(state),
    kpis: state.kpis,
  };
}

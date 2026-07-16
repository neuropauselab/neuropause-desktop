/**
 * P19 — Autonomous Enterprise Operations composition root.
 *
 * The closed-loop operations projection LAYER. It composes a READ-ONLY snapshot from the EXISTING signals —
 * the P7 intelligence report (health/risk/capacity/incidents/recommendations, injected), the ExecuteEngine
 * sessions + Workforce jobs/registry/audit (execution spine, injected + imported read singletons), the
 * RuntimeSupervisor recovery signals (injected), the P14 Strategy optimization (injected), the P16
 * Knowledge Fabric evidence (injected), the Cloud Control Plane SLAs/costs (injected), and the existing
 * approval surfaces (federation delegated approvals + enterprise approval chains, imported read singletons)
 * — into advisory operations projections behind RBAC-gated IPC (`autonomousops:read`).
 *
 * THE CARDINAL INVARIANT: no autonomous bypass. `buildState` reads only — it invokes no execute/dispatch/
 * approve/recover/rollback operation on any store or engine (only read accessors + change-listeners), so the
 * layer never acts on the enterprise. Every operation it projects
 * is advisory and carries reason/evidence/risk/expected-outcome/rollback/required-approvals; an operation
 * is auto-executable only when an existing policy explicitly permits it (the model's `computeAutoExecutable`
 * defaults to false). Execution continues to flow through the existing ExecuteEngine + Workforce Runtime
 * under the existing approval engine. It creates no new store/runtime and reuses `ecosystem:event` for
 * renderer liveness; every read is defensively wrapped so one failing source degrades rather than crashes.
 */
import {
  EmptyRequest,
  IpcChannel,
  type DeploymentStatusEntry,
  type EnterpriseIntelligenceReport,
  type EnterpriseTwinOverview,
  type ExecutionSession,
  type ExecutionStats,
  type FabricEvidenceReport,
  type OrchestrationOverview,
  type RecoveryRecord,
  type RegionStatus,
  type StrategyOverview,
  type SupervisorStatus,
  type UsageOverview,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { jobStore } from '../workforce/runtime/jobInstance';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { auditLog } from '../workforce/governance/auditInstance';
import { globalGovStore } from '../federation/governance/globalGovInstance';
import { governanceStore } from '../enterprise/governance/governanceInstance';
import { AutonomousOperationsService } from './autoOpsService';
import type {
  AutoOpsState,
  ChainInput,
  ExecRowInput,
  IncidentInput,
  MonitorInput,
  OptSeed,
  PendingInput,
  PlanSeed,
  RecoverySeed,
} from './autoOpsModel';
import { deriveAutoAllowedTriggers, isIncidentOpen } from './autoOpsModel';
import { withAutoOpsAuthz } from './autoOpsAuthz';

const log = createLogger('autonomous-operations');

export interface AutonomousOperationsDeps {
  enterpriseReport: () => EnterpriseIntelligenceReport;
  strategyOverview: () => StrategyOverview;
  twinOverview: () => EnterpriseTwinOverview;
  orchestrationOverview: () => OrchestrationOverview;
  /** P16 Knowledge Fabric — the evidence/lineage/confidence spine (injected accessor). */
  knowledgeEvidence: () => FabricEvidenceReport;
  /** Cloud Control Plane — costs / SLA / deployment health (injected accessors). */
  cloudUsage: () => UsageOverview;
  cloudDeployments: () => DeploymentStatusEntry[];
  cloudRegions: () => RegionStatus[];
  /** ExecuteEngine — read-only session/stat observation (injected; the engine is a runtimeCore local). */
  executionSessions: () => ExecutionSession[];
  executionHistory: () => ExecutionSession[];
  executionStats: () => ExecutionStats;
  /** RuntimeSupervisor — read-only recovery observation (injected; the supervisor is a runtimeCore local). */
  supervisorStatus: () => SupervisorStatus;
  supervisorHistory: () => RecoveryRecord[];
}

export interface AutonomousOperationsSubsystem {
  handlers: SecureHandlerDef[];
  service: AutonomousOperationsService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

type OpsRisk = PlanSeed['risk'];

/** RecoPriority and OpsRisk share a vocabulary; normalize to OpsRisk. */
function priorityRisk(p: string): OpsRisk {
  return p === 'critical' ? 'critical' : p === 'high' ? 'high' : p === 'medium' ? 'medium' : 'low';
}
/** Incident EventSeverity → OpsRisk. */
function severityRisk(sev: string): OpsRisk {
  return sev === 'critical' ? 'critical' : sev === 'warning' ? 'high' : sev === 'error' ? 'high' : 'low';
}

const clampPct = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 100 ? 100 : n);

/** Compose the sanitized operations snapshot from the EXISTING platform signals (no new store/runtime). */
function buildState(deps: AutonomousOperationsDeps): AutoOpsState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const report = safe(() => deps.enterpriseReport());
  const strategy = safe(() => deps.strategyOverview());
  const twin = safe(() => deps.twinOverview());
  const orchestration = safe(() => deps.orchestrationOverview());
  const evidence = safe(() => deps.knowledgeEvidence());
  const usage = safe(() => deps.cloudUsage());
  const deployments = safe(() => deps.cloudDeployments()) ?? [];
  const regions = safe(() => deps.cloudRegions()) ?? [];
  const execSessions = safe(() => deps.executionSessions()) ?? [];
  const execHistory = safe(() => deps.executionHistory()) ?? [];
  const execStats = safe(() => deps.executionStats());
  const supStatus = safe(() => deps.supervisorStatus());
  const supHistory = safe(() => deps.supervisorHistory()) ?? [];

  // Health — assume-worst when the intelligence report is unavailable (never falsely healthy).
  const health = report ? { overall: report.health.overall, band: report.health.band } : { overall: 0, band: 'critical' as const };
  const kpis = report?.kpis ?? strategy?.kpis ?? [];

  // ── Incidents (P7 root-cause correlation) — open matches the P7 criterion: severity !== 'info'. ──
  const rawIncidents = report?.incidents?.incidents ?? [];
  const incidents: IncidentInput[] = rawIncidents.slice(0, 40).map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    blastRadius: i.impact?.blastRadius ?? 0,
    confidence: i.confidence,
    rootCause: i.rootCause?.label ?? null,
    recommendedActions: i.recommendedActions ?? [],
    open: isIncidentOpen(i.severity),
  }));

  // ── Approval chains (enterprise governance) ──
  const chains: ChainInput[] = (safe(() => governanceStore.chains()) ?? []).map((c) => ({
    name: c.name,
    appliesTo: c.appliesTo,
    steps: c.steps?.length ?? 0,
    enabled: c.enabled,
  }));

  // ── Auto-execution allow-list: a trigger is auto-executable ONLY if an existing policy EXPLICITLY permits
  // autonomous execution for it (an enabled allow-policy with action `autonomous:<trigger>`). Precise by
  // construction — a normal allow-policy can never opt in — so this is empty unless deliberately authored. ──
  const autoAllowedTriggers = deriveAutoAllowedTriggers(safe(() => globalGovStore.listPolicies()) ?? []);

  // ── Plan seeds (Autonomous Operations generation) ──
  const planSeeds: PlanSeed[] = [];
  // Recovery-category plans from open incidents.
  for (const i of incidents.filter((x) => x.open).slice(0, 10)) {
    planSeeds.push({
      id: `plan:incident:${i.id}`,
      category: 'recovery',
      title: `Remediate incident: ${i.title}`,
      reason: i.rootCause ? `Root cause — ${i.rootCause}.` : 'Correlated incident requires remediation.',
      risk: severityRisk(i.severity),
      confidence: i.confidence,
      evidenceKinds: ['incident'],
      evidenceCount: 1,
      expectedOutcome: `Contain the incident and reduce its blast radius (${i.blastRadius} resource(s)).`,
      sources: ['Enterprise Intelligence', 'Knowledge Fabric'],
      approvalTrigger: 'workforce_side_effect',
    });
  }
  // Optimization-category plans from P14 strategy opportunities.
  const opps = strategy?.optimization?.opportunities ?? [];
  for (const o of opps.slice(0, 12)) {
    planSeeds.push({
      id: `plan:opt:${o.id}`,
      category: 'optimization',
      title: o.title,
      reason: o.detail,
      risk: priorityRisk(o.priority),
      confidence: o.confidence,
      evidenceKinds: ['optimization'],
      evidenceCount: o.evidence?.length ?? 0,
      expectedOutcome: o.potentialSavingUsd > 0 ? `Potential saving of $${Math.round(o.potentialSavingUsd)}.` : o.recommendedAction,
      sources: ['Strategy Platform', 'Knowledge Fabric'],
      approvalTrigger: o.requiredApproval?.trigger ?? 'spend',
    });
  }
  // Capacity-category plans from P7 capacity pressure.
  const pressure = (report?.capacity?.pressureNodes ?? []).filter((n) => n.pressure === 'high' || n.pressure === 'critical');
  for (const n of pressure.slice(0, 6)) {
    planSeeds.push({
      id: `plan:cap:${n.id}`,
      category: 'capacity',
      title: `Relieve capacity pressure: ${n.label}`,
      reason: `${n.utilization ?? '?'}% utilization — ${n.pressure} pressure.`,
      risk: n.pressure === 'critical' ? 'high' : 'medium',
      confidence: 0.8,
      evidenceKinds: ['capacity'],
      evidenceCount: 1,
      expectedOutcome: 'Restore healthy utilization headroom on the pressured resource.',
      sources: ['Enterprise Intelligence'],
      approvalTrigger: 'spend',
    });
  }
  // Operational-category plans from P7 recommendations.
  for (const r of (report?.recommendations ?? []).slice(0, 12)) {
    planSeeds.push({
      id: `plan:reco:${r.id}`,
      category: 'operational',
      title: r.title,
      reason: r.detail,
      risk: priorityRisk(r.priority),
      confidence: r.confidence,
      evidenceKinds: [r.category],
      evidenceCount: r.evidence?.length ?? 0,
      expectedOutcome: 'Address the flagged operational finding.',
      sources: ['Enterprise Intelligence', 'Knowledge Fabric'],
      approvalTrigger: r.category === 'security' ? 'governance_change' : 'workforce_side_effect',
    });
  }

  // ── Execution coordination (ExecuteEngine sessions + Workforce jobs) ──
  const sessionRow = (s: ExecutionSession): ExecRowInput => ({
    id: s.id,
    label: s.label,
    kind: s.kind,
    state: s.state,
    worker: null,
    awaitingApproval: s.state === 'waiting' || s.state === 'paused',
    correlationId: s.correlationId ?? null,
    startedAt: s.startedAt,
    durationMs: s.durationMs,
    success: s.state === 'completed' ? true : s.state === 'failed' ? false : null,
  });
  const awaitingJobs = safe(() => jobStore.page({ status: 'awaiting_approval', limit: 50 }).jobs) ?? [];
  const awaiting: ExecRowInput[] = awaitingJobs.map((j) => ({
    id: j.id,
    label: j.summary ?? j.skillId,
    kind: 'job',
    state: j.status,
    worker: j.workerId,
    awaitingApproval: true,
    correlationId: j.correlationId ?? null,
    startedAt: j.startedAt,
    durationMs: j.durationMs,
    success: null,
  }));
  const execution = {
    active: execSessions.map(sessionRow),
    awaiting,
    history: execHistory.map(sessionRow),
    total: safe(() => jobStore.size()) ?? execHistory.length,
    completed: execStats?.completed ?? 0,
    failed: execStats?.failed ?? 0,
  };

  // ── Recovery (RuntimeSupervisor + incidents + failed jobs) ──
  const supervisorRecoveries = supHistory
    .map((r: RecoveryRecord) => ({ subsystem: r.subsystem, reason: r.reason, ok: r.ok, at: r.startedAt, durationMs: r.durationMs }))
    .slice(0, 60);
  const escalations = [...new Set(supHistory.filter((r) => !r.ok).map((r) => r.subsystem))];
  const recoverySeeds: RecoverySeed[] = [];
  for (const sub of escalations) {
    recoverySeeds.push({
      id: `rec:esc:${sub}`,
      kind: 'escalation',
      target: sub,
      reason: 'Automated recovery attempts did not succeed; escalate to an operator.',
      risk: 'high',
      confidence: 0.7,
      sources: ['RuntimeSupervisor'],
      approvalTrigger: 'workforce_side_effect',
    });
  }
  for (const i of incidents.filter((x) => x.open && (x.severity === 'critical' || x.severity === 'warning')).slice(0, 6)) {
    const wantsFailover = i.recommendedActions.some((a) => /failover|fail over|switch|reroute/i.test(a));
    recoverySeeds.push({
      id: `rec:inc:${i.id}`,
      kind: wantsFailover ? 'failover' : 'rollback',
      target: i.title,
      reason: i.rootCause ? `Root cause — ${i.rootCause}.` : 'Open incident requires recovery.',
      risk: severityRisk(i.severity),
      confidence: i.confidence,
      sources: ['Enterprise Intelligence'],
      approvalTrigger: 'workforce_side_effect',
    });
  }
  const failedJobs = safe(() => jobStore.page({ status: 'failed', limit: 8 }).jobs) ?? [];
  for (const j of failedJobs.slice(0, 5)) {
    recoverySeeds.push({
      id: `rec:job:${j.id}`,
      kind: 'retry',
      target: j.skillId,
      reason: j.error ? `Job failed — ${j.error}.` : 'Job failed and is a retry candidate.',
      risk: 'medium',
      confidence: 0.6,
      sources: ['Workforce Runtime'],
      approvalTrigger: 'workforce_side_effect',
    });
  }

  // ── Optimization (P14 strategy) ──
  const optSeeds: OptSeed[] = opps.slice(0, 20).map((o) => ({
    id: `opt:${o.id}`,
    area: o.area,
    title: o.title,
    detail: o.detail,
    potentialSavingUsd: o.potentialSavingUsd,
    confidence: o.confidence,
    risk: priorityRisk(o.priority),
    evidenceKinds: ['optimization'],
    recommendedAction: o.recommendedAction,
    approvalTrigger: o.requiredApproval?.trigger ?? 'spend',
  }));

  // ── Pending approvals (workforce awaiting jobs + federation delegated approvals) ──
  const pendingApprovals: PendingInput[] = [];
  for (const j of awaitingJobs.slice(0, 30)) {
    const maxRisk = (j.proposals ?? []).reduce<OpsRisk>((acc, p) => {
      const r = p.risk as OpsRisk;
      return (['low', 'medium', 'high', 'critical'].indexOf(r) > ['low', 'medium', 'high', 'critical'].indexOf(acc) ? r : acc);
    }, 'low');
    pendingApprovals.push({
      id: `appr:wf:${j.id}`,
      source: 'workforce',
      title: j.summary ?? j.skillId,
      risk: maxRisk,
      requestedBy: j.requestedBy,
      status: 'awaiting_approval',
      approvalTrigger: 'workforce_side_effect',
    });
  }
  const fedApprovals = (safe(() => globalGovStore.listApprovals()) ?? []).filter((a) => a.status === 'pending');
  for (const a of fedApprovals.slice(0, 20)) {
    pendingApprovals.push({
      id: `appr:fed:${a.id}`,
      source: 'federation',
      title: a.action,
      risk: 'medium',
      requestedBy: a.fromOrgName,
      status: a.status,
      approvalTrigger: 'data_export',
    });
  }

  // ── Monitoring (reused read accessors, normalized health-oriented 0..100) ──
  const monitorSignals: MonitorInput[] = [];
  const execSuccess = execStats?.successRate; // already a 0..100 percent (or null)
  monitorSignals.push({
    dimension: 'execution',
    label: 'Execution success',
    value: execSuccess != null ? clampPct(execSuccess) : execution.active.length > 0 ? 60 : 80,
    display: execSuccess != null ? `${Math.round(execSuccess)}%` : 'n/a',
    detail: `${execution.active.length} active · ${execution.awaiting.length} awaiting approval`,
    source: 'ExecuteEngine + Workforce Runtime',
  });
  const coordinationHealth = orchestration?.summary?.overallHealth ?? null;
  monitorSignals.push({
    dimension: 'health',
    label: 'Operational health',
    value: clampPct(twin?.summary?.overallHealth ?? health.overall),
    display: `${Math.round(twin?.summary?.overallHealth ?? health.overall)}/100`,
    detail: coordinationHealth != null ? `P7 health + Digital Twin; orchestration coordination at ${Math.round(coordinationHealth)}/100.` : 'P7 enterprise health + Digital Twin overall health.',
    source: 'Enterprise Intelligence + Digital Twin + Orchestration',
  });
  if (report?.capacity) {
    monitorSignals.push({
      dimension: 'capacity',
      label: 'Capacity headroom',
      value: clampPct(100 - report.capacity.pressureScore),
      display: `${Math.round(report.capacity.pressureScore)} pressure`,
      detail: `${(report.capacity.pressureNodes ?? []).length} pressured resource(s).`,
      source: 'Enterprise Intelligence (capacity)',
    });
  }
  if (usage) {
    const avgUtil = usage.quotas?.length ? usage.quotas.reduce((n, q) => n + (q.utilizationPct ?? 0), 0) / usage.quotas.length : 0;
    monitorSignals.push({
      dimension: 'costs',
      label: 'Cost / quota headroom',
      value: clampPct(100 - avgUtil),
      display: `${usage.currency ?? '$'}${Math.round(usage.monthlySpend ?? 0)}/mo`,
      detail: `${Math.round(avgUtil)}% average quota utilization.`,
      source: 'Cloud Control Plane (usage)',
    });
  }
  if (report?.risk) {
    const secRisk = report.risk.byCategory?.security ?? report.risk.overall;
    monitorSignals.push({
      dimension: 'security',
      label: 'Security posture',
      value: clampPct(100 - secRisk),
      display: `${Math.round(secRisk)} risk`,
      detail: 'P7 security + identity risk categories.',
      source: 'Enterprise Intelligence (risk)',
    });
    const compScore = report.health.byKey?.compliance ?? 100 - (report.risk.byCategory?.operational ?? 0);
    monitorSignals.push({
      dimension: 'compliance',
      label: 'Compliance posture',
      value: clampPct(compScore),
      display: `${Math.round(compScore)}/100`,
      detail: 'P7 compliance health score.',
      source: 'Enterprise Intelligence (health) + Governance',
    });
  }
  if (deployments.length) {
    const avgUptime = deployments.reduce((n, d) => n + (d.uptimePct ?? 0), 0) / deployments.length;
    const laggingRegions = regions.filter((r) => r.replication === 'lagging' || r.replication === 'failed').length;
    monitorSignals.push({
      dimension: 'sla',
      label: 'SLA / availability',
      value: clampPct(avgUptime),
      display: `${avgUptime.toFixed(1)}% uptime`,
      detail: `${deployments.filter((d) => d.gate === 'ok').length}/${deployments.length} deployments OK · ${laggingRegions} region(s) lagging.`,
      source: 'Cloud Control Plane (deployments/regions)',
    });
  }

  // ── Evidence coverage + audit provenance (fabric-backed lineage) ──
  const auditSources = [
    `Workforce audit (${safe(() => auditLog.size()) ?? 0})`,
    `Federation governance audit (${(safe(() => globalGovStore.listAudit()) ?? []).length})`,
    `Enterprise governance audit (${safe(() => governanceStore.auditCount()) ?? 0})`,
    `Worker registry (${(safe(() => workerRegistry.summaries()) ?? []).length} workers)`,
  ];
  const evidenceCoverage = evidence ? Math.round(evidence.evidenceCoverage ?? 0) : 0; // already 0..100
  const redactions = [
    'Evidence reduced to reference kinds (never entity ids) on every projected plan.',
    'Approvals are surfaced but resolved only by the existing approval engine.',
    'No execution/dispatch/approve/recover/rollback mutator is imported — the layer cannot act.',
    `Knowledge Fabric evidence coverage: ${evidenceCoverage}% (${evidence?.total ?? 0} explanations).`,
  ];

  return {
    generatedAt: report ? report.generatedAt : nowIso,
    health,
    planSeeds,
    execution,
    supervisorRecoveries,
    escalations,
    recoveryCount: supStatus?.recoveryCount ?? 0,
    recentFailures: supStatus?.recentFailures ?? 0,
    recoverySeeds,
    optSeeds,
    incidents,
    pendingApprovals,
    chains,
    monitorSignals,
    autoAllowedTriggers,
    auditSources,
    redactions,
    kpis,
  };
}

export function initAutonomousOperations(deps: AutonomousOperationsDeps): AutonomousOperationsSubsystem {
  const service = new AutonomousOperationsService({ readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected execution/supervisor/
  // knowledge/strategy/cloud accessors refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  jobStore.on('changed', invalidate);
  workerRegistry.on('changed', invalidate);
  governanceStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.AutoOpsOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.AutoOpsPlans, schema: EmptyRequest, handler: () => service.plans() },
    { channel: IpcChannel.AutoOpsExecution, schema: EmptyRequest, handler: () => service.execution() },
    { channel: IpcChannel.AutoOpsRecovery, schema: EmptyRequest, handler: () => service.recovery() },
    { channel: IpcChannel.AutoOpsOptimization, schema: EmptyRequest, handler: () => service.optimization() },
    { channel: IpcChannel.AutoOpsIncidents, schema: EmptyRequest, handler: () => service.incidents() },
    { channel: IpcChannel.AutoOpsApprovals, schema: EmptyRequest, handler: () => service.approvals() },
    { channel: IpcChannel.AutoOpsMonitoring, schema: EmptyRequest, handler: () => service.monitoring() },
    { channel: IpcChannel.AutoOpsAnalytics, schema: EmptyRequest, handler: () => service.analytics() },
    { channel: IpcChannel.AutoOpsGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withAutoOpsAuthz(rawHandlers);

  const dispose = (): void => {
    jobStore.off('changed', invalidate);
    workerRegistry.off('changed', invalidate);
    governanceStore.off('changed', invalidate);
  };

  log.info('Autonomous Enterprise Operations ready', { modules: safe(() => service.overview().modules.length) ?? 0 });
  return { handlers, service, dispose };
}

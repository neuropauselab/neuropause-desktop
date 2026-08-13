/**
 * P14 — Autonomous Enterprise Intelligence composition root.
 *
 * The strategic-intelligence LAYER over the existing platform. It composes a READ-ONLY snapshot from
 * the EXISTING signals — the P7 Enterprise Intelligence report (injected `enterpriseReport`), the
 * Cloud Control Plane service (injected), the Industry Platform service (injected), and the AI
 * Workforce / Connectors / Marketplace / Federation / Governance store singletons — into strategic
 * projections (goals, planning, reasoning, optimization, simulation, decisions) behind RBAC-gated IPC
 * (`strategy:read`). It creates NO new store, runtime, engine, or execution path, executes nothing,
 * and reuses the existing `ecosystem:event` broadcast for renderer liveness. Every read source is
 * wrapped defensively so a single failing subsystem degrades the projection rather than crashing it.
 */
import { EmptyRequest, IpcChannel, type EnterpriseIntelligenceReport } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { summarizeWorkforceHealth } from '../enterprise/workforceHealth';
import { connectorService } from '../connectors/connectorService';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { governanceStore } from '../enterprise/governance/governanceInstance';
import { fedStore } from '../federation/runtime/fedInstance';
import { globalGovStore } from '../federation/governance/globalGovInstance';
import { evaluateFederatedAction } from '../federation/governance/globalGov';
import type { IndustryPlatformService } from '../industry/industryService';
import type { ControlPlaneService } from '../cloud/controlPlane/controlPlaneService';
import { StrategyService } from './strategyService';
import type { StrategyState } from './strategyModel';
import { withStrategyAuthz } from './strategyAuthz';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('autonomous-intelligence');

export interface AutonomousIntelligenceDeps {
  /** The P7 Enterprise Intelligence report accessor (memoized, 3s TTL) — injected, not re-created. */
  enterpriseReport: () => EnterpriseIntelligenceReport;
  /** The P11 Cloud Control Plane service — injected from runtimeCore, not re-initialized. */
  controlPlane: ControlPlaneService;
  /** The P13 Industry Platform service — injected from runtimeCore, not re-initialized. */
  industry: IndustryPlatformService;
}

export interface AutonomousIntelligenceSubsystem {
  handlers: SecureHandlerDef[];
  service: StrategyService;
  dispose: () => void;
}

/** Run a read defensively; a failing source degrades the projection instead of crashing it. */
function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Compose the strategy snapshot from the EXISTING platform signals (no new store; read-only). */
function buildState(deps: AutonomousIntelligenceDeps): StrategyState {
  const report = safe(() => deps.enterpriseReport());

  const health = report
    ? { overall: report.health.overall, band: report.health.band, scores: report.health.scores.map((sc) => ({ key: sc.key, label: sc.label, score: sc.score, band: sc.band })) }
    : { overall: 0, band: 'critical' as const, scores: [] };

  const risk = report
    ? { overall: report.risk.overall, band: report.risk.band, byCategory: report.risk.byCategory as Record<string, number>, topRisks: report.risk.topRisks.map((r) => ({ id: r.id, label: r.label, risk: r.risk, reason: r.reason })), confidence: report.risk.confidence }
    : // Report unavailable → assume-worst on the risk axis so goals never read as "met" while blind.
      { overall: 100, band: 'critical' as const, byCategory: {}, topRisks: [], confidence: 0 };

  const dependencies = report
    ? { spofs: report.dependencies.spofs.length, cycles: report.dependencies.cycles.length, bottlenecks: report.dependencies.bottlenecks.length, criticalCount: report.dependencies.criticalCount, topSpofs: report.dependencies.spofs.slice(0, 5).map((n) => ({ id: n.id, label: n.label, blastRadius: n.blastRadius })) }
    : { spofs: 0, cycles: 0, bottlenecks: 0, criticalCount: 0, topSpofs: [] };

  const capacity = report
    ? { utilizationAvg: report.capacity.utilizationAvg, costTotal: report.capacity.costTotal, pressureScore: report.capacity.pressureScore, costOutliers: report.capacity.costOutliers.map((o) => ({ id: o.id, label: o.label, cost: o.cost })) }
    : { utilizationAvg: null, costTotal: 0, pressureScore: 0, costOutliers: [] };

  const incidents = report ? { open: report.incidents.open, total: report.incidents.total } : { open: 0, total: 0 };
  const recommendations = report ? report.recommendations : [];

  // Cloud (injected control plane service).
  const usage = safe(() => deps.controlPlane.usage());
  const fleet = safe(() => deps.controlPlane.fleet());
  const cloud = {
    monthlySpend: usage?.monthlySpend ?? 0,
    currency: usage?.currency ?? 'USD',
    quotas: (usage?.quotas ?? []).map((q) => ({ resource: q.resource, used: q.used, limit: q.limit, utilizationPct: q.utilizationPct })),
    fleetStatus: fleet?.status ?? 'healthy',
    deployments: fleet?.totals.deployments ?? 0,
    healthyDeployments: fleet?.totals.healthyDeployments ?? 0,
    regions: fleet?.totals.regions ?? 0,
  };

  // Workforce (pure derivers over the job store + registry health).
  const jobs = safe(() => jobStore.page({ limit: 2000 }).jobs) ?? [];
  const wi = safe(() => workforceIntelligence(jobs));
  const whs = safe(() => summarizeWorkforceHealth(safe(() => workerRegistry.healthSummaries()) ?? []));
  const workforce = {
    totalWorkers: safe(() => workerRegistry.summaries().length) ?? 0,
    overallSuccessRate: wi?.overallSuccessRate ?? 0,
    bottlenecks: (wi?.bottlenecks ?? []).map((b) => ({ scope: b.scope, key: b.key, kind: b.kind, reason: b.reason })),
    healthy: whs?.healthy ?? 0,
    degraded: whs?.degraded ?? 0,
    unhealthy: whs?.unhealthy ?? 0,
  };

  // Connectors.
  const cstats = safe(() => connectorService.stats());
  const connectors = { total: cstats?.total ?? 0, connected: cstats?.connected ?? 0, healthy: cstats?.healthy ?? 0, degraded: cstats?.degraded ?? 0, down: cstats?.down ?? 0 };

  // Industry (injected service).
  const readiness = safe(() => deps.industry.readiness());
  const industry = {
    ready: readiness?.ready ?? 0,
    partial: readiness?.partial ?? 0,
    planned: readiness?.planned ?? 0,
    averageActivation: readiness?.averageActivation ?? 0,
    entries: (readiness?.entries ?? []).map((e) => ({ id: e.id, name: e.name, status: e.status, activation: e.activation })),
  };

  // Marketplace (published listings only).
  const listings = (safe(() => marketplaceStore.list()) ?? []).filter((l) => l.status === 'published');
  const byKind: Record<string, number> = {};
  for (const l of listings) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  const marketplace = { published: listings.length, certified: listings.filter((l) => l.certified).length, byKind };

  // Compliance — reuse the health compliance score + the industry compliance frameworks.
  const compReport = safe(() => deps.industry.compliance());
  const compScore = health.scores.find((sc) => sc.key === 'compliance');
  const failing = (compReport?.frameworks ?? []).filter((f) => f.status !== 'ready').length;
  const totalFrameworks = compReport?.totalFrameworks ?? 0;
  const compliance = { score: compScore?.score ?? 100, band: compScore?.band ?? ('healthy' as const), frameworks: totalFrameworks, failing, passing: totalFrameworks - failing };

  // Governance approval chains (referenced for approval-awareness — read-only).
  const approvalChains = (safe(() => governanceStore.chains()) ?? []).map((c) => ({ id: c.id, appliesTo: c.appliesTo, name: c.name, enabled: c.enabled, steps: c.steps.map((st) => ({ roleId: st.roleId, order: st.order })) }));

  // Cross-org collaboration — gated by the real federation trust policy (pure, read-only evaluator).
  const policies = safe(() => globalGovStore.listPolicies()) ?? [];
  const collaboration = (safe(() => fedStore.listTrust()) ?? []).map((t) => {
    const evaln = safe(() => evaluateFederatedAction({ action: 'cross_org_strategic_collaboration', peerTrustLevel: t.trustLevel, policies }));
    return { peerOrg: t.peerOrg, peerOrgName: t.peerOrgName, trustLevel: t.trustLevel, decision: evaln?.decision ?? ('require_approval' as const), reason: evaln?.reason ?? 'Trust policy evaluation unavailable.' };
  });

  return {
    generatedAt: report ? report.generatedAt : new Date().toISOString(),
    health,
    risk,
    dependencies,
    capacity,
    incidents,
    recommendations,
    cloud,
    workforce,
    connectors,
    industry,
    marketplace,
    compliance,
    approvalChains,
    collaboration,
  };
}

export function initAutonomousIntelligence(deps: AutonomousIntelligenceDeps): AutonomousIntelligenceSubsystem {
  const service = new StrategyService({ scope: activeTenantScope, readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing signal changes. The injected cloud/industry
  // services and the enterprise report keep themselves fresh (their own composition roots + TTLs);
  // renderer liveness is served by the existing `ecosystem:event` broadcast + manual refresh.
  const invalidate = (): void => service.invalidate();
  workerRegistry.on('changed', invalidate);
  connectorService.on('event', invalidate);
  governanceStore.on('changed', invalidate);
  marketplaceStore.on('changed', invalidate);
  fedStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.StrategyOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.StrategyGoals, schema: EmptyRequest, handler: () => service.goals() },
    { channel: IpcChannel.StrategyPlanning, schema: EmptyRequest, handler: () => service.planning() },
    { channel: IpcChannel.StrategyReasoning, schema: EmptyRequest, handler: () => service.reasoning() },
    { channel: IpcChannel.StrategyOptimization, schema: EmptyRequest, handler: () => service.optimization() },
    { channel: IpcChannel.StrategySimulation, schema: EmptyRequest, handler: () => service.simulation() },
    { channel: IpcChannel.StrategyDecisions, schema: EmptyRequest, handler: () => service.decisions() },
  ];
  const handlers = withStrategyAuthz(rawHandlers);

  const dispose = (): void => {
    workerRegistry.off('changed', invalidate);
    connectorService.off('event', invalidate);
    governanceStore.off('changed', invalidate);
    marketplaceStore.off('changed', invalidate);
    fedStore.off('changed', invalidate);
  };

  log.info('Autonomous Enterprise Intelligence ready', { goals: safe(() => service.goals().goals.length) ?? 0, decisions: safe(() => service.decisions().count) ?? 0 });
  return { handlers, service, dispose };
}

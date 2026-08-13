/**
 * P17 — Global AI Orchestration Platform composition root.
 *
 * The coordination/routing LAYER over the existing platform. It composes a READ-ONLY snapshot from the
 * EXISTING signals — the P7 Enterprise Intelligence report (injected), the P14 Strategy overview
 * (injected, for planning steps + approval), the P16 Knowledge Fabric evidence/lineage (injected), the
 * P11 Cloud Control Plane (injected as narrowed read fns), and the Industry/Developer overviews
 * (injected) — plus the AI Workforce registry + job store, the org store, the marketplace, and the
 * federation store (imported singletons, read-only) — into orchestration projections (goal routing,
 * workforce/cloud/knowledge/cross-system coordination, flows, governance) behind RBAC-gated IPC
 * (`orchestration:read`).
 *
 * It ROUTES goals to existing worker capability pools using the SHIPPED delegation matcher and reuses the
 * SHIPPED `workforceIntelligence` deriver — it imports NO workforce mutator, scheduler, runtime, or
 * ExecuteEngine, so it is STRUCTURALLY unable to dispatch/approve/execute. Every route respects the
 * existing approval chains. It creates no new store, runtime, engine, graph, memory, or search, executes
 * nothing, and reuses the existing `ecosystem:event` broadcast for renderer liveness. Every read source
 * is wrapped defensively so a single failing subsystem degrades the projection rather than crashing it.
 */
import {
  EmptyRequest,
  IpcChannel,
  type DelegationCandidate,
  type DeveloperPlatformOverview,
  type DeploymentStatusEntry,
  type EnterpriseIntelligenceReport,
  type FabricEvidenceReport,
  type FabricLineage,
  type FleetOverview,
  type IndustryPlatformOverview,
  type RegionStatus,
  type StrategyOverview,
  type UsageOverview,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { orgStore } from '../enterprise/org/orgInstance';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { fedStore } from '../federation/runtime/fedInstance';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { GlobalOrchestrationService } from './orchestrationService';
import type { OrchestrationRouteStep, OrchestrationState } from './orchestrationModel';
import { withOrchestrationAuthz } from './orchestrationAuthz';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('global-orchestration');

export interface GlobalOrchestrationDeps {
  /** The P7 Enterprise Intelligence report accessor (memoized, 3s TTL) — injected, not re-created. */
  enterpriseReport: () => EnterpriseIntelligenceReport;
  /** The P14 Strategy overview accessor — injected (planning steps + approval requirements). */
  strategyOverview: () => StrategyOverview;
  /** The P16 Knowledge Fabric evidence report — injected (knowledge delivered to decisions). */
  knowledgeEvidence: () => FabricEvidenceReport;
  /** The P16 Knowledge Fabric lineage — injected. */
  knowledgeLineage: () => FabricLineage;
  /** Cloud Control Plane READ accessors — narrowed so the layer cannot mutate/execute. */
  fleet: () => FleetOverview;
  regions: () => RegionStatus[];
  deployments: () => DeploymentStatusEntry[];
  usage: () => UsageOverview;
  /** Industry/Developer overviews — injected only for a liveness null-check. */
  industryOverview: () => IndustryPlatformOverview;
  developerOverview: () => DeveloperPlatformOverview;
}

export interface GlobalOrchestrationSubsystem {
  handlers: SecureHandlerDef[];
  service: GlobalOrchestrationService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Compose the orchestration snapshot from the EXISTING platform signals (no new runtime/engine). */
function buildState(deps: GlobalOrchestrationDeps): OrchestrationState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const report = safe(() => deps.enterpriseReport());
  const strategy = safe(() => deps.strategyOverview());
  const evidence = safe(() => deps.knowledgeEvidence());
  const lineage = safe(() => deps.knowledgeLineage());
  const fleet = safe(() => deps.fleet());
  const regionsRaw = safe(() => deps.regions()) ?? [];
  const deploymentsRaw = safe(() => deps.deployments()) ?? [];
  const usage = safe(() => deps.usage());

  // Health — assume-worst when the intelligence report is unavailable (never falsely healthy).
  const health = report ? { overall: report.health.overall, band: report.health.band } : { overall: 0, band: 'critical' as const };
  const kpis = report?.kpis ?? strategy?.kpis ?? [];

  // Goal routing inputs: ready-to-route plan steps from the EXISTING Strategy planning engine.
  const routeSteps: OrchestrationRouteStep[] = [];
  for (const h of strategy?.planning.horizons ?? []) {
    for (const step of h.steps) {
      routeSteps.push({
        id: step.id,
        label: step.label,
        action: step.action,
        approvalGoverned: step.requiredApproval.governed,
        approvalChain: step.requiredApproval.chainName,
        approvalSteps: step.requiredApproval.steps,
        evidenceCount: step.evidence.length,
      });
    }
  }

  // Worker candidates for the EXISTING matcher — identity redacted (name unused by scoreCandidate).
  const summaries = safe(() => workerRegistry.summaries()) ?? [];
  const candidates: DelegationCandidate[] = summaries.map((w) => ({
    id: w.id,
    name: '',
    role: w.role,
    trustScore: w.trustScore,
    healthState: w.healthState,
    lifecycle: w.lifecycle,
    grantedScopes: [],
  }));

  // Load distribution via the SHIPPED workforceIntelligence deriver (no new metrics store).
  const jobs = safe(() => jobStore.page({ limit: 500 }).jobs) ?? [];
  const wi = safe(() => workforceIntelligence(jobs));
  const bottlenecks = (wi?.bottlenecks ?? []).map((b) => ({ scope: b.scope, kind: b.kind, reason: b.reason, value: b.value, sampleSize: b.sampleSize }));

  // Cross-org/department structure (worker→org projection already maintained by syncWorkers).
  const orgs = (safe(() => orgStore.listOrganizations()) ?? []).map((o) => {
    const units = safe(() => orgStore.unitsFor(o.id)) ?? [];
    const users = safe(() => orgStore.usersFor(o.id)) ?? [];
    return { orgId: o.id, orgName: o.name, units: units.length, workers: users.filter((u) => u.kind === 'ai_worker').length };
  });

  const workforce = {
    summaries: summaries.map((w) => ({ role: w.role, lifecycle: w.lifecycle, trustScore: w.trustScore })),
    activeWorkers: wi?.activeWorkers ?? 0,
    inFlight: wi?.inFlight ?? 0,
    overallSuccessRate: wi?.overallSuccessRate ?? 0,
    bottlenecks,
    orgs,
  };

  const cloud = {
    fleetStatus: fleet?.status ?? 'unavailable',
    fleetScore: fleet?.score ?? 0,
    regions: regionsRaw.map((r) => ({ id: r.id, name: r.name, available: r.available, deployments: r.deployments, healthyDeployments: r.healthyDeployments, replication: r.replication, health: r.health })),
    deployments: deploymentsRaw.map((d) => ({ service: d.service, region: d.regionId, status: d.status, gate: d.gate, uptimePct: d.uptimePct })),
    quotas: (usage?.quotas ?? []).map((q) => ({ resource: q.resource, utilizationPct: q.utilizationPct })),
    monthlySpend: usage?.monthlySpend ?? 0,
    currency: usage?.currency ?? 'USD',
  };

  // Knowledge delivered to decisions — per-kind confidence computed from the fabric's explanations.
  const kindAgg = new Map<string, { count: number; conf: number }>();
  for (const x of evidence?.explanations ?? []) {
    const e = kindAgg.get(x.kind) ?? { count: 0, conf: 0 };
    e.count += 1;
    e.conf += x.confidence;
    kindAgg.set(x.kind, e);
  }
  const knowledge = {
    explanations: evidence?.total ?? 0,
    evidenceCoverage: evidence?.evidenceCoverage ?? 0,
    avgConfidence: evidence?.avgConfidence ?? 0,
    byKind: [...kindAgg.entries()].map(([kind, e]) => ({ kind, count: e.count, avgConfidence: e.count ? e.conf / e.count : 0 })),
    lineageStages: (lineage?.stages ?? []).map((l) => ({ stage: l.stage, count: l.count })),
  };

  // Marketplace + federation coordination (read-only store rollups).
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const published = listings.filter((l) => l.status === 'published');
  const mstats = safe(() => marketplaceStore.stats());
  const marketplace = { published: published.length, certified: published.filter((l) => l.certified).length, total: listings.length, installs: mstats?.totalInstalls ?? 0 };

  const fedSummary = safe(() => fedStore.summary());
  const trust = safe(() => fedStore.listTrust()) ?? [];
  const federation = {
    peers: fedSummary?.peers ?? 0,
    activePeers: fedSummary?.activePeers ?? 0,
    trustedPeers: fedSummary?.trustedPeers ?? 0,
    canShareWorkers: trust.filter((t) => t.canShareWorkers).length,
    sharedOut: fedSummary?.sharedOut ?? 0,
    sharedIn: fedSummary?.sharedIn ?? 0,
  };

  const industry = { live: safe(() => deps.industryOverview()) != null };
  const developer = { live: safe(() => deps.developerOverview()) != null };

  return { generatedAt: report ? report.generatedAt : nowIso, health, routeSteps, candidates, workforce, cloud, knowledge, marketplace, federation, industry, developer, kpis };
}

export function initGlobalOrchestration(deps: GlobalOrchestrationDeps): GlobalOrchestrationSubsystem {
  const service = new GlobalOrchestrationService({ scope: activeTenantScope, readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing store changes; the injected report/strategy/
  // knowledge/cloud accessors refresh via the service TTL. Renderer liveness reuses `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  workerRegistry.on('changed', invalidate);
  jobStore.on('changed', invalidate);
  orgStore.on('changed', invalidate);
  marketplaceStore.on('changed', invalidate);
  fedStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.OrchestrationOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.OrchestrationGoals, schema: EmptyRequest, handler: () => service.goals() },
    { channel: IpcChannel.OrchestrationWorkforce, schema: EmptyRequest, handler: () => service.workforce() },
    { channel: IpcChannel.OrchestrationCloud, schema: EmptyRequest, handler: () => service.cloud() },
    { channel: IpcChannel.OrchestrationKnowledge, schema: EmptyRequest, handler: () => service.knowledge() },
    { channel: IpcChannel.OrchestrationFlows, schema: EmptyRequest, handler: () => service.flows() },
    { channel: IpcChannel.OrchestrationCoordination, schema: EmptyRequest, handler: () => service.coordination() },
    { channel: IpcChannel.OrchestrationGovernance, schema: EmptyRequest, handler: () => service.governance() },
  ];
  const handlers = withOrchestrationAuthz(rawHandlers);

  const dispose = (): void => {
    workerRegistry.off('changed', invalidate);
    jobStore.off('changed', invalidate);
    orgStore.off('changed', invalidate);
    marketplaceStore.off('changed', invalidate);
    fedStore.off('changed', invalidate);
  };

  log.info('Global AI Orchestration ready', { orchestrators: safe(() => service.overview().orchestrators.length) ?? 0 });
  return { handlers, service, dispose };
}

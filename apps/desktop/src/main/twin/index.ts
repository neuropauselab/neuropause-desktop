/**
 * P15 — Enterprise Digital Twin composition root.
 *
 * The digital-twin visualization LAYER over the existing platform. It composes a READ-ONLY snapshot
 * from the EXISTING signals — the P7 Enterprise Intelligence report (injected), the Cloud Control Plane
 * service (injected), the P14 Strategy service (injected), the platform timeline query (injected), and
 * the Organization / AI Workforce / Connectors / Marketplace / Federation store singletons — into
 * Digital Twin projections (domains, topology, health map, blast-radius impact, timeline replay,
 * scenario passthrough, executive command center) behind RBAC-gated IPC (`twin:read`). It creates NO
 * new store, graph, timeline, or simulation engine, executes nothing, and reuses the existing
 * `ecosystem:event` broadcast for renderer liveness. Every read source is wrapped defensively so a
 * single failing subsystem degrades the projection rather than crashing it.
 */
import {
  EmptyRequest,
  IpcChannel,
  type EnterpriseIntelligenceReport,
  type PlatformEvent,
  type SimulationReport,
  type TimelineQuery,
  type TimelinePage,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { orgStore } from '../enterprise/org/orgInstance';
import { activeTenantScope } from '../enterprise/index';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { jobStore } from '../workforce/runtime/jobInstance';
import { workforceIntelligence } from '../workforce/intelligence/workforceIntelligence';
import { summarizeWorkforceHealth } from '../enterprise/workforceHealth';
import { connectorService } from '../connectors/connectorService';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { fedStore } from '../federation/runtime/fedInstance';
import type { ControlPlaneService } from '../cloud/controlPlane/controlPlaneService';
import type { StrategyService } from '../strategy/strategyService';
import { TwinService } from './twinService';
import { projectReport } from './twinModel';
import type { TwinReplayInput, TwinState } from './twinModel';
import { withTwinAuthz } from './twinAuthz';

const log = createLogger('enterprise-twin');

export interface EnterpriseTwinDeps {
  /** The P7 Enterprise Intelligence report accessor (memoized, 3s TTL) — injected, not re-created. */
  enterpriseReport: () => EnterpriseIntelligenceReport;
  /**
   * Cloud Control Plane (P11) READ accessors, narrowed to functions so the twin is STRUCTURALLY unable
   * to reach any mutating/executing method on the service — defense-in-depth for the never-execute rule.
   */
  fleet: () => ReturnType<ControlPlaneService['fleet']>;
  usage: () => ReturnType<ControlPlaneService['usage']>;
  deployments: () => ReturnType<ControlPlaneService['deployments']>;
  /** P14 Strategy READ accessors — narrowed to overview + the passthrough simulation report. */
  strategyOverview: () => ReturnType<StrategyService['overview']>;
  simulation: () => SimulationReport;
  /** The existing platform timeline query — injected from runtimeCore (for replay). Reused, not re-created. */
  queryTimeline: (q: TimelineQuery) => TimelinePage;
}

export interface EnterpriseTwinSubsystem {
  handlers: SecureHandlerDef[];
  service: TwinService;
  dispose: () => void;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

const EMPTY_PROJECTION = { costUsd: 0, riskScore: 0, timeDays: 0, resourceUtilizationPct: 0, complianceScore: 0, probabilityPct: 0 };
const EMPTY_SIMULATION: SimulationReport = {
  baseline: { id: 'baseline', name: 'Baseline', description: 'Strategy simulation unavailable.', focus: 'baseline', projected: EMPTY_PROJECTION, deltaVsBaseline: EMPTY_PROJECTION, evidence: [], applied: false },
  scenarios: [],
  comparison: [],
  note: 'Strategy simulation unavailable.',
};

function toFrame(e: PlatformEvent): TwinReplayInput['frames'][number] {
  return { id: e.id, at: e.timestamp, type: e.type, category: e.category, priority: e.priority, source: e.source, resource: e.resource?.name ?? null };
}

/** Build the six replay windows by FILTERING the existing platform timeline — no new timeline. */
function buildReplayWindows(query: (q: TimelineQuery) => TimelinePage, since: string, until: string): TwinReplayInput[] {
  const LIMIT = 120;
  const win = (kind: TwinReplayInput['kind'], label: string, q: TimelineQuery, note: string): TwinReplayInput => {
    const page = safe(() => query({ ...q, since, until, order: 'desc', limit: LIMIT }));
    const events = page?.events ?? [];
    const total = page?.total ?? events.length;
    // Honest: the per-day chart is built from the fetched frames; when the window holds more than we
    // fetched, say so rather than letting the daily bars silently understate the true volume.
    const fullNote = total > events.length ? `${note} Showing the ${events.length} most recent of ${total} events; the daily chart reflects this sample.` : note;
    return { kind, label, since, until, total, note: fullNote, frames: events.map(toFrame) };
  };
  return [
    win('historical', 'Historical', {}, 'All platform events in the window.'),
    win('incident', 'Incidents', { priorities: ['high', 'critical'] }, 'High/critical-priority events (incidents are correlated from these by the existing engine).'),
    win('deployment', 'Deployments', { categories: ['infrastructure', 'update', 'application', 'plugin'] }, 'Deployment-adjacent events (infra actions + app/plugin updates). Control-plane deployments are a read-model, not an event stream.'),
    win('change', 'Changes', { categories: ['enterprise', 'knowledge', 'connector'] }, 'Record, knowledge, and connector-write changes.'),
    win('federation', 'Federation', { search: 'federation' }, 'Best-effort — most federation activity lives in the Federation Center, not the platform event bus.'),
    win('worker', 'Workers', { categories: ['automation'] }, 'AI worker job lifecycle, approvals, and install events.'),
  ];
}

/** Compose the twin snapshot from the EXISTING platform signals (no new store/graph/timeline/sim). */
function buildState(deps: EnterpriseTwinDeps): TwinState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const report = safe(() => deps.enterpriseReport());
  // Assume-worst on an unavailable report (health critical, risk maxed) and redact SPOF identities —
  // see projectReport. A failed intelligence read must never read as a healthy, low-risk enterprise.
  const projected = projectReport(report);
  const { health, risk, graph, dependencies, reportKpis } = projected;

  // Organization.
  /**
   * P13C REMEDIATION — N6. This was `orgs[0]`, the first-inserted organization,
   * so the twin reported THAT tenant's headcount, unit count and human/worker
   * split to every caller. `buildState` is a lazy per-request read model, so
   * resolving the caller's own tenant is enough to make each evaluation
   * describe the right organization.
   *
   * `orgs.length` is also no longer reported from the install roster: telling a
   * tenant how many organizations share the machine is a fact about other
   * customers. A resolved caller counts one; an unresolved caller counts none.
   */
  const activeOrg = (() => {
    const scope = activeTenantScope();
    if (scope === null) return null;
    return safe(() => orgStore.organization(scope.tenantId)) ?? null;
  })();
  const users = activeOrg ? safe(() => orgStore.usersFor(activeOrg.id)) ?? [] : [];
  const units = activeOrg ? safe(() => orgStore.unitsFor(activeOrg.id)) ?? [] : [];
  const org = { orgs: activeOrg ? 1 : 0, units: units.length, users: users.length, humans: users.filter((u) => u.kind === 'human').length, workers: users.filter((u) => u.kind === 'ai_worker').length };

  // Cloud (injected control plane service) + Application (deployments).
  const fleet = safe(() => deps.fleet());
  const usage = safe(() => deps.usage());
  const deployments = safe(() => deps.deployments()) ?? [];
  const cloud = {
    deployments: fleet?.totals.deployments ?? deployments.length,
    healthyDeployments: fleet?.totals.healthyDeployments ?? deployments.filter((d) => d.status === 'healthy').length,
    regions: fleet?.totals.regions ?? 0,
    // Assume-worst when the fleet read fails: 'unavailable' bands to 'critical' (fleetBand), never a
    // false green. A fresh install returns a real (empty) overview, so null here means a genuine failure.
    fleetStatus: fleet?.status ?? 'unavailable',
    fleetScore: fleet?.score ?? 0,
    monthlySpend: usage?.monthlySpend ?? 0,
    currency: usage?.currency ?? 'USD',
  };
  const appHealthy = deployments.filter((d) => d.status === 'healthy').length;
  const avgUptimePct = deployments.length > 0 ? deployments.reduce((n, d) => n + d.uptimePct, 0) / deployments.length : 0;
  const application = { deployments: deployments.length, healthy: appHealthy, avgUptimePct };

  // Workforce.
  const jobs = safe(() => jobStore.page({ limit: 2000 }).jobs) ?? [];
  const wi = safe(() => workforceIntelligence(jobs));
  const whs = safe(() => summarizeWorkforceHealth(safe(() => workerRegistry.healthSummaries()) ?? []));
  const workforce = {
    total: safe(() => workerRegistry.summaries().length) ?? 0,
    healthy: whs?.healthy ?? 0,
    degraded: whs?.degraded ?? 0,
    unhealthy: whs?.unhealthy ?? 0,
    state: whs?.state ?? 'unknown',
    successRate: wi?.overallSuccessRate ?? 0,
  };

  // Connectors.
  const cstats = safe(() => connectorService.stats());
  const connectors = { total: cstats?.total ?? 0, connected: cstats?.connected ?? 0, healthy: cstats?.healthy ?? 0, degraded: cstats?.degraded ?? 0, down: cstats?.down ?? 0 };

  // Marketplace.
  const listings = safe(() => marketplaceStore.list()) ?? [];
  const published = listings.filter((l) => l.status === 'published');
  const marketplace = { published: published.length, certified: published.filter((l) => l.certified).length, total: listings.length };

  // Federation.
  const fedSummary = safe(() => fedStore.summary());
  const federation = { peers: fedSummary?.peers ?? 0, activePeers: fedSummary?.activePeers ?? 0, trustedPeers: fedSummary?.trustedPeers ?? 0 };

  // Strategy (injected P14 service).
  const stratOverview = safe(() => deps.strategyOverview());
  const strategy = stratOverview
    ? {
        goalsTotal: stratOverview.summary.goalsTotal,
        goalsOnTrack: stratOverview.summary.goalsOnTrack,
        overallProgress: stratOverview.summary.overallProgress,
        openDecisions: stratOverview.summary.openDecisions,
        requiresApproval: stratOverview.summary.decisionsRequiringApproval,
        healthBand: stratOverview.summary.healthBand,
      }
    : { goalsTotal: 0, goalsOnTrack: 0, overallProgress: 0, openDecisions: 0, requiresApproval: 0, healthBand: 'watch' as const };
  const strategyKpis = stratOverview?.kpis ?? [];
  const simulation = safe(() => deps.simulation()) ?? EMPTY_SIMULATION;

  // Replay windows (filtered platform-timeline queries).
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const replay = buildReplayWindows(deps.queryTimeline, since, nowIso);

  return { generatedAt: projected.generatedAt ?? nowIso, org, cloud, workforce, application, connectors, marketplace, federation, strategy, health, risk, graph, dependencies, reportKpis, strategyKpis, simulation, replay };
}

export function initEnterpriseTwin(deps: EnterpriseTwinDeps): EnterpriseTwinSubsystem {
  const service = new TwinService({ readState: () => buildState(deps) });

  // Invalidate the memoized snapshot when a backing signal changes; the injected report/cloud/strategy/
  // timeline sources refresh via the service TTL. Renderer liveness reuses the existing `ecosystem:event`.
  const invalidate = (): void => service.invalidate();
  workerRegistry.on('changed', invalidate);
  connectorService.on('event', invalidate);
  marketplaceStore.on('changed', invalidate);
  fedStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.TwinOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.TwinDomains, schema: EmptyRequest, handler: () => service.domains() },
    { channel: IpcChannel.TwinTopology, schema: EmptyRequest, handler: () => service.topology() },
    { channel: IpcChannel.TwinHealth, schema: EmptyRequest, handler: () => service.health() },
    { channel: IpcChannel.TwinReplay, schema: EmptyRequest, handler: () => service.replay() },
    { channel: IpcChannel.TwinScenario, schema: EmptyRequest, handler: () => service.scenario() },
    { channel: IpcChannel.TwinImpact, schema: EmptyRequest, handler: () => service.impact() },
    { channel: IpcChannel.TwinExecutive, schema: EmptyRequest, handler: () => service.executive() },
  ];
  const handlers = withTwinAuthz(rawHandlers);

  const dispose = (): void => {
    workerRegistry.off('changed', invalidate);
    connectorService.off('event', invalidate);
    marketplaceStore.off('changed', invalidate);
    fedStore.off('changed', invalidate);
  };

  log.info('Enterprise Digital Twin ready', { domains: safe(() => service.domains().domains.length) ?? 0 });
  return { handlers, service, dispose };
}

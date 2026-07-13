/**
 * The Infrastructure Runtime composition root (P6 — Cloud & Infrastructure Control Plane).
 *
 * Wires the Cloud Platform abstraction, the Discovery Engine, the Resource Store, and the Resource Graph
 * into ONE subsystem that plugs into `runtimeCore` exactly like `initConnectors` / `initCloud` — reusing the
 * secure-bridge IPC, the Platform Event Bus (Timeline), the diagnostics probe registry, the `HttpClient` /
 * `RateLimiter` / `RetryQueue` primitives, and the RBAC gate. It stands up NO parallel runtime, OAuth,
 * vault, timeline, memory, or graph. Discovery adapters (which call AWS/Azure/GCP APIs) are registered here
 * in P6.1; until then the registry is empty and the Cloud Platform Center lists the catalog as unconfigured.
 */
import { join } from 'node:path';
import { app } from 'electron';
import {
  IpcChannel,
  EmptyRequest,
  InfraResourceGraphRequest,
  InfraResourceNeighborsRequest,
  InfraDiscoverRequest,
  InfraActionsRequest,
  InfraActionRequest,
  InfraSearchRequest,
  manifestToPlatformDto,
  resourceNeighbors,
  type CloudPlatformDto,
  type CloudPlatformStats,
  type CloudPlatformAccountDto,
  type CloudPlatformStatus,
  type CloudPlatformHealth,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { makeCheck, type DiagnosticProbe } from '../platform/diagnostics';
import { HttpClient } from '../unified/sync/http';
import { RateLimiter } from '../unified/sync/rateLimiter';
import { createLogger } from '../logger';
import { CLOUD_PLATFORM_MANIFESTS, PLATFORM_BY_ID } from './cloudPlatformManifests';
import { getPlatform } from './platformRegistry';
import { ResourceStore } from './resourceStore';
import { DiscoveryStateStore, type AccountDiscoveryState } from './discoveryState';
import { InfrastructureDiscoveryEngine } from './discoveryEngine';
import { registerAwsPlatform, makeAwsHttp } from './aws/awsAdapter';
import { InfraActionExecutor } from './executor';
import { awsActions } from './aws/awsActions';
import type { DiscoveryHttp } from '@neuropause/shared';
import { AuthError } from '../unified/sync/http';

const log = createLogger('infrastructure');

export interface InfrastructureDeps {
  broadcast: (channel: string, payload: unknown) => void;
  publish: (e: PlatformEventInput) => void;
  now?: () => string;
}

export interface InfrastructureSubsystem {
  handlers: SecureHandlerDef[];
  engine: InfrastructureDiscoveryEngine;
  store: ResourceStore;
  state: DiscoveryStateStore;
  /** A diagnostics probe reporting discovery health (register it in runtimeCore). */
  probe: DiagnosticProbe;
  dispose: () => void;
}

/** Map an account discovery state's status onto the platform-account DTO status. */
function accountStatus(s: AccountDiscoveryState): CloudPlatformStatus {
  switch (s.status) {
    case 'discovering': return 'discovering';
    case 'degraded': return 'degraded';
    case 'error': return 'error';
    default: return 'connected';
  }
}
function accountHealth(s: AccountDiscoveryState): CloudPlatformHealth {
  if (s.status === 'error') return 'down';
  if (s.status === 'degraded' || s.consecutiveFailures > 0) return 'degraded';
  return 'healthy';
}

export async function initInfrastructure(deps: InfrastructureDeps): Promise<InfrastructureSubsystem> {
  const now = deps.now ?? (() => new Date().toISOString());
  const baseDir = safeUserData();
  const store = new ResourceStore(baseDir ? join(baseDir, 'infra-resources.json') : null);
  const state = new DiscoveryStateStore(baseDir ? join(baseDir, 'infra-discovery-state.json') : null);
  await store.load();
  await state.load();
  await state.reconcile();

  const rate = new RateLimiter();
  // P6.1 — register the first concrete Cloud Platform (AWS) into the shared registry.
  registerAwsPlatform();
  // The signed transport for a platform+account. AWS is injected a SigV4-signing transport built from the
  // credential profile; other platforms fall back to the generic bearer client (their adapters land later).
  // An unconfigured AWS degrades every domain `unauthorized` with a clear reason rather than a hard error.
  // This ONE builder is shared by discovery and automation — the executor never creates a second transport.
  const makeHttp = (platformId: string, accountId: string): DiscoveryHttp => {
    if (platformId === 'aws') {
      return makeAwsHttp(rate, accountId) ?? unconfiguredAws();
    }
    return new HttpClient(platformId, async () => '', rate, getPlatform(platformId)?.baseHeaders ?? {});
  };
  const engine = new InfrastructureDiscoveryEngine({
    getPlatform,
    state,
    makeHttp,
    sink: (platformId, accountId, resources, deletedIds) => store.upsertMany(resources, deletedIds, { platformId, accountId }),
    publish: deps.publish,
    now,
  });

  // P6.1 — the confirmation-gated automation executor (AWS high-privilege actions). It reuses `makeHttp`
  // (the same signed discovery transport) and publishes started→completed|failed onto the same event bus, so
  // every action lands in the ONE Timeline/Audit with no parallel runtime.
  const executor = new InfraActionExecutor(
    {
      makeHttp,
      publish: deps.publish,
      regionFor: (platformId, accountId) => state.get(platformId, accountId).region,
      now,
    },
    [...awsActions()],
  );

  // Re-broadcast resource-store changes so the Cloud Platform Center refreshes live.
  store.on('changed', (e) => deps.broadcast(IpcChannel.InfraEventBroadcast, { kind: 'resources', ...e }));
  state.on('changed', (e) => deps.broadcast(IpcChannel.InfraEventBroadcast, { kind: 'discovery', ...e }));

  /* ── Projections the Cloud Platform Center reads ─────────────────────────── */

  const listPlatforms = (): CloudPlatformDto[] =>
    CLOUD_PLATFORM_MANIFESTS.map((m) => {
      const dto = manifestToPlatformDto(m);
      const adapter = getPlatform(m.id);
      const accounts = state.all(m.id).map((s): CloudPlatformAccountDto => ({
        accountId: s.accountId,
        label: s.accountId,
        status: accountStatus(s),
        health: accountHealth(s),
        region: s.region,
        lastDiscoveryAt: s.lastDiscoveryAt,
        nextDiscoveryAt: s.nextDiscoveryAt,
        resourceCount: store.query({ platformId: m.id, accountId: s.accountId }).length,
        consecutiveFailures: s.consecutiveFailures,
      }));
      dto.configured = adapter != null;
      dto.accounts = accounts;
      dto.resourceCount = store.countForPlatform(m.id);
      if (accounts.length > 0) {
        dto.status = accounts.some((a) => a.status === 'discovering') ? 'discovering'
          : accounts.some((a) => a.status === 'error') ? 'error'
          : accounts.some((a) => a.status === 'degraded') ? 'degraded'
          : 'connected';
        dto.health = accounts.some((a) => a.health === 'down') ? 'down'
          : accounts.some((a) => a.health === 'degraded') ? 'degraded'
          : 'healthy';
      }
      return dto;
    });

  const buildStats = (): CloudPlatformStats => {
    const platforms = listPlatforms();
    const domainSet = new Set<string>();
    for (const p of platforms) for (const d of p.domains) domainSet.add(d);
    return {
      platforms: platforms.length,
      configured: platforms.filter((p) => p.configured).length,
      connected: platforms.filter((p) => p.status === 'connected' || p.status === 'discovering' || p.status === 'degraded').length,
      discovering: platforms.filter((p) => p.status === 'discovering').length,
      degraded: platforms.filter((p) => p.status === 'degraded').length,
      down: platforms.filter((p) => p.health === 'down').length,
      accounts: platforms.reduce((n, p) => n + p.accounts.length, 0),
      resources: store.all().length,
      domains: domainSet.size,
    };
  };

  /* ── Diagnostics probe (registered by runtimeCore) ───────────────────────── */

  const probe: DiagnosticProbe = () => {
    const accounts = state.all();
    const errored = accounts.filter((s) => s.status === 'error').length;
    const degraded = accounts.filter((s) => s.status === 'degraded').length;
    const status = errored > 0 ? 'degraded' : degraded > 0 ? 'degraded' : 'ok';
    const detail = accounts.length === 0
      ? `Infrastructure runtime ready — ${CLOUD_PLATFORM_MANIFESTS.length} platforms in catalog, none configured yet.`
      : `${accounts.length} account(s), ${store.all().length} resources, ${errored} errored, ${degraded} degraded.`;
    return makeCheck('infrastructure', 'Cloud & Infrastructure', status, { detail });
  };

  /* ── IPC handlers (RBAC-gated; reads reuse connectors:read, discovery reuses connectors:manage) ── */

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.InfraPlatforms, schema: EmptyRequest, requireAuth: true, permission: 'connectors:read', handler: () => listPlatforms() },
    { channel: IpcChannel.InfraStats, schema: EmptyRequest, requireAuth: true, permission: 'connectors:read', handler: () => buildStats() },
    { channel: IpcChannel.InfraCapabilities, schema: EmptyRequest, requireAuth: true, permission: 'connectors:read', handler: () => CLOUD_PLATFORM_MANIFESTS.map((m) => ({ platformId: m.id, provider: m.provider, domains: m.domains, configured: getPlatform(m.id) != null })) },
    {
      channel: IpcChannel.InfraResourceGraph,
      schema: InfraResourceGraphRequest,
      requireAuth: true,
      permission: 'connectors:read',
      handler: (p) => {
        const req = p as { platformId?: string; accountId?: string };
        return store.graph(Date.parse(now()), req.platformId || req.accountId ? { platformId: req.platformId, accountId: req.accountId } : undefined);
      },
    },
    {
      channel: IpcChannel.InfraResourceNeighbors,
      schema: InfraResourceNeighborsRequest,
      requireAuth: true,
      permission: 'connectors:read',
      handler: (p) => {
        const req = p as { resourceId: string };
        return resourceNeighbors(store.graph(Date.parse(now())), req.resourceId);
      },
    },
    {
      channel: IpcChannel.InfraDiscover,
      schema: InfraDiscoverRequest,
      requireAuth: true,
      permission: 'connectors:manage',
      audit: true,
      handler: async (p) => {
        const req = p as { platformId: string; accountId?: string };
        if (!PLATFORM_BY_ID[req.platformId]) return { ok: false, hadAdapter: false, resources: 0, error: 'Unknown platform', domains: [], created: 0, updated: 0, deleted: 0, retryable: false };
        return engine.discoverAccount(req.platformId, req.accountId ?? 'default');
      },
    },
    // P6.1 — automation action catalog (read) + a single confirmation-gated action run (manage + audited).
    {
      channel: IpcChannel.InfraActions,
      schema: InfraActionsRequest,
      requireAuth: true,
      permission: 'connectors:read',
      handler: (p) => executor.list((p as { platformId?: string }).platformId),
    },
    {
      channel: IpcChannel.InfraAction,
      schema: InfraActionRequest,
      requireAuth: true,
      permission: 'connectors:manage',
      audit: true,
      handler: async (p) => {
        const req = p as { platformId: string; accountId?: string; actionId: string; params?: Record<string, unknown>; confirmed?: boolean };
        return executor.execute(req.platformId, req.accountId ?? 'default', req.actionId, req.params ?? {}, req.confirmed === true);
      },
    },
    // P6.1 — global infrastructure search across every discovered resource (read).
    {
      channel: IpcChannel.InfraSearch,
      schema: InfraSearchRequest,
      requireAuth: true,
      permission: 'connectors:read',
      handler: (p) => {
        const req = p as { query: string; platformId?: string; domain?: string; limit?: number };
        return store.search(req.query, { platformId: req.platformId, domain: req.domain }, req.limit);
      },
    },
  ];

  log.info('Infrastructure runtime ready', { platforms: CLOUD_PLATFORM_MANIFESTS.length, resources: store.all().length });

  return {
    handlers,
    engine,
    store,
    state,
    probe,
    dispose: () => undefined,
  };
}

/** A transport for an AWS platform with no credential profile — every request degrades `unauthorized`. */
function unconfiguredAws(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('AWS credentials are not configured (set NEUROPAUSE_AWS_ACCESS_KEY_ID / _SECRET_ACCESS_KEY)', 403);
  };
  return { getJson: fail, send: fail };
}

/** `app.getPath('userData')` guarded — returns null under a test/headless context where electron app is absent. */
function safeUserData(): string | null {
  try {
    return app?.getPath ? app.getPath('userData') : null;
  } catch {
    return null;
  }
}

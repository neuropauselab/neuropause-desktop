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
import { registerAzurePlatform, makeAzureHttp } from './azure/azureAdapter';
import { registerGcpPlatform, makeGcpHttp } from './gcp/gcpAdapter';
import { registerKubernetesPlatform, makeKubernetesHttp } from './kubernetes/kubernetesAdapter';
import { registerDockerPlatform, makeDockerHttp } from './docker/dockerAdapter';
import { registerVmwarePlatform, makeVmwareHttp } from './vmware/vmwareAdapter';
import { registerCloudflarePlatform, makeCloudflareHttp } from './cloudflare/cloudflareAdapter';
import { registerSnowflakePlatform, makeSnowflakeHttp } from './snowflake/snowflakeAdapter';
import { registerDatabricksPlatform, makeDatabricksHttp } from './databricks/databricksAdapter';
import { registerIacPlatform, makeIacHttp } from './iac/iacAdapter';
import type { IacTransport } from './iac/iacClient';
import { InfraActionExecutor } from './executor';
import { awsActions } from './aws/awsActions';
import { azureActions } from './azure/azureActions';
import { gcpActions } from './gcp/gcpActions';
import { kubernetesActions } from './kubernetes/kubernetesActions';
import { dockerActions } from './docker/dockerActions';
import { vmwareActions } from './vmware/vmwareActions';
import { cloudflareActions } from './cloudflare/cloudflareActions';
import { snowflakeActions } from './snowflake/snowflakeActions';
import { databricksActions } from './databricks/databricksActions';
import { iacActions } from './iac/iacActions';
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
  /** P8.3 — the confirmation-gated action executor, for approved worker actions. */
  actionExecutor: InfraActionExecutor;
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
  // P6.2 — register the second concrete Cloud Platform (Azure). Same registry, same engine, no new runtime.
  registerAzurePlatform();
  // P6.3 — register the third concrete Cloud Platform (Google Cloud). Same registry, same engine, no new runtime.
  registerGcpPlatform();
  // P6.4 — register the fourth concrete Cloud Platform (Kubernetes). Same registry, same engine, no new runtime.
  registerKubernetesPlatform();
  // P6.5 — register the fifth concrete Cloud Platform (Docker). Same registry, same engine, no new runtime.
  registerDockerPlatform();
  // P6.6 — register the sixth concrete Cloud Platform (VMware vSphere). Same registry, same engine, no new runtime.
  registerVmwarePlatform();
  // P6.7 — register the seventh concrete Cloud Platform (Cloudflare). Same registry, same engine, no new runtime.
  registerCloudflarePlatform();
  // P6.8 — register the eighth concrete Cloud Platform (Snowflake). Same registry, same engine, no new runtime.
  registerSnowflakePlatform();
  // P6.9 — register the ninth concrete Cloud Platform (Databricks). Same registry, same engine, no new runtime.
  registerDatabricksPlatform();
  // P6.10 — register the tenth concrete Cloud Platform (Infrastructure as Code: Terraform + OpenTofu + Pulumi).
  registerIacPlatform();
  // The signed transport for a platform+account. AWS is injected a SigV4-signing transport built from the
  // credential profile; other platforms fall back to the generic bearer client (their adapters land later).
  // An unconfigured AWS degrades every domain `unauthorized` with a clear reason rather than a hard error.
  // This ONE builder is shared by discovery and automation — the executor never creates a second transport.
  const makeHttp = (platformId: string, accountId: string): DiscoveryHttp => {
    if (platformId === 'aws') {
      return makeAwsHttp(rate, accountId) ?? unconfiguredAws();
    }
    if (platformId === 'azure') {
      // Azure is a bearer (Entra) transport; an unconfigured Azure degrades every domain `unauthorized`.
      return makeAzureHttp(rate, accountId) ?? unconfiguredAzure();
    }
    if (platformId === 'gcp') {
      // GCP is a bearer (service-account) transport; an unconfigured GCP degrades every domain `unauthorized`.
      return makeGcpHttp(rate, accountId) ?? unconfiguredGcp();
    }
    if (platformId === 'kubernetes') {
      // Kubernetes is a server-pinned bearer transport (accountId = cluster); unconfigured degrades `unauthorized`.
      return makeKubernetesHttp(rate, accountId) ?? unconfiguredKubernetes();
    }
    if (platformId === 'docker') {
      // Docker is an engine-pinned socket/TCP/mTLS transport (accountId = engine); unconfigured degrades `unauthorized`.
      return makeDockerHttp(rate, accountId) ?? unconfiguredDocker();
    }
    if (platformId === 'vmware') {
      // VMware is a server-pinned vCenter session transport (accountId = vCenter); unconfigured degrades `unauthorized`.
      return makeVmwareHttp(rate, accountId) ?? unconfiguredVmware();
    }
    if (platformId === 'cloudflare') {
      // Cloudflare is a fixed-host bearer transport (accountId = Cloudflare account); unconfigured degrades `unauthorized`.
      return makeCloudflareHttp(rate, accountId) ?? unconfiguredCloudflare();
    }
    if (platformId === 'snowflake') {
      // Snowflake is a host-pinned key-pair-JWT SQL transport (accountId = account); unconfigured degrades `unauthorized`.
      return makeSnowflakeHttp(rate, accountId) ?? unconfiguredSnowflake();
    }
    if (platformId === 'databricks') {
      // Databricks is a host-pinned PAT-bearer transport (accountId = workspace); unconfigured degrades `unauthorized`.
      return makeDatabricksHttp(rate, accountId) ?? unconfiguredDatabricks();
    }
    if (platformId === 'iac') {
      // IaC is a flavor-aware host-pinned transport (accountId = backend flavor); unconfigured degrades `unauthorized`.
      return makeIacHttp(rate, accountId) ?? unconfiguredIac();
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
    [...awsActions(), ...azureActions(), ...gcpActions(), ...kubernetesActions(), ...dockerActions(), ...vmwareActions(), ...cloudflareActions(), ...snowflakeActions(), ...databricksActions(), ...iacActions()],
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
    // P8.3 — the confirmation-gated action executor, so approved worker actions can run it.
    actionExecutor: executor,
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

/** A transport for an Azure platform with no credential profile — every request degrades `unauthorized`. */
function unconfiguredAzure(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Azure credentials are not configured (set NEUROPAUSE_AZURE_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a GCP platform with no credential profile — every request degrades `unauthorized`. */
function unconfiguredGcp(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('GCP credentials are not configured (set NEUROPAUSE_GCP_SERVICE_ACCOUNT_JSON or NEUROPAUSE_GCP_CLIENT_EMAIL / _PRIVATE_KEY)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a Kubernetes platform with no cluster profile — every request degrades `unauthorized`. */
function unconfiguredKubernetes(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Kubernetes cluster is not configured (set NEUROPAUSE_K8S_API_SERVER / NEUROPAUSE_K8S_TOKEN)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a Docker platform with no engine profile — every request degrades `unauthorized`. */
function unconfiguredDocker(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Docker engine is not configured (set NEUROPAUSE_DOCKER_HOST, e.g. unix:///var/run/docker.sock or tcp://host:2376)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a VMware platform with no vCenter profile — every request degrades `unauthorized`. */
function unconfiguredVmware(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('vCenter is not configured (set NEUROPAUSE_VMWARE_HOST / NEUROPAUSE_VMWARE_USERNAME / NEUROPAUSE_VMWARE_PASSWORD)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a Cloudflare platform with no API token — every request degrades `unauthorized`. */
function unconfiguredCloudflare(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Cloudflare API token is not configured (set NEUROPAUSE_CLOUDFLARE_API_TOKEN)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a Snowflake platform with no key-pair profile — every request degrades `unauthorized`. */
function unconfiguredSnowflake(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Snowflake key-pair credentials are not configured (set NEUROPAUSE_SNOWFLAKE_ACCOUNT / NEUROPAUSE_SNOWFLAKE_USER / NEUROPAUSE_SNOWFLAKE_PRIVATE_KEY)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for a Databricks platform with no workspace profile — every request degrades `unauthorized`. */
function unconfiguredDatabricks(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('Databricks workspace is not configured (set NEUROPAUSE_DATABRICKS_HOST / NEUROPAUSE_DATABRICKS_TOKEN)', 403);
  };
  return { getJson: fail, send: fail };
}

/** A transport for an IaC platform with no backend configured — every request degrades `unauthorized`. The stub
 *  carries a flavor so the collectors narrow it (via `asIac`) and then degrade on the first real request. */
function unconfiguredIac(): DiscoveryHttp {
  const fail = async (): Promise<never> => {
    throw new AuthError('No IaC backend is configured (set NEUROPAUSE_IAC_TERRAFORM_TOKEN / _ORG, NEUROPAUSE_IAC_PULUMI_TOKEN / _ORG, or NEUROPAUSE_IAC_OPENTOFU_TOKEN / _ORG)', 403);
  };
  const stub: IacTransport = { flavor: 'terraform', organization: '', getJson: fail, send: fail, getArtifact: fail, getLocation: fail };
  return stub;
}

/** `app.getPath('userData')` guarded — returns null under a test/headless context where electron app is absent. */
function safeUserData(): string | null {
  try {
    return app?.getPath ? app.getPath('userData') : null;
  } catch {
    return null;
  }
}

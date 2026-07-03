/**
 * Cloud Platform composition root (Phase 9 · Stage 1). Loads the multi-tenant
 * runtime, identity federation, cloud synchronization, the API platform, and
 * enterprise administration; wires their IPC handlers behind the secure bridge;
 * and emits a single `cloud:event` broadcast on any change so the renderer stays
 * live.
 *
 * Reads across subsystems: the workforce registry (tenant workers, active
 * worker count), the organization runtime (admin users), the API gateway metrics
 * (API request volume), and billing (home-tenant monthly spend).
 */
import {
  IpcChannel,
  EmptyRequest,
  CloudCreateTenantRequest,
  CloudSetTenantStatusRequest,
  CloudProjectsRequest,
  CloudCreateProjectRequest,
  CloudDeleteProjectRequest,
  CloudTeamsRequest,
  CloudCreateTeamRequest,
  CloudTenantWorkersRequest,
  CloudCreateSsoRequest,
  CloudUpdateSsoRequest,
  CloudDeleteSsoRequest,
  CloudTestSsoRequest,
  CloudSetScimRequest,
  CloudSetMfaRequest,
  CloudSyncDomainRequest,
  CloudSyncSetOnlineRequest,
  LiveSyncSetOnlineRequest,
  LiveSyncSetActiveOrgRequest,
  CloudSyncRecordChangeRequest,
  CloudSetPolicyEnabledRequest,
  CloudCreateWebhookRequest,
  CloudSetWebhookStatusRequest,
  CloudDeleteWebhookRequest,
  CloudTestWebhookRequest,
  type CloudRegionId,
  type DataResidency,
  type FederationResult,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { tenancyStore, CLOUD_REGIONS } from './tenancy/tenancyInstance';
import { federationStore } from './identity/federationInstance';
import { syncStore } from './sync/syncInstance';
import { liveSync, setLiveSyncActiveOrg } from './livesync/liveSyncInstance';
import { apiPlatformStore } from './apiplatform/apiPlatformInstance';
import { evaluateFederation, buildTestAssertion } from './identity/federation';
import {
  buildAdminOverview,
  buildComplianceReport,
  type AdminInput,
  type AdminUserInput,
} from './admin/admin';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { orgStore } from '../enterprise/org/orgInstance';
import { gatewayStore } from '../ecosystem/gateway/gatewayInstance';
import { billingStore } from '../ecosystem/billing/billingInstance';
import { PLAN_CATALOG } from '../ecosystem/billing/billing';
import { ORG_ID } from '../enterprise/org/seed';

const log = createLogger('cloud');

export interface CloudDeps {
  broadcast: (channel: string, payload: unknown) => void;
}

export interface CloudSubsystem {
  handlers: SecureHandlerDef[];
}

const REGION_RESIDENCY = Object.fromEntries(
  CLOUD_REGIONS.map((r) => [r.id, r.residency]),
) as Record<CloudRegionId, DataResidency>;

function homeUsersForAdmin(): AdminUserInput[] {
  return orgStore.usersFor(ORG_ID).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? `${u.name.toLowerCase().replace(/\s+/g, '.')}@neuropause.app`,
    role: u.title,
    isWorker: u.kind !== 'human',
  }));
}

function homeMonthly(): number {
  const sub = billingStore.getSubscription();
  return PLAN_CATALOG[sub.planTier]?.priceMonthly ?? 0;
}

function buildAdminInput(): AdminInput {
  const home = tenancyStore.homeTenant();
  return {
    tenants: tenancyStore.listTenants(),
    isolation: tenancyStore.listIsolation(),
    homeTenantId: home?.id ?? '',
    homeUsers: homeUsersForAdmin(),
    homeMonthly: homeMonthly(),
    identity: federationStore.summary(),
    apiRequests30d: gatewayStore.metrics(30, Date.now()).requests,
    syncOps30d: syncStore.states_().reduce((n, s) => n + s.localVersion, 0),
    activeWorkers: workerRegistry.summaries().length,
    regionResidency: REGION_RESIDENCY,
    now: Date.now(),
  };
}

export async function initCloud(deps: CloudDeps): Promise<CloudSubsystem> {
  await tenancyStore.load();
  const home = tenancyStore.homeTenant();
  const homeId = home?.id ?? '';

  // Fold the live workforce onto the home tenant.
  tenancyStore.syncHomeWorkers(
    workerRegistry.summaries().map((w) => ({ workerId: w.id, name: w.name, role: w.role })),
  );

  await federationStore.load(homeId);
  await apiPlatformStore.load(homeId);
  await syncStore.load();
  await liveSync.init();
  liveSync.start();

  const emit = (kind: string): void =>
    deps.broadcast(IpcChannel.CloudEventBroadcast, { kind, at: new Date().toISOString() });
  tenancyStore.on('changed', () => emit('tenancy'));
  federationStore.on('changed', () => emit('identity'));
  syncStore.on('changed', () => emit('sync'));
  apiPlatformStore.on('changed', () => emit('apiplatform'));

  log.info('Cloud platform ready', {
    homeTenant: home?.name,
    tenants: tenancyStore.listTenants().length,
    regions: CLOUD_REGIONS.length,
    region: home?.regionId,
  });
  log.info('Cloud services ready', {
    deployments: apiPlatformStore.listDeployments().length,
    syncDomains: syncStore.states_().length,
    sso: federationStore.listConnections().length,
    online: syncStore.isOnline(),
  });

  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    /* ── Multi-tenant runtime ── */
    {
      channel: IpcChannel.CloudRegions,
      schema: EmptyRequest,
      handler: () => tenancyStore.regions(),
    },
    {
      channel: IpcChannel.CloudTenants,
      schema: EmptyRequest,
      handler: () => tenancyStore.listTenants(),
    },
    {
      channel: IpcChannel.CloudTenantSummary,
      schema: EmptyRequest,
      handler: () => tenancyStore.summary(),
    },
    {
      channel: IpcChannel.CloudCreateTenant,
      schema: CloudCreateTenantRequest,
      audit: true,
      handler: (p) => {
        const r = p as CloudCreateTenantRequest;
        return tenancyStore.createTenant({ name: r.name, regionId: r.regionId, tier: r.tier });
      },
    },
    {
      channel: IpcChannel.CloudSetTenantStatus,
      schema: CloudSetTenantStatusRequest,
      audit: true,
      handler: (p) => {
        const r = p as CloudSetTenantStatusRequest;
        const result = tenancyStore.setTenantStatus(r.tenantId, r.status);
        return result ?? { error: 'Tenant not found or is the home tenant.' };
      },
    },
    {
      channel: IpcChannel.CloudProjects,
      schema: CloudProjectsRequest,
      handler: (p) => tenancyStore.listProjects((p as { tenantId?: string }).tenantId),
    },
    {
      channel: IpcChannel.CloudCreateProject,
      schema: CloudCreateProjectRequest,
      handler: (p) => {
        const r = p as CloudCreateProjectRequest;
        return (
          tenancyStore.createProject({
            tenantId: r.tenantId,
            name: r.name,
            description: r.description,
          }) ?? { error: 'Tenant not found.' }
        );
      },
    },
    {
      channel: IpcChannel.CloudDeleteProject,
      schema: CloudDeleteProjectRequest,
      handler: (p) => ({ deleted: tenancyStore.deleteProject((p as { id: string }).id) }),
    },
    {
      channel: IpcChannel.CloudTeams,
      schema: CloudTeamsRequest,
      handler: (p) => tenancyStore.listTeams((p as { tenantId?: string }).tenantId),
    },
    {
      channel: IpcChannel.CloudCreateTeam,
      schema: CloudCreateTeamRequest,
      handler: (p) => {
        const r = p as CloudCreateTeamRequest;
        return (
          tenancyStore.createTeam({ tenantId: r.tenantId, name: r.name }) ?? {
            error: 'Tenant not found.',
          }
        );
      },
    },
    {
      channel: IpcChannel.CloudTenantWorkers,
      schema: CloudTenantWorkersRequest,
      handler: (p) => tenancyStore.listWorkers((p as { tenantId?: string }).tenantId),
    },
    {
      channel: IpcChannel.CloudStorageIsolation,
      schema: EmptyRequest,
      handler: () => tenancyStore.listIsolation(),
    },

    /* ── Identity federation ── */
    {
      channel: IpcChannel.CloudSsoConnections,
      schema: EmptyRequest,
      handler: () => federationStore.listConnections(),
    },
    {
      channel: IpcChannel.CloudIdentitySummary,
      schema: EmptyRequest,
      handler: () => federationStore.summary(),
    },
    {
      channel: IpcChannel.CloudCreateSso,
      schema: CloudCreateSsoRequest,
      audit: true,
      handler: (p) => {
        const r = p as CloudCreateSsoRequest;
        return federationStore.createConnection({
          name: r.name,
          protocol: r.protocol,
          issuer: r.issuer,
          entityId: r.entityId,
          ssoUrl: r.ssoUrl,
          clientId: r.clientId,
          domains: r.domains,
          attributeMapping: r.attributeMapping,
        });
      },
    },
    {
      channel: IpcChannel.CloudUpdateSso,
      schema: CloudUpdateSsoRequest,
      audit: true,
      handler: (p) => {
        const r = p as CloudUpdateSsoRequest;
        const patch: Record<string, unknown> = {};
        if (r.status !== undefined) patch.status = r.status;
        if (r.enforced !== undefined) patch.enforced = r.enforced;
        if (r.domains !== undefined) patch.domains = r.domains;
        if (r.name !== undefined) patch.name = r.name;
        return federationStore.updateConnection(r.id, patch) ?? { error: 'Connection not found.' };
      },
    },
    {
      channel: IpcChannel.CloudDeleteSso,
      schema: CloudDeleteSsoRequest,
      audit: true,
      handler: (p) => ({ deleted: federationStore.deleteConnection((p as { id: string }).id) }),
    },
    {
      channel: IpcChannel.CloudTestSso,
      schema: CloudTestSsoRequest,
      handler: (p): FederationResult => {
        const conn = federationStore.connection((p as { id: string }).id);
        if (!conn)
          return { ok: false, identity: null, reason: 'Connection not found.', mfaRequired: false };
        const mfa = federationStore.mfaPolicy() ?? {
          tenantId: '',
          required: false,
          methods: [],
          graceDays: 0,
        };
        return evaluateFederation(conn, buildTestAssertion(conn), mfa);
      },
    },
    {
      channel: IpcChannel.CloudScim,
      schema: EmptyRequest,
      handler: () => federationStore.scimConfig(),
    },
    {
      channel: IpcChannel.CloudSetScim,
      schema: CloudSetScimRequest,
      audit: true,
      handler: (p) => federationStore.setScim((p as { enabled: boolean }).enabled),
    },
    {
      channel: IpcChannel.CloudScimSync,
      schema: EmptyRequest,
      handler: () =>
        federationStore.recordScimSync(
          orgStore.usersFor(ORG_ID).filter((u) => u.kind === 'human').length,
        ) ?? { error: 'SCIM is not enabled.' },
    },
    {
      channel: IpcChannel.CloudMfa,
      schema: EmptyRequest,
      handler: () => federationStore.mfaPolicy(),
    },
    {
      channel: IpcChannel.CloudSetMfa,
      schema: CloudSetMfaRequest,
      audit: true,
      handler: (p) => federationStore.setMfa(p as CloudSetMfaRequest),
    },

    /* ── Cloud synchronization ── */
    {
      channel: IpcChannel.CloudSyncStates,
      schema: EmptyRequest,
      handler: () => syncStore.states_(),
    },
    {
      channel: IpcChannel.CloudSyncSummary,
      schema: EmptyRequest,
      handler: () => syncStore.summary(),
    },
    {
      channel: IpcChannel.CloudSyncConflicts,
      schema: EmptyRequest,
      handler: () => syncStore.listConflicts(),
    },
    {
      channel: IpcChannel.CloudSyncDomain,
      schema: CloudSyncDomainRequest,
      handler: (p) => syncStore.syncDomain((p as CloudSyncDomainRequest).domain),
    },
    { channel: IpcChannel.CloudSyncAll, schema: EmptyRequest, handler: () => syncStore.syncAll() },
    {
      channel: IpcChannel.CloudSyncSetOnline,
      schema: CloudSyncSetOnlineRequest,
      handler: (p) => {
        syncStore.setOnline((p as { online: boolean }).online);
        return syncStore.summary();
      },
    },
    {
      channel: IpcChannel.CloudSyncRecordChange,
      schema: CloudSyncRecordChangeRequest,
      handler: (p) => {
        const r = p as CloudSyncRecordChangeRequest;
        syncStore.recordLocalChange(r.domain, r.count ?? 1);
        return syncStore.summary();
      },
    },

    // Live cloud sync (real record-level sync engine).
    {
      channel: IpcChannel.LiveSyncStatus,
      schema: EmptyRequest,
      handler: () => liveSync.getStatus(),
    },
    { channel: IpcChannel.LiveSyncNow, schema: EmptyRequest, handler: () => liveSync.syncNow() },
    {
      channel: IpcChannel.LiveSyncSetOnline,
      schema: LiveSyncSetOnlineRequest,
      handler: (p) => {
        liveSync.setOnline((p as LiveSyncSetOnlineRequest).online);
        return liveSync.getStatus();
      },
    },
    {
      channel: IpcChannel.LiveSyncSetActiveOrg,
      schema: LiveSyncSetActiveOrgRequest,
      handler: (p) => {
        setLiveSyncActiveOrg((p as LiveSyncSetActiveOrgRequest).orgId);
        return liveSync.getStatus();
      },
    },

    /* ── Enterprise API platform ── */
    {
      channel: IpcChannel.CloudDeployments,
      schema: EmptyRequest,
      handler: () => apiPlatformStore.listDeployments(),
    },
    {
      channel: IpcChannel.CloudApiSummary,
      schema: EmptyRequest,
      handler: () => apiPlatformStore.summary(gatewayStore.metrics(30, Date.now()).requests),
    },
    {
      channel: IpcChannel.CloudRatePolicies,
      schema: EmptyRequest,
      handler: () => apiPlatformStore.listPolicies(),
    },
    {
      channel: IpcChannel.CloudSetPolicyEnabled,
      schema: CloudSetPolicyEnabledRequest,
      handler: (p) => {
        const r = p as CloudSetPolicyEnabledRequest;
        return apiPlatformStore.setPolicyEnabled(r.id, r.enabled) ?? { error: 'Policy not found.' };
      },
    },
    {
      channel: IpcChannel.CloudWebhooks,
      schema: EmptyRequest,
      handler: () => apiPlatformStore.listWebhooks(),
    },
    {
      channel: IpcChannel.CloudCreateWebhook,
      schema: CloudCreateWebhookRequest,
      audit: true,
      handler: (p) => {
        const r = p as CloudCreateWebhookRequest;
        return apiPlatformStore.createWebhook({ url: r.url, events: r.events });
      },
    },
    {
      channel: IpcChannel.CloudSetWebhookStatus,
      schema: CloudSetWebhookStatusRequest,
      handler: (p) => {
        const r = p as CloudSetWebhookStatusRequest;
        return apiPlatformStore.setWebhookStatus(r.id, r.status) ?? { error: 'Webhook not found.' };
      },
    },
    {
      channel: IpcChannel.CloudDeleteWebhook,
      schema: CloudDeleteWebhookRequest,
      audit: true,
      handler: (p) => ({ deleted: apiPlatformStore.deleteWebhook((p as { id: string }).id) }),
    },
    {
      channel: IpcChannel.CloudTestWebhook,
      schema: CloudTestWebhookRequest,
      handler: (p) =>
        apiPlatformStore.testWebhook((p as { id: string }).id) ?? { error: 'Webhook not found.' },
    },
    {
      channel: IpcChannel.CloudPublicApis,
      schema: EmptyRequest,
      handler: () => apiPlatformStore.listPublicApis(),
    },

    /* ── Enterprise administration ── */
    {
      channel: IpcChannel.CloudAdminOverview,
      schema: EmptyRequest,
      handler: () => buildAdminOverview(buildAdminInput()),
    },
    {
      channel: IpcChannel.CloudAdminCompliance,
      schema: EmptyRequest,
      handler: () => buildComplianceReport(buildAdminInput()),
    },
  ];
}

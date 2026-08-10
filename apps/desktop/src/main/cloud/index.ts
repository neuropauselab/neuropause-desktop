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
  LiveSyncSetOnlineRequest,
  LiveSyncSetActiveOrgRequest,
  CloudSetPolicyEnabledRequest,
  CloudCreateWebhookRequest,
  CloudSetWebhookStatusRequest,
  CloudDeleteWebhookRequest,
  CloudTestWebhookRequest,
  type CloudRegionId,
  type DataResidency,
  type FederationResult,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { tenancyStore, CLOUD_REGIONS } from './tenancy/tenancyInstance';
import { federationStore } from './identity/federationInstance';
import { liveSync, onLiveSyncStatus, setLiveSyncActiveOrg } from './livesync/liveSyncInstance';
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
import { activeTenantScope, resolveTenantContext } from '../enterprise/index';

const log = createLogger('cloud');

export interface CloudDeps {
  broadcast: IpcBroadcaster;
}

export interface CloudSubsystem {
  handlers: SecureHandlerDef[];
}

const REGION_RESIDENCY = Object.fromEntries(
  CLOUD_REGIONS.map((r) => [r.id, r.residency]),
) as Record<CloudRegionId, DataResidency>;

/**
 * The CALLER's own members, for the Cloud admin surface.
 *
 * P13C REMEDIATION — N1. This read `orgStore.usersFor(ORG_ID)`: the literal
 * seeded organization, regardless of who was asking. It feeds `CloudAdminOverview`
 * and `CloudAdminCompliance`, so every tenant was shown the seeded tenant's real
 * names, emails and titles. Same defect class the ecosystem fix removed, in a
 * file that fix did not touch.
 *
 * An unresolved caller gets an EMPTY roster, not the seeded one.
 */
/**
 * The cloud tenant this call acts in, resolved SERVER-SIDE.
 *
 * P13C REMEDIATION — N4. `CloudProjects`, `CloudTeams` and `CloudTenantWorkers`
 * took `tenantId` from the payload, and the schema made it optional — so the
 * bypass was to omit it, which returned every tenant's rows. The write
 * channels took it from the payload too, guarded only by "does this tenant
 * exist".
 *
 * The tenant is now the caller's own. Nothing on these channels reads a
 * payload-supplied tenant any more, so a renderer cannot name one at all —
 * which is the same rule `EnterpriseWorkspaceCreate` follows and, unlike an
 * added membership check, leaves no parameter to get wrong later.
 */
function callerTenantId(): string {
  return activeTenantScope()?.tenantId ?? '';
}

function homeUsersForAdmin(): AdminUserInput[] {
  const scope = activeTenantScope();
  if (scope === null) return [];
  return orgStore.usersFor(scope.tenantId).map((u) => ({
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
    // Real applied-operation counter from the live sync engine (its cursor is a
    // monotonically increasing sequence of applied changes). Honest zero offline.
    syncOps30d: liveSync.getStatus().cursor,
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
  await liveSync.init();
  liveSync.start();

  const emit = (kind: string): void =>
    deps.broadcast(IpcChannel.CloudEventBroadcast, { kind, at: new Date().toISOString() });
  tenancyStore.on('changed', () => emit('tenancy'));
  federationStore.on('changed', () => emit('identity'));
  onLiveSyncStatus(() => emit('sync'));
  apiPlatformStore.on('changed', () => emit('apiplatform'));

  log.info('Cloud platform ready', {
    homeTenant: home?.name,
    tenants: tenancyStore.listTenants().length,
    regions: CLOUD_REGIONS.length,
    region: home?.regionId,
  });
  log.info('Cloud services ready', {
    deployments: apiPlatformStore.listDeployments().length,
    sso: federationStore.listConnections().length,
    liveSync: liveSync.getStatus().state,
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
        // Suspending or reactivating a tenant is the most consequential write
        // on this surface; it may only be applied to the caller's own.
        if (r.tenantId !== callerTenantId() || callerTenantId() === '') {
          return { error: 'Tenant not found or is the home tenant.' };
        }
        const result = tenancyStore.setTenantStatus(r.tenantId, r.status);
        return result ?? { error: 'Tenant not found or is the home tenant.' };
      },
    },
    {
      channel: IpcChannel.CloudProjects,
      schema: CloudProjectsRequest,
      handler: () => tenancyStore.listProjects(callerTenantId()),
    },
    {
      channel: IpcChannel.CloudCreateProject,
      schema: CloudCreateProjectRequest,
      handler: (p) => {
        const r = p as CloudCreateProjectRequest;
        return (
          tenancyStore.createProject({
            // The caller's tenant, never `r.tenantId` — the payload could name
            // any tenant and the store only checked that it existed.
            tenantId: callerTenantId(),
            name: r.name,
            description: r.description,
          }) ?? { error: 'Tenant not found.' }
        );
      },
    },
    {
      channel: IpcChannel.CloudDeleteProject,
      schema: CloudDeleteProjectRequest,
      handler: (p) => {
        // `deleteProject(id)` takes a bare id, so ownership is resolved here:
        // the id must appear in the caller's OWN project list.
        const id = (p as { id: string }).id;
        const mine = tenancyStore.listProjects(callerTenantId()).some((x) => x.id === id);
        if (!mine) return { deleted: false };
        return { deleted: tenancyStore.deleteProject(id) };
      },
    },
    {
      channel: IpcChannel.CloudTeams,
      schema: CloudTeamsRequest,
      handler: () => tenancyStore.listTeams(callerTenantId()),
    },
    {
      channel: IpcChannel.CloudCreateTeam,
      schema: CloudCreateTeamRequest,
      handler: (p) => {
        const r = p as CloudCreateTeamRequest;
        return (
          tenancyStore.createTeam({ tenantId: callerTenantId(), name: r.name }) ?? {
            error: 'Tenant not found.',
          }
        );
      },
    },
    {
      channel: IpcChannel.CloudTenantWorkers,
      schema: CloudTenantWorkersRequest,
      handler: () => tenancyStore.listWorkers(callerTenantId()),
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
          /**
           * P13C REMEDIATION — N8. This counted the SEEDED organization's
           * humans and WROTE that number into the calling tenant's SCIM sync
           * record — one tenant's headcount stored as another's fact.
           */
          orgStore.usersFor(activeTenantScope()?.tenantId ?? '').filter((u) => u.kind === 'human')
            .length,
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

    /* ── Cloud synchronization — the real record-level live sync engine ──
       (The pre-livesync domain simulator and its cloud:sync.* channels were
       retired per audit findings A4-2/A5-3; `cloud-sync.json` in userData is
       its orphaned store file and is no longer read.) */
    {
      channel: IpcChannel.LiveSyncStatus,
      schema: EmptyRequest,
      handler: () => liveSync.getStatus(),
    },
    {
      channel: IpcChannel.LiveSyncDetail,
      schema: EmptyRequest,
      handler: () => liveSync.getDetail(),
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
        const requested = (p as LiveSyncSetActiveOrgRequest).orgId;
        /**
         * P11 — THE ORG COMES FROM THE SESSION, NOT THE PAYLOAD.
         *
         * This was the sharpest hole the audit found. The live-sync scheduler is
         * a 60-second background push loop with NO actor and NO permission, and
         * its target org was whatever the renderer last set here. So a renderer
         * could point a permission-free egress loop at an arbitrary organization
         * id and walk away — and the memory bridge downstream enqueues every
         * synced item under that id regardless of the item's own org.
         *
         * `null` still means "stop syncing", which is a safe direction and the
         * only way to turn the loop off. Any non-null value must match the
         * tenant the session actually resolves to.
         */
        if (requested === null) {
          setLiveSyncActiveOrg(null);
          return liveSync.getStatus();
        }
        const resolved = resolveTenantContext();
        if (!resolved.ok) throw new Error(resolved.refusal.message);
        if (requested !== resolved.context.tenantId) {
          // Refused without saying whether that org exists.
          throw new Error('Sync can only be pointed at the organization you are signed in to.');
        }
        setLiveSyncActiveOrg(resolved.context.tenantId);
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

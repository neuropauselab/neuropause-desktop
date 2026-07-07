/**
 * Runtime Core composition root. Wires the trusted execution layer together:
 *
 *   - registers every catalog/registry/NPS/runtime/permission channel behind
 *     the secure IPC middleware (the only path the renderer may use);
 *   - bridges NPS progress and runtime lifecycle/health events to the renderer
 *     as broadcasts;
 *   - loads the Local Application Registry and starts background services;
 *   - performs a startup self-check so the logs confirm the layer is live.
 */
import type {
  CatalogSearchRequest as TCatalogSearchRequest,
  CatalogSectionsRequest as TCatalogSectionsRequest,
  CatalogReviewsRequest as TCatalogReviewsRequest,
  CatalogToggleBookmarkRequest as TCatalogToggleBookmarkRequest,
  CatalogSubmitReviewRequest as TCatalogSubmitReviewRequest,
  RegistrySetFlagsRequest as TRegistrySetFlagsRequest,
  RegistryImportRequest as TRegistryImportRequest,
  NpsInstallRequest as TNpsInstallRequest,
  PermissionMutationRequest as TPermissionMutationRequest,
  RuntimeHealthRequest as TRuntimeHealthRequest,
  SlugRequest as TSlugRequest,
  InstanceRequest as TInstanceRequest,
  OperationRequest as TOperationRequest,
  PluginIdRequest as TPluginIdRequest,
  PluginInstallRequest as TPluginInstallRequest,
  PluginPermissionRequest as TPluginPermissionRequest,
  PluginContributionsRequest as TPluginContributionsRequest,
  VoiceRuntimeState,
  SupervisedSubsystem,
  RecoveryPolicy,
  ExecutionRequest,
  LicenseState,
  BillingPlanId,
  DeviceTrustStatus,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  VoiceStatusRequest,
  SupervisorRecoverRequest,
  SupervisorSetPolicyRequest,
  ExecuteRunRequest,
  ExecuteCancelRequest,
  LicenseReportHealthRequest,
  BillingCheckoutRequest,
  DevicesRegisterRequest,
  DevicesListRequest,
  DevicesRevokeRequest,
  DeviceReportHealthRequest,
  primaryNextStatus,
  recoverInterrupted,
  SlugRequest,
  InstanceRequest,
  OperationRequest,
  CatalogSectionsRequest,
  CatalogSearchRequest,
  CatalogReviewsRequest,
  CatalogToggleBookmarkRequest,
  CatalogSubmitReviewRequest,
  RegistrySetFlagsRequest,
  RegistryImportRequest,
  NpsInstallRequest,
  RuntimeHealthRequest,
  PermissionMutationRequest,
  PluginIdRequest,
  PluginInstallRequest,
  PluginPermissionRequest,
  PluginContributionsRequest,
  OrgCreateRequest,
  OrgIdRequest,
  OrgUpdateRequest,
  OrgInviteRequest,
  OrgAcceptInviteRequest,
  OrgChangeRoleRequest,
  OrgMembershipRequest,
  OrgCreateWorkspaceRequest,
  OrgWorkspaceRequest,
  OrgUpdateWorkspaceRequest,
} from '@neuropause/shared';
import { app, shell } from 'electron';
import { join } from 'node:path';
import { createLogger } from './logger';
import { authService } from './auth/authService';
import { catalogClient } from './catalog/catalogClient';
import { orgClient } from './organization/orgClient';
import { registry } from './registry/registry';
import { packageService } from './nps/packageService';
import { supervisor } from './runtime/supervisor';
import { permissionManager } from './permissions/permissionManager';
import { serviceManager } from './services/serviceManager';
import { pluginManager } from './plugins/pluginManager';
import { pluginHost } from './plugins/pluginHost';
import { registerSecureHandlers, type SecureHandlerDef } from './ipc/secureBridge';
import { initPlatform, registerDiagnosticProbes } from './platform';
import { build } from './platform/producers';
import { initConnectors } from './connectors';
import { initUnified } from './unified';
import { initSync } from './unified/sync';
import { initGraph } from './graph';
import { initMemory } from './memory';
import { initKnowledge } from './knowledge';
import { initEnterpriseTimeline } from './timeline';
import { initEnterpriseSearch } from './search';
import { initDailyIntelligence } from './intelligence';
import { initExecutiveCenter } from './enterprise/executiveCenterSubsystem';
import { initDecisions } from './enterprise/decisionSubsystem';
import { decisionStore } from './enterprise/decisionInstance';
import {
  initAutomations,
  getAutomationMonitor,
  getAutomationRunner,
} from './enterprise/automationSubsystem';
import { NeuroCore } from './neuroCore';
import { RuntimeSupervisor } from './runtimeSupervisor';
import { ExecuteEngine } from './executeEngine';
import { ExecutionStore } from './executionStore';
import {
  getVoiceRuntimeState,
  setVoiceRuntimeState,
  onVoiceStateChange,
} from './voiceRuntimeState';
import { getLicenseRuntimeState, setLicenseRuntimeState } from './licenseRuntimeState';
import { getDeviceRuntimeState, setDeviceRuntimeState } from './deviceRuntimeState';
import { liveSync } from './cloud/livesync/liveSyncInstance';
import { billingClient } from './billing/billingClient';
import { deviceClient } from './devices/deviceClient';
import { initVoice } from './voice/voiceSubsystem';
import { initExecutiveDelivery } from './services/executiveDelivery';
import { initRecommendations } from './recommendations';
import { initFounderAI } from './founder';
import { initEngineeringAI, initFounderAIv2 } from './ai';
import { initTrace } from './trace';
import { initWorkforce } from './workforce';
import { initEnterprise } from './enterprise';
import { initEcosystem } from './ecosystem';
import { initCloud } from './cloud';
import { initFederation } from './federation';
import { initUpdater } from './updater';
import { initReleaseOps } from './releaseOps';
import { initFeatureFlags } from './featureFlags';
import { initLicense } from './license';
import { initOnboarding } from './onboarding';
import { initFeedback } from './feedback';
import { initPilot } from './pilot';
import { aiMemoryProbe, knowledgeGraphProbe, ollamaProbe } from './platform/aiHealthProbes';
import { memoryStore } from './memory/memoryInstance';
import { graphStore } from './graph/graphInstance';
const log = createLogger('runtime-core');
export interface RuntimeCoreDeps {
  broadcast: (channel: string, payload: unknown) => void;
}
export async function initRuntimeCore(deps: RuntimeCoreDeps): Promise<void> {
  await registry.load();
  await pluginManager.load();
  // Platform core: event bus + timeline + subscribers + diagnostics.
  const platform = await initPlatform({ broadcast: deps.broadcast });
  // Connector Framework (NCF): SDK + OAuth engine + registry + lifecycle runtime.
  const connectors = await initConnectors({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
  });
  // Unified knowledge layer (UDM): canonical store + query engine + local search.
  const unified = await initUnified({ broadcast: deps.broadcast });
  // Sync engine: adapters → UDM, incremental + scheduled, wired to the event bus.
  const sync = await initSync({ publish: platform.api.publish, broadcast: deps.broadcast });
  // Enterprise Knowledge Graph: projects the UDM into a typed graph with
  // relationship history; the foundation the Phase 5 intelligence layer reads.
  const graph = await initGraph({ broadcast: deps.broadcast });
  // AI Memory: distills the UDM into a searchable organizational memory.
  const memory = await initMemory({ broadcast: deps.broadcast });
  const knowledge = initKnowledge();
  // Enterprise Timeline: unified stream of platform events + UDM work-activity.
  const timeline = initEnterpriseTimeline({
    broadcast: deps.broadcast,
    platformQuery: (q) => platform.api.query(q),
  });
  // Enterprise Search: one federated search across entities, graph, memory, timeline.
  const search = initEnterpriseSearch();
  // Daily Intelligence + Recommendations: evidence-grounded briefings and next-actions.
  const intelligence = initDailyIntelligence();
  const recommendations = initRecommendations();
  // Executive Intelligence Center (V2.4): one snapshot composing existing
  // intelligence (founder proactive + org intelligence + org-health KPIs).
  const executiveCenter = initExecutiveCenter();
  // Executive Decision Intelligence (V3.3): persists + transitions decisions,
  // convertible from the executive center's recommendations (traceability).
  const decisions = initDecisions(() => executiveCenter.snapshot());
  // Automation Builder (Module 9): persists user Trigger→Condition→Action rules.
  // V4.8: wire platform publish + subscribe so automations fire on real events
  // and completed runs surface on the timeline/activity bus.
  const automations = initAutomations({
    publish: platform.api.publish,
    on: (types, handler) => platform.api.on(types, handler),
  });
  // Executive Voice Assistant (V2.6): routes recognized speech to existing
  // intelligence and composes evidence-grounded spoken responses. No new AI.
  const voice = initVoice();
  // Executive Intelligence Delivery: proactively delivers the already-built brief
  // (and future sources) on a schedule via the existing notification path. Reuses
  // intelligence + scheduler + notifications; adds no new AI or scheduler.
  await initExecutiveDelivery();
  // Founder AI: evidence-grounded Q&A that separates facts from suggestions.
  const founder = initFounderAI();
  // Engineering AI: AI Engine + Context Builder over live data, governed, with a
  // deterministic fallback when no model is reachable.
  const engineeringAI = initEngineeringAI();
  // Founder AI v2: executive intelligence — intent detection → context → engine →
  // governed executive answer, with deterministic findings as the offline fallback.
  const founderAIv2 = initFounderAIv2();
  // Traces: governance, context, and relationship explainability.
  const trace = initTrace();
  // AI Workforce: governed, evidence-grounded workers over the intelligence layer.
  const workforce = await initWorkforce({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
  });
  // Enterprise Operating System: organization runtime + graph + governance +
  // multi-workspace isolation + the executive snapshot that rolls it all up.
  const enterprise = await initEnterprise({ broadcast: deps.broadcast });
  // Ecosystem Platform: developer portal + marketplace + API gateway + billing.
  const ecosystem = await initEcosystem({ broadcast: deps.broadcast });
  // Phase 9 · Stage 1 — Cloud Platform (multi-tenant, identity federation, sync, API platform, admin).
  const cloud = await initCloud({ broadcast: deps.broadcast });
  const featureFlags = await initFeatureFlags();
  const license = await initLicense();
  const onboarding = await initOnboarding();
  const feedback = await initFeedback();
  const pilot = await initPilot();
  const federation = await initFederation({ broadcast: deps.broadcast });
  // Application self-update (electron-updater): channels + check/download/install + rollback prep.
  const updater = initUpdater({ broadcast: deps.broadcast });
  // Release Operations: migration, backup, crash reporting, release diagnostics,
  // Recovery Center actions, and support-bundle generation — one composition.
  const releaseOps = await initReleaseOps({
    broadcast: deps.broadcast,
    platformDiagnostics: () => platform.diagnostics(),
    rebuildGraph: graph.rebuild,
    rebuildSearch: memory.rebuild,
  });
  // Apply any pending data migrations before the app is used. The baseline stamps
  // the data version; future data-transforming migrations run here as well.
  await releaseOps.runStartupMigrations();
  const defs: SecureHandlerDef[] = [
    /* ── catalog (proxy to Store API) ── */
    {
      channel: IpcChannel.CatalogFeatured,
      schema: EmptyRequest,
      handler: () => catalogClient.featured(),
    },
    {
      channel: IpcChannel.CatalogCollections,
      schema: EmptyRequest,
      handler: () => catalogClient.collections(),
    },
    {
      channel: IpcChannel.CatalogSections,
      schema: CatalogSectionsRequest,
      handler: (p) => {
        const r = p as TCatalogSectionsRequest;
        return catalogClient.sections(r.key, r.page, r.pageSize);
      },
    },
    {
      channel: IpcChannel.CatalogSearch,
      schema: CatalogSearchRequest,
      handler: (p) => catalogClient.search(p as TCatalogSearchRequest),
    },
    {
      channel: IpcChannel.CatalogApp,
      schema: SlugRequest,
      handler: (p) => catalogClient.app((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.CatalogReviews,
      schema: CatalogReviewsRequest,
      handler: (p) => {
        const r = p as TCatalogReviewsRequest;
        return catalogClient.reviews(r.slug, r.page, r.pageSize);
      },
    },
    {
      channel: IpcChannel.CatalogDeveloper,
      schema: SlugRequest,
      handler: (p) => catalogClient.developer((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.CatalogCategories,
      schema: EmptyRequest,
      handler: () => catalogClient.categories(),
    },
    {
      channel: IpcChannel.CatalogBookmarks,
      schema: EmptyRequest,
      requireAuth: true,
      handler: () => catalogClient.bookmarks(),
    },
    {
      channel: IpcChannel.CatalogToggleBookmark,
      schema: CatalogToggleBookmarkRequest,
      requireAuth: true,
      audit: true,
      handler: (p) => {
        const r = p as TCatalogToggleBookmarkRequest;
        return r.bookmarked
          ? catalogClient.addBookmark(r.slug)
          : catalogClient.removeBookmark(r.slug);
      },
    },
    {
      channel: IpcChannel.CatalogSubmitReview,
      schema: CatalogSubmitReviewRequest,
      requireAuth: true,
      audit: true,
      handler: (p) => {
        const r = p as TCatalogSubmitReviewRequest;
        return catalogClient.submitReview(r.slug, {
          rating: r.rating,
          title: r.title,
          body: r.body,
        });
      },
    },
    {
      channel: IpcChannel.CatalogRecommendations,
      schema: EmptyRequest,
      requireAuth: true,
      handler: () => catalogClient.recommendations(),
    },
    {
      channel: IpcChannel.CatalogCheckUpdate,
      schema: SlugRequest,
      requireAuth: true,
      handler: async (p) => {
        const slug = (p as TSlugRequest).slug;
        const res = await catalogClient.checkUpdate(slug);
        if (res.updateAvailable)
          platform.api.publish(build.updateAvailable(slug, res.latestVersion));
        return res;
      },
    },
    /* ── cloud organizations (backend /organizations) ── */
    {
      channel: IpcChannel.OrgList,
      schema: EmptyRequest,
      requireAuth: true,
      handler: () => orgClient.list(),
    },
    {
      channel: IpcChannel.OrgCreate,
      schema: OrgCreateRequest,
      requireAuth: true,
      handler: (p) => orgClient.create(p as { name: string; slug?: string }),
    },
    {
      channel: IpcChannel.OrgGet,
      schema: OrgIdRequest,
      requireAuth: true,
      handler: (p) => orgClient.get((p as { orgId: string }).orgId),
    },
    {
      channel: IpcChannel.OrgUpdate,
      schema: OrgUpdateRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; name: string };
        return orgClient.update(r.orgId, r.name);
      },
    },
    {
      channel: IpcChannel.OrgMembers,
      schema: OrgIdRequest,
      requireAuth: true,
      handler: (p) => orgClient.members((p as { orgId: string }).orgId),
    },
    {
      channel: IpcChannel.OrgInvite,
      schema: OrgInviteRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as {
          orgId: string;
          email: string;
          role: 'owner' | 'admin' | 'member' | 'viewer';
        };
        return orgClient.invite(r.orgId, { email: r.email, role: r.role });
      },
    },
    {
      channel: IpcChannel.OrgAcceptInvite,
      schema: OrgAcceptInviteRequest,
      requireAuth: true,
      handler: (p) => orgClient.acceptInvite((p as { token: string }).token),
    },
    {
      channel: IpcChannel.OrgChangeRole,
      schema: OrgChangeRoleRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as {
          orgId: string;
          membershipId: string;
          role: 'owner' | 'admin' | 'member' | 'viewer';
        };
        return orgClient.changeRole(r.orgId, r.membershipId, r.role);
      },
    },
    {
      channel: IpcChannel.OrgRemoveMember,
      schema: OrgMembershipRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; membershipId: string };
        return orgClient.removeMember(r.orgId, r.membershipId);
      },
    },
    {
      channel: IpcChannel.OrgWorkspaces,
      schema: OrgIdRequest,
      requireAuth: true,
      handler: (p) => orgClient.workspaces((p as { orgId: string }).orgId),
    },
    {
      channel: IpcChannel.OrgCreateWorkspace,
      schema: OrgCreateWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; name: string };
        return orgClient.createWorkspace(r.orgId, r.name);
      },
    },
    {
      channel: IpcChannel.OrgUpdateWorkspace,
      schema: OrgUpdateWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; workspaceId: string; name: string };
        return orgClient.updateWorkspace(r.orgId, r.workspaceId, r.name);
      },
    },
    {
      channel: IpcChannel.OrgDeleteWorkspace,
      schema: OrgWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; workspaceId: string };
        return orgClient.deleteWorkspace(r.orgId, r.workspaceId);
      },
    },
    /* ── local application registry ── */
    { channel: IpcChannel.RegistryList, schema: EmptyRequest, handler: () => registry.list() },
    {
      channel: IpcChannel.RegistryGet,
      schema: SlugRequest,
      handler: (p) => registry.get((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.RegistrySetFlags,
      schema: RegistrySetFlagsRequest,
      audit: true,
      handler: (p) => {
        const r = p as TRegistrySetFlagsRequest;
        return registry.setFlags(r.slug, { pinned: r.pinned, favorite: r.favorite });
      },
    },
    { channel: IpcChannel.RegistryStats, schema: EmptyRequest, handler: () => registry.stats() },
    {
      channel: IpcChannel.RegistryExport,
      schema: EmptyRequest,
      handler: () => ({ data: registry.export() }),
    },
    {
      channel: IpcChannel.RegistryImport,
      schema: RegistryImportRequest,
      audit: true,
      handler: async (p) => ({
        count: await registry.import((p as TRegistryImportRequest).data, { merge: true }),
      }),
    },
    {
      channel: IpcChannel.RegistryBackup,
      schema: EmptyRequest,
      audit: true,
      handler: async () => ({ path: await registry.backup() }),
    },
    /* ── NeuroPause Package Service ── */
    {
      channel: IpcChannel.NpsInstall,
      schema: NpsInstallRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 120_000,
      handler: async (p) => {
        const r = p as TNpsInstallRequest;
        const res = await packageService.install({
          slug: r.slug,
          channel: r.channel,
          grantedPermissions: r.grantedPermissions ?? [],
          installLocation: r.installLocation,
        });
        if (res.ok)
          platform.api.publish(
            build.appInstalled(
              r.slug,
              res.entry?.name ?? null,
              res.entry?.installedVersion ?? null,
            ),
          );
        return res;
      },
    },
    {
      channel: IpcChannel.NpsUninstall,
      schema: SlugRequest,
      requireAuth: true,
      audit: true,
      handler: async (p) => {
        const slug = (p as TSlugRequest).slug;
        await supervisor.stopByApp(slug); // stop the runtime before removing
        const res = await packageService.uninstall(slug);
        if (res.ok) platform.api.publish(build.appRemoved(slug, null));
        return res;
      },
    },
    {
      channel: IpcChannel.NpsUpdate,
      schema: SlugRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 120_000,
      handler: async (p) => {
        const slug = (p as TSlugRequest).slug;
        const res = await packageService.update(slug);
        if (res.ok)
          platform.api.publish(
            build.appUpdated(slug, res.entry?.name ?? null, res.entry?.installedVersion ?? null),
          );
        return res;
      },
    },
    {
      channel: IpcChannel.NpsRollback,
      schema: SlugRequest,
      audit: true,
      handler: async (p) => {
        const slug = (p as TSlugRequest).slug;
        const res = await packageService.rollback(slug);
        if (res.ok) platform.api.publish(build.appUpdated(slug, null, null));
        return res;
      },
    },
    {
      channel: IpcChannel.NpsRepair,
      schema: SlugRequest,
      requireAuth: true,
      audit: true,
      timeoutMs: 120_000,
      handler: (p) => packageService.repair((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.NpsVerify,
      schema: SlugRequest,
      audit: true,
      handler: (p) => packageService.verify((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.NpsOperations,
      schema: EmptyRequest,
      handler: () => packageService.operations(),
    },
    {
      channel: IpcChannel.NpsPause,
      schema: OperationRequest,
      handler: (p) => ({ ok: packageService.pause((p as TOperationRequest).operationId) }),
    },
    {
      channel: IpcChannel.NpsResume,
      schema: OperationRequest,
      handler: async (p) => ({
        ok: await packageService.resume((p as TOperationRequest).operationId),
      }),
    },
    {
      channel: IpcChannel.NpsCancel,
      schema: OperationRequest,
      audit: true,
      handler: async (p) => ({
        ok: await packageService.cancel((p as TOperationRequest).operationId),
      }),
    },
    /* ── runtime ── */
    {
      channel: IpcChannel.RuntimeLaunch,
      schema: SlugRequest,
      audit: true,
      handler: (p) => supervisor.launch((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.RuntimeStop,
      schema: InstanceRequest,
      audit: true,
      handler: async (p) => {
        await supervisor.stop((p as TInstanceRequest).instanceId);
        return { ok: true };
      },
    },
    {
      channel: IpcChannel.RuntimeSuspend,
      schema: InstanceRequest,
      handler: (p) => supervisor.suspend((p as TInstanceRequest).instanceId),
    },
    {
      channel: IpcChannel.RuntimeResume,
      schema: InstanceRequest,
      handler: (p) => supervisor.resume((p as TInstanceRequest).instanceId),
    },
    {
      channel: IpcChannel.RuntimeRestart,
      schema: InstanceRequest,
      audit: true,
      handler: (p) => supervisor.restart((p as TInstanceRequest).instanceId),
    },
    { channel: IpcChannel.RuntimeList, schema: EmptyRequest, handler: () => supervisor.list() },
    {
      channel: IpcChannel.RuntimeHealth,
      schema: RuntimeHealthRequest,
      handler: async (p) => {
        await supervisor.checkHealth();
        const id = (p as TRuntimeHealthRequest).instanceId;
        return id ? supervisor.get(id) : supervisor.list();
      },
    },
    /* ── permissions ── */
    {
      channel: IpcChannel.PermsList,
      schema: SlugRequest,
      handler: (p) => permissionManager.list((p as TSlugRequest).slug),
    },
    {
      channel: IpcChannel.PermsGrant,
      schema: PermissionMutationRequest,
      audit: true,
      handler: async (p) => {
        const r = p as TPermissionMutationRequest;
        const res = await permissionManager.grant(r.slug, r.permission);
        platform.api.publish(build.permissionGranted(r.slug, r.permission));
        return res;
      },
    },
    {
      channel: IpcChannel.PermsRevoke,
      schema: PermissionMutationRequest,
      audit: true,
      handler: async (p) => {
        const r = p as TPermissionMutationRequest;
        const res = await permissionManager.revoke(r.slug, r.permission);
        platform.api.publish(build.permissionRevoked(r.slug, r.permission));
        return res;
      },
    },
    /* ── plugin runtime ── */
    { channel: IpcChannel.PluginsList, schema: EmptyRequest, handler: () => pluginManager.list() },
    {
      channel: IpcChannel.PluginsGet,
      schema: PluginIdRequest,
      handler: (p) => pluginManager.get((p as TPluginIdRequest).id),
    },
    {
      channel: IpcChannel.PluginsInstall,
      schema: PluginInstallRequest,
      audit: true,
      timeoutMs: 60_000,
      handler: async (p) => {
        const res = await pluginManager.install((p as TPluginInstallRequest).source);
        if (res.ok && res.plugin)
          platform.api.publish(build.pluginInstalled(res.plugin.id, res.plugin.name));
        return res;
      },
    },
    {
      channel: IpcChannel.PluginsEnable,
      schema: PluginIdRequest,
      audit: true,
      handler: async (p) => {
        const id = (p as TPluginIdRequest).id;
        const res = await pluginManager.enable(id);
        platform.api.publish(build.pluginEnabled(id, null));
        return res;
      },
    },
    {
      channel: IpcChannel.PluginsDisable,
      schema: PluginIdRequest,
      audit: true,
      handler: async (p) => {
        const id = (p as TPluginIdRequest).id;
        const res = await pluginManager.disable(id);
        platform.api.publish(build.pluginDisabled(id, null));
        return res;
      },
    },
    {
      channel: IpcChannel.PluginsReload,
      schema: PluginIdRequest,
      audit: true,
      handler: (p) => pluginManager.reload((p as TPluginIdRequest).id),
    },
    {
      channel: IpcChannel.PluginsUpdate,
      schema: PluginIdRequest,
      audit: true,
      handler: (p) => pluginManager.update((p as TPluginIdRequest).id),
    },
    {
      channel: IpcChannel.PluginsRemove,
      schema: PluginIdRequest,
      audit: true,
      handler: async (p) => {
        const id = (p as TPluginIdRequest).id;
        const res = await pluginManager.remove(id);
        platform.api.publish(build.pluginRemoved(id, null));
        return res;
      },
    },
    {
      channel: IpcChannel.PluginsGrant,
      schema: PluginPermissionRequest,
      audit: true,
      handler: (p) => {
        const r = p as TPluginPermissionRequest;
        return pluginManager.grant(r.id, r.permission);
      },
    },
    {
      channel: IpcChannel.PluginsRevoke,
      schema: PluginPermissionRequest,
      audit: true,
      handler: (p) => {
        const r = p as TPluginPermissionRequest;
        return pluginManager.revoke(r.id, r.permission);
      },
    },
    {
      channel: IpcChannel.PluginsContributions,
      schema: PluginContributionsRequest,
      handler: (p) => pluginManager.contributions((p as TPluginContributionsRequest).surface),
    },
  ];
  // Platform-core IPC (timeline query/stats/export, diagnostics, UI event emit).
  defs.push(...platform.handlers);
  // Connector Framework IPC (list/connect/disconnect/reconnect/refresh/sync/health/logs).
  defs.push(...connectors.handlers);
  // Unified knowledge layer IPC (query/get/counts/search).
  defs.push(...unified.handlers);
  // Sync engine IPC (sync-state snapshot for the health dashboard).
  defs.push(...sync.handlers);
  defs.push(...graph.handlers);
  defs.push(...memory.handlers);
  defs.push(...knowledge.handlers);
  defs.push(...timeline.handlers);
  defs.push(...search.handlers);
  defs.push(...intelligence.handlers);
  defs.push(...recommendations.handlers);
  defs.push(...executiveCenter.handlers);
  defs.push(...decisions.handlers);
  defs.push(...automations.handlers);
  // NeuroCore (V5.0/V5.1/V5.2): composes system health from live subsystem signals
  // — platform diagnostics, automation monitor, real CPU/memory + backend probe
  // (V5.1), and now the live voice runtime state reported by the widget (V5.2).
  const publishPlatform = (input: {
    type: string;
    category: string;
    source: string;
    priority?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): void => {
    platform.api.publish({
      type: input.type as Parameters<typeof platform.api.publish>[0]['type'],
      category: input.category as Parameters<typeof platform.api.publish>[0]['category'],
      source: input.source,
      actor: { kind: 'system', id: null },
      priority: (input.priority ?? 'normal') as Parameters<
        typeof platform.api.publish
      >[0]['priority'],
      metadata: input.metadata,
    });
  };
  const neuroCore = new NeuroCore({
    diagnostics: () => platform.diagnostics(),
    automationMonitor: () => getAutomationMonitor(),
    voiceState: () => getVoiceRuntimeState(),
    licenseState: () => getLicenseRuntimeState(),
    deviceState: () => getDeviceRuntimeState(),
    // V6.6: read cloud-sync health straight from the livesync engine (main-side —
    // no IPC needed). Omitted when sync isn't running so it can't show a
    // misleading "healthy" with nothing to sync.
    cloudSyncState: () => {
      if (!liveSync.isRunning()) return null;
      const s = liveSync.getStatus();
      return {
        online: s.online,
        pendingCount: s.pendingCount,
        failures: s.failures,
        hasError: s.lastError !== null,
      };
    },
    startedAtMs: Date.now(),
    publish: publishPlatform,
  });
  // V5.2: emit a voice.* platform event whenever the live voice state changes.
  onVoiceStateChange((state) => {
    publishPlatform({
      type: `voice.${state}`,
      category: 'runtime',
      source: 'voice-runtime',
      priority: state === 'disconnected' ? 'high' : 'normal',
      metadata: { state },
    });
  });
  defs.push({
    channel: IpcChannel.SystemHealthSnapshot,
    schema: EmptyRequest,
    handler: () => neuroCore.snapshot(),
  });
  // V6.1: renderer reports license health (it holds the active org) so NeuroCore
  // can compose it into system health without needing ambient org state in main.
  defs.push({
    channel: IpcChannel.LicenseReportHealth,
    schema: LicenseReportHealthRequest,
    handler: (payload: unknown) => {
      const p = payload as { state: LicenseState | null; graceDaysRemaining: number };
      setLicenseRuntimeState(
        p.state === null ? null : { state: p.state, graceDaysRemaining: p.graceDaysRemaining },
      );
      return { ok: true };
    },
  });
  // V6.4: create a Razorpay subscription checkout for an org+plan and open the
  // hosted checkout URL. The subscription/Razorpay/webhook work is all backend —
  // this handler only invokes the existing endpoint and opens the returned URL.
  // The desktop never handles card data (Razorpay hosts the payment page).
  defs.push({
    channel: IpcChannel.BillingCheckout,
    schema: BillingCheckoutRequest,
    handler: async (payload: unknown) => {
      const p = payload as { orgId: string; plan: BillingPlanId; seats?: number };
      const result = await billingClient.checkout(p.orgId, p.plan, p.seats);
      if (result.checkoutUrl) void shell.openExternal(result.checkoutUrl);
      return result;
    },
  });
  // V6.5: device trust. The device identity is assembled main-side (livesync id +
  // OS/arch + app version); the renderer supplies the active org. Membership +
  // authorization are enforced server-side (reusing the org membership check).
  defs.push({
    channel: IpcChannel.DevicesRegister,
    schema: DevicesRegisterRequest,
    handler: (payload: unknown) =>
      deviceClient.registerCurrent((payload as { orgId: string }).orgId),
  });
  defs.push({
    channel: IpcChannel.DevicesList,
    schema: DevicesListRequest,
    handler: (payload: unknown) => deviceClient.list((payload as { orgId: string }).orgId),
  });
  defs.push({
    channel: IpcChannel.DevicesRevoke,
    schema: DevicesRevokeRequest,
    handler: (payload: unknown) => {
      const p = payload as { orgId: string; deviceId: string };
      return deviceClient.revoke(p.orgId, p.deviceId);
    },
  });
  // V6.5: renderer reports THIS device's trust status (it holds the active org)
  // so NeuroCore can compose device trust into system health.
  defs.push({
    channel: IpcChannel.DeviceReportHealth,
    schema: DeviceReportHealthRequest,
    handler: (payload: unknown) => {
      const p = payload as { trustStatus: DeviceTrustStatus | null };
      setDeviceRuntimeState(p.trustStatus === null ? null : { trustStatus: p.trustStatus });
      return { ok: true };
    },
  });
  // Runtime Supervisor (V5.3): autonomous recovery. Executors reuse existing
  // subsystem capabilities — backend re-probe (real), voice-state reset (real),
  // and a diagnostics refresh for platform/runtime. Automation restart is a
  // structural hook until the dispatcher exposes a restart API.
  const runtimeSupervisor = new RuntimeSupervisor({
    snapshot: () => neuroCore.snapshot(),
    publish: publishPlatform,
    executors: {
      backend: async () => {
        const ok = await neuroCore.forceBackendProbe();
        return { ok, detail: ok ? 'backend reachable' : 'still unreachable' };
      },
      voice: async () => {
        // Clear a stuck voice state so the runtime returns to idle.
        setVoiceRuntimeState('idle');
        return { ok: true, detail: 'voice runtime reset to idle' };
      },
      platform: async () => {
        await platform.diagnostics();
        return { ok: true, detail: 'diagnostics refreshed' };
      },
      runtime: async () => {
        await platform.diagnostics();
        return { ok: true, detail: 'runtime diagnostics refreshed' };
      },
    },
  });
  runtimeSupervisor.start();
  defs.push({
    channel: IpcChannel.SupervisorStatus,
    schema: EmptyRequest,
    handler: () => runtimeSupervisor.status(),
  });
  defs.push({
    channel: IpcChannel.SupervisorHistory,
    schema: EmptyRequest,
    handler: () => ({ records: runtimeSupervisor.getHistory() }),
  });
  defs.push({
    channel: IpcChannel.SupervisorRecover,
    schema: SupervisorRecoverRequest,
    handler: async (payload: unknown) => {
      const { subsystem } = payload as { subsystem: SupervisedSubsystem };
      return runtimeSupervisor.recover(subsystem, 'manual');
    },
  });
  defs.push({
    channel: IpcChannel.SupervisorSetPolicy,
    schema: SupervisorSetPolicyRequest,
    handler: (payload: unknown) => {
      const { subsystem, policy } = payload as {
        subsystem: SupervisedSubsystem;
        policy: RecoveryPolicy;
      };
      runtimeSupervisor.setPolicy(subsystem, policy);
      return runtimeSupervisor.status();
    },
  });
  // Execute Engine (V5.4): the unified execution pipeline. Subsystems register
  // their executor and every execution flows through one session lifecycle +
  // history + events. Executors ORCHESTRATE existing subsystem logic (founder AI,
  // automation runner) — no execution logic is duplicated. task + automation are
  // wired now; worker/decision/etc. register the same way as they expose callables.
  // V5.8: durable execution persistence. The store implements the engine's
  // persist hook; the engine stays unaware of storage. Sessions in-flight at last
  // shutdown are recovered as 'interrupted' (never rerun) and seeded into history.
  const executionStore = new ExecutionStore(join(app.getPath('userData'), 'executions.json'));
  const executeEngine = new ExecuteEngine({
    publish: publishPlatform,
    persist: (session) => void executionStore.save(session),
  });
  executeEngine.register('task', async (req, ctx) => {
    ctx.setStep(1);
    const res = await founderAIv2.ask({ text: req.input ?? '', now: undefined });
    ctx.setStep(2);
    return {
      ok: true,
      summary: res.executiveSummary ?? res.clarification ?? 'Completed',
      result: res,
    };
  });
  executeEngine.register('automation', async (req, ctx) => {
    if (!req.targetId) return { ok: false, error: 'No automation id provided' };
    ctx.setStep(1);
    const record = await getAutomationRunner().runById(
      req.targetId,
      req.input ? { input: req.input } : {},
      'manual',
    );
    ctx.setStep(2);
    if (!record) return { ok: false, error: 'Automation not found or inactive' };
    return {
      ok: record.ok,
      summary: record.ok ? `${record.actions.length} action(s) run` : undefined,
      error: record.ok ? undefined : (record.error ?? 'Automation failed'),
      result: record,
    };
  });
  executeEngine.register('decision', async (req, ctx) => {
    if (!req.targetId) return { ok: false, error: 'No decision id provided' };
    const decision = decisionStore.all().find((d) => d.id === req.targetId);
    if (!decision) return { ok: false, error: 'Decision not found' };
    const next = primaryNextStatus(decision.status);
    if (!next) {
      return { ok: false, error: `Decision is ${decision.status} — no forward action` };
    }
    ctx.setStep(1);
    const updated = await decisionStore.setStatus(decision.id, next.to, new Date().toISOString());
    ctx.setStep(2);
    return { ok: true, summary: `${next.label} → ${next.to}`, result: updated };
  });
  // V5.6: memory / voice / executive / runtime executors — each orchestrates the
  // existing subsystem callable, preserves the full typed output, and reports steps.
  executeEngine.register('memory', async (req, ctx) => {
    ctx.setStep(1);
    const result = await memoryStore.recall({ text: req.input?.trim() || undefined, limit: 50 });
    return {
      ok: true,
      summary: `${result.total} ${result.total === 1 ? 'memory' : 'memories'} found`,
      result,
    };
  });
  executeEngine.register('voice', async (req) => {
    if (!req.input?.trim()) return { ok: false, error: 'No voice command provided' };
    const response = voice.answer(req.input.trim());
    return {
      ok: true,
      summary: response.speech || 'Responded',
      result: response,
    };
  });
  executeEngine.register('executive', async (_req, ctx) => {
    ctx.setStep(1);
    const snapshot = await executiveCenter.snapshot();
    return {
      ok: true,
      summary: snapshot.executiveSummary
        ? `Executive score ${snapshot.executiveSummary.executiveScore}/100`
        : 'Executive snapshot composed',
      result: snapshot,
    };
  });
  executeEngine.register('runtime', async (_req, ctx) => {
    ctx.setStep(1);
    const snapshot = await neuroCore.snapshot();
    return {
      ok: true,
      summary: `System health ${snapshot.score}/100 (${snapshot.level})`,
      result: snapshot,
    };
  });
  // V5.7: worker executor — dispatches a worker's default skill as a real job via
  // the workforce runtime. Skill resolution + governance stay in the subsystem.
  executeEngine.register('worker', async (req, ctx) => {
    if (!req.targetId) return { ok: false, error: 'No worker id provided' };
    ctx.setStep(1);
    const job = workforce.runWorker(req.targetId, req.input ? { input: req.input } : {});
    if (!job) return { ok: false, error: 'Worker not found or has no runnable skill' };
    ctx.setStep(2);
    const ok = job.status === 'succeeded' || job.status === 'awaiting_approval';
    return {
      ok,
      summary:
        job.status === 'awaiting_approval'
          ? `Proposal awaiting approval${job.summary ? ` — ${job.summary}` : ''}`
          : (job.summary ?? job.status),
      error: ok ? undefined : `Job ${job.status}`,
      result: job,
    };
  });
  // V5.8 startup recovery: load persisted sessions, mark any that were in-flight
  // as interrupted (recovered, not rerun), persist the correction, and seed the
  // engine's history so the dashboard shows durable history across restarts.
  const persistedSessions = executionStore.loadAllSync();
  const recovered = recoverInterrupted(persistedSessions, new Date().toISOString());
  const interruptedCount = recovered.filter((s) => s.state === 'interrupted').length;
  if (recovered.length > 0) executeEngine.seedHistory(recovered);
  if (interruptedCount > 0) {
    void executionStore.replaceAll(recovered);
    log.warn('Recovered interrupted executions from previous session', {
      interrupted: interruptedCount,
      total: recovered.length,
    });
  }
  // Always announce readiness (like every peer store) so the recovery path is
  // observable exactly when it fires — not silent until the day it matters.
  const execStoreLog = createLogger('execution-store');
  execStoreLog.info('Execution store ready', {
    executions: recovered.length,
    recovered: interruptedCount,
  });
  defs.push({
    channel: IpcChannel.ExecuteRun,
    schema: ExecuteRunRequest,
    handler: (payload: unknown) => executeEngine.execute(payload as ExecutionRequest),
  });
  defs.push({
    channel: IpcChannel.ExecuteSessions,
    schema: EmptyRequest,
    handler: () => ({ sessions: executeEngine.activeSessions(), stats: executeEngine.stats() }),
  });
  defs.push({
    channel: IpcChannel.ExecuteHistory,
    schema: EmptyRequest,
    handler: () => ({ records: executeEngine.getHistory() }),
  });
  defs.push({
    channel: IpcChannel.ExecuteCancel,
    schema: ExecuteCancelRequest,
    handler: (payload: unknown) => executeEngine.cancel((payload as { id: string }).id),
  });
  // V5.2: renderer → main live voice runtime state.
  defs.push({
    channel: IpcChannel.VoiceStatus,
    schema: VoiceStatusRequest,
    handler: (payload: unknown) => {
      const { state } = payload as { state: VoiceRuntimeState };
      setVoiceRuntimeState(state);
      return { ok: true };
    },
  });
  defs.push(...voice.handlers);
  defs.push(...founder.handlers);
  defs.push(...engineeringAI.handlers);
  defs.push(...founderAIv2.handlers);
  defs.push(...trace.handlers);
  defs.push(...workforce.handlers);
  defs.push(...enterprise.handlers);
  defs.push(...ecosystem.handlers);
  defs.push(...cloud.handlers);
  defs.push(...featureFlags.handlers);
  defs.push(...license.handlers);
  defs.push(...onboarding.handlers);
  defs.push(...feedback.handlers);
  defs.push(...pilot.handlers);
  registerDiagnosticProbes([
    // Mirrors OllamaModelClient's URL resolution (env override, then local default).
    ollamaProbe({ baseUrl: process.env.NEUROPAUSE_OLLAMA_URL ?? 'http://localhost:11434' }),
    aiMemoryProbe(() => memoryStore.counts().total),
    knowledgeGraphProbe(() => {
      const c = graphStore.counts();
      return { nodes: c.nodes, edges: c.edges };
    }),
  ]);
  defs.push(...federation.handlers);
  defs.push(...updater.handlers);
  defs.push(...releaseOps.handlers);
  registerSecureHandlers(defs, {
    isAuthenticated: () => authService.getStatus().state === 'authenticated',
  });
  // Bridge runtime-core events to the renderer.
  packageService.on('progress', (e) => deps.broadcast(IpcChannel.NpsProgress, e));
  supervisor.on('event', (e) => deps.broadcast(IpcChannel.RuntimeEventBroadcast, e));
  supervisor.on('openApp', (req) => deps.broadcast(IpcChannel.RuntimeOpenApp, req));
  pluginHost.on('event', (e) => deps.broadcast(IpcChannel.PluginEventBroadcast, e));
  // Republish service signals onto the platform event bus.
  platform.wireProducers({ supervisor, packageService, pluginHost, authService });
  const safeMode = await releaseOps.safeModeState();
  if (safeMode.enabled)
    log.warn('Safe Mode active — starting with plugins disabled', { reason: safeMode.reason });
  serviceManager.startAll({ skip: safeMode.enabled ? ['plugin-loader'] : [] });
  platform.api.publish({
    type: 'system.ready',
    category: 'system',
    source: 'runtime-core',
    metadata: { installs: registry.list().length, plugins: pluginManager.list().length },
  });
  await selfCheck();
}
/** Confirms the layer is live: backend reachable + registry loaded. */
async function selfCheck(): Promise<void> {
  let catalogMsg = 'catalog unreachable (will retry on demand)';
  try {
    const page = await catalogClient.sections('trending', 1, 1);
    catalogMsg = `catalog reachable (${page.total} apps)`;
  } catch {
    /* backend may not be running yet; handlers retry per call */
  }
  log.info(
    `Runtime core ready: ${catalogMsg}, registry loaded (${registry.list().length} installs), plugins (${pluginManager.list().length})`,
  );
}

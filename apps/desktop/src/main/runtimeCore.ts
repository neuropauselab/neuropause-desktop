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
import { app, dialog, shell } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
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
import { pluginExtensionRegistry } from './plugins/extensionRegistry';
import {
  registerSecureHandlers,
  runSecureHandler,
  type SecureHandlerDef,
} from './ipc/secureBridge';
import {
  RUNTIME_CHANNEL_PERMISSIONS,
  withRuntimeAuthz,
  PUBLIC_CHANNELS,
  assertAllChannelsClassified,
} from './ipc/runtimeAuthz';
import { initPlatform, registerDiagnosticProbes } from './platform';
import { build } from './platform/producers';
import { initConnectors } from './connectors';
import { initUnified } from './unified';
import { initSync } from './unified/sync';
import { initGraph } from './graph';
import { initMemory } from './memory';
import { initKnowledge } from './knowledge';
import { initWorkforceIntelligence } from './workforce/intelligence';
import { initEnterpriseTimeline, getEnterpriseTimeline } from './timeline';
import { initEnterpriseSearch } from './search';
import { initDailyIntelligence } from './intelligence';
import { initExecutiveCenter } from './enterprise/executiveCenterSubsystem';
import { initDecisions } from './enterprise/decisionSubsystem';
import { decisionStore } from './enterprise/decisionInstance';
import {
  initAutomations,
  getAutomationMonitor,
  getAutomationRunner,
  getAutomationRunRecords,
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
import { deliveryEngine, initExecutiveDelivery } from './services/executiveDelivery';
import { initRecommendations } from './recommendations';
import {
  initEnterpriseIntelligence,
  type RawTimelineEvent,
} from './enterprise/intelligence/enterpriseIntelligenceSubsystem';
import { getRelationshipModel, invalidateModelCache as invalidateRelationshipModelCache } from './enterprise/relationshipProvider';
import { invalidateModelCache as invalidateTrustModelCache } from './enterprise/trustProvider';
import { initFounderAI } from './founder';
import { initEngineeringAI, initFounderAIv2 } from './ai';
// Phase 6 Stage 4 — the Workspace Assistant (composition over existing engines).
import { initAssistant } from './assistant';
import { routingUsageStore } from './ai/routingUsageInstance';
// Phase 6 Stage 5 — the Notification Inbox + preference surface (D-8): the
// EXISTING delivery engine's notification-center channel made real.
import { initNotifications } from './notifications';
// Phase 6 Stage 6 — the Enterprise Intelligence Layer: signal projection into
// the EXISTING P7 engines + composed health/predictions/dashboard (no engine,
// no store, no executor; read-only insight:* IPC + delivery-engine sources).
import { initInsight, type InsightSubsystem } from './insight';
import { healthHistoryStore } from './enterprise/healthHistoryInstance';
import { collectOrgHealthInputs } from './enterprise/orgIntelligence';
import { summarizeWorkforceHealth } from './enterprise/workforceHealth';
import { orgStore } from './enterprise/org/orgInstance';
import { automationStore } from './enterprise/automationInstance';
import { unifiedStore } from './unified/storeInstance';
import { initTrace } from './trace';
import { initWorkforce } from './workforce';
import { workforceProbe } from './workforce/workforceDiagnostics';
import { workerRegistry } from './workforce/registry/registryInstance';
import { jobStore } from './workforce/runtime/jobInstance';
import { createWorkforceActionExecutor } from './workforce/execution/workforceActionExecutor';
import type { ExecutionBinding } from '@neuropause/shared';
import { computeOrgHealth } from '@neuropause/shared';
import {
  activeMemoryViewer,
  activeTenantScope,
  forEachTenantBackground,
  initEnterprise,
  onWorkspaceSwitch,
} from './enterprise';
import { currentPrincipal } from './tenancy/backgroundPrincipal';
import { assertAllTenantStoresBound } from './tenancy/tenantOwnedStore';
import { assertAllStoreScopesBound } from './tenancy/storeScope';
import type { Organization } from '@neuropause/shared';
import { setLiveSyncActiveOrg } from './cloud/livesync/liveSyncInstance';
import { initDataPlane } from './dataPlane';
import { initDocuments } from './documents';
import { initIdentity, type ServiceAuthorizer } from './identity';
import { EVIDENCE_STRENGTH, scoreEvidence, type IdentityEvidence } from '@neuropause/shared';
import { bridgeResource } from './connectors/bridge';
import { RELATIONSHIPS, assertRelationshipsAreDeclarable } from './dataPlane/relationshipModel';
import {
  bindIncomingLinkReader,
  bindingIsLive,
  decisionRecordStore,
  holdStore,
} from './decisions/instances';
import { opportunityDecisionStore } from './opportunities/instances';
import { outcomeRevisionStore } from './outcomes/instances';
// Named `initDecisionRecords` here: `initDecisions` is already taken by the
// executive decision workflow, and these are the governance RECORD/HOLD reads.
import { initDecisions as initDecisionRecords } from './decisions';
import { createHoldRaiser } from './decisions/raiseHold';
import { bindRelationshipEngine, bindRelationshipStore } from './crossDomain/instances';
import {
  ambiguousIdentityHold,
  externalUnavailableHold,
  unresolvedDependencyHold,
} from '@neuropause/shared';
import type { ConnectorSyncSnapshot } from '@neuropause/shared';
import { initEcosystem, runGateway, gatewayMetrics, gatewayAuditEntries } from './ecosystem';
import { initMarketplace } from './marketplace';
import { initEnterpriseApi } from './api';
import { initCompanion } from './companion';
import { initWebhooks } from './webhooks';
import { webhookStore } from './webhooks/webhookInstance';
import { initSandbox } from './sandbox';
import { createDesktopExecutor, PlaywrightDesktopDriver } from './sandbox/desktop';
import { initEnterpriseRunner } from './sandbox/enterprise';
import { createRealEnterprisePlatform } from './sandbox/enterprise/realPlatform';
import { createRealDesktopChannel } from './sandbox/enterprise/desktopChannel';
import { createGatewaySdk, createGatewayCli } from './sandbox/enterprise/developerChannels';
import { initAiQa, createQaExecutor, type QaExecutorBackend } from './sandbox/agent';
import { initPerfSecurityLab } from './sandbox/lab';
import { initContinuousValidation } from './sandbox/validation';
import { taskScheduler } from './services/taskScheduler';
import { notificationScheduler } from './services/notificationScheduler';
import { aiEngine } from './ai/engineInstance';
import { bindDeliveryViewer } from './services/executiveDelivery';
import { PlatformOperatorRegistry } from './platformOperator/platformOperatorRegistry';
import { createPlatformAuthorizer } from './platformOperator/platformAuthority';
import { engineManager } from './ai/engineManager';
import { initAiConfig } from './ai/aiConfigIpc';
import { handleEnterpriseApiRequest } from './api/apiGateway';
import { collectPlanningModel } from './enterprise/planningModel';
import { connectorService } from './connectors/connectorService';
import { initCloud } from './cloud';
import { initInfrastructure } from './infrastructure';
import { initFederation } from './federation';
import { initFederationPlatform } from './federationPlatform';
import { withFederationAuthz } from './federationPlatform/federationAuthz';
import { initControlPlane } from './cloud/controlPlane';
import { withCloudAuthz } from './cloud/controlPlane/cloudAuthz';
import { initDeveloperPlatform } from './ecosystem/developerPlatform';
import { withEcosystemAuthz } from './ecosystem/developerPlatform/ecosystemAuthz';
import { initIndustryPlatform } from './industry';
import { initAutonomousIntelligence } from './strategy';
import { initEnterpriseTwin } from './twin';
import { initEnterpriseKnowledge } from './knowledgeFabric';
import { initGlobalOrchestration } from './orchestration';
import { initEnterpriseIntelligenceNetwork } from './intelligenceNetwork';
import { initAutonomousOperations } from './autonomousOps';
import { initCommercialPlatform } from './commercial';
import { initExperience } from './experience';
import { initIntent } from './intent';
import { initUpdater } from './updater';
import { initHelp } from './help';
import { initReleaseOps } from './releaseOps';
import { initFeatureFlags } from './featureFlags';
import { initLicense } from './license';
import { initOnboarding } from './onboarding';
import { bindExperienceEvents } from './onboarding/experienceProfileInstance';
import { initFeedback } from './feedback';
import { initPilot } from './pilot';
import { aiMemoryProbe, knowledgeGraphProbe, ollamaProbe } from './platform/aiHealthProbes';
import { connectorHealthProbe } from './connectors/connectorDiagnostics';
import { memoryStore } from './memory/memoryInstance';
import { graphStore } from './graph/graphInstance';
// Phase 6 Stage 7 — the Enterprise Knowledge & Decision Platform (read-only
// composition over the stores wired above; no new store/graph/search/executor).
import { initKnowledgeAssets, type KnowledgeAssetsSubsystem } from './knowledgeAssets';
// Phase 6 Stage 8 — the Enterprise Automation Platform (orchestration-layer
// composition; no runtime/store/scheduler-class/executor of its own).
import { initAutomationPlatform, type AutomationPlatformSubsystem } from './automationPlatform';
// Phase 6 Stage 9 — the Enterprise Operations Platform (orchestration-layer
// composition; no runtime/store/scheduler/executor of its own).
import { initOperationsPlatform, type OperationsPlatformSubsystem } from './operationsPlatform';
// Phase 6 Stage 10 — the Enterprise Strategy Platform (read-only composition
// over Stages 1–9 + P14; six estrat:* channels; one strategy-watch source).
import { initStrategyPlatform, type StrategyPlatformSubsystem } from './strategyPlatform';
// Phase 6 Stage 11 — the Enterprise Federation Platform (read-only composition
// over the P9-S2 federation stores + P18 + Stages 7–10; six efed:* channels;
// one federation-watch source).
import {
  initEnterpriseFederation,
  type EnterpriseFederationSubsystem,
} from './enterpriseFederation';
import { initAnalyticsPlatform, type AnalyticsPlatformSubsystem } from './analyticsPlatform';
// Phase 6 Stage 13 — the Enterprise Digital Twin Platform (read-only composition
// over the P15 twin + Execute Engine + Runtime Supervisor + Stages 6–12; seven
// etwin:* channels under P15's EXISTING twin:read scope; one twin-watch source).
// P15 stays authoritative — this composes it and never modifies it.
import { initDigitalTwinPlatform, type EtwinPlatformSubsystem } from './digitalTwinPlatform';
import { fedStore } from './federation/runtime/fedInstance';
import { exchangeStore } from './federation/exchange/exchangeInstance';
import { PLAYBOOK_REGISTRY } from './automationPlatform/automationRegistry';
import { drStore } from './federation/dr/drInstance';
import { detectBottlenecks } from './workforce/intelligence/bottlenecks';
import { getProcessAssessment, getProcessExplorerKpis } from './enterprise/processMiningProvider';
import { selectRulesForEvent } from './enterprise/automationRunner';
// (taskScheduler is already imported above with the other service singletons.)
import { globalGovStore } from './federation/governance/globalGovInstance';
import { workerInstallStore } from './workforce/install/installInstance';
import { governanceStore } from './enterprise/governance/governanceInstance';
import { workspaceStore } from './enterprise/workspace/workspaceInstance';
import { DEFAULT_PROMPTS } from './ai/promptManager';
import { runEnterpriseSearch } from './search/enterpriseSearch';
import { getFederationSearcher } from './federationPlatform/searcherInstance';
import { runMrp, computeCapacitySchedule, isTerminalExecutionStatus } from '@neuropause/shared';
import type {
  ApiMethod,
  EnterprisePermission,
  IpcChannelName,
  ResourceGraphModel,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { developerStore } from './ecosystem/developer/developerInstance';
const log = createLogger('runtime-core');

/**
 * The organization a READ MODEL is being built for, or null.
 *
 * P13C REMEDIATION — FINDING 3. Seven platform read models resolved their
 * organization with `orgStore.defaultOrg()` — the first-inserted one — and each
 * returns real membership data: unit names and their lead user ids, member ids
 * and names, the role catalogue. Insight, Knowledge Assets, the Automation
 * Platform, Operations and Strategy were all reading one tenant's org chart and
 * serving it to whoever asked.
 *
 * All seven are lazy accessors, evaluated per request or per background pass
 * rather than captured at boot, so routing them through `activeTenantScope()`
 * is enough to make each evaluation answer for its own caller — and inside a
 * fanned-out job it answers for the tenant the job is running FOR, not the one
 * on screen.
 *
 * Null when nothing resolves, and every call site degrades to an EMPTY result
 * rather than substituting an organization. These feed dashboards and
 * recommendation inputs whose shapes all have an empty form, so failing closed
 * costs a blank panel; failing open costs another customer's roster.
 */
/**
 * Assert the caller is a member of the CLOUD organization they named.
 *
 * P13C REMEDIATION — FINDING 6. A family of channels — `org.get`, `org.members`,
 * `org.invite`, `org.removeMember`, `org.workspaces`, the workspace
 * create/rename/delete trio, billing, and `devices.list/registerCurrent/revoke`
 * — took `orgId` straight from the renderer payload and forwarded it, guarded by
 * `requireAuth: true` alone. `requireAuth` proves somebody is signed in. It
 * proves nothing about WHICH organization they may act in, so any signed-in
 * account could read another organization's member list and device inventory by
 * supplying its id.
 *
 * WHY THIS IS NOT VALIDATED AGAINST `orgStore`
 *
 * These are CLOUD organizations, a different id space from the local enterprise
 * `orgStore`. Checking a cloud id against local tenancy would reject every real
 * organization while looking like a security control — worse than no check,
 * because it would be trusted.
 *
 * The authority is `orgClient.list()`, which the backend already scopes to the
 * authenticated user's own memberships. Asking it and requiring the named id to
 * appear turns a caller-supplied identifier into a verified one, using the
 * session's own token rather than anything the renderer said.
 *
 * FAIL CLOSED ON AN UNREACHABLE BACKEND. If the list cannot be fetched, the
 * request is refused rather than forwarded — an offline backend must not become
 * a bypass, and the caller sees the same refusal either way.
 */
async function requireCloudOrgMembership(orgId: string): Promise<string> {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('That organization is not available to you.');
  }
  let mine: { orgId: string }[];
  try {
    mine = (await orgClient.list()) as unknown as { orgId: string }[];
  } catch {
    throw new Error('That organization is not available to you.');
  }
  if (!mine.some((o) => o.orgId === orgId)) {
    // One message for "does not exist" and "not yours" — distinguishing them
    // would confirm which organizations exist on the backend.
    throw new Error('That organization is not available to you.');
  }
  return orgId;
}

function activeOrgForReadModel(): Organization | null {
  const scope = activeTenantScope();
  if (scope === null) return null;
  return orgStore.organization(scope.tenantId);
}


/** Narrows a bridge-supplied evidence label to the closed evidence set. */
function isEvidenceKind(kind: string): kind is IdentityEvidence['kind'] {
  return Object.prototype.hasOwnProperty.call(EVIDENCE_STRENGTH, kind);
}
export interface RuntimeCoreDeps {
  broadcast: IpcBroadcaster;
}
export async function initRuntimeCore(deps: RuntimeCoreDeps): Promise<void> {
  /**
   * The sync bridge's closure is built before the identity subsystem exists in
   * this function's source order, and the identity subsystem needs `enterprise`
   * which needs things declared after the sync. Rather than reorder the whole
   * composition root, the service principal is bound once and read lazily.
   *
   * It starts unbound and, unbound, DENIES: a sync that somehow ran before the
   * principal existed must import nothing rather than fall back to a human's
   * permissions, which is the exact failure this replaces.
   */
  let syncServiceLookup: (() => ServiceAuthorizer) | null = null;
  const bindSyncService = (fn: () => ServiceAuthorizer): void => {
    syncServiceLookup = fn;
  };
  const syncPrincipal = (): ServiceAuthorizer | null => syncServiceLookup?.() ?? null;
  await registry.load();
  await pluginManager.load();
  // Platform core: event bus + timeline + subscribers + diagnostics.
  const platform = await initPlatform({ broadcast: deps.broadcast });
  // Connector Framework (NCF): SDK + OAuth engine + registry + lifecycle runtime.
  const connectors = await initConnectors({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
    /**
     * P10 — the credential boundary.
     *
     * Both the vault and the connection list are scoped to this. A connection
     * made in one workspace is no longer listed, synced or spendable from
     * another, and a credential written before this boundary existed is
     * unclaimed rather than silently adopted by whoever looks first.
     */
    /**
     * P11 — the NULLABLE accessor, so the cold-start window closes here too.
     *
     * The bare `activeWorkspaceId()` returns `'workspace-default'` from field
     * initialisation, before the file is read. `initConnectors` runs ~270 lines
     * before `workspaceStore.load()`, so every credential key and connection
     * filter in that window resolved to the default workspace REGARDLESS of what
     * was persisted — an OAuth completion in that window writes one workspace's
     * token under another's key. `requireWorkspace()` in `connectorService`
     * already throws on an empty string; this gives it the empty string to throw
     * on instead of a plausible wrong answer.
     */
    /**
     * P13C — A BACKGROUND PRINCIPAL WINS, exactly as it does in
     * `activeTenantScope`.
     *
     * This binding is what `connectorStore.all()` filters on, so inside the
     * fanned-out sync it has to name the workspace being SYNCED rather than the
     * one being LOOKED AT. Without this the fan-out changes nothing: every pass
     * would list the signed-in user's accounts and then sync them N times, once
     * per tenant, stamping the results with whichever tenant that pass was
     * running as. That is not a stale-data bug, it is a cross-tenant WRITE —
     * strictly worse than the single-workspace sync it replaced.
     *
     * A tenant-level or SYSTEM principal reports no workspace and therefore
     * yields `''`, which `requireWorkspace()` already refuses. A job with no
     * workspace has no connections, and getting nothing is the correct answer.
     */
    workspaceId: () => {
      const principal = currentPrincipal();
      if (principal !== null) return principal.workspaceId ?? '';
      return workspaceStore.activeWorkspaceIdOrNull() ?? '';
    },
  });
  // Unified knowledge layer (UDM): canonical store + query engine + local search.
  const unified = await initUnified({ broadcast: deps.broadcast });
  // Sync engine: adapters → UDM, incremental + scheduled, wired to the event bus.
  // P4.1 — the sync engine honours the Runtime Supervisor's suppression (scheduled-path pause/disable).
  const sync = await initSync({
    publish: platform.api.publish,
    broadcast: deps.broadcast,
    isSuppressed: (c, a) => connectors.supervisor.isSyncSuppressed(c, a),
    // P13C Part 3 — scheduled sync runs for every workspace, not just the open
    // one. `perWorkspace` because a connection belongs to a workspace.
    forEachWorkspace: (jobId, fn) => forEachTenantBackground(jobId, fn, { perWorkspace: true }),
    /**
     * P9 — synced provider data reaches the GOVERNED business data.
     *
     * Before this, thirteen real adapters pulled live data into the Unified
     * store, where it fed search, memory and briefings and reached nothing
     * governed: a customer from a CSV had provenance, relationships and
     * Related Records, and the same customer from HubSpot had none of them.
     *
     * The bridge reuses the Data Plane wholesale — its record stores, its
     * `ProvenanceStore`, its identity rules and the SAME `onImported` fan-out
     * a file import fires, which is what makes the relationship engine
     * resolve a synced record's links.
     */
    bridge: async (input) => {
      /**
       * The workspace is captured ONCE, at the start of the run.
       *
       * Read at callback time instead, a workspace switch mid-sync filed
       * workspace A's provider row — and A's record values inside `differs` —
       * into workspace B's question queue.
       */
      const runWorkspace = workspaceStore.activeWorkspaceIdOrNull() ?? '';
      /**
       * Wait for the service principal's row to be readable before checking it.
       *
       * `allows` fails closed while the identity store is unread, which is
       * correct and would otherwise mean the first sync of every process is
       * refused for no reason the operator can see.
       */
      await syncPrincipal()?.ready();
      const result = await bridgeResource(input, {
        storeFor: (moduleId) => enterprise.modules.get(moduleId)?.store ?? null,
        modules: () => enterprise.modules.list().map((m) => m.descriptor),
        /**
         * A PURE check, not the throwing gate.
         *
         * `enterprise.authorize` throws AND, on refusal, opens a HOLD and
         * writes a Decision Record. A scheduled sync has no signed-in actor,
         * so that produced a governance artefact every fifteen minutes for a
         * machine-triggered read. The bridge reports the refusal instead.
         */
        /**
         * The SERVICE's authority, not the signed-in human's.
         *
         * Still a pure check rather than the throwing gate: `authorize` opens a
         * HOLD and writes a Decision Record on refusal, which for a
         * machine-triggered read every fifteen minutes is a governance artefact
         * nobody asked for. The bridge reports the refusal in its result.
         */
        allows: (permission) => syncPrincipal()?.allows(permission) ?? false,
        provenance: dataPlane.provenance,
        /**
         * Rows arrive attributed to the sync service.
         *
         * Attributing them to whoever was last signed in made a 3am scheduled
         * write look like that person's action, which is precisely the thing an
         * audit trail exists to distinguish.
         */
        actor: () => syncPrincipal()?.actor() ?? null,
        now: () => new Date().toISOString(),
        /**
         * P13C PART 3 — THE AUDIT ROW BELONGS TO THE WORKSPACE BEING SYNCED.
         *
         * `workspaceId` is not decoration on this record: `governanceStore`
         * PARTITIONS audit reads on exactly this field. Stamping it with
         * `activeWorkspaceIdForDisplay()` — the window's workspace — meant that
         * once scheduled sync fanned out across workspaces, tenant B's sync
         * rows were written into tenant A's audit trail, carrying B's record
         * ids and titles in `target` and `summary`. Two failures at once: a
         * disclosure into A, and a gap in B's own trail, where the evidence
         * that the sync happened simply is not.
         *
         * `activeTenantScope()` prefers the running principal, so inside the
         * fanned-out pass this names the workspace whose accounts are being
         * pulled. Outside one — a manual sync — it is the caller's own, which
         * is the same answer as before.
         *
         * Falls back to the display id ONLY when nothing resolves, preserving
         * the pre-existing cold-start behaviour rather than dropping the row:
         * an audit entry that is hard to attribute is worth more than no audit
         * entry at all, and it is the boundary itself that decides who reads it.
         */
        audit: (entry) =>
          governanceStore.record({
            actor: 'connector',
            action: entry.action,
            target: entry.target,
            summary: entry.summary,
            workspaceId:
              activeTenantScope()?.workspaceId || workspaceStore.activeWorkspaceIdForDisplay(),
          }),
        /**
         * P10 — ASK instead of discarding.
         *
         * `void` because a raised question must never fail a sync: the row is
         * already reported as ambiguous either way, and a queue write that
         * throws would turn "we need to ask about one row" into "the sync
         * broke".
         */
        /**
         * Do not re-ask a settled question. See `decidedAlready`.
         */
        identityDecided: (probe) => identity.decidedAlready(probe),
        raiseIdentityQuestion: (question) => {
          void identity.store
            .raiseMatch({
              workspaceId: runWorkspace,
              provider: question.provider,
              connectionId: question.connectionId,
              providerEntityType: question.providerEntityType,
              providerEntityId: question.providerEntityId,
              incomingLabel: question.incomingLabel,
              incoming: question.incoming,
              destinationModuleId: question.destinationModuleId,
              destinationLabel: question.destinationLabel,
              candidates: question.candidates.map((c) => {
                const evidence = c.evidence.map((e) => ({
                  // The bridge speaks in loose strings; the evidence kinds are a
                  // closed set. Anything it cannot name is the weakest kind
                  // rather than a stronger guess.
                  kind: isEvidenceKind(e.kind) ? e.kind : ('name_canonical' as const),
                  field: e.field,
                  value: e.value,
                  detail: e.detail,
                }));
                return {
                  subject: c.subject,
                  evidence,
                  /**
                   * DERIVED, never passed through.
                   *
                   * The bridge handed over a literal `0.2` and the screen
                   * rendered it as "20%" — a hardcoded constant dressed as a
                   * computed confidence. `scoreEvidence` is deterministic, is
                   * the only scorer in the app, and is never a model's opinion.
                   */
                  confidence: scoreEvidence(evidence),
                  differs: c.differs,
                };
              }),
              state: question.candidates.length === 0 ? 'unknown' : 'ambiguous',
              reason: question.reason,
            })
            .catch((err: unknown) => {
            log.warn('Could not queue an identity question', {
              provider: question.provider,
              err: err instanceof Error ? err.message : String(err),
            });
          });
        },
        onImported: (event) => {
          void enterprise
            .notifyImported({
              moduleId: event.moduleId,
              recordIds: event.recordIds,
              correlationId: event.correlationId,
            })
            .catch((err: unknown) => {
              log.warn('Sync lifecycle replay failed', {
                moduleId: event.moduleId,
                err: err instanceof Error ? err.message : String(err),
              });
            });
        },
      });
      // Only claim the service acted if it actually did. Noting a refusal made
      // the health surface report work that never happened.
      if (result.skippedReason === null) {
        void syncPrincipal()?.note(
          `Bridged ${input.connectorId}/${input.resourceId}: ${result.created} created, ${result.updated} updated, ${result.adopted} adopted, ${result.ambiguous} awaiting a decision`,
        );
      }
      return {
        created: result.created,
        updated: result.updated,
        adopted: result.adopted,
        ambiguous: result.ambiguous,
        invalid: result.invalid,
      };
    },
  });
  // P4.1 — feed the Supervisor the richer sync signals (rate-limit / offline / retry depth) so the runtime
  // state machine surfaces those sub-states, and re-project an account whenever its snapshot changes.
  connectors.supervisor.setSnapshotSource(sync.snapshotFor);
  sync.onSnapshotChange((c, a) => connectors.supervisor.notifySignalChange(c, a));
  // P5 — Increment 4: feed the Supervisor the sync layer's runtime-declared per-service capability
  // source, so the Enterprise Connector Center's Services view is discovered from the runtime (Google's
  // scope catalog / an adapter's declared resources) and never hardcoded. Mirrors the snapshot seam above.
  connectors.supervisor.setServiceCapabilitySource(sync.serviceCapabilities);
  // Enterprise Knowledge Graph: projects the UDM into a typed graph with
  // relationship history; the foundation the Phase 5 intelligence layer reads.
  // P7 — lazy handles so the graph projection can fold in the P6 Resource Graph once infrastructure inits (below).
  let getInfraResourceModel: (() => ResourceGraphModel | null) | null = null;
  let infraGraphRebuild: (() => void) | null = null;
  const graph = await initGraph({
    broadcast: deps.broadcast,
    on: (types, handler) => platform.api.on([...types], handler),
    getResourceModel: () => {
      try {
        return getInfraResourceModel ? getInfraResourceModel() : null;
      } catch {
        return null;
      }
    },
    onResourceChanged: (h) => {
      infraGraphRebuild = h;
    },
  });
  // AI Memory: distills the UDM into a searchable organizational memory.
  // P2.5 — also subscribes to ERP record + connector-write events to re-project business memory.
  const memory = await initMemory({
    // P13C Round 7 — the memory AUDIT LOG had no boundary and a public channel.
    scope: activeTenantScope,
    broadcast: deps.broadcast,
    on: (types, handler) => platform.api.on([...types], handler),
  });
  const knowledge = initKnowledge();
  const workforceIntel = initWorkforceIntelligence();
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
    // P13C Round 8 — Finding 1. Run records now carry an owner.
    scope: activeTenantScope,
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
  // Upgrade the AI engine from its env-only boot router to the config + Vault-aware
  // one (M4): async and non-blocking — the engine keeps working on the boot router
  // if this never resolves; failures are logged, never fatal.
  void engineManager.init();
  // Traces: governance, context, and relationship explainability.
  const trace = initTrace();
  // AI Workforce: governed, evidence-grounded workers over the intelligence layer.
  const workforce = await initWorkforce({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
    appVersion: app.getVersion(),
  });
  // Enterprise Operating System: organization runtime + graph + governance +
  // multi-workspace isolation + the executive snapshot that rolls it all up.
  const enterprise = await initEnterprise({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
  });
  // Phase 6 — Universal Enterprise Data Plane: file → understood → routed →
  // approved → imported, writing through the EXISTING module stores. Owns no
  // business logic; reuses the enterprise registry, authz gate and audit sink.
  const dataPlane = initDataPlane({
    userDataDir: app.getPath('userData'),
    storeFor: (moduleId) => enterprise.modules.get(moduleId)?.store ?? null,
    actor: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
    },
    // Mapping memory is isolated per workspace — the same boundary the audit
    // trail stamps. A mapping learned in one workspace is never offered in another.
    /**
     * P11 — nullable, and the `?? 'local'` branch is now REACHABLE.
     *
     * It was dead before: the bare accessor never returned null, which is direct
     * evidence this call site meant to use the nullable one. `'local'` is a
     * sentinel that matches no real workspace, so mapping memory saved during
     * cold start is not readable as any tenant's.
     */
    tenantId: () => workspaceStore.activeWorkspaceIdOrNull() ?? 'local',
    now: () => new Date().toISOString(),
    audit: (entry) =>
      governanceStore.record({
        actor: (() => {
          const st = authService.getStatus();
          return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : 'owner';
        })(),
        action: entry.action,
        target: entry.target,
        summary: entry.summary,
        workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
      }),
    authorize: enterprise.authorize,
    // Stamped into the export manifest. Read from the running app rather than
    // a constant, so a manifest naming a version is naming the build that
    // actually wrote the file.
    appVersion: () => app.getVersion(),
    workspaceId: () => workspaceStore.activeWorkspaceIdOrNull() ?? '',
    // Phase 6 — imported records re-enter the SAME lifecycle a hand-created
    // record takes: audit, platform timeline, renderer broadcast, and every
    // module's own `onChange` reconciler. Without this the records exist in the
    // store and nothing else in the system knows they arrived. Fire-and-forget
    // against the already-committed import, and a failing reconciler is logged
    // rather than allowed to unwind an import that already succeeded.
    onImported: (event) => {
      void enterprise
        .notifyImported({
          moduleId: event.moduleId,
          recordIds: event.recordIds,
          correlationId: event.correlationId,
        })
        .then((res) => {
          if (res.failed.length > 0 || res.missing > 0) {
            log.warn('Import lifecycle replay had problems', {
              moduleId: res.moduleId,
              notified: res.notified,
              missing: res.missing,
              failed: res.failed.length,
            });
          }
        })
        .catch((err: unknown) => {
          log.warn('Import lifecycle replay failed', {
            moduleId: event.moduleId,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    // Export reads the module descriptors: their fields become the columns and
    // their own read permission is enforced on top of `data:read`.
    modules: () => enterprise.modules.list().map((m) => m.descriptor),
    // The save dialog + filesystem write live HERE, not in the plane, so the
    // plane itself stays Electron-free and fully testable under Node.
    saveExport: async (suggestedName, format, content) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export data',
        defaultPath: suggestedName,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (canceled || !filePath) return null;
      await writeFile(filePath, content);
      return filePath;
    },
  });

  /**
   * Program 8 — Document Intelligence.
   *
   * Deliberately a sibling of the Data Plane rather than a part of it: the
   * Data Plane turns a file into RECORDS and forgets the file, while this
   * keeps the file as evidence. It reuses the Data Plane's parser and the
   * decision subsystem's storage substrate, and owns no governance of its own.
   */
  const documents = initDocuments({
    userDataDir: app.getPath('userData'),
    // P12 — the same tenant resolver the record stores read.
    scope: activeTenantScope,
    actor: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
    },
    now: () => new Date().toISOString(),
    audit: (entry) =>
      governanceStore.record({
        actor: (() => {
          const st = authService.getStatus();
          return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : 'owner';
        })(),
        action: entry.action,
        target: entry.target,
        summary: entry.summary,
        workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
      }),
    authorize: enterprise.authorize,
    modules: () => enterprise.modules.list().map((m) => m.descriptor),
    storeFor: (moduleId) => enterprise.modules.get(moduleId)?.store ?? null,
  });

  /**
   * P10 — Identity + external services.
   *
   * Two things nothing else owns:
   *
   *  · An ambiguous provider row becomes a QUESTION a person can answer. The
   *    sync used to count those rows and drop them, so the data never arrived
   *    and nobody was ever asked.
   *  · A background job gets a principal of its own. See `syncService` below
   *    for why the alternative was untenable in both directions.
   *
   * It owns no governance: it authorizes through `enterprise`, writes records
   * through the modules' own stores, and fires the SAME `onImported` fan-out an
   * import does, so a record linked here gets its relationships resolved.
   */
  /**
   * P11 — what a workspace switch has to forget.
   *
   * Registered at the composition root because these are the only two places
   * that know both halves: that the Data Plane holds plans and that live-sync
   * holds a target org. Records need nothing here — the store re-reads its scope
   * on every call, which is why it was built as a function rather than a value.
   */
  /**
   * P12 — bind the tenant boundary onto the append-only stores.
   *
   * Holds, Decision Records, opportunity decisions and outcome revisions are
   * module-level singletons created at import time, so they cannot take the
   * resolver as a constructor argument. Bound here, at the same place the module
   * registry is bound, and UNBOUND DENIES — so a store missed here returns
   * nothing rather than everything.
   *
   * `activeTenantScope` is the same resolver every other surface reads. One
   * authority, four more consumers.
   */
  /**
   * P13C Round 2 — the legacy stores join the bound set.
   *
   * Automation rules, executive decisions and the relationship queue each
   * predate tenancy and were reached by public or base-role channels. They are
   * bound here alongside the nine stores bound since P13B, and
   * `assertAllTenantStoresBound()` below turns a forgotten binding into a
   * startup failure rather than a silent leak.
   */
  /**
   * P13C Round 6 — AI usage accrues to the tenant that spent it. Bound HERE and
   * not in `ai/engineInstance.ts`: that module is imported by pure-model tests,
   * and `activeTenantScope` pulls Electron in with it.
   */
  aiEngine.bindUsageScope(activeTenantScope);
  /**
   * P13C Round 8 — the worker CATALOGUE is install-level and stays so; its
   * execution COUNTERS are per tenant. `jobsRun` on a shared row was a live meter
   * of another tenant's work.
   */
  workerRegistry.bindOutcomeScope(() => activeTenantScope()?.tenantId ?? null);
  /**
   * P13C Round 9 — F20. Same shape, same reason, different registry: the
   * installed-app CATALOGUE is install-level and stays so; its LAUNCH COUNTERS
   * are per tenant. `launchCount` and `usage.*` on a shared row told one
   * organization how often another had run an app and when it last did.
   */
  registry.bindUsageScope(() => activeTenantScope()?.tenantId ?? null);
  /**
   * P13C Round 7 — an OS toast goes to a PERSON. `deliveryEngine.tick()` fans out
   * over every organization on the install; the only correct recipient of a
   * desktop notification is the tenant the signed-in human is currently viewing.
   */
  bindDeliveryViewer(() => activeTenantScope()?.tenantId ?? null);
  automationStore.bindScope(activeTenantScope);
  decisionStore.bindScope(activeTenantScope);
  holdStore.bindScope(activeTenantScope);
  decisionRecordStore.bindScope(activeTenantScope);
  opportunityDecisionStore.bindScope(activeTenantScope);
  outcomeRevisionStore.bindScope(activeTenantScope);

  /**
   * P13A — bind the tenant boundary onto memory and provenance.
   *
   * Same shape as the four above, same failure mode if omitted: unbound
   * DENIES, so forgetting this line empties the Memory view rather than
   * silently exposing every tenant's memories. That asymmetry is the reason the
   * default is deny.
   *
   * Memory takes `activeMemoryViewer` rather than `activeTenantScope` because
   * it needs the identity as well as the scope — a scope cannot express "this
   * person's private memory". Provenance takes the plain scope: a provenance
   * record belongs to the tenant that imported it, never to one person.
   */
  memoryStore.bindViewer(activeMemoryViewer);
  dataPlane.provenance.bindScope(activeTenantScope);
  /**
   * P13C Round 2 — H6. Its sibling gained a scope in P13A; this one did not,
   * and nothing noticed because the relationship queue is a back-office
   * surface that returns `sourceValue` verbatim.
   */
  dataPlane.relationships.bindScope(activeTenantScope);

  /**
   * P13B — the Unified Store and the Graph, the two roots of the data fabric.
   *
   * `unifiedStore.bindScope` also binds the SEARCH INDEX it owns, because the
   * index is a second copy of the same records with its own reachable read
   * path. Binding these two is what finally gives the memory and graph
   * projections a trustworthy source: Program 13A could stamp a projected
   * memory with an owner, but the thing it projected from had none.
   */
  unifiedStore.bindScope(activeTenantScope);
  /**
   * P13C — the webhook registry. Bound like every other store, and it matters
   * more than most: this is the only surface that transmits platform data OFF
   * the device to an address a user chose.
   */
  webhookStore.bindScope(activeTenantScope);
  // The event bus + durable timeline: bound here rather than at platform boot,
  // because the resolver does not exist that early.
  platform.bindTenant(activeTenantScope);
  graphStore.bindScope(activeTenantScope);

  /**
   * THE STARTUP GATE — P13C Round 2, Phases 2 and 16.
   *
   * Four security sweeps found the same defect in four different subsystems,
   * and every one of them was found because somebody happened to walk that
   * code. That approach cannot converge: the risk was never in the audited
   * files, it was in the ones the audit did not reach.
   *
   * `assertAllTenantStoresBound()` inverts it. A tenant-sensitive store
   * registers itself at CONSTRUCTION; this line asserts, once at startup, that
   * every registered store has a boundary. A store nobody bound therefore
   * cannot reach a user, because the application refuses to start.
   *
   * Placed AFTER every `bindScope` above and BEFORE any handler is registered,
   * so the failure happens at composition rather than on the first request.
   */
  assertAllTenantStoresBound();

  /**
   * THE SECOND GATE, AND IT WAS NEVER WIRED. P13C ROUND 9.
   *
   * Round 8 built `assertAllStoreScopesBound()` and documented it as "called
   * from the composition root before any handler is registered, so an unbound
   * store cannot reach a user". It was never called from anywhere but its own
   * test. So every `isBound` predicate written into the 21 declarations that
   * round was decoration: a store could declare `TENANT`, have no boundary
   * bound, and the application would start and serve.
   *
   * The two assertions overlap DELIBERATELY and are not redundant.
   * `assertAllTenantStoresBound` covers stores that registered a
   * `TenantOwnership`; this one covers everything that declared a SCOPE,
   * including stores whose seam is their own and which never touch that class.
   * A store can pass either gate and fail the other, which is exactly why both
   * run — and why a Round 8 gate that only ever ran in a test is a finding
   * about this program's own instrumentation, recorded here rather than quietly
   * fixed.
   */
  assertAllStoreScopesBound();

  onWorkspaceSwitch(() => {
    dataPlane.forgetPlans();
    /**
     * P13B — flush the keyless TTL model caches on a switch.
     *
     * Both are built by fanning out across scoped stores, so a cache built by
     * tenant A holds A's data and is then served to whoever asks within the
     * TTL. That was an accepted transient leak while it stayed in memory; the
     * graph projection now persists what it reads, so it no longer does.
     */
    invalidateRelationshipModelCache();
    invalidateTrustModelCache();
    // Stop the 60-second push loop rather than let it keep pushing to the
    // workspace that was just left. The renderer re-points it deliberately.
    setLiveSyncActiveOrg(null);
  });

  const identity = initIdentity({
    userDataDir: app.getPath('userData'),
    workspaceId: () => workspaceStore.activeWorkspaceIdOrNull() ?? '',
    actor: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
    },
    now: () => new Date().toISOString(),
    audit: (entry) =>
      governanceStore.record({
        actor: (() => {
          const st = authService.getStatus();
          return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : 'owner';
        })(),
        action: entry.action,
        target: entry.target,
        summary: entry.summary,
        workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
      }),
    allows: (permission) => enterprise.allows(permission),
    authorize: enterprise.authorize,
    modules: () => enterprise.modules.list().map((m) => m.descriptor),
    storeFor: (moduleId) => enterprise.modules.get(moduleId)?.store ?? null,
    /**
     * The SAME store the bridge and the file importer write.
     *
     * This is what makes an answer durable. The bridge's only idempotency
     * source is `provenance.forExternalKey(...)`, so a decision that leaves no
     * provenance is invisible to the next sync: the question came back on the
     * following tick and the provider's updates never reached the linked record.
     */
    provenance: dataPlane.provenance,
    onImported: (event) => {
      void enterprise
        .notifyImported({
          moduleId: event.moduleId,
          recordIds: event.recordIds,
          correlationId: event.correlationId,
        })
        .catch((err: unknown) => {
          log.warn('Identity lifecycle replay failed', {
            moduleId: event.moduleId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    },
  });

  /**
   * The principal the connector sync actually writes as.
   *
   * Before P10 the bridge asked `enterprise.allows(...)`, which resolves the
   * SIGNED-IN HUMAN's roles. That is wrong in both directions at once: a
   * scheduled sync with nobody signed in has no permissions and silently
   * imports nothing, and a sync while an administrator is signed in runs every
   * fifteen minutes with an administrator's authority and attributes the rows
   * to them. Neither is a background job's authority.
   *
   * `crm:read` and `crm:manage` are the complete list because the four resource
   * mappings target `contact` and `customer`, and both live in CRM. If a
   * mapping is added for another module, this list has to be widened
   * deliberately — which is the point of writing it out rather than inheriting
   * it. Created lazily so the declaration lands after a workspace exists.
   */
  let syncServiceRef: ServiceAuthorizer | null = null;
  const syncService = (): ServiceAuthorizer => {
    syncServiceRef ??= identity.serviceAuthorizer({
      id: 'service.connector-sync',
      purpose: 'Connector sync',
      permissions: ['crm:read', 'crm:manage'],
    });
    return syncServiceRef;
  };
  bindSyncService(syncService);

  // A relationship declaration naming a field that does not exist resolves
  // nothing, forever, without erroring — the worst failure mode this feature
  // has. Checked against the LIVE descriptors at boot so a typo is visible in
  // the log rather than discovered as "relationships just don't work".
  const relationshipProblems = assertRelationshipsAreDeclarable(
    enterprise.modules.list().map((m) => m.descriptor),
  );
  if (relationshipProblems.length > 0) {
    log.error('Relationship declarations do not match the live modules', {
      count: relationshipProblems.length,
      problems: relationshipProblems.slice(0, 10),
    });
  }

  /**
   * The single seam every HOLD producer outside the enterprise root goes
   * through: open the hold, pair a Decision Record with it, audit. Reused
   * rather than re-implemented, so the hold/record pairing cannot be forgotten
   * at one call site.
   */
  const raiseHold = createHoldRaiser({
    holds: holdStore,
    decisions: decisionRecordStore,
    actor: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
    },
    audit: (action, target, summary) =>
      governanceStore.record({
        actor: (() => {
          const st = authService.getStatus();
          return st.state === 'authenticated' ? st.session.user.email : 'system';
        })(),
        action,
        target,
        summary,
        workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
      }),
  });

  /**
   * HOLD producer #6: `external_unavailable`.
   *
   * A connector that stops answering used to surface only as a number on the
   * diagnostics page. That is the wrong shape for work that DID NOT HAPPEN:
   * the sync was legitimate, nothing is wrong with the request, and retrying
   * later is a real resolution — which is precisely a hold.
   *
   * Reads the live snapshots rather than a fixture, quotes the state the
   * connector actually reported (401 and 503 need different actions), and
   * dedupes per account so a permanently-down system produces one item.
   * Returns the snapshots unchanged so it can sit inline on the health probe.
   */
  const raiseHoldsForUnreachableConnectors = (
    snapshots: readonly ConnectorSyncSnapshot[],
  ): ConnectorSyncSnapshot[] => {
    for (const snap of snapshots) {
      if (snap.status !== 'error' && snap.status !== 'offline') continue;
      raiseHold({
        ...externalUnavailableHold({
          action: `the ${snap.connectorId} sync`,
          systemName: snap.connectorId,
          // The connector's OWN words. A summarised error loses the only part
          // that distinguishes an outage from a revoked credential.
          observed: snap.lastError ?? `reported "${snap.status}" with no detail`,
          lastSuccessAt: snap.lastSyncAt,
        }),
        title: `${snap.connectorId} is unreachable`,
        subject: `connector/${snap.connectorId}/${snap.accountId}`,
        requestedAction: `Sync ${snap.connectorId}`,
        executed: 'Nothing — the system could not be reached.',
      });
    }
    return [...snapshots];
  };

  // Governed delete: bind the pre-delete assessor to the REAL resolved links.
  // This runs at composition time, unconditionally — the enterprise subsystem
  // above already holds `assessDelete`, which calls through this binding, and
  // an unbound reader silently reports "no links", i.e. every dangerous delete
  // would sail through ungoverned. The relationship store exists from the
  // `initDataPlane` call above, so here is the earliest correct place.
  // Cross-domain related records read the SAME resolved links governed delete
  // does — one relationship store, two consumers, no second graph.
  bindRelationshipStore(dataPlane.relationships);
  bindRelationshipEngine(dataPlane.relationshipEngine);
  bindIncomingLinkReader((recordId) =>
    dataPlane.relationships.incoming(recordId).map((link) => {
      const declaration = RELATIONSHIPS.find((r) => r.key === link.relationshipKey);
      return {
        relationshipKey: link.relationshipKey,
        label: declaration?.label ?? link.relationshipKey,
        sourceModuleId: link.sourceModuleId,
        // The module's own title, so the evidence a person acts on reads
        // "3 records in Invoices" and not "3 records in finance-invoices".
        sourceModuleTitle: enterprise.modules.get(link.sourceModuleId)?.descriptor.title,
      };
    }),
  );
  // Decision records + open holds are organizational memory: load them before
  // anything can produce one, so an append never races an unloaded file. The
  // relationship store is loaded here too — the handlers that use it load it
  // lazily, but the delete assessor has no handler of its own to trigger that,
  // and an unloaded store answers "no links" for every record.
  await Promise.all([
    decisionRecordStore.load(),
    holdStore.load(),
    dataPlane.relationships.load(),
  ]);
  /**
   * HOLD producers #4 and #5: `ambiguous_identity` and `unresolved_dependency`.
   *
   * The relationship engine already parks every reference it cannot resolve —
   * an ambiguous one (several candidates) or an unresolved one (no target).
   * That queue was visible only inside the Data Command Center, so a reference
   * that silently failed to link was invisible to anyone not looking there.
   *
   * The two are genuinely different problems and must not be merged:
   * ambiguity needs a person to CHOOSE, absence needs the missing record to
   * ARRIVE. Only the first reference of each class raises a hold; the queue
   * itself remains the place to work through the rest.
   */
  dataPlane.relationships.onFirstParked = (entry) => {
    const subject = `relationship/${entry.sourceModuleId}/${entry.relationshipKey}/${entry.status}`;
    const view =
      entry.status === 'ambiguous'
        ? ambiguousIdentityHold({
            action: `linking ${entry.sourceTitle} to its ${entry.targetLabel}`,
            reference: entry.sourceValue,
            candidates: entry.candidates.map((c) => `${c.title} (${c.id})`),
          })
        : unresolvedDependencyHold({
            action: `Linking ${entry.sourceTitle} to its ${entry.targetLabel}`,
            dependencies: [
              `"${entry.sourceValue}" in ${entry.sourceField} matches no ${entry.targetLabel} record.`,
              entry.reason,
            ],
            resolution: `Import or create the missing ${entry.targetLabel}, then re-run resolution from Data → Relationships.`,
          });
    raiseHold({
      ...view,
      title:
        entry.status === 'ambiguous'
          ? `Ambiguous ${entry.targetLabel} reference on ${entry.sourceTitle}`
          : `Missing ${entry.targetLabel} for ${entry.sourceTitle}`,
      subject,
      requestedAction: `Resolve ${entry.relationshipKey} for ${entry.sourceModuleId}`,
      executed: 'Nothing — the reference is parked, not guessed.',
    });
  };

  // Decision Records + Holds read/resolve IPC (governance:read / :manage).
  const decisionRecords = initDecisionRecords({
    decisionRecords: decisionRecordStore,
    holds: holdStore,
    assessmentLive: bindingIsLive,
    relationshipsDeclared: () => RELATIONSHIPS.length,
    actor: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? (st.session.user.displayName ?? st.session.user.email) : null;
    },
    audit: (action, target, summary) =>
      governanceStore.record({
        actor: (() => {
          const st = authService.getStatus();
          return st.state === 'authenticated' ? st.session.user.email : 'system';
        })(),
        action,
        target,
        summary,
        workspaceId: workspaceStore.activeWorkspaceIdForDisplay(),
      }),
  });

  // Ecosystem Platform: developer portal + marketplace + API gateway + billing.
  const ecosystem = await initEcosystem({ broadcast: deps.broadcast });
  // P9 — Enterprise Marketplace: a governed, trusted, installing LAYER over the ecosystem
  // marketplace. Routes approved worker installs to the existing P8.5 install service.
  const marketplace = await initMarketplace({
    // P13C Round 8 — Finding 3. The marketplace policy is per organization.
    scope: activeTenantScope,
    broadcast: deps.broadcast,
    appVersion: app.getVersion(),
    installWorker: workforce.installWorkerPackage,
  });
  // P3.0 Increment 4 — Enterprise Webhooks: fan the platform event bus out to signed,
  // retried, dead-lettered HTTP deliveries. Reuses the bus (subscribe), owns an outbox.
  const webhooks = await initWebhooks({
    broadcast: deps.broadcast,
    subscribe: (handler) => platform.api.subscribe(handler),
  });
  // AI Sandbox — Sandbox Core (S1): the reusable execution substrate (workspaces,
  // versioned scenarios, queue → run → status → timeline, artifacts/results/reports,
  // datasets, dashboard). No executor is registered yet — a later stage plugs one in.
  const sandbox = await initSandbox({
    broadcast: deps.broadcast,
    baseDir: join(app.getPath('userData'), 'sandbox'),
    /**
     * P13C N3 — the sandbox joins the bound stores.
     *
     * Nine stores are bound to `activeTenantScope` a few hundred lines above;
     * the five sandbox stores were absent from that list, which is why the whole
     * subsystem had no tenant. The same resolver, so a sandbox read inside a
     * background run answers for the run's tenant exactly as every other store
     * does.
     */
    scope: activeTenantScope,
  });
  // AI Sandbox S2 (Desktop Automation) + S3 (Enterprise Scenario Runner) register their
  // executors onto the S1 engine THROUGH a router, wired below (after the secure handler
  // registry + REST gateway are assembled) so the enterprise runner can dispatch through
  // the SAME secure core the IPC bridge + REST gateway use.
  const sandboxBaseDir = join(app.getPath('userData'), 'sandbox');
  const sandboxLaunchTarget = {
    executablePath: process.execPath,
    args: [app.getAppPath()],
    cwd: app.getAppPath(),
  };
  // Phase 9 · Stage 1 — Cloud Platform (multi-tenant, identity federation, sync, API platform, admin).
  /**
   * P13C ROUND 7 — THE INSTALL-LEVEL OPERATOR.
   *
   * Loaded from disk, empty unless the machine's owner wrote the file. There is
   * no IPC that adds an operator, deliberately: a grant path reachable by whoever
   * is signed in would be reachable by exactly the person this authority exists
   * to sit above. See `platformOperatorRegistry.ts`.
   */
  const platformOperators = new PlatformOperatorRegistry(app.getPath('userData'));
  await platformOperators.load();
  const platformAuthorizer = createPlatformAuthorizer({
    sessionEmail: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? st.session.user.email : null;
    },
    isOperator: (email) => platformOperators.isOperator(email),
  });

  const cloud = await initCloud({
    broadcast: deps.broadcast,
    platformAuthorizer,
    /**
     * The change lands in the same tamper-evident governance trail as every other
     * administrative action, rather than in a second log nobody reads.
     *
     * It is stamped with the CALLER'S tenant, which is a deliberate compromise
     * worth naming: the ACTION is install-level, so no single tenant owns the
     * record, and there is no install-level audit store to put it in. Filing it
     * under the operator's active organization means another tenant cannot read
     * that an operator changed a shared policy — an under-disclosure, not an
     * over-disclosure. The alternative, an unowned row, is withheld from
     * everyone and read by nobody.
     */
    auditPolicyChange: (r) =>
      governanceStore.record({
        actor: r.actor,
        action: r.operation,
        target: `${r.policyId} (${r.policyName})`,
        summary: `Platform operator ${r.actor} set rate policy "${r.policyName}" enabled=${r.before} → enabled=${r.after}, authorized by ${r.authorizedBy} at ${r.authorizedAt}.`,
        workspaceId:
          activeTenantScope()?.workspaceId || workspaceStore.activeWorkspaceIdForDisplay(),
      }),
  });
  // P6 — Cloud & Infrastructure Control Plane (Cloud Platform abstraction, Discovery Engine, Resource Graph).
  // Reuses the Platform Event Bus (Timeline), the diagnostics probe registry, the HttpClient/RateLimiter
  // primitives, and the secure-bridge IPC — no parallel runtime.
  const infrastructure = await initInfrastructure({
    broadcast: deps.broadcast,
    publish: platform.api.publish,
    // P13C Round 7 — the boundary this subsystem never had.
    scope: activeTenantScope,
  });
  // P7 — Enterprise Intelligence. Fold infra into the unified graph projection + re-project on discovery changes,
  // and stand up the intelligence subsystem (composes the Resource Graph + ERP Relationship Graph + Timeline into
  // health/risk/dependency/impact/drift/capacity/root-cause; reuses store/graph/timeline/diagnostics/RBAC).
  getInfraResourceModel = () => infrastructure.store.graph(Date.now());
  if (infraGraphRebuild) infrastructure.store.on('changed', infraGraphRebuild);
  const enterpriseIntel = initEnterpriseIntelligence({
    scope: activeTenantScope,
    broadcast: deps.broadcast,
    getResourceModel: () => {
      try {
        return infrastructure.store.graph(Date.now());
      } catch {
        return null;
      }
    },
    getRelationshipModel: () => {
      try {
        return getRelationshipModel();
      } catch {
        return null;
      }
    },
    getEvents: (since, limit) => {
      try {
        const page = platform.api.query({ since, limit }) as { events?: unknown };
        return (Array.isArray(page.events) ? page.events : []) as unknown as RawTimelineEvent[];
      } catch {
        return [];
      }
    },
  });
  const featureFlags = await initFeatureFlags({
    /**
     * P13C Round 8 — Finding 6. The renderer no longer supplies the plan.
     * `developerStore.planFor()` resolves it from the CALLER'S tenant through the
     * store's own bound scope, so a renderer claiming `enterprise` on a free
     * tenant is evaluated as free.
     */
    authoritativePlanTier: () => developerStore.planFor(),
  });
  const license = await initLicense();
  const onboarding = await initOnboarding();
  // AI configuration IPC (M5, read-only surface: current provider/model, health, Ollama detect).
  const aiConfig = initAiConfig();
  const feedback = await initFeedback();
  const pilot = await initPilot();
  const federation = await initFederation({ broadcast: deps.broadcast });
  // P10 — Federation Platform: the intelligence/governance/integration layer over the
  // federation runtime (graph, unified timeline, search, directory, analytics + RBAC).
  const federationPlatform = initFederationPlatform();
  // P11 — Cloud Control Plane: the global management/orchestration layer over the cloud
  // subsystems (fleet, regions, tenants, deployments, usage) + RBAC on the cloud handlers.
  // Runs after cloud + federation init so every backing store is loaded.
  const controlPlane = initControlPlane();
  // P12 — Developer Platform: the developer-experience layer over the ecosystem developer stack
  // (developer console, SDK/API/template registries, publishing, analytics) + RBAC on the
  // ecosystem handlers. Runs after ecosystem + cloud init so every backing store is loaded.
  const developerPlatform = initDeveloperPlatform();
  // P13 — Industry Solution Platform: the curated solution-pack catalog + readiness projection over
  // the existing platform (workforce, connectors, governance, marketplace). Runs last so every
  // backing store is loaded; read-only, RBAC-gated (industry:read).
  const industryPlatform = initIndustryPlatform();
  // P14 — Autonomous Enterprise Intelligence: the read-only strategic reasoning/projection layer over
  // the existing intelligence report, cloud control plane, industry platform, workforce, connectors,
  // marketplace, federation, and governance. Injects the already-computed handles (never re-creates a
  // second intelligence/cloud/industry engine); read-only, RBAC-gated (strategy:read), executes nothing.
  const autonomousIntel = initAutonomousIntelligence({
    enterpriseReport: enterpriseIntel.report,
    controlPlane: controlPlane.service,
    industry: industryPlatform.service,
  });
  // P15 — Enterprise Digital Twin: the read-only visualization/composition layer over the existing
  // enterprise graph, timeline, cloud, workforce, connectors, marketplace, federation, and P14 strategy.
  // Injects the already-computed handles + the platform timeline query (never re-creates a graph,
  // timeline, or simulation engine); read-only, RBAC-gated (twin:read), executes nothing.
  const enterpriseTwin = initEnterpriseTwin({
    enterpriseReport: enterpriseIntel.report,
    fleet: () => controlPlane.service.fleet(),
    usage: () => controlPlane.service.usage(),
    deployments: () => controlPlane.service.deployments(),
    strategyOverview: () => autonomousIntel.service.overview(),
    simulation: () => autonomousIntel.service.simulation(),
    queryTimeline: (q) => platform.api.query(q),
  });
  // P16 — Enterprise Knowledge Fabric: the read-only knowledge-enrichment layer that relates,
  // classifies, traces lineage, and EXPLAINS enterprise objects by projecting the existing relationship
  // graph, intelligence report, strategy, twin, timeline, and memory corpus. Reuses the shipped
  // knowledge derivations; creates NO new graph, memory, search, or vector index; RBAC-gated
  // (knowledge:read); executes nothing.
  const enterpriseKnowledge = initEnterpriseKnowledge({
    enterpriseReport: enterpriseIntel.report,
    strategyOverview: () => autonomousIntel.service.overview(),
    twinOverview: () => enterpriseTwin.service.overview(),
    queryTimeline: (q) => platform.api.query(q),
  });
  // P17 — Global AI Orchestration Platform: the read-only coordination/routing layer that routes
  // enterprise goals to existing worker capability pools (reusing the shipped delegation matcher), and
  // coordinates workforce/cloud/knowledge/marketplace/federation by projecting over the existing
  // Strategy planning, Workforce runtime, Cloud Control Plane, Knowledge Fabric, Marketplace, and
  // Federation. Imports NO mutator/scheduler/ExecuteEngine — structurally unable to dispatch/execute;
  // every route respects the existing approval chains. RBAC-gated (orchestration:read); executes nothing.
  const globalOrchestration = initGlobalOrchestration({
    enterpriseReport: enterpriseIntel.report,
    strategyOverview: () => autonomousIntel.service.overview(),
    knowledgeEvidence: () => enterpriseKnowledge.service.evidence(),
    knowledgeLineage: () => enterpriseKnowledge.service.lineage(),
    fleet: () => controlPlane.service.fleet(),
    regions: () => controlPlane.service.regions(),
    deployments: () => controlPlane.service.deployments(),
    usage: () => controlPlane.service.usage(),
    industryOverview: () => industryPlatform.service.overview(),
    developerOverview: () => developerPlatform.service.overview(),
  });
  // P18 — Enterprise Intelligence Network: the read-only, governed intelligence-EXCHANGE layer that lets
  // organizations share sanitized recommendations, patterns, benchmarks, and templates — WITHOUT any raw
  // enterprise records — by projecting the already-redacted Knowledge Fabric, the Industry benchmark
  // reference, the Twin/Orchestration aggregate metrics, and the EXISTING federation exchange substrate +
  // trust/consent/policy. Imports NO exchange/publish/share mutator; RBAC-gated (network:read); shares
  // nothing raw and executes nothing.
  const intelligenceNetwork = initEnterpriseIntelligenceNetwork({
    enterpriseReport: enterpriseIntel.report,
    strategyOverview: () => autonomousIntel.service.overview(),
    twinOverview: () => enterpriseTwin.service.overview(),
    orchestrationOverview: () => globalOrchestration.service.overview(),
    knowledgeEvidence: () => enterpriseKnowledge.service.evidence(),
    knowledgeClassification: () => enterpriseKnowledge.service.classification(),
    knowledgeAnalytics: () => enterpriseKnowledge.service.analytics(),
    knowledgeGovernance: () => enterpriseKnowledge.service.governance(),
    industryKpis: () => industryPlatform.service.kpis(),
    industryReadiness: () => industryPlatform.service.readiness(),
  });
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
      handler: async (p) =>
        orgClient.get(await requireCloudOrgMembership((p as { orgId: string }).orgId)),
    },
    {
      channel: IpcChannel.OrgUpdate,
      schema: OrgUpdateRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; name: string };
        return requireCloudOrgMembership(r.orgId).then((id) => orgClient.update(id, r.name));
      },
    },
    {
      channel: IpcChannel.OrgMembers,
      schema: OrgIdRequest,
      requireAuth: true,
      handler: async (p) =>
        orgClient.members(await requireCloudOrgMembership((p as { orgId: string }).orgId)),
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
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.invite(id, { email: r.email, role: r.role }),
        );
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
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.changeRole(id, r.membershipId, r.role),
        );
      },
    },
    {
      channel: IpcChannel.OrgRemoveMember,
      schema: OrgMembershipRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; membershipId: string };
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.removeMember(id, r.membershipId),
        );
      },
    },
    {
      channel: IpcChannel.OrgWorkspaces,
      schema: OrgIdRequest,
      requireAuth: true,
      handler: async (p) =>
        orgClient.workspaces(await requireCloudOrgMembership((p as { orgId: string }).orgId)),
    },
    {
      channel: IpcChannel.OrgCreateWorkspace,
      schema: OrgCreateWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; name: string };
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.createWorkspace(id, r.name),
        );
      },
    },
    {
      channel: IpcChannel.OrgUpdateWorkspace,
      schema: OrgUpdateWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; workspaceId: string; name: string };
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.updateWorkspace(id, r.workspaceId, r.name),
        );
      },
    },
    {
      channel: IpcChannel.OrgDeleteWorkspace,
      schema: OrgWorkspaceRequest,
      requireAuth: true,
      handler: (p) => {
        const r = p as { orgId: string; workspaceId: string };
        return requireCloudOrgMembership(r.orgId).then((id) =>
          orgClient.deleteWorkspace(id, r.workspaceId),
        );
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
    {
      // Plugin SDK v2 — the extensions installed plugins have registered (ERP modules, KPIs, providers, …).
      channel: IpcChannel.PluginsExtensions,
      schema: EmptyRequest,
      handler: () => pluginExtensionRegistry.all(),
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
  defs.push(...workforceIntel.handlers);
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
    correlationId?: string;
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
      // P8.3 — forward the chain id so execution.* events share the job/goal correlation.
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
  };
  // Private-First experience telemetry: profile decisions become platform
  // events (names only — no prompts, no content). Late-bound because the
  // profile service loads before the platform event bus exists.
  bindExperienceEvents((event) => {
    publishPlatform({
      type: 'experience.decision',
      category: 'system',
      source: 'experience:first-run',
      metadata: { event },
    });
  });
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
      // Money. The membership check matters more here than anywhere else in
      // this family: without it a signed-in account could start a checkout
      // against another organization's billing account.
      const orgId = await requireCloudOrgMembership(p.orgId);
      const result = await billingClient.checkout(orgId, p.plan, p.seats);
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
      requireCloudOrgMembership((payload as { orgId: string }).orgId).then((id) =>
        deviceClient.registerCurrent(id),
      ),
  });
  defs.push({
    channel: IpcChannel.DevicesList,
    schema: DevicesListRequest,
    handler: async (payload: unknown) =>
      deviceClient.list(await requireCloudOrgMembership((payload as { orgId: string }).orgId)),
  });
  defs.push({
    channel: IpcChannel.DevicesRevoke,
    schema: DevicesRevokeRequest,
    handler: (payload: unknown) => {
      const p = payload as { orgId: string; deviceId: string };
      return requireCloudOrgMembership(p.orgId).then((id) => deviceClient.revoke(id, p.deviceId));
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
  const executionStore = new ExecutionStore(join(app.getPath('userData'), 'executions.json')).bindScope(activeTenantScope);
  const executeEngine = new ExecuteEngine({
    publish: publishPlatform,
    persist: (session) => void executionStore.save(session),
    // P13C Round 2 — H5. Sessions carry their owner, so `activeSessions`,
    // `getHistory`, `stats` and `cancel` answer for the caller rather than the
    // install. Resolved through the one resolver, so a background execution
    // belongs to the tenant it was started FOR.
    tenantId: () => activeTenantScope()?.tenantId ?? null,
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
  // P8.3 — the workforce action executor: runs an APPROVED worker proposal's binding
  // through the EXISTING confirmation-gated executors (infra / m365 / automation).
  // `confirmed` is forwarded from the request — true only when the trusted in-process
  // dispatcher set it after a human approval, so mutating actions still hit their gate.
  const runBinding = async (
    binding: ExecutionBinding,
    confirmed: boolean,
  ): Promise<{ ok: boolean; summary?: string; error?: string }> => {
    switch (binding.executor) {
      case 'infra': {
        const r = await infrastructure.actionExecutor.execute(
          binding.target,
          binding.accountId ?? 'default',
          binding.actionId ?? '',
          binding.params ?? {},
          confirmed,
        );
        return { ok: r.ok, summary: r.message, error: r.ok ? undefined : r.message };
      }
      case 'm365': {
        const r = await connectors.m365Executor.execute(
          binding.target,
          binding.accountId ?? 'default',
          binding.actionId ?? '',
          binding.params ?? {},
          confirmed,
        );
        return {
          ok: r.ok,
          summary: r.message ?? undefined,
          error: r.ok ? undefined : (r.message ?? undefined),
        };
      }
      case 'automation': {
        const rec = await getAutomationRunner().runById(
          binding.target,
          binding.params ?? {},
          'manual',
        );
        if (!rec) return { ok: false, error: `Automation rule "${binding.target}" not found` };
        return {
          ok: rec.ok,
          summary: rec.ok ? `Automation ${binding.target} ran` : undefined,
          error: rec.ok ? undefined : 'Automation failed',
        };
      }
      default:
        return {
          ok: false,
          error: `Unknown executor "${(binding as { executor?: string }).executor ?? ''}"`,
        };
    }
  };
  executeEngine.register('connector', createWorkforceActionExecutor(runBinding));
  // Late-bind the engine into the workforce so approved binding-carrying proposals execute.
  workforce.setExecutionSubmit((req) => executeEngine.execute(req));
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
  // Phase 6 Stage 4 — Workspace Assistant: conversation → context → retrieval →
  // reasoning → planning → approval → execution → verification → response, as a
  // COMPOSITION over the engines wired above. Execution flows EXCLUSIVELY
  // through the ExecuteEngine (same governance as `execute:run`); one
  // correlation id (`asst_…`) threads every retrieval, AI audit record,
  // approval, execution session, and timeline event of a turn.
  // Phase 6 Stage 6 — the insight subsystem initializes AFTER the assistant (it
  // reads conversation summaries), while the assistant's ten-question port
  // resolves through this late-bound handle (same precedent as setAuxPorts).
  let insightRef: InsightSubsystem | null = null;
  // Phase 6 Stage 7 — same late-bound pattern for the Knowledge Platform's
  // ten-question port (the knowledge subsystem reads conversation summaries,
  // so it initializes after the assistant, below).
  let knowledgeRef: KnowledgeAssetsSubsystem | null = null;
  // Phase 6 Stage 8 — same late-bound pattern for the Automation Platform's
  // six-question port (the platform reads workflow runs, so it initializes
  // after the workforce handlers below).
  let automationRef: AutomationPlatformSubsystem | null = null;
  // Phase 6 Stage 9 — same late-bound pattern for the Operations Platform's
  // ten-question port (it reads the validation subsystem, so it initializes
  // after continuous validation below).
  let operationsRef: OperationsPlatformSubsystem | null = null;
  // Phase 6 Stage 10 — same late-bound pattern for the Strategy Platform's
  // eleven-question port (it composes the operations platform, so it
  // initializes after the operations platform below).
  let strategyRef: StrategyPlatformSubsystem | null = null;
  // Phase 6 Stage 11 — same late-bound pattern for the Federation Platform's
  // ten-question port (it composes the strategy platform, so it initializes
  // after the strategy platform below).
  let efedRef: EnterpriseFederationSubsystem | null = null;
  let analyticsRef: AnalyticsPlatformSubsystem | null = null;
  // Phase 6 Stage 13 — same late-bound pattern for the Digital Twin Platform's
  // ten-question port (it composes the analytics platform, so it initializes
  // after the analytics platform below).
  let twinRef: EtwinPlatformSubsystem | null = null;
  const assistant = initAssistant({
    broadcast: deps.broadcast,
    publish: publishPlatform,
    execute: (req) => executeEngine.execute(req),
    // Deterministic-first: the assistant answers lookup/aggregate questions
    // straight from the enterprise registry, under the SAME RBAC gate the
    // generic module channels enforce. 'forbidden' is surfaced as an answer.
    moduleRecords: (moduleId) => {
      const module = enterprise.modules.get(moduleId);
      if (!module) return null;
      try {
        enterprise.authorize(module.descriptor.permissions.read);
      } catch {
        return 'forbidden';
      }
      return {
        rows: module.store
          .list()
          .map((r) => ({ id: r.id, title: r.title, status: r.status, fields: r.fields })),
      };
    },
    // Engineless turns land one measured 'none'; engine-backed turns are
    // measured by the engine itself (never both — that would double-count).
    recordProcessing: (location) => routingUsageStore.record(location),
    executionsActive: () => executeEngine.activeSessions().length,
    // Phase 6 Stage 5 — Work Summary aggregation inputs (existing histories).
    executionHistory: () =>
      executeEngine
        .getHistory()
        .map((s) => ({ label: s.label, state: s.state, startedAt: s.startedAt })),
    automationRuns: () =>
      getAutomationRunRecords().map((r) => ({ ok: r.ok, startedAt: r.startedAt })),
    // Phase 6 Stage 6 (D-5) — the ten enterprise questions answer from the
    // Enterprise Intelligence Layer; unmatched questions fall through unchanged.
    intelligenceAnswer: (text, now) => insightRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 7 (D-8) — the ten knowledge questions answer from the
    // Knowledge Platform through the same late-bound, read-only port.
    knowledgeAnswer: (text, now) => knowledgeRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 8 (D-8) — the six automation questions answer from the
    // Automation Platform through the same late-bound, read-only port.
    automationAnswer: (text, now) => automationRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 9 (D-8) — the ten operations questions answer from the
    // Operations Platform through the same late-bound, read-only port.
    operationsAnswer: (text, now) => operationsRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 10 (D-8) — the eleven strategy questions answer from the
    // Strategy Platform through the same late-bound, read-only port.
    strategyAnswer: (text, now) => strategyRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 11 (D-8) — the ten federation questions answer from the
    // Enterprise Federation composition through the same late-bound port.
    federationAnswer: (text, now) => efedRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 12 (D-8) — the ten analytics questions answer from the
    // Enterprise Analytics composition through the same late-bound port.
    analyticsAnswer: (text, now) => analyticsRef?.answerQuestion(text, now) ?? null,
    // Phase 6 Stage 13 (D-8) — the ten digital-twin questions answer from the
    // Enterprise Digital Twin Platform composition through the same late-bound
    // port. The ninth resolver; P15's twin:* surface is composed, never changed.
    twinAnswer: (text, now) => twinRef?.answerQuestion(text, now) ?? null,
  });
  defs.push(...assistant.handlers);
  // Phase 6 Stage 5 (D-8) — Notification Inbox: registers the notification-center
  // delivery channel, routes attention-worthy bus events through the SAME engine
  // gates, adds the meeting-soon interval source, and exposes notifications:*.
  const notifications = initNotifications({
    broadcast: deps.broadcast,
    on: (types, handler) => platform.api.on([...types], handler),
    // P13C Part 3 — the one fan-out, shared with the delivery engine, so a
    // SYSTEM alert reaches each tenant under that tenant's own principal.
    forEachTenant: (jobId, fn) => forEachTenantBackground(jobId, fn),
  });
  defs.push(...notifications.handlers);
  // Phase 6 Stage 6 — the Enterprise Intelligence Layer. Every dep is a READ
  // over an existing singleton (the same graph/timeline ports P7 uses, the
  // operational stores, the existing health computations, the 90-day health
  // history); the two monitor sources register on the EXISTING delivery engine
  // and produce governed recommendation items only. Suggested recoveries run
  // exclusively as approval-gated assistant plan steps through the ExecuteEngine.
  const insight = initInsight({
    scope: activeTenantScope,
    getResourceModel: () => {
      try {
        return infrastructure.store.graph(Date.now());
      } catch {
        return null;
      }
    },
    getRelationshipModel: () => {
      try {
        return getRelationshipModel();
      } catch {
        return null;
      }
    },
    getEvents: (since, limit) => {
      const page = platform.api.query({ since, limit }) as { events?: unknown };
      return (Array.isArray(page.events) ? page.events : []) as unknown as RawTimelineEvent[];
    },
    entities: () => unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items,
    jobs: () => jobStore.page({ limit: 500 }).jobs,
    executions: () => executeEngine.getHistory(),
    automationRuns: () => getAutomationRunRecords(),
    automationRules: () => automationStore.all(),
    connectors: () => connectorService.list(),
    workers: () =>
      workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role })),
    conversations: () => assistant.conversationSummaries(),
    inbox: () =>
      notifications
        .inboxItems()
        .map((n) => ({ id: n.id, sourceKey: n.sourceKey, at: n.at, read: n.read })),
    orgHealth: () => computeOrgHealth(collectOrgHealthInputs(Date.now())),
    orgUnits: () => {
      const org = activeOrgForReadModel();
      if (org === null) return { units: 0, leadershipCoverage: null };
      const units = orgStore.unitsFor(org.id);
      const withLead = units.filter((u) => u.leadUserId).length;
      return {
        units: units.length,
        leadershipCoverage: units.length > 0 ? withLead / units.length : null,
      };
    },
    workforceHealth: () => summarizeWorkforceHealth(workerRegistry.healthSummaries()),
    systemHealth: () => {
      const snap = neuroCore.last();
      return snap ? { score: snap.score, level: snap.level } : null;
    },
    automationMonitor: () => getAutomationMonitor(),
    healthHistory: () => healthHistoryStore.all(),
    decisions: () =>
      decisionStore.all().map((d) => ({
        id: d.id,
        fromRecommendationId: d.fromRecommendationId ?? null,
        status: d.status,
        updatedAt: d.updatedAt,
      })),
    publish: publishPlatform,
    registerSource: (source) => deliveryEngine.register(source),
  });
  insightRef = insight;
  defs.push(...insight.handlers);
  // Phase 6 Stage 7 — the Enterprise Knowledge & Decision Platform. Every dep
  // is a READ over an existing singleton (decision store, governance store,
  // the versioned prompt registry, the UDM, the memory corpus, connector
  // service, org store, job store, the knowledge graph, the timeline, the
  // Stage 6 insight report, the P16 fabric, the federated search); the one
  // hygiene source registers on the EXISTING delivery engine and produces
  // governed recommendation items only. Six read-only kb:* channels
  // (knowledge:read); zero new persistence; no lifecycle executor — state
  // changes stay behind the existing governed writes.
  const knowledgeAssets = initKnowledgeAssets({
    scope: activeTenantScope,
    decisions: () => decisionStore.all(),
    chains: () => governanceStore.chains(),
    rules: () => governanceStore.rules(),
    prompts: () => {
      const latest = new Map<string, { id: string; version: number; label: string }>();
      for (const p of DEFAULT_PROMPTS) {
        const cur = latest.get(p.id);
        if (!cur || p.version > cur.version)
          latest.set(p.id, { id: p.id, version: p.version, label: p.label });
      }
      return [...latest.values()];
    },
    entities: () => unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items,
    memories: () => memoryStore.allItems(),
    connectors: () => connectorService.list(),
    org: () => {
      const org = activeOrgForReadModel();
      // No tenant, no org chart. This accessor returns the member list, so an
      // unresolved caller getting "the usual organization" was a roster leak.
      if (org === null) return { org: { id: '', name: '' }, units: [], users: [] };
      return {
        org: { id: org.id, name: org.name },
        units: orgStore
          .unitsFor(org.id)
          .map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId })),
        users: orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name, unitId: u.unitId })),
      };
    },
    jobs: () =>
      jobStore.page({ limit: 500 }).jobs.map((j) => ({
        id: j.id,
        skillId: j.skillId,
        status: j.status,
        requestedBy: j.requestedBy,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
        correlationId: j.correlationId ?? null,
      })),
    conversations: () =>
      assistant
        .conversationSummaries()
        .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    executions: () =>
      executeEngine
        .getHistory()
        .map((s) => ({ label: s.label, state: s.state, startedAt: s.startedAt })),
    getEvents: (since, limit) => {
      const page = platform.api.query({ since, limit }) as { events?: unknown };
      const events = Array.isArray(page.events) ? page.events : [];
      return events as {
        id: string;
        type: string;
        timestamp: string;
        correlationId?: string | null;
        metadata?: Record<string, unknown> | null;
      }[];
    },
    graphEdgesFor: (recordIds) => {
      const out: {
        type: string;
        fromSourceId: string | null;
        toSourceId: string | null;
        fromLabel: string;
        toLabel: string;
        at: string | null;
        evidenceId: string | null;
      }[] = [];
      for (const rid of recordIds) {
        if (out.length >= 2000) break;
        if (!graphStore.getNode(rid)) continue;
        const n = graphStore.neighbors({ id: rid, limit: 50 });
        if (!n) continue;
        for (const en of n.neighbors) {
          out.push({
            type: en.edge.type,
            fromSourceId: en.edge.from,
            toSourceId: en.edge.to,
            fromLabel: en.direction === 'out' ? n.node.label : en.node.label,
            toLabel: en.direction === 'out' ? en.node.label : n.node.label,
            at: en.edge.updatedAt,
            evidenceId: en.edge.evidence?.id ?? null,
          });
        }
      }
      return out;
    },
    graphDiscussedIn: (recordId) => {
      if (!graphStore.getNode(recordId)) return [];
      const n = graphStore.neighbors({ id: recordId, edgeTypes: ['discussed_in'], limit: 20 });
      return n
        ? n.neighbors.map((en) => ({ id: en.node.id, label: en.node.label, at: en.edge.updatedAt }))
        : [];
    },
    graphHistoryFor: (recordIds) => {
      const out: { at: string; action: string; label: string }[] = [];
      for (const rid of recordIds) {
        if (out.length >= 20) break;
        for (const ev of graphStore.historyFor({ id: rid, limit: 5 })) {
          out.push({ at: ev.at, action: ev.change, label: `${ev.type}: ${ev.from} → ${ev.to}` });
        }
      }
      return out;
    },
    insightRecommendations: () =>
      insight
        .report()
        .recommendations.map((r) => ({ id: r.id, title: r.title, evidence: r.evidence })),
    fabricGeneratedAt: () => enterpriseKnowledge.service.overview().summary.generatedAt,
    search: (text) =>
      runEnterpriseSearch(
        { text, limit: 10 },
        {
          entity: unifiedStore.searchBackend,
          graph: graphStore,
          memory: memoryStore,
          // P13A — see EnterpriseSearchSources.memoryScope.
          memoryScope: activeTenantScope(),
          timeline: getEnterpriseTimeline() ?? undefined,
          federation: getFederationSearcher() ?? undefined,
        },
      ).hits.map((h) => ({
        source: h.source,
        id: h.id,
        kind: h.kind,
        title: h.title,
        snippet: h.snippet,
        score: h.score,
      })),
    registerSource: (source) => deliveryEngine.register(source),
  });
  knowledgeRef = knowledgeAssets;
  defs.push(...knowledgeAssets.handlers);
  // Phase 6 Stage 8 — the Enterprise Automation Platform. Every dep is a READ
  // over an existing singleton; the schedule tick (D-3) registers on the
  // EXISTING taskScheduler and fires DUE schedule rules through the EXISTING
  // automation runner path (trigger + condition checks via
  // selectRulesForEvent, then runner.runRule) — the Builder's `schedule`
  // trigger fires for the first time. Six read-only ap:* channels
  // (autonomousops:read); one governed watch source; zero mutation surface;
  // execution remains exclusively Assistant → Approval → ExecuteEngine →
  // Workforce → Connector Executors.
  const automationPlatform = initAutomationPlatform({
    scope: activeTenantScope,
    rules: () => automationStore.all(),
    runRecords: () => getAutomationRunRecords(),
    workflowRuns: () => workforce.workflowRunEntries(),
    sessions: () =>
      executeEngine.getHistory().map((x) => ({
        id: x.id,
        kind: x.kind,
        label: x.label,
        state: x.state,
        startedAt: x.startedAt,
      })),
    jobsAwaiting: () =>
      jobStore
        .page({ status: 'awaiting_approval', limit: 200 })
        .jobs.map((j) => ({ id: j.id, createdAt: j.createdAt })),
    chains: () => governanceStore.chains(),
    orgRoles: () => {
      const org = activeOrgForReadModel();
      if (org === null) return [];
      return orgStore.rolesFor(org.id).map((r) => ({ id: r.id, name: r.name }));
    },
    globalPolicies: () =>
      globalGovStore.listPolicies().map((pol) => ({
        effect: (pol as { effect?: string }).effect ?? '',
        enabled: (pol as { enabled?: boolean }).enabled ?? false,
        action: (pol as { action?: string }).action ?? '',
      })),
    knownWorkers: () =>
      workerRegistry
        .list()
        .map((w) => ({ id: w.identity.id, skills: w.skills.map((sk) => sk.id) })),
    installedWorkers: () =>
      workerInstallStore.all().map((r) => ({ id: r.id, hasPreviousVersion: r.previous !== null })),
    deliverySources: () => deliveryEngine.listSources().map((key) => ({ key })),
    scheduledValidations: () => null,
    autoOpsPlans: () => null,
    sandboxHistory: () => null,
    knowledgeMatch: (refs) => {
      const inv = knowledgeRef?.inventory();
      if (!inv) return refs.map((ref) => ({ ref, matched: false }));
      return refs.map((ref) => ({
        ref,
        matched: inv.assets.some((asset) => asset.recordId === ref || asset.topics.includes(ref)),
      }));
    },
    fireScheduledRule: async (ruleId, scheduledForIso) => {
      const rule = automationStore.all().find((r) => r.id === ruleId && r.status === 'active');
      if (!rule) return null;
      const event = { source: 'schedule' as const, payload: { scheduledFor: scheduledForIso } };
      // The EXISTING trigger + condition evaluation, then the EXISTING runner.
      if (selectRulesForEvent([rule], event).length === 0) return null;
      const record = await getAutomationRunner().runRule(rule, event);
      return { ok: record.ok };
    },
    schedule: {
      every: (id, ms, fn) => taskScheduler.every(id, ms, fn),
      cancel: (id) => taskScheduler.cancel(id),
    },
    registerSource: (source) => deliveryEngine.register(source),
  });
  automationRef = automationPlatform;
  defs.push(...automationPlatform.handlers);
  // Phase 6 Stage 5 (D-7) — bind the recommendation engine's aux read ports now
  // that workforce + connectors + automations + assistant all exist. Late-bound
  // exactly like workforce.setExecutionSubmit; a failing port silences its rules.
  recommendations.setAuxPorts({
    pendingApprovals: () => {
      const workers = new Map(workerRegistry.summaries().map((w) => [w.id, w.name]));
      return jobStore.page({ status: 'awaiting_approval', limit: 50 }).jobs.map((j) => ({
        jobId: j.id,
        title: j.summary ?? j.skillId,
        workerName: workers.get(j.workerId) ?? j.workerId,
        createdAt: j.createdAt,
      }));
    },
    connectors: () =>
      connectorService.list().map((c) => ({
        id: c.id,
        problem:
          c.health === 'healthy' || !c.configured || c.health === 'unknown'
            ? null
            : `health ${c.health} (status ${c.status})`,
      })),
    executionHistory: () =>
      getAutomationRunRecords()
        .filter((r) => r.triggeredBy === 'manual' && r.ok)
        .map((r) => ({
          kind: 'automation',
          targetId: r.ruleId,
          label: r.ruleName,
          startedAt: r.startedAt,
          state: 'completed',
        })),
    conversations: () => assistant.conversationSummaries(),
  });
  defs.push(...trace.handlers);
  defs.push(...workforce.handlers);
  defs.push(...enterprise.handlers);
  defs.push(...dataPlane.handlers);
  defs.push(...documents.handlers);
  defs.push(...identity.handlers);
  // P12 — harden the previously-ungated ecosystem handlers with RBAC (they shipped with no
  // requireAuth/permission); every ecosystem channel now requires a developer:* permission.
  defs.push(...withEcosystemAuthz(ecosystem.handlers));
  defs.push(...developerPlatform.handlers);
  // P19 — Autonomous Enterprise Operations: the closed-loop operations projection LAYER. It OBSERVES the
  // ExecuteEngine + Workforce runtime, the RuntimeSupervisor recovery signals, P7/P14/P16 intelligence, and
  // the Cloud Control Plane, and RECOMMENDS operational/recovery/optimization plans — importing zero
  // mutators, so it can never execute. Wired here because it reads executeEngine + runtimeSupervisor
  // (constructed above); execution + approval still flow through the existing runtime + approval engine.
  const autonomousOps = initAutonomousOperations({
    enterpriseReport: enterpriseIntel.report,
    strategyOverview: () => autonomousIntel.service.overview(),
    twinOverview: () => enterpriseTwin.service.overview(),
    orchestrationOverview: () => globalOrchestration.service.overview(),
    knowledgeEvidence: () => enterpriseKnowledge.service.evidence(),
    cloudUsage: () => controlPlane.service.usage(),
    cloudDeployments: () => controlPlane.service.deployments(),
    cloudRegions: () => controlPlane.service.regions(),
    executionSessions: () => executeEngine.activeSessions(),
    executionHistory: () => executeEngine.getHistory(),
    executionStats: () => executeEngine.stats(),
    supervisorStatus: () => runtimeSupervisor.status(),
    supervisorHistory: () => runtimeSupervisor.getHistory(),
  });
  // P20 — NeuroPause Platform v2 (Commercial Productization): the read-only commercial projection LAYER. It
  // unifies the EXISTING billing / license / cloud-tenancy / org-RBAC / usage-analytics / customer-health /
  // release substrate into customer-facing commercial views — importing zero mutators, so it can neither
  // change a plan, charge a card, assign a seat, nor provision a tenant; those flow through the existing
  // billing engine + cloud control plane under their own manage scopes.
  const commercial = initCommercialPlatform({
    enterpriseReport: enterpriseIntel.report,
    controlPlaneOverview: () => controlPlane.service.overview(),
    strategyOptimization: () => autonomousIntel.service.optimization(),
  });
  // Experience Program v1.0 — the Decision-First Experience LAYER. A read-only compression over the ENTIRE
  // platform (P7/P14–P20 + workforce/connectors/marketplace) that distills it into the executive Decision
  // Center — business health, today's mission, revenue, one decision/risk/approval. It imports zero mutators
  // and changes only HOW humans interact with NeuroPause, not how it works.
  const experience = initExperience({
    enterpriseReport: enterpriseIntel.report,
    strategyDecisions: () => autonomousIntel.service.decisions(),
    strategyOverview: () => autonomousIntel.service.overview(),
    opsOverview: () => autonomousOps.service.overview(),
    opsApprovals: () => autonomousOps.service.approvals(),
    twinOverview: () => enterpriseTwin.service.overview(),
    knowledgeOverview: () => enterpriseKnowledge.service.overview(),
    commercialOverview: () => commercial.service.overview(),
  });
  // Intent Experience Program v2.0 — the Intent-Native Experience LAYER. A read-only reprojection of the
  // EXISTING P14 strategic goals as user outcomes ("intents"): a multi-intent board, Today's Intent
  // dashboard, per-intent dynamic workspaces, role lenses, and the real next best action. Every value traces
  // to a real strategy-goal signal; it imports zero mutators and adds no runtime/engine/store.
  const intent = initIntent({
    strategyOverview: () => autonomousIntel.service.overview(),
  });
  // P13 — Industry Solution Platform read handlers (self-gated with industry:read).
  defs.push(...industryPlatform.handlers);
  // P14 — Autonomous Enterprise Intelligence read handlers (self-gated with strategy:read).
  defs.push(...autonomousIntel.handlers);
  // P15 — Enterprise Digital Twin read handlers (self-gated with twin:read).
  defs.push(...enterpriseTwin.handlers);
  // P16 — Enterprise Knowledge Fabric read handlers (self-gated with knowledge:read).
  defs.push(...enterpriseKnowledge.handlers);
  // P17 — Global AI Orchestration read handlers (self-gated with orchestration:read).
  defs.push(...globalOrchestration.handlers);
  // P18 — Enterprise Intelligence Network read handlers (self-gated with network:read).
  defs.push(...intelligenceNetwork.handlers);
  // P19 — Autonomous Enterprise Operations read handlers (self-gated with autonomousops:read).
  defs.push(...autonomousOps.handlers);
  // P20 — NeuroPause Platform v2 commercial read handlers (self-gated with commercial:read).
  defs.push(...commercial.handlers);
  // Experience Program v1.0 — decision-first experience read handlers (self-gated with experience:read).
  defs.push(...experience.handlers);
  // Intent Experience Program v2.0 — intent-native experience read handlers (self-gated with intent:read).
  defs.push(...intent.handlers);
  defs.push(...marketplace.handlers);
  defs.push(...webhooks.handlers);
  defs.push(...sandbox.handlers);
  // P11 — harden the previously-ungated cloud runtime handlers with RBAC (they shipped with no
  // requireAuth/permission); every cloud channel now requires a cloud:* permission.
  defs.push(...withCloudAuthz(cloud.handlers));
  defs.push(...controlPlane.handlers);
  defs.push(...infrastructure.handlers);
  defs.push(...enterpriseIntel.handlers);
  defs.push(...featureFlags.handlers);
  defs.push(...license.handlers);
  defs.push(...onboarding.handlers);
  // Decision Records + Holds. Classified in `ipc/runtimeAuthz.ts`
  // (governance:read / governance:manage) and stamped by withRuntimeAuthz below.
  defs.push(...decisionRecords.handlers);
  defs.push(...aiConfig.handlers);
  defs.push(...feedback.handlers);
  defs.push(...pilot.handlers);
  registerDiagnosticProbes([
    // Mirrors OllamaModelClient's URL resolution (env override, then local default).
    ollamaProbe({ baseUrl: process.env.NEUROPAUSE_OLLAMA_URL ?? 'http://localhost:11434' }),
    aiMemoryProbe(() => memoryStore.counts().total),
    // A6 — semantic retrieval health. `aiMemoryProbe` above only counts what is
    // indexed; it stays `ok` while the semantic leg is dead, because the items
    // are still there. This reports whether recall can actually *reach* them.
    // Exposed by the subsystem rather than built here, because the tracker lives
    // inside the resilient decorator `initMemory` wires — the same idiom as
    // `infrastructure.probe` / `enterpriseIntel.probe` below.
    memory.probe,
    // P4.1 — connector runtime health rolls into the existing diagnostics report; reauth/error accounts
    // (excluded from the connected-only snapshots) surface via the attention count.
    connectorHealthProbe(() => raiseHoldsForUnreachableConnectors(sync.snapshots()), {
      attention: () =>
        connectors.supervisor
          .runtimeView()
          .flatMap((v) => v.accounts)
          .filter((a) => a.state === 'reauth_required' || a.state === 'error').length,
    }),
    knowledgeGraphProbe(() => {
      const c = graphStore.counts();
      return { nodes: c.nodes, edges: c.edges };
    }),
    // P6 — Cloud & Infrastructure discovery health rolls into the existing diagnostics report.
    infrastructure.probe,
    // P7 — Enterprise Intelligence health (composite health/risk/incidents) rolls into the same report.
    enterpriseIntel.probe,
    // P8.2 — AI Workforce runtime health (worker health/availability, queue, exec/failure
    // rate, avg duration, pending approvals) rolls into the same report. Reads the live
    // registry + job store singletons; lazy getters run at report() time.
    workforceProbe({
      workers: () => workerRegistry.summaries(),
      health: () => workerRegistry.healthSummaries(),
      jobs: () => jobStore.page({ limit: 500 }).jobs,
      queued: () => jobStore.page({ status: 'queued', limit: 1 }).total,
      storedJobs: () => jobStore.size(),
    }),
  ]);
  // P10 — harden the previously-unguarded federation runtime handlers with RBAC (they shipped
  // with only `audit: true`); every federation channel now requires a federation:* permission.
  defs.push(...withFederationAuthz(federation.handlers));
  defs.push(...federationPlatform.handlers);
  defs.push(...updater.handlers);
  // Phase 8 (8.14): in-app help over the bundled documentation set.
  defs.push(...initHelp().handlers);
  defs.push(...releaseOps.handlers);

  // Mobile M1-03 — Companion Gateway (desktop side of the mobile companion): a LAN
  // server a paired phone reaches over end-to-end sealed frames, off by default,
  // hosting view-models only and dispatching through the same secure core as
  // IPC/REST. Wired before the sender-trust stamping below so its org:manage-gated
  // management channels (enable / revoke / pairingQr) are classified with the rest.
  const companion = await initCompanion({
    isSignedIn: () => authService.getStatus().state === 'authenticated',
    sessionEmail: () => {
      const st = authService.getStatus();
      return st.state === 'authenticated' ? st.session.user.email : null;
    },
    /**
     * P13C Part 3 — the ACTIVE organization's name, not the first one's.
     *
     * `orgStore.defaultOrg()` returns the first-inserted organization, so every
     * paired phone in every tenant was told the same organization's name — over
     * the LAN, in the pairing response and every `session.hello`. Resolving
     * through the tenant resolver makes the label describe the tenant whose
     * records the device is actually being shown; an unresolved tenant reports
     * nothing rather than borrowing a name.
     */
    orgName: () => {
      const scope = activeTenantScope();
      if (scope === null) return '';
      return orgStore.organization(scope.tenantId)?.name ?? '';
    },
    currentTenantId: () => activeTenantScope()?.tenantId ?? null,
    modules: enterprise.modules,
    executiveSnapshot: () => executiveCenter.snapshot(),
    subscribe: (types, handler) => platform.api.on(types, handler),
    broadcast: deps.broadcast,
  });
  defs.push(...companion.handlers);

  // ── Close the sender-trust gap on privileged base/core channels ──────────────
  // A class of privileged runtime channels (execute / plugin lifecycle / permission
  // grants / automation mutations / runtime control / memory writes / decision
  // mutations / feature-flag overrides / migration+backup+recovery+support / billing
  // / device registration / supervisor recovery / registry import+backup / package
  // rollback + org-intelligence reads) shipped WITHOUT a `permission`, riding on
  // sender-trust alone because no authz annotator covered their namespace. Stamp
  // requireAuth + the RBAC permission from RUNTIME_CHANNEL_PERMISSIONS onto exactly
  // those channels, skipping any already gated by another withXAuthz annotator
  // (never double-wrap). See ipc/runtimeAuthz.ts. Applied here, at the composition
  // root, because these privileged channels are interleaved with genuinely-public
  // ones inside shared subsystem handler arrays (memory / graph / automation /
  // decision / feature-flags / releaseOps / trace / …); wrapping the whole arrays
  // would trip withRuntimeAuthz's throw-on-unclassified guard on the public reads.
  const runtimeGated = new Map(
    withRuntimeAuthz(
      defs.filter((d) => RUNTIME_CHANNEL_PERMISSIONS[d.channel] && !d.permission),
    ).map((d) => [d.channel, d] as const),
  );
  for (let i = 0; i < defs.length; i += 1) {
    const gated = runtimeGated.get(defs[i].channel);
    if (gated) defs[i] = gated;
  }

  // RBAC: channels annotated with `permission` (the enterprise family) are asserted
  // against the signed-in actor's org roles before dispatch.
  const secureBridgeDeps = {
    isAuthenticated: () => authService.getStatus().state === 'authenticated',
    authorize: enterprise.authorize,
  };

  // P3.0 Increment 1 — Enterprise REST API. A gateway adapter over the SAME secure
  // handler registry: it reuses the Ecosystem gateway (auth / scope / rate / quota /
  // audit) and the shared secure-handler core (RBAC + Zod + the existing handler).
  // No parallel REST layer, no duplicated business logic. Built after every other
  // handler is assembled so it can resolve any of them by channel.
  const handlerByChannel = new Map<string, SecureHandlerDef>();
  for (const d of defs) handlerByChannel.set(d.channel, d);
  // Mobile M1-05 — let the companion write path (approvals.act) dispatch module
  // actions through the SAME secure core (RBAC + Zod + module guards + audit).
  companion.bindDispatch((channel, payload) => {
    const def = handlerByChannel.get(channel);
    if (!def) throw new Error(`Companion dispatch: no handler for channel "${channel}"`);
    return runSecureHandler(def, payload, secureBridgeDeps);
  });
  const apiGatewayDeps = {
    decide: (input: Parameters<typeof runGateway>[0]) => runGateway(input),
    resolveHandler: (channel: string) => handlerByChannel.get(channel),
    runHandler: (def: SecureHandlerDef, payload: unknown) =>
      runSecureHandler(def, payload, secureBridgeDeps),
    metrics: (windowDays: number) => gatewayMetrics(windowDays),
    gatewayAudit: (limit: number) => gatewayAuditEntries(limit),
    health: () => neuroCore.snapshot(),
    now: () => Date.now(),
  };
  const enterpriseApi = initEnterpriseApi(apiGatewayDeps);
  defs.push(...enterpriseApi.handlers);

  // AI Sandbox S2 + S3 — register the Desktop Automation executor and the Enterprise
  // Scenario Runner onto the S1 engine through a router. The runner drives REAL platform
  // state: module CRUD/actions go through the SAME secure core the IPC bridge + REST
  // gateway use (`runSecureHandler` over the live module registry), so it can never bypass
  // RBAC. REST/SDK/CLI channels reuse the in-process REST gateway; desktop reuses S2.
  wireSandboxRunners({
    engine: sandbox.engine,
    baseDir: sandboxBaseDir,
    launchTarget: sandboxLaunchTarget,
    handlerByChannel,
    secureBridgeDeps,
    apiGatewayDeps,
    authorize: enterprise.authorize,
    moduleRegistry: enterprise.modules,
    graphRebuild: graph.rebuild,
    executiveSnapshot: () => executiveCenter.snapshot(),
  });

  // AI Sandbox S4 — AI QA Agent. A reasoning layer that plans QA goals and submits scenario
  // specs to the EXISTING executors through the sandbox IPC channels (same secure core →
  // same RBAC). It reuses the memory store for learnings and the AI engine for optional
  // narrative enrichment (deterministic without a model). No new engine/memory/graph.
  const aiQa = wireAiQa({ handlerByChannel, secureBridgeDeps });
  log.info('AI QA agent ready', { agents: aiQa.agents.length, reasoner: aiQa.reasonerKind });

  // AI Sandbox S5 — Performance & Security Lab. Validates performance/scalability/resilience/
  // security of the REAL platform by running scenarios through the SAME executors and reading
  // the EXISTING diagnostics (NeuroCore health), executive KPIs, and gateway audit. It
  // surfaces its verdict through the existing diagnostics via a probe. No new monitoring.
  const perfLab = await wirePerfSecurityLab({
    handlerByChannel,
    secureBridgeDeps,
    benchmarksPath: join(sandboxBaseDir, 'lab', 'benchmarks.json'),
    health: async () => {
      const s = await neuroCore.snapshot();
      return {
        level: s.level,
        cpuPercent: s.telemetry.cpuPercent,
        memoryUsedMb: s.telemetry.memoryUsedMb,
      };
    },
    kpis: () => executiveCenter.snapshot().kpis.map((k) => ({ key: k.key, value: k.value })),
    auditCount: () => gatewayAuditEntries(100).length,
  });
  registerDiagnosticProbes([() => perfLab.diagnosticsProbe()]);
  log.info('Perf & Security Lab ready', { benchmarks: perfLab.benchmarks.count() });

  // AI Sandbox S6 — Continuous Validation Platform. The orchestration layer that composes
  // S1–S5 into named pipelines, fires them on the EXISTING scheduler, compares against the
  // SAME benchmark store, records in the EXISTING memory, certifies, and notifies through
  // the EXISTING notification path. Auto-schedules are OFF by default (runs mutate real
  // data). Completes AI Sandbox v1.0. No new engine/scheduler/dashboard/report/memory.
  const validation = await wireContinuousValidation({
    handlerByChannel,
    secureBridgeDeps,
    runsPath: join(sandboxBaseDir, 'validation', 'runs.json'),
    runQaSession: (goal) => aiQa.runSession({ text: goal }).then((o) => o.session),
    runLab: (config) => perfLab.runLab(config),
    benchmarks: perfLab.benchmarks,
    health: async () => {
      const s = await neuroCore.snapshot();
      return {
        level: s.level,
        cpuPercent: s.telemetry.cpuPercent,
        memoryUsedMb: s.telemetry.memoryUsedMb,
      };
    },
    kpis: () => executiveCenter.snapshot().kpis.map((k) => ({ key: k.key, value: k.value })),
  });
  defs.push(...validation.handlers);
  log.info('Continuous Validation Platform ready — AI Sandbox v1.0 complete', {
    pipelines: validation.pipelines.length,
  });

  // Phase 6 Stage 9 — the Enterprise Operations Platform. Every dep is a READ
  // over an existing singleton/subsystem; the ONE async read is the local
  // backup list (via the release-ops accessor). Six read-only eops:* channels
  // (autonomousops:read); one governed operations-watch source; zero mutation
  // surface; execution remains exclusively Assistant → Approval →
  // ExecuteEngine → Workforce → Connector Executors.
  const operationsPlatform = initOperationsPlatform({
    scope: activeTenantScope,
    insightReport: () => insightRef?.report() ?? null,
    executionStats: () => executeEngine.stats(),
    queuedJobsTotal: () => jobStore.page({ status: 'queued', limit: 1 }).total,
    awaitingApprovals: () =>
      jobStore
        .page({ status: 'awaiting_approval', limit: 200 })
        .jobs.map((j) => ({ id: j.id, createdAt: j.createdAt })),
    bottlenecks: () =>
      detectBottlenecks(jobStore.page({ limit: 500 }).jobs).map((b) => ({
        scope: b.scope,
        key: b.key,
        kind: b.kind,
        reason: b.reason,
        value: b.value,
        sampleSize: b.sampleSize,
      })),
    automationMonitor: () => getAutomationMonitor(),
    automationErrorRules: () => automationStore.all().filter((r) => r.status === 'error').length,
    connectors: () =>
      connectorService
        .list()
        .map((c) => ({ id: c.id, name: c.name, configured: c.configured, health: c.health })),
    aiState: () => engineManager.status().state,
    executiveKpis: () =>
      executiveCenter.snapshot().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    processKpis: () =>
      getProcessExplorerKpis().map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    minedProcesses: () =>
      getProcessAssessment().metrics.byType.map((m) => ({
        type: m.processType,
        cases: m.caseCount,
        medianDurationMs: Number.isFinite(m.medianCycleHours)
          ? m.medianCycleHours * 3_600_000
          : null,
        onTimeRate: Number.isFinite(m.completionRate) ? m.completionRate : null,
      })),
    units: () => {
      const org = activeOrgForReadModel();
      if (org === null) return [];
      return orgStore
        .unitsFor(org.id)
        .map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId }));
    },
    users: () => {
      const org = activeOrgForReadModel();
      if (org === null) return [];
      return orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name }));
    },
    compliance: () =>
      enterprise.complianceFindings().map((f) => ({
        ruleId: f.ruleId,
        ruleName: f.ruleName,
        severity: f.severity,
        status: f.status,
      })),
    enabledChains: () => governanceStore.chains().filter((c) => c.enabled).length,
    workforceHealth: () => {
      const w = summarizeWorkforceHealth(workerRegistry.healthSummaries());
      return {
        healthy: w.healthy,
        degraded: w.degraded,
        unhealthy: w.unhealthy,
        unknown: w.unknown,
      };
    },
    systemHealth: () => {
      const snap = neuroCore.last();
      return snap ? { score: snap.score, level: snap.level } : null;
    },
    healthHistory: () => healthHistoryStore.all().map((h) => ({ day: h.day, overall: h.overall })),
    validationSummary: () => {
      const v = validation.summary();
      return {
        totalRuns: v.totalRuns,
        certifies: v.pipelines.filter((x) => x.certifies).length,
        latestCertification: v.latestCertification,
      };
    },
    drPosture: () => drStore.continuity(),
    drReplicas: () => drStore.listReplicas().map((r) => ({ status: r.status })),
    drValidations: () =>
      drStore
        .listValidations()
        .map((v) => ({ status: v.status, rpoSeconds: v.rpoSeconds, validatedAt: v.validatedAt })),
    localBackups: async () => {
      const list = await releaseOps.listBackups();
      return list.map((b) => ({ createdAt: b.createdAt, valid: b.valid }));
    },
    supervisor: () => {
      const st = runtimeSupervisor.status();
      return { recoveryCount: st.recoveryCount, recentFailures: st.recentFailures };
    },
    knowledgeMatch: (refs) => {
      const inv = knowledgeRef?.inventory();
      if (!inv) return refs.map((ref) => ({ ref, matched: false }));
      return refs.map((ref) => ({
        ref,
        matched: inv.assets.some((asset) => asset.recordId === ref || asset.topics.includes(ref)),
      }));
    },
    automationPlatform: () => {
      if (!automationRef) return null;
      const c = automationRef.catalog();
      const m = automationRef.monitor();
      return { entries: c.totals.entries, findings: m.totals.findings };
    },
    registerSource: (source) => deliveryEngine.register(source),
  });
  operationsRef = operationsPlatform;
  defs.push(...operationsPlatform.handlers);

  // ── Phase 6 Stage 10 — the Enterprise Strategy Platform ─────────────────
  // ONE composition subsystem over everything above: objectives measured by
  // existing aggregates, the initiative portfolio over existing records, the
  // decision→outcome value view, relative-horizon planning, the Enterprise
  // Capability Map, strategy health (S6+S7+S8+S9+P14 — P14 composed as ONE
  // injected input, never duplicated), the executive dashboard, and the board
  // report. Six read-only estrat:* channels under the EXISTING strategy:read
  // scope; one strategy-watch delivery source; zero mutation surface.
  const strategyPlatform = initStrategyPlatform({
    scope: activeTenantScope,
    insightDomains: () =>
      insightRef
        ?.report()
        .health.domains.map((d) => ({ key: d.key, band: d.band, score: d.score })) ?? null,
    insightOverallBand: () => insightRef?.report().health.band ?? null,
    insightIncidents: () => {
      // Domain attribution rides the Stage 9 incident lifecycle (composed, not recomputed).
      if (!operationsRef) return null;
      return operationsRef
        .incidents()
        .incidents.map((i) => ({ domain: i.domain, severity: i.incident.severity }));
    },
    insightOutcomes: () =>
      insightRef?.report().recommendations.map((r) => ({ id: r.id, stage: r.outcome.stage })) ??
      null,
    executiveKpis: () =>
      executiveCenter.snapshot().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        ...(k.band ? { band: k.band } : {}),
      })),
    slaStatuses: () =>
      operationsRef
        ? operationsRef
            .sla()
            .statuses.map((s) => ({ targetId: s.targetId, status: s.status, detail: s.detail }))
        : [],
    readiness: () =>
      operationsRef
        ? operationsRef.readiness().dimensions.map((d) => ({
            key: d.key,
            state: d.state,
            detail: d.detail,
            missing: d.missing,
          }))
        : [],
    s9Services: () =>
      operationsRef
        ? operationsRef.catalog().entries.map((e) => ({
            serviceId: e.serviceId,
            state: e.state,
            stateDetail: e.stateDetail,
          }))
        : [],
    capacityPressure: () => (operationsRef ? operationsRef.capacity().pressure : 'unknown'),
    playbooks: () => PLAYBOOK_REGISTRY.map((p) => ({ id: p.id, version: p.version })),
    apFindings: () =>
      automationRef
        ? automationRef.monitor().findings.map((f) => ({ kind: f.kind, severity: f.severity }))
        : null,
    knowledgeTotals: () => {
      const d = knowledgeRef?.dashboard();
      return d ? { assets: d.inventory.total, findings: d.quality.findings } : null;
    },
    knowledgeMatch: (refs) => {
      const inv = knowledgeRef?.inventory();
      if (!inv) return refs.map((ref) => ({ ref, matched: false }));
      return refs.map((ref) => ({
        ref,
        matched: inv.assets.some((asset) => asset.recordId === ref || asset.topics.includes(ref)),
      }));
    },
    p14Overview: () => {
      const s = autonomousIntel.service.overview().summary;
      return { goalsOnTrack: s.goalsOnTrack, goalsTotal: s.goalsTotal, healthBand: s.healthBand };
    },
    decisions: () =>
      decisionStore.all().map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        status: d.status,
        expectedOutcome: d.expectedOutcome,
        businessImpact: d.businessImpact,
        fromRecommendationId: d.fromRecommendationId ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    projects: () =>
      unifiedStore
        .query({ kinds: ['project'], limit: 100_000, includeDeleted: false })
        .items.map((e) => ({
          id: e.id,
          title: e.title,
          syncState: e.syncState,
          status: e.status ?? null,
        })),
    minedTypes: () =>
      getProcessAssessment()
        .metrics.byType.filter((m) => m.caseCount > 0)
        .map((m) => m.processType),
    compliance: () => enterprise.complianceFindings().map((f) => ({ status: f.status })),
    units: () => {
      const org = activeOrgForReadModel();
      if (org === null) return [];
      return orgStore
        .unitsFor(org.id)
        .map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId }));
    },
    users: () => {
      const org = activeOrgForReadModel();
      if (org === null) return [];
      return orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name }));
    },
    healthHistory: () =>
      healthHistoryStore
        .all()
        .map((h) => ({ day: h.day, overall: h.overall, engineering: h.engineering })),
    registerSource: (source) => deliveryEngine.register(source),
  });
  strategyRef = strategyPlatform;
  defs.push(...strategyPlatform.handlers);

  // ── Phase 6 Stage 11 — the Enterprise Federation Platform ───────────────
  // ONE composition subsystem over the EXISTING federation stores (P9-S2:
  // peers/trust/shares/exchange/governance — all authoritative and untouched),
  // the P18 sanitized network summary, and the Stage 7–10 platforms. Six
  // read-only efed:* channels under the EXISTING federation:read scope; one
  // federation-watch delivery source; zero mutation surface. Everything
  // cross-org here is a RECORD in the local stores — no live connectivity
  // exists and none is claimed.
  const enterpriseFederation = initEnterpriseFederation({
    scope: activeTenantScope,
    fedHome: () => {
      const h = fedStore.homeOrg();
      return h ? { id: h.id, name: h.name, regionId: h.regionId } : null;
    },
    fedPeers: () =>
      fedStore.peers().map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        status: p.status,
        regionId: p.regionId,
        trustLevel: p.trustLevel,
        joinedAt: p.joinedAt,
        sharedOut: p.sharedOut,
        sharedIn: p.sharedIn,
      })),
    fedInvitations: () =>
      fedStore.listInvitations().map((i) => ({
        toOrg: i.toOrg,
        fromOrg: i.fromOrg,
        direction: i.direction,
        status: i.status,
      })),
    fedTrusts: () =>
      fedStore.listTrust().map((t) => ({
        peerOrg: t.peerOrg,
        peerOrgName: t.peerOrgName,
        trustLevel: t.trustLevel,
        delegatedApproval: t.delegatedApproval,
        canShareWorkers: t.canShareWorkers,
        canShareData: t.canShareData,
      })),
    fedShares: () =>
      fedStore.listShared().map((s) => ({
        kind: s.kind,
        name: s.name,
        peerOrg: s.peerOrg,
        peerOrgName: s.peerOrgName,
        direction: s.direction,
        access: s.access,
      })),
    fedSummary: () => fedStore.summary(),
    artifacts: () =>
      exchangeStore.listArtifacts().map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        publisherOrg: a.publisherOrg,
        publisherOrgName: a.publisherOrgName,
        scope: a.scope,
        verification: a.verification,
        installs: a.installs,
        signaturesEd25519: a.versions.every((v) => v.signature.algorithm === 'ed25519'),
      })),
    govPolicies: () =>
      globalGovStore
        .listPolicies()
        .map((p) => ({ id: p.id, name: p.name, action: p.action, enabled: p.enabled })),
    govApprovals: () => globalGovStore.listApprovals().map((a) => ({ status: a.status })),
    govAudit: () => globalGovStore.listAudit().map((e) => ({ peerOrg: e.peerOrg })),
    p18Summary: () => {
      const s = intelligenceNetwork.service.overview().summary;
      return {
        shareableIntelligence: s.shareableIntelligence,
        publishedInsights: s.publishedInsights,
        healthBand: s.healthBand,
      };
    },
    knowledgeAssets: () => {
      const inv = knowledgeRef?.inventory();
      return inv ? inv.assets.map((a) => ({ id: a.id, title: a.title, topics: a.topics })) : null;
    },
    playbooks: () => PLAYBOOK_REGISTRY.map((p) => ({ id: p.id, name: p.name, version: p.version })),
    apFindings: () =>
      automationRef
        ? automationRef.monitor().findings.map((f) => ({ severity: f.severity }))
        : null,
    connectors: () => connectorService.list().map((c) => ({ id: c.id, name: c.name })),
    workers: () => workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name })),
    s9Services: () =>
      operationsRef
        ? operationsRef.catalog().entries.map((e) => ({ serviceId: e.serviceId, state: e.state }))
        : [],
    slaStatuses: () =>
      operationsRef
        ? operationsRef.sla().statuses.map((s) => ({
            targetId: s.targetId,
            serviceId: s.serviceId,
            status: s.status,
          }))
        : [],
    readiness: () =>
      operationsRef ? operationsRef.readiness().dimensions.map((d) => ({ state: d.state })) : [],
    capacityPressure: () => (operationsRef ? operationsRef.capacity().pressure : 'unknown'),
    strategyInitiatives: () =>
      strategyRef
        ? strategyRef.portfolio().initiatives.map((i) => ({
            id: i.id,
            label: i.label,
            state: i.state,
            capabilityKeys: [...i.capabilityKeys],
          }))
        : [],
    strategyCapabilities: () =>
      strategyRef
        ? strategyRef
            .capabilityMap()
            .capabilities.map((c) => ({ key: c.key, label: c.label, condition: c.condition }))
        : [],
    executiveKpis: () =>
      executiveCenter.snapshot().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        ...(k.band ? { band: k.band } : {}),
      })),
    registerSource: (source) => deliveryEngine.register(source),
  });
  efedRef = enterpriseFederation;
  defs.push(...enterpriseFederation.handlers);

  // ── Phase 6 Stage 12 — the Enterprise Analytics Platform ────────────────
  // ONE composition subsystem over the analytics the platform ALREADY
  // computes: every KPI feed source-attributed into one catalog (producers
  // authoritative — nothing recomputed), deterministic trends over RECORDED
  // windows only, the forecast-capability inventory (registers the Stage 6
  // heuristics + P14 scenarios; adds zero forecasting), the decision-
  // intelligence rollup, and the cross-domain executive dashboard/report
  // (S8–S11 dashboards composed as PRE-BUILT slices; P18 benchmarks as ONE
  // input). Six read-only eana:* channels under the EXISTING
  // intelligence:read scope; one analytics-watch delivery source; zero
  // mutation surface.
  const analyticsPlatform = initAnalyticsPlatform({
    scope: activeTenantScope,
    executiveKpis: () =>
      executiveCenter.snapshot().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    processKpis: () =>
      getProcessExplorerKpis().map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    p14Kpis: () =>
      autonomousIntel.service.overview().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    p18Kpis: () =>
      intelligenceNetwork.service.overview().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        value: k.value,
        ...(k.band ? { band: k.band } : {}),
      })),
    healthHistory: () =>
      healthHistoryStore
        .all()
        .map((h) => ({ day: h.day, overall: h.overall, engineering: h.engineering })),
    valueDeltas: () =>
      strategyPlatform.value().decisions.map((d) => ({
        decisionId: d.decisionId,
        title: d.title,
        deltas: d.deltas.map((x) => ({ label: x.label, before: x.before, after: x.after })),
      })),
    valueTotals: () => strategyPlatform.value().totals,
    insightPredictions: () => {
      if (!insightRef) throw new Error('insight subsystem not initialized');
      return insightRef
        .report()
        .predictions.map((p) => ({ kind: p.kind, likelihood: p.likelihood }));
    },
    p14Simulation: () => ({
      scenarios: autonomousIntel.service.overview().simulation.scenarios.length,
    }),
    capacityPressure: () => (operationsRef ? operationsRef.capacity().pressure : 'unknown'),
    decisions: () =>
      decisionStore.all().map((d) => ({
        id: d.id,
        status: d.status,
        fromRecommendationId: d.fromRecommendationId ?? null,
      })),
    insightOutcomes: () => {
      if (!insightRef) throw new Error('insight subsystem not initialized');
      return insightRef.report().recommendations.map((r) => ({ id: r.id, stage: r.outcome.stage }));
    },
    strategyRecs: () => {
      const recs = strategyPlatform.dashboard().recommendations;
      return {
        count: recs.length,
        criticalOrHigh: recs.filter((r) => r.priority === 'critical' || r.priority === 'high')
          .length,
      };
    },
    federationRecs: () => {
      const recs = enterpriseFederation.dashboard().recommendations;
      return {
        count: recs.length,
        criticalOrHigh: recs.filter((r) => r.priority === 'critical' || r.priority === 'high')
          .length,
      };
    },
    s8Monitor: () => {
      if (!automationRef) return null;
      const findings = automationRef.monitor().findings;
      return {
        findings: findings.length,
        criticalOrHigh: findings.filter((f) => f.severity === 'critical' || f.severity === 'high')
          .length,
      };
    },
    s9Slices: () => {
      if (!operationsRef) return null;
      const sla = operationsRef.sla().statuses;
      const dims = operationsRef.readiness().dimensions;
      return {
        slaTargets: sla.length,
        slaMet: sla.filter((s) => s.status === 'met').length,
        slaBreached: sla.filter((s) => s.status === 'breached').length,
        readinessReady: dims.filter((d) => d.state === 'ready').length,
        readinessNotReady: dims.filter((d) => d.state === 'not-ready').length,
      };
    },
    s10Totals: () => {
      const d = strategyPlatform.dashboard();
      return {
        offTrack: d.objectives.offTrack,
        atRisk: d.objectives.atRisk,
        blocked: d.portfolio.blocked,
      };
    },
    s11Totals: () => {
      const d = enterpriseFederation.dashboard();
      return { partners: d.partners.total, declaredAboveEvidence: d.trust.declaredAboveEvidence };
    },
    p18Benchmark: () => {
      const s = intelligenceNetwork.service.overview().summary;
      return { position: s.benchmarkPosition, healthBand: s.healthBand };
    },
    registerSource: (source) => deliveryEngine.register(source),
  });
  analyticsRef = analyticsPlatform;
  defs.push(...analyticsPlatform.handlers);

  // ── Phase 6 Stage 13 — the Enterprise Digital Twin Platform ─────────────
  // ONE composition subsystem over the twin the platform ALREADY has: P15's
  // summary and nine domains composed VERBATIM (D-1 — P15 stays authoritative
  // and is never modified), the runtime/execution twin over the Execute Engine
  // and Runtime Supervisor, the Stage 6–12 platform twins built from each
  // platform's own published slice, the enterprise state-coverage map, the
  // simulation inventory (every entry registered-never-invoked), the
  // recorded-history view over Stage 12 trends, and the dashboard/report.
  // Seven read-only etwin:* channels under P15's EXISTING twin:read scope
  // (D-3 — no new RBAC scope is minted); one twin-watch delivery source; zero
  // mutation surface.
  //
  // Every dep is SYNCHRONOUS by contract, which is why the Stage 9 slice reads
  // `capacity()` and not `dashboard()`: Stage 9's dashboard is a Promise
  // (continuity awaits the local-backup list), and `capacity()` publishes both
  // the posture and its bottleneck count from one snapshot.
  const digitalTwinPlatform = initDigitalTwinPlatform({
    scope: activeTenantScope,
    // P15, composed verbatim. `safeRead` inside the subsystem turns a throw
    // into a reported failure, so these stay direct reads.
    twinSummary: () => enterpriseTwin.service.overview().summary,
    twinDomains: () => enterpriseTwin.service.domains(),
    // The Execute Engine's own reads — Stage 13 tracks no session state.
    executionKinds: () => executeEngine.registeredKinds(),
    executionActive: () => executeEngine.activeSessions(),
    executionHistory: () => executeEngine.getHistory(),
    executionStats: () => executeEngine.stats(),
    // The Runtime Supervisor's own reads — no recovery is started or policied.
    supervisorStatus: () => runtimeSupervisor.status(),
    supervisorHistory: () => runtimeSupervisor.getHistory(),
    // The seven Stage 6–12 slices, each taken from what that platform already
    // publishes. A platform that has not initialized yet returns null, which
    // the composition reports as `unknown` — never as a steady zero.
    s6Insight: () => {
      if (!insightRef) return null;
      const recs = insightRef.report().recommendations;
      return {
        findings: recs.length,
        criticalOrHigh: recs.filter((r) => r.priority === 'critical' || r.priority === 'high')
          .length,
      };
    },
    s7Knowledge: () => {
      if (!knowledgeRef) return null;
      const inv = knowledgeRef.inventory();
      return { assets: inv.totals.assets, gaps: inv.gaps.length };
    },
    s8Automation: () => {
      if (!automationRef) return null;
      // `failed-run` only — a stuck execution or an unparseable schedule is a
      // finding Stage 8 raised, not a run that failed.
      const failed = automationRef.monitor().findings.filter((f) => f.kind === 'failed-run').length;
      return { automations: automationRef.catalog().totals.entries, failures: failed };
    },
    s9Operations: () => {
      if (!operationsRef) return null;
      const cap = operationsRef.capacity();
      return { posture: cap.pressure, bottlenecks: cap.bottlenecks.length };
    },
    s10Strategy: () => {
      const o = strategyPlatform.dashboard().objectives;
      return { objectives: o.company + o.departments, atRisk: o.atRisk };
    },
    s11Federation: () => {
      const d = enterpriseFederation.dashboard();
      // `declaredAboveEvidence` is Stage 11's own degradation signal: a partner
      // claiming more trust than the recorded evidence supports.
      return { partners: d.partners.total, degraded: d.trust.declaredAboveEvidence };
    },
    s12Analytics: () => ({
      kpis: analyticsPlatform.kpis().totals.total,
      regressing: analyticsPlatform.trends().totals.regressing,
    }),
    // Stage 12 owns delta computation; its report is composed verbatim.
    s12Trends: () => analyticsPlatform.trends(),
    // The recorded-evidence footprint — counts only, never the records.
    recordedDays: () => healthHistoryStore.all().length,
    recordedDecisions: () => decisionStore.all().length,
    // Existing simulation capability, registered but never invoked.
    insightPredictions: () =>
      insightRef ? insightRef.report().predictions.map((p) => ({ kind: p.kind })) : null,
    p14Scenarios: () => ({ count: autonomousIntel.service.overview().simulation.scenarios.length }),
    s12Forecasts: () => ({ registered: analyticsPlatform.forecasts().totals.registered }),
    registerSource: (source) => deliveryEngine.register(source),
  });
  twinRef = digitalTwinPlatform;
  defs.push(...digitalTwinPlatform.handlers);

  // Startup invariant (fail-closed): with every def now assembled, no runtime-invokable
  // channel may ride on sender-trust ALONE. Collect the channels that ended up gated —
  // carrying a `permission` (RBAC, from every withXAuthz annotator's output) and/or
  // `requireAuth` (authentication) — and require every remaining channel to be on the
  // vetted PUBLIC_CHANNELS allowlist. A channel that is neither is refused loudly,
  // mirroring the annotators' throw-on-unclassified-channel philosophy.
  const gatedChannels = new Set<IpcChannelName>();
  for (const d of defs) if (d.permission || d.requireAuth) gatedChannels.add(d.channel);
  const ungatedChannels = assertAllChannelsClassified(gatedChannels, PUBLIC_CHANNELS);
  if (ungatedChannels.length > 0) {
    log.error('Ungated IPC channels — neither RBAC/auth-gated nor public-allowlisted', {
      count: ungatedChannels.length,
      channels: ungatedChannels,
    });
    throw new Error(
      `Refusing to start: ${ungatedChannels.length} runtime IPC channel(s) ride on sender-trust alone ` +
        `(classify in RUNTIME_CHANNEL_PERMISSIONS or allowlist in PUBLIC_CHANNELS): ${ungatedChannels.join(', ')}`,
    );
  }

  registerSecureHandlers(defs, secureBridgeDeps);
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

/**
 * Wire the AI Sandbox S2 (Desktop Automation) + S3 (Enterprise Scenario Runner) executors
 * onto the S1 engine through a router. The enterprise runner talks to the REAL platform:
 * module CRUD/actions dispatch through the SAME secure core the IPC bridge + REST gateway
 * use (`runSecureHandler` over the live module registry) — so the runner is a client of
 * the gated core and can never bypass RBAC or tenant isolation. REST/SDK/CLI channels
 * reuse the in-process REST gateway; the desktop channel reuses the S2 session manager.
 */
function wireSandboxRunners(cfg: {
  engine: Parameters<typeof initEnterpriseRunner>[0]['engine'];
  baseDir: string;
  launchTarget: { executablePath: string; args: string[]; cwd?: string };
  handlerByChannel: Map<string, SecureHandlerDef>;
  secureBridgeDeps: {
    isAuthenticated: () => boolean;
    authorize?: (p: EnterprisePermission) => void;
  };
  apiGatewayDeps: Parameters<typeof handleEnterpriseApiRequest>[1];
  authorize: (p: EnterprisePermission) => void;
  moduleRegistry: { get: (id: string) => unknown };
  graphRebuild: () => unknown;
  executiveSnapshot: () => {
    kpis: { key: string; label: string; value: number | null; display: string }[];
  };
  webhookDelivered?: (ref: string) => boolean;
}): void {
  const restRaw = async (req: {
    method: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | number | boolean>;
    apiKey?: string | null;
  }): Promise<{ status: number; ok: boolean; data?: unknown; error?: string }> => {
    const query = req.query
      ? Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]))
      : undefined;
    const res = await handleEnterpriseApiRequest(
      {
        method: req.method as ApiMethod,
        path: req.path,
        body: req.body,
        query,
        apiKey: req.apiKey ?? null,
      },
      cfg.apiGatewayDeps,
    );
    const out: { status: number; ok: boolean; data?: unknown; error?: string } = {
      status: res.status,
      ok: res.ok,
    };
    if (res.data !== undefined) out.data = res.data;
    if (res.error !== undefined) out.error = res.error;
    return out;
  };

  const desktopChannel = createRealDesktopChannel({
    launchTarget: cfg.launchTarget,
    profilesDir: join(cfg.baseDir, 'enterprise', 'profiles'),
    artifactsBaseDir: join(cfg.baseDir, 'enterprise', 'artifacts'),
    // P13C Round 7 — persistent profiles are per tenant. See SessionManagerDeps.
    tenantId: () => activeTenantScope()?.tenantId ?? null,
    /**
     * P13C ROUND 9 — F16. The workspace segment of the capture path.
     *
     * The SESSION boundary is the tenant (see DesktopSessionRegistry — the
     * enterprise runner executes every scenario under a tenant-level principal
     * with no workspace, so keying sessions by workspace would split one
     * tenant's own sessions while adding no boundary between tenants). This is
     * recorded for the artifact path only: without it every capture lands in
     * `tenants/<tenant>/_tenant/` and one tenant's screenshots share a directory
     * across its workspaces.
     */
    workspaceId: () => activeTenantScope()?.workspaceId ?? null,
  });

  const platform = createRealEnterprisePlatform({
    dispatch: (channel, payload) => {
      const def = cfg.handlerByChannel.get(channel);
      if (!def) throw new Error(`channel not wired: ${channel}`);
      return runSecureHandler(def, payload, cfg.secureBridgeDeps);
    },
    restRaw,
    sdkEnterprise: createGatewaySdk(restRaw),
    cli: createGatewayCli(restRaw),
    automationRun: async (ruleId, payload) => {
      const rec = (await getAutomationRunner().runById(ruleId, payload, 'manual')) as {
        id?: string;
        ok?: boolean;
        actions?: unknown[];
      } | null;
      return { ok: rec?.ok ?? false, ranId: rec?.id ?? null, actions: rec?.actions?.length ?? 0 };
    },
    automationMonitor: () => {
      const m = getAutomationMonitor() as { completed: number; failed: number; running?: number };
      return { completed: m.completed, failed: m.failed, running: m.running ?? 0 };
    },
    timelineQuery: (ref) => {
      const tl = getEnterpriseTimeline();
      if (!tl) return [];
      const page = tl.query({ entityRef: ref, order: 'desc' }) as {
        entries: {
          id: string;
          kind: string;
          title: string;
          at: string;
          entityRefs: string[];
          resourceId: string | null;
        }[];
      };
      return page.entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        at: e.at,
        entityRefs: e.entityRefs,
        resourceId: e.resourceId,
      }));
    },
    graphGetNode: (id) => {
      const n = graphStore.getNode(id) as { id: string; type?: string; label?: string } | null;
      return n ? { id: n.id, type: n.type ?? 'node', label: n.label ?? n.id } : null;
    },
    graphNeighbors: (id) => {
      const r = graphStore.neighbors({ id }) as {
        neighbors?: { node: { id: string; type?: string; label?: string } }[];
      } | null;
      return (r?.neighbors ?? []).map((x) => ({
        id: x.node.id,
        type: x.node.type ?? 'node',
        label: x.node.label ?? x.node.id,
      }));
    },
    graphRebuild: async () => {
      await cfg.graphRebuild();
    },
    memoryReferences: (ref) => {
      try {
        const q = { query: ref, limit: 10 } as unknown as Parameters<typeof memoryStore.recall>[0];
        const res = memoryStore.recall(q) as unknown as {
          entries?: unknown[];
          results?: unknown[];
          items?: unknown[];
        };
        const list = res.entries ?? res.results ?? res.items ?? [];
        return Array.isArray(list) && list.length > 0;
      } catch {
        return false;
      }
    },
    executiveKpis: () =>
      cfg
        .executiveSnapshot()
        .kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, display: k.display })),
    connectorSync: async (id, accountId) => {
      const r = (await connectorService.sync(id, accountId)) as { ok: boolean; message?: string };
      return { ok: r.ok, message: r.message ?? '' };
    },
    connectorState: (id) => {
      const c = connectorService.get(id) as {
        status?: string;
        lastSync?: { at?: string } | null;
      } | null;
      return c
        ? {
            status: c.status ?? 'unknown',
            lastSyncAt: c.lastSync?.at ?? null,
            entityCount: 0,
            consecutiveFailures: 0,
          }
        : null;
    },
    planningRun: (kind) => {
      const { input } = collectPlanningModel();
      const summary: Record<string, number> = {};
      if (kind === 'mrp') {
        const r = runMrp(input) as { orders?: unknown[]; shortages?: unknown[] };
        summary.plannedOrders = r.orders?.length ?? 0;
        summary.shortages = r.shortages?.length ?? 0;
      } else {
        const s = computeCapacitySchedule(input, Date.now()) as {
          bottlenecks?: unknown[];
          assignments?: unknown[];
        };
        summary.bottlenecks = s.bottlenecks?.length ?? 0;
        summary.scheduled = s.assignments?.length ?? 0;
      }
      return { kind, ok: true, summary };
    },
    pluginRun: () =>
      Promise.resolve({
        ok: false,
        error: 'plugin execution is not exposed to the embedded scenario runner',
      }),
    pluginRegistered: (id) => pluginManager.list().some((p) => (p as { id?: string }).id === id),
    webhookDelivered: (ref) => cfg.webhookDelivered?.(ref) ?? false,
    moduleRegistered: (id) => cfg.moduleRegistry.get(id) != null,
    can: (permission) => {
      try {
        cfg.authorize(permission as EnterprisePermission);
        return true;
      } catch {
        return false;
      }
    },
    desktop: desktopChannel,
    now: () => Date.now(),
  });

  const desktopExecutor = createDesktopExecutor({
    driver: new PlaywrightDesktopDriver(),
    profilesDir: join(cfg.baseDir, 'profiles'),
    artifactsBaseDir: join(cfg.baseDir, 'artifacts'),
    launchTarget: cfg.launchTarget,
    // P13C Round 7 — persistent browser profiles are per tenant. An unresolved
    // tenant gets a fresh, disposable profile rather than a shared one.
    tenantId: () => activeTenantScope()?.tenantId ?? null,
  });

  initEnterpriseRunner({ engine: cfg.engine, platform, desktopExecutor });
}

/**
 * Wire the AI Sandbox S4 (AI QA Agent) runtime. The agent REASONS and submits scenario
 * specs to the EXISTING executors through the sandbox IPC channels (`runSecureHandler`
 * over the same secure core → same RBAC — it cannot bypass permissions or touch the ERP
 * directly). Learnings reuse the memory store; the optional LLM narrative reuses the AI
 * engine (deterministic when no model is configured). No new engine/memory/graph/timeline.
 */
type SandboxSecureCfg = {
  handlerByChannel: Map<string, SecureHandlerDef>;
  secureBridgeDeps: {
    isAuthenticated: () => boolean;
    authorize?: (p: EnterprisePermission) => void;
  };
};

/** A dispatcher + `QaExecutorBackend` over the sandbox IPC channels — reused by S4 (AI QA)
 *  and S5 (Perf & Security Lab). Runs through the SAME secure core → same RBAC. */
function buildSandboxExecutorBackend(cfg: SandboxSecureCfg): {
  dispatch: (channel: string, payload: unknown) => Promise<unknown>;
  backend: QaExecutorBackend;
} {
  const dispatch = (channel: string, payload: unknown): Promise<unknown> => {
    const def = cfg.handlerByChannel.get(channel);
    if (!def) return Promise.reject(new Error(`channel not wired: ${channel}`));
    return runSecureHandler(def, payload, cfg.secureBridgeDeps);
  };

  /**
   * P13C N3 — keyed by TENANT, not a single process-wide value.
   *
   * This was one `let workspaceId`, resolved once to the FIRST sandbox
   * workspace on the install (or a created "AI QA" one) and then memoised for
   * the life of the process. Every AI-QA session, every perf-lab run and every
   * validation pipeline — for every tenant — wrote its scenarios, executions
   * and artifacts into that one workspace forever.
   *
   * A map keyed by tenant makes the memo per-owner, and an unresolved tenant
   * gets no entry at all rather than sharing whoever was first.
   */
  const workspaceIdByTenant = new Map<string, string>();
  const backend: QaExecutorBackend = {
    ensureWorkspace: async () => {
      /**
       * The tenant is resolved per call, and the memo is keyed by it.
       *
       * `SandboxWorkspaceList` is now scoped, so `list[0]` is "the first of
       * MINE" rather than "the first on the install" — the adoption is still a
       * `[0]`, but it can no longer cross a boundary. Failing closed when no
       * tenant resolves is what stops the AI-QA path creating an unowned
       * workspace at a moment when nobody could own it.
       */
      const tenantId = activeTenantScope()?.tenantId ?? null;
      if (tenantId === null) throw new Error('No organization is active, so this run has no owner.');
      const memo = workspaceIdByTenant.get(tenantId);
      if (memo) return memo;
      const list = (await dispatch(IpcChannel.SandboxWorkspaceList, {}).catch(() => [])) as {
        id?: string;
      }[];
      let resolved: string;
      if (Array.isArray(list) && list[0]?.id) resolved = list[0].id;
      else
        resolved = (
          (await dispatch(IpcChannel.SandboxWorkspaceCreate, { name: 'AI QA' })) as { id: string }
        ).id;
      workspaceIdByTenant.set(tenantId, resolved);
      return resolved;
    },
    createScenario: async (wsId, key, name) =>
      (
        (await dispatch(IpcChannel.SandboxScenarioCreate, { workspaceId: wsId, key, name })) as {
          id: string;
        }
      ).id,
    createVersion: async (scenarioId, spec) => {
      await dispatch(IpcChannel.SandboxScenarioVersionCreate, { scenarioId, spec });
    },
    enqueue: async (scenarioId) =>
      ((await dispatch(IpcChannel.SandboxExecutionEnqueue, { scenarioId })) as { id: string }).id,
    getExecution: async (id) => {
      const e = (await dispatch(IpcChannel.SandboxExecutionGet, { id }).catch(() => null)) as {
        status?: string;
        error?: string | null;
      } | null;
      return e && e.status ? { status: e.status, error: e.error ?? null } : null;
    },
    getResult: async (id) => {
      const r = (await dispatch(IpcChannel.SandboxResultGet, { executionId: id }).catch(
        () => null,
      )) as {
        outcome?: 'pass' | 'fail' | 'error' | null;
        assertions?: { total: number; passed: number; failed: number };
        metrics?: Record<string, number>;
      } | null;
      return r
        ? {
            outcome: r.outcome ?? null,
            assertions: r.assertions ?? { total: 0, passed: 0, failed: 0 },
            metrics: r.metrics ?? {},
          }
        : null;
    },
    listArtifacts: async (id) => {
      const a = (await dispatch(IpcChannel.SandboxArtifactList, { executionId: id }).catch(
        () => [],
      )) as { name: string; kind: string; storageRef?: string | null }[];
      return Array.isArray(a)
        ? a.map((x) => ({ name: x.name, kind: x.kind, ref: x.storageRef ?? null }))
        : [];
    },
    getTimeline: async (id) => {
      const t = (await dispatch(IpcChannel.SandboxExecutionTimeline, { executionId: id }).catch(
        () => [],
      )) as { phase: string }[];
      return Array.isArray(t) ? t.map((x) => x.phase) : [];
    },
    isTerminal: (status) =>
      isTerminalExecutionStatus(status as Parameters<typeof isTerminalExecutionStatus>[0]),
  };
  return { dispatch, backend };
}

function wireAiQa(cfg: SandboxSecureCfg): ReturnType<typeof initAiQa> {
  const { backend } = buildSandboxExecutorBackend(cfg);

  const generate = async (
    prompt: string,
  ): Promise<{ text: string; confidence: number; tokens: number; grounded: boolean }> => {
    try {
      const res = await aiEngine.run({
        worker: 'diagnostic',
        promptId: 'generic.summary',
        variables: { content: prompt, input: prompt, text: prompt },
        tier: 'fast',
        maxOutputTokens: 400,
      });
      return {
        text: res.text,
        confidence: res.confidence,
        tokens: res.usage.inputTokens + res.usage.outputTokens,
        grounded: res.grounded,
      };
    } catch {
      return { text: '', confidence: 0, tokens: 0, grounded: false };
    }
  };

  return initAiQa({
    executorBackend: backend,
    memory: {
      // P13A — same reasoning as the validation history below: a QA note that
      // cannot be owned is not written, and the QA run continues regardless.
      remember: (i) => {
        try {
          return memoryStore.remember(
            i as unknown as Parameters<typeof memoryStore.remember>[0],
          );
        } catch (err) {
          log.warn('QA memory note not recorded: no tenant is active', { error: String(err) });
          return undefined as unknown as ReturnType<typeof memoryStore.remember>;
        }
      },
      recall: (q) =>
        memoryStore.recall(q as unknown as Parameters<typeof memoryStore.recall>[0]) as unknown as {
          hits: { item: { id: string; title: string; content: string } }[];
        },
    },
    generate,
  });
}

/**
 * Wire the AI Sandbox S5 (Performance & Security Lab). The lab runs scenarios through the
 * SAME sandbox executor backend S4 uses (→ S1 engine → S2/S3, same secure core → same
 * RBAC) and OBSERVES through the EXISTING diagnostics (NeuroCore health), executive KPIs,
 * gateway audit, and sandbox queue depth. It surfaces its verdict through the EXISTING
 * diagnostics via a registered probe. No new diagnostics/monitoring/metrics/dashboard.
 */
async function wirePerfSecurityLab(
  cfg: SandboxSecureCfg & {
    benchmarksPath: string;
    health: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
    kpis: () => { key: string; value: number | null }[];
    auditCount: () => number;
  },
): Promise<Awaited<ReturnType<typeof initPerfSecurityLab>>> {
  const { dispatch, backend } = buildSandboxExecutorBackend(cfg);
  const queueDepth = async (): Promise<number> => {
    const q = (await dispatch(IpcChannel.SandboxQueueState, {}).catch(() => ({ depth: 0 }))) as {
      depth?: number;
    };
    return q?.depth ?? 0;
  };
  return initPerfSecurityLab({
    executorBackend: backend,
    observers: { health: cfg.health, kpis: cfg.kpis, auditCount: cfg.auditCount, queueDepth },
    benchmarksPath: cfg.benchmarksPath,
    // P13C — the benchmark store joins the bound stores. A baseline is echoed
    // verbatim into the next run's regression findings, so an unbound one put
    // another tenant's measurements inside this tenant's certification report.
    scope: activeTenantScope,
  });
}

/**
 * Wire the AI Sandbox S6 (Continuous Validation Platform) — the capstone. It composes S1–S5
 * into pipelines run through the SAME executor backend (→ S1 → S2/S3/S4/S5), fires them on
 * the EXISTING `taskScheduler` (auto-schedules OFF by default), compares against the SAME S5
 * benchmark store, records history in the EXISTING memory, certifies, and notifies through
 * the EXISTING `notificationScheduler`. Exposes one read-only `sandbox:read` channel the
 * Developer Portal consumes. No new engine/scheduler/dashboard/report/memory/security.
 */
async function wireContinuousValidation(
  cfg: SandboxSecureCfg & {
    runsPath: string;
    runQaSession: Parameters<typeof initContinuousValidation>[0]['executors']['runQaSession'];
    runLab: Parameters<typeof initContinuousValidation>[0]['executors']['runLab'];
    benchmarks: Parameters<typeof initContinuousValidation>[0]['benchmarks'];
    health: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
    kpis: () => { key: string; value: number | null }[];
  },
): Promise<Awaited<ReturnType<typeof initContinuousValidation>>> {
  const { backend } = buildSandboxExecutorBackend(cfg);
  const executor = createQaExecutor(backend, {
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  return initContinuousValidation({
    executors: { qaExecutor: executor, runQaSession: cfg.runQaSession, runLab: cfg.runLab },
    benchmarks: cfg.benchmarks,
    runsPath: cfg.runsPath,
    // P13C — the validation run store joins the bound stores. It extends the
    // same PersistentStore the five S1 stores do and was the subclass nobody
    // bound; its certification reports carry live executive KPI figures.
    scope: activeTenantScope,
    enableSchedules: false,
    scheduler: {
      every: (id, ms, fn) => taskScheduler.every(id, ms, fn),
      cancel: (id) => {
        taskScheduler.cancel(id);
      },
    },
    notifier: {
      notify: (n) => {
        if (n.priority === 'high' || n.priority === 'critical')
          notificationScheduler.notifyNow(n.title, n.body);
      },
    },
    history: {
      remember: (i) => {
        /**
         * P13A — bookkeeping must not abort the run it is recording.
         *
         * `remember` now FAILS CLOSED when no tenant resolves, which is correct:
         * a validation note with no owner is exactly the unowned memory the
         * program forbids. But a validation run is the primary work and this
         * note is a record of it, so a throw here would let the absence of a
         * signed-in workspace cancel the run itself. Not recorded is the right
         * outcome; not run is not.
         */
        try {
          memoryStore.remember({
            kind: 'note',
            title: i.title,
            content: i.content,
            tags: i.tags,
            metadata: i.metadata,
          } as unknown as Parameters<typeof memoryStore.remember>[0]);
        } catch (err) {
          log.warn('validation history note not recorded: no tenant is active', {
            error: String(err),
          });
        }
      },
      recall: (q) => {
        const res = memoryStore.recall({
          tag: q.tag,
          text: q.text,
          limit: q.limit,
        } as unknown as Parameters<typeof memoryStore.recall>[0]) as unknown as {
          hits: { item: { title: string; content: string } }[];
        };
        return res.hits.map((h) => ({ title: h.item.title, content: h.item.content }));
      },
    },
    observers: { health: cfg.health, kpis: cfg.kpis },
  });
}

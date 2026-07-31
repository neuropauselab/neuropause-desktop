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
import { pluginExtensionRegistry } from './plugins/extensionRegistry';
import { registerSecureHandlers, runSecureHandler, type SecureHandlerDef } from './ipc/secureBridge';
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
import { initEnterpriseIntelligence, type RawTimelineEvent } from './enterprise/intelligence/enterpriseIntelligenceSubsystem';
import { getRelationshipModel } from './enterprise/relationshipProvider';
import { initFounderAI } from './founder';
import { initEngineeringAI, initFounderAIv2 } from './ai';
// Phase 6 Stage 4 — the Workspace Assistant (composition over existing engines).
import { initAssistant } from './assistant';
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
import { initEnterprise } from './enterprise';
import { initEcosystem, runGateway, gatewayMetrics, gatewayAuditEntries } from './ecosystem';
import { initMarketplace } from './marketplace';
import { initEnterpriseApi } from './api';
import { initWebhooks } from './webhooks';
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
import { initReleaseOps } from './releaseOps';
import { initFeatureFlags } from './featureFlags';
import { initLicense } from './license';
import { initOnboarding } from './onboarding';
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
import { PLAYBOOK_REGISTRY } from './automationPlatform/automationRegistry';
import { drStore } from './federation/dr/drInstance';
import { detectBottlenecks } from './workforce/intelligence/bottlenecks';
import { getProcessAssessment, getProcessExplorerKpis } from './enterprise/processMiningProvider';
import { selectRulesForEvent } from './enterprise/automationRunner';
// (taskScheduler is already imported above with the other service singletons.)
import { globalGovStore } from './federation/governance/globalGovInstance';
import { workerInstallStore } from './workforce/install/installInstance';
import { governanceStore } from './enterprise/governance/governanceInstance';
import { DEFAULT_PROMPTS } from './ai/promptManager';
import { runEnterpriseSearch } from './search/enterpriseSearch';
import { getFederationSearcher } from './federationPlatform/searcherInstance';
import { runMrp, computeCapacitySchedule, isTerminalExecutionStatus } from '@neuropause/shared';
import type { ApiMethod, EnterprisePermission, IpcChannelName, ResourceGraphModel } from '@neuropause/shared';
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
  // P4.1 — the sync engine honours the Runtime Supervisor's suppression (scheduled-path pause/disable).
  const sync = await initSync({
    publish: platform.api.publish,
    broadcast: deps.broadcast,
    isSuppressed: (c, a) => connectors.supervisor.isSyncSuppressed(c, a),
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
  // Ecosystem Platform: developer portal + marketplace + API gateway + billing.
  const ecosystem = await initEcosystem({ broadcast: deps.broadcast });
  // P9 — Enterprise Marketplace: a governed, trusted, installing LAYER over the ecosystem
  // marketplace. Routes approved worker installs to the existing P8.5 install service.
  const marketplace = await initMarketplace({
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
  });
  // AI Sandbox S2 (Desktop Automation) + S3 (Enterprise Scenario Runner) register their
  // executors onto the S1 engine THROUGH a router, wired below (after the secure handler
  // registry + REST gateway are assembled) so the enterprise runner can dispatch through
  // the SAME secure core the IPC bridge + REST gateway use.
  const sandboxBaseDir = join(app.getPath('userData'), 'sandbox');
  const sandboxLaunchTarget = { executablePath: process.execPath, args: [app.getAppPath()], cwd: app.getAppPath() };
  // Phase 9 · Stage 1 — Cloud Platform (multi-tenant, identity federation, sync, API platform, admin).
  const cloud = await initCloud({ broadcast: deps.broadcast });
  // P6 — Cloud & Infrastructure Control Plane (Cloud Platform abstraction, Discovery Engine, Resource Graph).
  // Reuses the Platform Event Bus (Timeline), the diagnostics probe registry, the HttpClient/RateLimiter
  // primitives, and the secure-bridge IPC — no parallel runtime.
  const infrastructure = await initInfrastructure({ broadcast: deps.broadcast, publish: platform.api.publish });
  // P7 — Enterprise Intelligence. Fold infra into the unified graph projection + re-project on discovery changes,
  // and stand up the intelligence subsystem (composes the Resource Graph + ERP Relationship Graph + Timeline into
  // health/risk/dependency/impact/drift/capacity/root-cause; reuses store/graph/timeline/diagnostics/RBAC).
  getInfraResourceModel = () => infrastructure.store.graph(Date.now());
  if (infraGraphRebuild) infrastructure.store.on('changed', infraGraphRebuild);
  const enterpriseIntel = initEnterpriseIntelligence({
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
  const featureFlags = await initFeatureFlags();
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
        return { ok: r.ok, summary: r.message ?? undefined, error: r.ok ? undefined : (r.message ?? undefined) };
      }
      case 'automation': {
        const rec = await getAutomationRunner().runById(binding.target, binding.params ?? {}, 'manual');
        if (!rec) return { ok: false, error: `Automation rule "${binding.target}" not found` };
        return { ok: rec.ok, summary: rec.ok ? `Automation ${binding.target} ran` : undefined, error: rec.ok ? undefined : 'Automation failed' };
      }
      default:
        return { ok: false, error: `Unknown executor "${(binding as { executor?: string }).executor ?? ''}"` };
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
  const assistant = initAssistant({
    broadcast: deps.broadcast,
    publish: publishPlatform,
    execute: (req) => executeEngine.execute(req),
    executionsActive: () => executeEngine.activeSessions().length,
    // Phase 6 Stage 5 — Work Summary aggregation inputs (existing histories).
    executionHistory: () =>
      executeEngine.getHistory().map((s) => ({ label: s.label, state: s.state, startedAt: s.startedAt })),
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
  });
  defs.push(...assistant.handlers);
  // Phase 6 Stage 5 (D-8) — Notification Inbox: registers the notification-center
  // delivery channel, routes attention-worthy bus events through the SAME engine
  // gates, adds the meeting-soon interval source, and exposes notifications:*.
  const notifications = initNotifications({
    broadcast: deps.broadcast,
    on: (types, handler) => platform.api.on([...types], handler),
  });
  defs.push(...notifications.handlers);
  // Phase 6 Stage 6 — the Enterprise Intelligence Layer. Every dep is a READ
  // over an existing singleton (the same graph/timeline ports P7 uses, the
  // operational stores, the existing health computations, the 90-day health
  // history); the two monitor sources register on the EXISTING delivery engine
  // and produce governed recommendation items only. Suggested recoveries run
  // exclusively as approval-gated assistant plan steps through the ExecuteEngine.
  const insight = initInsight({
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
    workers: () => workerRegistry.summaries().map((w) => ({ id: w.id, name: w.name, role: w.role })),
    conversations: () => assistant.conversationSummaries(),
    inbox: () => notifications.inboxItems().map((n) => ({ id: n.id, sourceKey: n.sourceKey, at: n.at, read: n.read })),
    orgHealth: () => computeOrgHealth(collectOrgHealthInputs(Date.now())),
    orgUnits: () => {
      const org = orgStore.defaultOrg();
      const units = orgStore.unitsFor(org.id);
      const withLead = units.filter((u) => u.leadUserId).length;
      return { units: units.length, leadershipCoverage: units.length > 0 ? withLead / units.length : null };
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
    decisions: () => decisionStore.all(),
    chains: () => governanceStore.chains(),
    rules: () => governanceStore.rules(),
    prompts: () => {
      const latest = new Map<string, { id: string; version: number; label: string }>();
      for (const p of DEFAULT_PROMPTS) {
        const cur = latest.get(p.id);
        if (!cur || p.version > cur.version) latest.set(p.id, { id: p.id, version: p.version, label: p.label });
      }
      return [...latest.values()];
    },
    entities: () => unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items,
    memories: () => memoryStore.allItems(),
    connectors: () => connectorService.list(),
    org: () => {
      const org = orgStore.defaultOrg();
      return {
        org: { id: org.id, name: org.name },
        units: orgStore.unitsFor(org.id).map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId })),
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
    conversations: () => assistant.conversationSummaries().map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    executions: () =>
      executeEngine.getHistory().map((s) => ({ label: s.label, state: s.state, startedAt: s.startedAt })),
    getEvents: (since, limit) => {
      const page = platform.api.query({ since, limit }) as { events?: unknown };
      const events = Array.isArray(page.events) ? page.events : [];
      return events as { id: string; type: string; timestamp: string; correlationId?: string | null; metadata?: Record<string, unknown> | null }[];
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
      return n ? n.neighbors.map((en) => ({ id: en.node.id, label: en.node.label, at: en.edge.updatedAt })) : [];
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
      insight.report().recommendations.map((r) => ({ id: r.id, title: r.title, evidence: r.evidence })),
    fabricGeneratedAt: () => enterpriseKnowledge.service.overview().summary.generatedAt,
    search: (text) =>
      runEnterpriseSearch(
        { text, limit: 10 },
        {
          entity: unifiedStore.searchBackend,
          graph: graphStore,
          memory: memoryStore,
          timeline: getEnterpriseTimeline() ?? undefined,
          federation: getFederationSearcher() ?? undefined,
        },
      ).hits.map((h) => ({ source: h.source, id: h.id, kind: h.kind, title: h.title, snippet: h.snippet, score: h.score })),
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
    rules: () => automationStore.all(),
    runRecords: () => getAutomationRunRecords(),
    workflowRuns: () => workforce.workflowRunEntries(),
    sessions: () =>
      executeEngine
        .getHistory()
        .map((x) => ({ id: x.id, kind: x.kind, label: x.label, state: x.state, startedAt: x.startedAt })),
    jobsAwaiting: () =>
      jobStore.page({ status: 'awaiting_approval', limit: 200 }).jobs.map((j) => ({ id: j.id, createdAt: j.createdAt })),
    chains: () => governanceStore.chains(),
    orgRoles: () => {
      const org = orgStore.defaultOrg();
      return orgStore.rolesFor(org.id).map((r) => ({ id: r.id, name: r.name }));
    },
    globalPolicies: () =>
      globalGovStore.listPolicies().map((pol) => ({
        effect: (pol as { effect?: string }).effect ?? '',
        enabled: (pol as { enabled?: boolean }).enabled ?? false,
        action: (pol as { action?: string }).action ?? '',
      })),
    knownWorkers: () =>
      workerRegistry.list().map((w) => ({ id: w.identity.id, skills: w.skills.map((sk) => sk.id) })),
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
  defs.push(...aiConfig.handlers);
  defs.push(...feedback.handlers);
  defs.push(...pilot.handlers);
  registerDiagnosticProbes([
    // Mirrors OllamaModelClient's URL resolution (env override, then local default).
    ollamaProbe({ baseUrl: process.env.NEUROPAUSE_OLLAMA_URL ?? 'http://localhost:11434' }),
    aiMemoryProbe(() => memoryStore.counts().total),
    // P4.1 — connector runtime health rolls into the existing diagnostics report; reauth/error accounts
    // (excluded from the connected-only snapshots) surface via the attention count.
    connectorHealthProbe(() => sync.snapshots(), {
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
  defs.push(...releaseOps.handlers);

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
  const apiGatewayDeps = {
    decide: (input: Parameters<typeof runGateway>[0]) => runGateway(input),
    resolveHandler: (channel: string) => handlerByChannel.get(channel),
    runHandler: (def: SecureHandlerDef, payload: unknown) => runSecureHandler(def, payload, secureBridgeDeps),
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
      return { level: s.level, cpuPercent: s.telemetry.cpuPercent, memoryUsedMb: s.telemetry.memoryUsedMb };
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
      return { level: s.level, cpuPercent: s.telemetry.cpuPercent, memoryUsedMb: s.telemetry.memoryUsedMb };
    },
    kpis: () => executiveCenter.snapshot().kpis.map((k) => ({ key: k.key, value: k.value })),
  });
  defs.push(...validation.handlers);
  log.info('Continuous Validation Platform ready — AI Sandbox v1.0 complete', { pipelines: validation.pipelines.length });

  // Phase 6 Stage 9 — the Enterprise Operations Platform. Every dep is a READ
  // over an existing singleton/subsystem; the ONE async read is the local
  // backup list (via the release-ops accessor). Six read-only eops:* channels
  // (autonomousops:read); one governed operations-watch source; zero mutation
  // surface; execution remains exclusively Assistant → Approval →
  // ExecuteEngine → Workforce → Connector Executors.
  const operationsPlatform = initOperationsPlatform({
    insightReport: () => insightRef?.report() ?? null,
    executionStats: () => executeEngine.stats(),
    queuedJobsTotal: () => jobStore.page({ status: 'queued', limit: 1 }).total,
    awaitingApprovals: () =>
      jobStore.page({ status: 'awaiting_approval', limit: 200 }).jobs.map((j) => ({ id: j.id, createdAt: j.createdAt })),
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
      connectorService.list().map((c) => ({ id: c.id, name: c.name, configured: c.configured, health: c.health })),
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
        medianDurationMs: Number.isFinite(m.medianCycleHours) ? m.medianCycleHours * 3_600_000 : null,
        onTimeRate: Number.isFinite(m.completionRate) ? m.completionRate : null,
      })),
    units: () => {
      const org = orgStore.defaultOrg();
      return orgStore.unitsFor(org.id).map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId }));
    },
    users: () => {
      const org = orgStore.defaultOrg();
      return orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name }));
    },
    compliance: () =>
      enterprise
        .complianceFindings()
        .map((f) => ({ ruleId: f.ruleId, ruleName: f.ruleName, severity: f.severity, status: f.status })),
    enabledChains: () => governanceStore.chains().filter((c) => c.enabled).length,
    workforceHealth: () => {
      const w = summarizeWorkforceHealth(workerRegistry.healthSummaries());
      return { healthy: w.healthy, degraded: w.degraded, unhealthy: w.unhealthy, unknown: w.unknown };
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
      drStore.listValidations().map((v) => ({ status: v.status, rpoSeconds: v.rpoSeconds, validatedAt: v.validatedAt })),
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
    insightDomains: () =>
      insightRef?.report().health.domains.map((d) => ({ key: d.key, band: d.band, score: d.score })) ?? null,
    insightOverallBand: () => insightRef?.report().health.band ?? null,
    insightIncidents: () => {
      // Domain attribution rides the Stage 9 incident lifecycle (composed, not recomputed).
      if (!operationsRef) return null;
      return operationsRef.incidents().incidents.map((i) => ({ domain: i.domain, severity: i.incident.severity }));
    },
    insightOutcomes: () =>
      insightRef?.report().recommendations.map((r) => ({ id: r.id, stage: r.outcome.stage })) ?? null,
    executiveKpis: () =>
      executiveCenter.snapshot().kpis.map((k) => ({
        key: k.key,
        label: k.label,
        display: k.display,
        ...(k.band ? { band: k.band } : {}),
      })),
    slaStatuses: () =>
      operationsRef
        ? operationsRef.sla().statuses.map((s) => ({ targetId: s.targetId, status: s.status, detail: s.detail }))
        : [],
    readiness: () =>
      operationsRef
        ? operationsRef
            .readiness()
            .dimensions.map((d) => ({ key: d.key, state: d.state, detail: d.detail, missing: d.missing }))
        : [],
    s9Services: () =>
      operationsRef
        ? operationsRef
            .catalog()
            .entries.map((e) => ({ serviceId: e.serviceId, state: e.state, stateDetail: e.stateDetail }))
        : [],
    capacityPressure: () => (operationsRef ? operationsRef.capacity().pressure : 'unknown'),
    playbooks: () => PLAYBOOK_REGISTRY.map((p) => ({ id: p.id, version: p.version })),
    apFindings: () =>
      automationRef ? automationRef.monitor().findings.map((f) => ({ kind: f.kind, severity: f.severity })) : null,
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
        .items.map((e) => ({ id: e.id, title: e.title, syncState: e.syncState, status: e.status ?? null })),
    minedTypes: () =>
      getProcessAssessment()
        .metrics.byType.filter((m) => m.caseCount > 0)
        .map((m) => m.processType),
    compliance: () => enterprise.complianceFindings().map((f) => ({ status: f.status })),
    units: () => {
      const org = orgStore.defaultOrg();
      return orgStore.unitsFor(org.id).map((u) => ({ id: u.id, name: u.name, leadUserId: u.leadUserId }));
    },
    users: () => {
      const org = orgStore.defaultOrg();
      return orgStore.usersFor(org.id).map((u) => ({ id: u.id, name: u.name }));
    },
    healthHistory: () =>
      healthHistoryStore.all().map((h) => ({ day: h.day, overall: h.overall, engineering: h.engineering })),
    registerSource: (source) => deliveryEngine.register(source),
  });
  strategyRef = strategyPlatform;
  defs.push(...strategyPlatform.handlers);

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
  secureBridgeDeps: { isAuthenticated: () => boolean; authorize?: (p: EnterprisePermission) => void };
  apiGatewayDeps: Parameters<typeof handleEnterpriseApiRequest>[1];
  authorize: (p: EnterprisePermission) => void;
  moduleRegistry: { get: (id: string) => unknown };
  graphRebuild: () => unknown;
  executiveSnapshot: () => { kpis: { key: string; label: string; value: number | null; display: string }[] };
  webhookDelivered?: (ref: string) => boolean;
}): void {
  const restRaw = async (req: { method: string; path: string; body?: unknown; query?: Record<string, string | number | boolean>; apiKey?: string | null }): Promise<{ status: number; ok: boolean; data?: unknown; error?: string }> => {
    const query = req.query ? Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)])) : undefined;
    const res = await handleEnterpriseApiRequest({ method: req.method as ApiMethod, path: req.path, body: req.body, query, apiKey: req.apiKey ?? null }, cfg.apiGatewayDeps);
    const out: { status: number; ok: boolean; data?: unknown; error?: string } = { status: res.status, ok: res.ok };
    if (res.data !== undefined) out.data = res.data;
    if (res.error !== undefined) out.error = res.error;
    return out;
  };

  const desktopChannel = createRealDesktopChannel({
    launchTarget: cfg.launchTarget,
    profilesDir: join(cfg.baseDir, 'enterprise', 'profiles'),
    artifactsBaseDir: join(cfg.baseDir, 'enterprise', 'artifacts'),
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
      const rec = (await getAutomationRunner().runById(ruleId, payload, 'manual')) as { id?: string; ok?: boolean; actions?: unknown[] } | null;
      return { ok: rec?.ok ?? false, ranId: rec?.id ?? null, actions: rec?.actions?.length ?? 0 };
    },
    automationMonitor: () => {
      const m = getAutomationMonitor() as { completed: number; failed: number; running?: number };
      return { completed: m.completed, failed: m.failed, running: m.running ?? 0 };
    },
    timelineQuery: (ref) => {
      const tl = getEnterpriseTimeline();
      if (!tl) return [];
      const page = tl.query({ entityRef: ref, order: 'desc' }) as { entries: { id: string; kind: string; title: string; at: string; entityRefs: string[]; resourceId: string | null }[] };
      return page.entries.map((e) => ({ id: e.id, kind: e.kind, title: e.title, at: e.at, entityRefs: e.entityRefs, resourceId: e.resourceId }));
    },
    graphGetNode: (id) => {
      const n = graphStore.getNode(id) as { id: string; type?: string; label?: string } | null;
      return n ? { id: n.id, type: n.type ?? 'node', label: n.label ?? n.id } : null;
    },
    graphNeighbors: (id) => {
      const r = graphStore.neighbors({ id }) as { neighbors?: { node: { id: string; type?: string; label?: string } }[] } | null;
      return (r?.neighbors ?? []).map((x) => ({ id: x.node.id, type: x.node.type ?? 'node', label: x.node.label ?? x.node.id }));
    },
    graphRebuild: async () => {
      await cfg.graphRebuild();
    },
    memoryReferences: (ref) => {
      try {
        const q = { query: ref, limit: 10 } as unknown as Parameters<typeof memoryStore.recall>[0];
        const res = memoryStore.recall(q) as unknown as { entries?: unknown[]; results?: unknown[]; items?: unknown[] };
        const list = res.entries ?? res.results ?? res.items ?? [];
        return Array.isArray(list) && list.length > 0;
      } catch {
        return false;
      }
    },
    executiveKpis: () => cfg.executiveSnapshot().kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, display: k.display })),
    connectorSync: async (id, accountId) => {
      const r = (await connectorService.sync(id, accountId)) as { ok: boolean; message?: string };
      return { ok: r.ok, message: r.message ?? '' };
    },
    connectorState: (id) => {
      const c = connectorService.get(id) as { status?: string; lastSync?: { at?: string } | null } | null;
      return c ? { status: c.status ?? 'unknown', lastSyncAt: c.lastSync?.at ?? null, entityCount: 0, consecutiveFailures: 0 } : null;
    },
    planningRun: (kind) => {
      const { input } = collectPlanningModel();
      const summary: Record<string, number> = {};
      if (kind === 'mrp') {
        const r = runMrp(input) as { orders?: unknown[]; shortages?: unknown[] };
        summary.plannedOrders = r.orders?.length ?? 0;
        summary.shortages = r.shortages?.length ?? 0;
      } else {
        const s = computeCapacitySchedule(input, Date.now()) as { bottlenecks?: unknown[]; assignments?: unknown[] };
        summary.bottlenecks = s.bottlenecks?.length ?? 0;
        summary.scheduled = s.assignments?.length ?? 0;
      }
      return { kind, ok: true, summary };
    },
    pluginRun: () => Promise.resolve({ ok: false, error: 'plugin execution is not exposed to the embedded scenario runner' }),
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
  secureBridgeDeps: { isAuthenticated: () => boolean; authorize?: (p: EnterprisePermission) => void };
};

/** A dispatcher + `QaExecutorBackend` over the sandbox IPC channels — reused by S4 (AI QA)
 *  and S5 (Perf & Security Lab). Runs through the SAME secure core → same RBAC. */
function buildSandboxExecutorBackend(cfg: SandboxSecureCfg): { dispatch: (channel: string, payload: unknown) => Promise<unknown>; backend: QaExecutorBackend } {
  const dispatch = (channel: string, payload: unknown): Promise<unknown> => {
    const def = cfg.handlerByChannel.get(channel);
    if (!def) return Promise.reject(new Error(`channel not wired: ${channel}`));
    return runSecureHandler(def, payload, cfg.secureBridgeDeps);
  };

  let workspaceId: string | null = null;
  const backend: QaExecutorBackend = {
    ensureWorkspace: async () => {
      if (workspaceId) return workspaceId;
      const list = (await dispatch(IpcChannel.SandboxWorkspaceList, {}).catch(() => [])) as { id?: string }[];
      if (Array.isArray(list) && list[0]?.id) workspaceId = list[0].id;
      else workspaceId = ((await dispatch(IpcChannel.SandboxWorkspaceCreate, { name: 'AI QA' })) as { id: string }).id;
      return workspaceId;
    },
    createScenario: async (wsId, key, name) => ((await dispatch(IpcChannel.SandboxScenarioCreate, { workspaceId: wsId, key, name })) as { id: string }).id,
    createVersion: async (scenarioId, spec) => { await dispatch(IpcChannel.SandboxScenarioVersionCreate, { scenarioId, spec }); },
    enqueue: async (scenarioId) => ((await dispatch(IpcChannel.SandboxExecutionEnqueue, { scenarioId })) as { id: string }).id,
    getExecution: async (id) => {
      const e = (await dispatch(IpcChannel.SandboxExecutionGet, { id }).catch(() => null)) as { status?: string; error?: string | null } | null;
      return e && e.status ? { status: e.status, error: e.error ?? null } : null;
    },
    getResult: async (id) => {
      const r = (await dispatch(IpcChannel.SandboxResultGet, { executionId: id }).catch(() => null)) as { outcome?: 'pass' | 'fail' | 'error' | null; assertions?: { total: number; passed: number; failed: number }; metrics?: Record<string, number> } | null;
      return r ? { outcome: r.outcome ?? null, assertions: r.assertions ?? { total: 0, passed: 0, failed: 0 }, metrics: r.metrics ?? {} } : null;
    },
    listArtifacts: async (id) => {
      const a = (await dispatch(IpcChannel.SandboxArtifactList, { executionId: id }).catch(() => [])) as { name: string; kind: string; storageRef?: string | null }[];
      return Array.isArray(a) ? a.map((x) => ({ name: x.name, kind: x.kind, ref: x.storageRef ?? null })) : [];
    },
    getTimeline: async (id) => {
      const t = (await dispatch(IpcChannel.SandboxExecutionTimeline, { executionId: id }).catch(() => [])) as { phase: string }[];
      return Array.isArray(t) ? t.map((x) => x.phase) : [];
    },
    isTerminal: (status) => isTerminalExecutionStatus(status as Parameters<typeof isTerminalExecutionStatus>[0]),
  };
  return { dispatch, backend };
}

function wireAiQa(cfg: SandboxSecureCfg): ReturnType<typeof initAiQa> {
  const { backend } = buildSandboxExecutorBackend(cfg);

  const generate = async (prompt: string): Promise<{ text: string; confidence: number; tokens: number; grounded: boolean }> => {
    try {
      const res = await aiEngine.run({ worker: 'diagnostic', promptId: 'generic.summary', variables: { content: prompt, input: prompt, text: prompt }, tier: 'fast', maxOutputTokens: 400 });
      return { text: res.text, confidence: res.confidence, tokens: res.usage.inputTokens + res.usage.outputTokens, grounded: res.grounded };
    } catch {
      return { text: '', confidence: 0, tokens: 0, grounded: false };
    }
  };

  return initAiQa({
    executorBackend: backend,
    memory: {
      remember: (i) => memoryStore.remember(i as unknown as Parameters<typeof memoryStore.remember>[0]),
      recall: (q) => memoryStore.recall(q as unknown as Parameters<typeof memoryStore.recall>[0]) as unknown as { hits: { item: { id: string; title: string; content: string } }[] },
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
async function wirePerfSecurityLab(cfg: SandboxSecureCfg & {
  benchmarksPath: string;
  health: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
  kpis: () => { key: string; value: number | null }[];
  auditCount: () => number;
}): Promise<Awaited<ReturnType<typeof initPerfSecurityLab>>> {
  const { dispatch, backend } = buildSandboxExecutorBackend(cfg);
  const queueDepth = async (): Promise<number> => {
    const q = (await dispatch(IpcChannel.SandboxQueueState, {}).catch(() => ({ depth: 0 }))) as { depth?: number };
    return q?.depth ?? 0;
  };
  return initPerfSecurityLab({
    executorBackend: backend,
    observers: { health: cfg.health, kpis: cfg.kpis, auditCount: cfg.auditCount, queueDepth },
    benchmarksPath: cfg.benchmarksPath,
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
async function wireContinuousValidation(cfg: SandboxSecureCfg & {
  runsPath: string;
  runQaSession: Parameters<typeof initContinuousValidation>[0]['executors']['runQaSession'];
  runLab: Parameters<typeof initContinuousValidation>[0]['executors']['runLab'];
  benchmarks: Parameters<typeof initContinuousValidation>[0]['benchmarks'];
  health: () => Promise<{ level: string; cpuPercent: number; memoryUsedMb: number }>;
  kpis: () => { key: string; value: number | null }[];
}): Promise<Awaited<ReturnType<typeof initContinuousValidation>>> {
  const { backend } = buildSandboxExecutorBackend(cfg);
  const executor = createQaExecutor(backend, { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  return initContinuousValidation({
    executors: { qaExecutor: executor, runQaSession: cfg.runQaSession, runLab: cfg.runLab },
    benchmarks: cfg.benchmarks,
    runsPath: cfg.runsPath,
    enableSchedules: false,
    scheduler: { every: (id, ms, fn) => taskScheduler.every(id, ms, fn), cancel: (id) => { taskScheduler.cancel(id); } },
    notifier: {
      notify: (n) => {
        if (n.priority === 'high' || n.priority === 'critical') notificationScheduler.notifyNow(n.title, n.body);
      },
    },
    history: {
      remember: (i) => {
        memoryStore.remember({ kind: 'note', title: i.title, content: i.content, tags: i.tags, metadata: i.metadata } as unknown as Parameters<typeof memoryStore.remember>[0]);
      },
      recall: (q) => {
        const res = memoryStore.recall({ tag: q.tag, text: q.text, limit: q.limit } as unknown as Parameters<typeof memoryStore.recall>[0]) as unknown as { hits: { item: { title: string; content: string } }[] };
        return res.hits.map((h) => ({ title: h.item.title, content: h.item.content }));
      },
    },
    observers: { health: cfg.health, kpis: cfg.kpis },
  });
}

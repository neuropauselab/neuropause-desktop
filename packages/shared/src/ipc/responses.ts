/**
 * The response half of the IPC contract: channel -> the shape its handler resolves to.
 *
 * A7. Requests have always been validated — every secure-bridge handler carries a
 * strict Zod schema (`ipc/contracts.ts`) and the bridge rejects anything that does
 * not parse. Responses had no contract at all. `SecureHandlerDef.handler` returns
 * `unknown`, the preload bridge returns `Promise<unknown>`, and the renderer
 * recovered a type by asserting one at each of 636 call sites in
 * `renderer/src/lib/ipc.ts`. The two ends of every channel were typed
 * independently, with nothing checking that they agreed — a cast is a claim, not a
 * check, so the claim was only ever as good as whoever wrote that line.
 *
 * This module is that missing half. Both ends now derive from it: the main process
 * through `SecureHandlerDef`'s channel-indexed handler return type, and the renderer
 * through a generic `invoke` that reads `IpcResponseOf<C>` instead of being told.
 * A handler that stops returning what its channel promises is a compile error in
 * the main process, and a renderer that reads a field the handler never sends is a
 * compile error in the renderer.
 *
 * GENERATED ONCE, THEN MAINTAINED BY HAND. Every entry below was lifted verbatim
 * from the cast it replaced, so adopting this map changed no type anywhere in the
 * renderer. It is ordinary source now: adding a channel means adding its entry —
 * `invoke` will not compile without one.
 *
 * No runtime cost. These are types only; nothing here is emitted to JavaScript, and
 * no response is re-validated at runtime. Deliberately: response schemas would mean
 * a second hand-maintained description of ~2,000 shapes that already have exactly
 * one description in TypeScript, and two descriptions of one thing drift.
 */
import type { HelpDocMeta } from '../types/helpDocs';
import type { IpcChannelName } from './channels';
import type {
  AdminOverview,
  AiConfigDto,
  AiHealthDto,
  AiTestResultDto,
  ApiDeployment,
  ApiExplorer,
  ApiKey,
  ApiKeyWithSecret,
  ApiPlatformSummary,
  ApiRouteInfo,
  ApiVersionInfo,
  AppInfo,
  Artifact,
  AssistantAskResult,
  AssistantConversation,
  AssistantConversationsResult,
  AuthStatus,
  AutoOpsAnalytics,
  AutoOpsApprovals,
  AutoOpsExecution,
  AutoOpsGovernance,
  AutoOpsIncidents,
  AutoOpsMonitoring,
  AutoOpsOptimization,
  AutoOpsOverview,
  AutoOpsPlans,
  AutoOpsRecovery,
  AutomationCatalog,
  AutomationMonitor,
  AutomationMonitorReport,
  AutomationPlan,
  AutomationPlatformDashboard,
  AutomationPoliciesView,
  AutomationRule,
  AutomationRunRecord,
  Backup,
  BackupInfo,
  BackupValidation,
  BillingSummary,
  BoardReport,
  Briefing,
  BusinessProcessReport,
  BusinessValueReport,
  CategorySummary,
  ChangeImpactReport,
  CloudInviteResult,
  CloudMembership,
  CloudOrgCreateResult,
  CloudOrganization,
  CloudOrganizationSummary,
  CloudPlatformDto,
  CloudPlatformStats,
  CloudProject,
  CloudRateLimitPolicy,
  CloudRegion,
  CloudTeam,
  CloudTenant,
  CloudWorkspace,
  CollectionDto,
  CommercialAdministration,
  CommercialAnalytics,
  CommercialBilling,
  CommercialCustomers,
  CommercialDeployment,
  CommercialGovernance,
  CommercialLicensing,
  CommercialMetering,
  CommercialOverview,
  CommercialReleases,
  CommercialSubscription,
  CompanionDeviceDto,
  CompanionPairingQrDto,
  CompanionStatusDto,
  ComplianceFinding,
  ComplianceReport,
  ConnectorActionResult,
  ConnectorConnectResult,
  ConnectorDto,
  ConnectorInspection,
  ConnectorLogEntry,
  ConnectorRuntimeView,
  ConnectorStats,
  ConnectorSyncSnapshot,
  ConnectorWriteActionInfo,
  ConnectorWriteResult,
  ContextTrace,
  ContinuityPosture,
  ContinuityView,
  ControlPlaneOverview,
  CrashRecord,
  CrashStatus,
  Dataset,
  DecisionLineage,
  DecisionQueue,
  DelegatedApproval,
  DelegationPlan,
  DeliveryPreferences,
  DeploymentStatusEntry,
  DeveloperAccount,
  DeveloperAnalytics,
  DeveloperConsole,
  DeveloperDashboard,
  DeveloperPlatformAnalytics,
  DeveloperPlatformOverview,
  Device,
  DiagnosticsReport,
  DrSummary,
  EanaDashboard,
  EanaDecisionReport,
  EanaForecastInventory,
  EanaKpiCatalog,
  EanaReport,
  EanaTrendReport,
  EcosystemAnalytics,
  EfedBoardReport,
  EfedDashboard,
  EfedExchangeReport,
  EfedPartnersReport,
  EfedSharingReport,
  EfedTrustReport,
  EngineeringAnalysis,
  EnterpriseApiResponse,
  EnterpriseAuditEntry,
  EnterpriseContext,
  EnterpriseEntity,
  EnterpriseIntelligenceReport,
  EnterpriseModuleActionResult,
  EnterpriseModuleMutationResult,
  EnterpriseModuleSummary,
  EnterpriseRecordSummary,
  EnterpriseSearchResult,
  EnterpriseTimelineExport,
  EnterpriseTimelinePage,
  EnterpriseTimelineStats,
  EnterpriseTrustModel,
  EnterpriseTwinOverview,
  EtwinCoverageMap,
  EtwinDashboard,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinReport,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
  ExchangeArtifact,
  ExchangePack,
  ExchangeStats,
  ExchangeSummary,
  Execution,
  ExecutionConsoleModel,
  ExecutionQueueState,
  ExecutionSession,
  ExecutionStats,
  ExecutionTimelineEntry,
  ExecutiveCenterSnapshot,
  ExecutiveDecision,
  ExecutiveKpi,
  ExecutiveMemoryView,
  ExecutiveSnapshot,
  ExperienceDecisions,
  ExperienceGovernance,
  ExperienceHome,
  ExperienceIntents,
  ExperienceSummaries,
  FabricAnalytics,
  FabricClassification,
  FabricEvidenceReport,
  FabricGovernance,
  FabricLineage,
  FabricOverview,
  FabricRelationshipMap,
  FabricSourceCatalog,
  FeatureFlagState,
  FeaturedEntry,
  FedActionEvaluation,
  FedAdminOverview,
  FedAuditEntry,
  FedComplianceRule,
  FedPolicy,
  FederatedOrg,
  FederationAnalytics,
  FederationGraph,
  FederationOverview,
  FederationResult,
  FederationSearchHit,
  FederationSummary,
  FederationTimelineEntry,
  FeedbackEntry,
  FeedbackExport,
  FleetOverview,
  FounderAnswer,
  FounderResponse,
  FounderSuggestedQuestion,
  GatewayAuditEntry,
  GatewayDecision,
  GatewayMetrics,
  GlobalGovSummary,
  GoalManager,
  GovernanceConfig,
  GovernanceTrace,
  GovernanceTraceList,
  GraphCounts,
  GraphEdgeEvent,
  GraphNeighbors,
  GraphNode,
  GraphPathResult,
  GraphSubgraph,
  IdentitySummary,
  IncidentLifecycleReport,
  IndustryCollection,
  IndustryComplianceReport,
  IndustryPlatformOverview,
  IndustryReadinessReport,
  IndustrySuite,
  InfraActionInfo,
  InfraActionResult,
  InfraSearchResult,
  InsightDashboard,
  InsightHealthFramework,
  InsightPrediction,
  InsightReport,
  InstallPlan,
  InstallResultDto,
  InstallSummary,
  Installation,
  IntelNetworkBenchmarks,
  IntelNetworkCollective,
  IntelNetworkExchange,
  IntelNetworkGovernance,
  IntelNetworkInsights,
  IntelNetworkOrganizations,
  IntelNetworkOverview,
  IntelNetworkTrust,
  IntentBoard,
  IntentGovernance,
  IntentWorkspaces,
  Invoice,
  Job,
  JobPage,
  KnowledgeAssetDashboard,
  KnowledgeImpactAnalysis,
  KnowledgeInventory,
  KnowledgeQualityReport,
  KnowledgeRelationshipMatrix,
  KnowledgeSearchHit,
  License,
  LicenseValidationStatus,
  ListingDetail,
  ListingVersion,
  LiveSyncDetail,
  LiveSyncStatus,
  MarketplaceAnalytics,
  MarketplaceEntry,
  MarketplaceInstallResult,
  MarketplaceListing,
  MarketplacePurchase,
  MarketplaceScopeSummary,
  MarketplaceStats,
  MemoryAuditPage,
  MemoryCounts,
  MemoryItem,
  MemoryRecallResult,
  MfaPolicy,
  MigrationReport,
  MigrationStatus,
  MigrationStatusDto,
  NotificationInboxPage,
  NpsOperationDto,
  OAuthApplication,
  OAuthApplicationWithSecret,
  ObjectivesReport,
  ObservabilityOverview,
  OllamaDetectDto,
  OnboardingStatus,
  OpenApiDocument,
  OperationalHealthView,
  OperationsDashboard,
  OptimizationEngine,
  OrchestrationCloud,
  OrchestrationCoordination,
  OrchestrationFlowReport,
  OrchestrationGoalRouting,
  OrchestrationGovernance,
  OrchestrationKnowledge,
  OrchestrationOverview,
  OrchestrationWorkforce,
  OrgDirectoryEntry,
  OrgGraph,
  OrgGraphNeighbors,
  OrgInvitation,
  OrgMarketplacePolicy,
  OrgRole,
  OrgUnit,
  OrgUser,
  Organization,
  Paginated,
  Partner,
  PartnerStats,
  PermissionGrant,
  PersonalizationState,
  PilotStatus,
  Plan,
  PlanningEngine,
  PlanningReport,
  PlaybookDefinition,
  PluginContribution,
  PluginDto,
  PluginExtension,
  PluginInstallResult,
  PolicyRule,
  PortfolioReport,
  ProcessCaseDetail,
  ProcessExplorerModel,
  PublicApi,
  PublisherProfile,
  PublishingConsole,
  ReadinessAssessment,
  ReasoningReport,
  RecommendationSet,
  RecoveryActionResult,
  RecoveryRecommendation,
  RecoveryRecord,
  RecoveryValidation,
  RegionStatus,
  RegistryEntryDto,
  RegistryStats,
  RelationshipGraphModel,
  RelationshipPath,
  RelationshipTrace,
  ReleaseDiagnostics,
  ReplicaState,
  ResourceEdgeToNode,
  ResourceGraphModel,
  RestoreResult,
  ReviewDto,
  RootCauseReport,
  RunHistoryPage,
  RunResult,
  RuntimeInstanceDto,
  SafeModeState,
  SandboxDashboard,
  SandboxReport,
  SandboxWorkspace,
  ScalabilityReport,
  Scenario,
  ScenarioVersion,
  ScheduleExploreModel,
  ScheduledValidation,
  ScimConfig,
  SdkArtifact,
  SdkRegistry,
  SearchResult,
  SeatAssignment,
  SecurityEvent,
  ServiceCatalog,
  SharedResource,
  SimulationReport,
  SlaReport,
  SsoConnection,
  StandardsReport,
  StorageIsolation,
  StoreAppCard,
  StoreAppDetail,
  StrategyDashboard,
  StrategyHealthView,
  StrategyOverview,
  SubmissionEvent,
  SupervisorStatus,
  SupportBundleInfo,
  SystemHealthSnapshot,
  TemplateRegistry,
  TenantDirectoryEntry,
  TenantSummary,
  TenantWorker,
  ThemeSource,
  TimelineExport,
  TimelinePage,
  TimelineReplay,
  TimelineStats,
  TrustRelationship,
  TrustReport,
  TwinCommandCenter,
  TwinDomains,
  TwinHealthMap,
  TwinImpact,
  TwinReplay,
  TwinScenarioCenter,
  TwinTopology,
  UnifiedCounts,
  UnifiedEntity,
  UnifiedQueryResult,
  UpdateCheck,
  UpdateStatus,
  UsageOverview,
  UsagePoint,
  ValidationDashboard,
  ValidationRunDetail,
  ValidationSummary,
  VoiceResponse,
  Webhook,
  WebhookDelivery,
  WebhookDeliveryStats,
  WebhookEndpoint,
  WebhookWithSecret,
  Worker,
  WorkerInstallDetail,
  WorkerInstallResult,
  WorkerInstallSummary,
  WorkerSummary,
  WorkflowRun,
  WorkforceAuditPage,
  WorkforceIntelligence,
  Workspace,
  WorkspaceContextStateDto,
  WorkspaceSummary,
} from '../index';

/**
 * The `{ items: T[] }` envelope a good number of list channels resolve to. It was a
 * private alias in the renderer's ipc.ts; it belongs with the contract it describes.
 */
export interface Items<T> {
  items: T[];
}

/**
 * Channel -> response shape. Keys are the wire strings from `IpcChannel`; the
 * assertion below makes a typo a compile error rather than a phantom entry that
 * silently matches nothing.
 */
export interface IpcResponseMap {
  // ── auth ──
  'auth:getStatus': AuthStatus;
  'auth:loginOAuth': AuthStatus;
  'auth:loginEmail': AuthStatus;
  'auth:registerEmail': AuthStatus;
  'auth:logout': AuthStatus;

  // ── app ──
  'app:getInfo': AppInfo;
  'app:setThemeSource': ThemeSource;
  'app:getThemeSource': ThemeSource;

  // ── window ──
  'window:close': void;

  // ── workspace-ctx ──
  'workspace-ctx:bootstrap': WorkspaceContextStateDto;
  'workspace-ctx:list': WorkspaceContextStateDto;
  'workspace-ctx:create': WorkspaceContextStateDto;
  'workspace-ctx:rename': WorkspaceContextStateDto;
  'workspace-ctx:delete': WorkspaceContextStateDto;
  'workspace-ctx:switch': WorkspaceContextStateDto;
  'workspace-ctx:update-snapshot': WorkspaceContextStateDto;

  // ── catalog ──
  'catalog:featured': Items<FeaturedEntry>;
  'catalog:collections': Items<CollectionDto>;
  'catalog:sections': Paginated<StoreAppCard>;
  'catalog:search': Paginated<StoreAppCard>;
  'catalog:app': StoreAppDetail;
  'catalog:reviews': Paginated<ReviewDto>;
  'catalog:developer': unknown;
  'catalog:categories': Items<CategorySummary>;
  'catalog:bookmarks': Items<StoreAppCard>;
  'catalog:toggleBookmark': { bookmarked: boolean };
  'catalog:submitReview': ReviewDto;
  'catalog:recommendations': Items<StoreAppCard>;
  'catalog:checkUpdate': UpdateCheck;

  // ── org ──
  'org:list': CloudOrganizationSummary[];
  'org:create': CloudOrgCreateResult;
  'org:get': CloudOrganization;
  'org:update': CloudOrganization;
  'org:members': CloudMembership[];
  'org:invite': CloudInviteResult;
  'org:acceptInvite': CloudMembership;
  'org:changeRole': CloudMembership;
  'org:removeMember': void;
  'org:workspaces': CloudWorkspace[];
  'org:createWorkspace': CloudWorkspace;
  'org:updateWorkspace': CloudWorkspace;
  'org:deleteWorkspace': void;

  // ── registry ──
  'registry:list': RegistryEntryDto[];
  'registry:get': RegistryEntryDto | null;
  'registry:setFlags': RegistryEntryDto | null;
  'registry:stats': RegistryStats;
  'registry:export': { data: string };
  'registry:import': { count: number };
  'registry:backup': { path: string };

  // ── nps ──
  'nps:install': InstallResultDto;
  'nps:uninstall': { ok: boolean; message: string | null };
  'nps:update': InstallResultDto;
  'nps:rollback': { ok: boolean; message: string | null };
  'nps:repair': { ok: boolean; message: string | null };
  'nps:verify': { ok: boolean; reason: string | null };
  'nps:operations': NpsOperationDto[];
  'nps:pause': { ok: boolean };
  'nps:resume': { ok: boolean };
  'nps:cancel': { ok: boolean };

  // ── runtime ──
  'runtime:launch': RuntimeInstanceDto;
  'runtime:stop': { ok: boolean };
  'runtime:suspend': RuntimeInstanceDto;
  'runtime:resume': RuntimeInstanceDto;
  'runtime:restart': RuntimeInstanceDto;
  'runtime:list': RuntimeInstanceDto[];
  'runtime:health': RuntimeInstanceDto | RuntimeInstanceDto[] | null;

  // ── perms ──
  'perms:list': PermissionGrant[];
  'perms:grant': PermissionGrant[];
  'perms:revoke': PermissionGrant[];

  // ── plugins ──
  'plugins:list': PluginDto[];
  'plugins:get': PluginDto | null;
  'plugins:install': PluginInstallResult;
  'plugins:enable': PluginDto;
  'plugins:disable': PluginDto;
  'plugins:reload': PluginDto;
  'plugins:update': PluginInstallResult;
  'plugins:remove': { ok: boolean };
  'plugins:grant': PluginDto;
  'plugins:revoke': PluginDto;
  'plugins:extensions': PluginExtension[];
  'plugins:contributions': PluginContribution[];

  // ── platform ──
  'platform:emit': { ok: boolean };

  // ── executiveCenter ──
  'executiveCenter:snapshot': ExecutiveCenterSnapshot;

  // ── decisions ──
  'decisions:list': { decisions: ExecutiveDecision[] };
  'decisions:createFromRecommendation': { decision: ExecutiveDecision | null };
  'decisions:setStatus': { decision: ExecutiveDecision | null };

  // ── automations ──
  'automations:list': {
    rules: AutomationRule[];
    summary: { total: number; active: number; paused: number; draft: number };
  };
  'automations:save': { ok: boolean; rule?: AutomationRule; issues?: string[] };
  'automations:setStatus': { rule: AutomationRule | null };
  'automations:remove': { removed: boolean };
  'automations:run': { record: AutomationRunRecord | null };
  'automations:monitor': { monitor: AutomationMonitor };
  'automations:history': { records: AutomationRunRecord[] };

  // ── neurocore ──
  'neurocore:systemHealth': SystemHealthSnapshot;

  // ── supervisor ──
  'supervisor:status': SupervisorStatus;

  // ── license ──
  'license:reportHealth': { ok: boolean };

  // ── billing ──
  'billing:checkout': { subscriptionId: string; checkoutUrl: string };

  // ── devices ──
  'devices:register': { device: Device };
  'devices:list': Device[];
  'devices:revoke': { device: Device };

  // ── device ──
  'device:reportHealth': { ok: boolean };

  // ── supervisor ──
  'supervisor:history': { records: RecoveryRecord[] };
  'supervisor:recover': RecoveryRecord;
  'supervisor:setPolicy': SupervisorStatus;

  // ── execute ──
  'execute:run': ExecutionSession;
  'execute:sessions': { sessions: ExecutionSession[]; stats: ExecutionStats };
  'execute:history': { records: ExecutionSession[] };
  'execute:cancel': ExecutionSession | null;

  // ── voice ──
  'voice:status': { ok: boolean };
  'voice:turn': VoiceResponse;

  // ── runtime ──
  'runtime:getLoginAtStartup': { enabled: boolean };
  'runtime:setLoginAtStartup': { enabled: boolean };

  // ── timeline ──
  'timeline:query': TimelinePage;
  'timeline:stats': TimelineStats;
  'timeline:export': TimelineExport;

  // ── diagnostics ──
  'diagnostics:get': DiagnosticsReport;

  // ── connectors ──
  'connectors:list': ConnectorDto[];
  'connectors:get': ConnectorDto | null;
  'connectors:stats': ConnectorStats;
  'connectors:connect': ConnectorConnectResult;
  'connectors:disconnect': ConnectorActionResult;
  'connectors:reconnect': ConnectorConnectResult;
  'connectors:refresh': ConnectorActionResult;
  'connectors:sync': ConnectorActionResult;
  'connectors:health': ConnectorDto[];
  'connectors:logs': ConnectorLogEntry[];
  'connectors:sync-state': ConnectorSyncSnapshot[];
  'connectors:control': ConnectorRuntimeView;
  'connectors:runtime': ConnectorRuntimeView[];
  'connectors:inspect': ConnectorInspection;
  'connectors:m365.actions': ConnectorWriteActionInfo[];
  'connectors:m365.execute': ConnectorWriteResult;
  'connectors:m365.draft': {
    ok: boolean;
    text: string;
    model: string;
    grounded: boolean;
    confidence: number;
  };

  // ── unified ──
  'unified:query': UnifiedQueryResult;
  'unified:get': UnifiedEntity | null;
  'unified:counts': UnifiedCounts;
  'unified:search': SearchResult;

  // ── graph ──
  'graph:counts': GraphCounts;
  'graph:node': GraphNode | null;
  'graph:nodes': GraphNode[];
  'graph:neighbors': GraphNeighbors | null;
  'graph:subgraph': GraphSubgraph | null;
  'graph:path': GraphPathResult;
  'graph:history': GraphEdgeEvent[];
  'graph:rebuild': GraphCounts;

  // ── memory ──
  'memory:recall': MemoryRecallResult;
  'memory:semantic-recall': MemoryRecallResult;

  // ── knowledge ──
  'knowledge:related': {
    memoryId: string;
    related: Array<{
      memoryId: string;
      title: string;
      kind: string;
      content: string;
      score: number;
      sharedEntities: string[];
    }>;
  };
  'knowledge:topics': {
    topics: Array<{
      id: string;
      label: string;
      memoryIds: string[];
      entities: string[];
      size: number;
    }>;
    total: number;
  };
  // FW-1: registered in main since P6-Stage7; typing it here completes the A7 contract so the renderer facade can reach it.
  'knowledge:health': {
    totalMemories: number;
    memoriesWithEntities: number;
    avgEntitiesPerMemory: number;
    topicCount: number;
    memoriesInTopics: number;
    orphanCount: number;
    coveragePercent: number;
    largestTopicSize: number;
  };

  // ── memory ──
  'memory:get': MemoryItem | null;
  'memory:remember': MemoryItem;
  'memory:forget': { forgotten: number };
  'memory:counts': MemoryCounts;
  'memory:rebuild': MemoryCounts;
  'memory:exec-search': ExecutiveMemoryView[];
  'memory:exec-forget': { forgotten: boolean };
  'memory:exec-pin': ExecutiveMemoryView | null;
  'memory:exec-resolve': ExecutiveMemoryView | null;
  'memory:exec-audit': MemoryAuditPage;

  // ── search ──
  'search:enterprise': EnterpriseSearchResult;

  // ── enterpriseTimeline ──
  'enterpriseTimeline:query': EnterpriseTimelinePage;
  'enterpriseTimeline:replay': TimelineReplay;
  'enterpriseTimeline:stats': EnterpriseTimelineStats;
  'enterpriseTimeline:export': EnterpriseTimelineExport;

  // ── intelligence ──
  'intelligence:briefing': Briefing;

  // ── recommendations ──
  'recommendations:generate': RecommendationSet;

  // ── founder ──
  'founder:ask': FounderAnswer;
  'founder:ask-v2': FounderResponse;
  'founder:suggestions': FounderSuggestedQuestion[];

  // ── ai ──
  'ai:engineering-analyze': EngineeringAnalysis;

  // ── assistant ──
  'assistant:ask': AssistantAskResult;
  'assistant:conversations': AssistantConversationsResult;
  'assistant:conversation': AssistantConversation | null;
  'assistant:conversation.save': AssistantConversation | null;
  'assistant:conversation.delete': boolean;
  'assistant:conversation.branch': AssistantConversation | null;
  'assistant:plan.decide': AssistantConversation | null;
  'assistant:cancel': { cancelled: boolean };

  // ── notifications ──
  'notifications:list': NotificationInboxPage;
  'notifications:markRead': { changed: number; unread: number };
  'notifications:prefs.get': DeliveryPreferences;
  'notifications:prefs.set': DeliveryPreferences;

  // ── companion (mobile) gateway management (Mobile M1-03) ──
  'companion:status': CompanionStatusDto;
  'companion:devices': CompanionDeviceDto[];
  'companion:enable': CompanionStatusDto;
  'companion:revoke': { ok: boolean };
  'companion:pairingQr': CompanionPairingQrDto;

  // ── governance ──
  'governance:list': GovernanceTraceList;
  'governance:trace': GovernanceTrace | null;

  // ── context ──
  'context:trace': ContextTrace;

  // ── relationship ──
  'relationship:trace': RelationshipTrace;
  'relationship:path': RelationshipPath;

  // ── workforce ──
  'workforce:workers': WorkerSummary[];
  'workforce:intelligence': WorkforceIntelligence;
  'workforce:worker': Worker | null;
  'workforce:job.run': Job;
  'workforce:jobs': JobPage;
  'workforce:job': Job | null;
  'workforce:proposal.approve': Job | null;
  'workforce:proposal.reject': Job | null;
  'workforce:workflow.run': WorkflowRun;
  'workforce:workflow.runs': WorkflowRun[];
  'workforce:workflow.resume': WorkflowRun | null;
  'workforce:workflow.checkpoint': WorkflowRun | null;
  'workforce:audit': WorkforceAuditPage;
  'workforce:policies': PolicyRule[];
  'workforce:delegate': DelegationPlan;
  'workforce:installs': WorkerInstallSummary[];
  'workforce:install.get': WorkerInstallDetail | null;
  'workforce:install': WorkerInstallResult;
  'workforce:install.update': WorkerInstallResult;
  'workforce:install.enable': WorkerInstallResult;
  'workforce:install.disable': WorkerInstallResult;
  'workforce:install.rollback': WorkerInstallResult;
  'workforce:uninstall': WorkerInstallResult;

  // ── enterprise ──
  'enterprise:org.get': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.createUnit': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.updateUnit': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.deleteUnit': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.createUser': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.updateUser': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.deleteUser': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.createRole': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.updateRole': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:org.deleteRole': {
    organization: Organization;
    units: OrgUnit[];
    roles: OrgRole[];
    users: OrgUser[];
  };
  'enterprise:workspace.list': WorkspaceSummary[];
  'enterprise:workspace.active': Workspace;
  'enterprise:workspace.create': WorkspaceSummary[];
  'enterprise:workspace.switch': Workspace;
  'enterprise:graph': OrgGraph;
  'enterprise:graph.neighbors': OrgGraphNeighbors | null;
  'enterprise:governance.config': GovernanceConfig;
  'enterprise:governance.compliance': ComplianceFinding[];
  'enterprise:governance.setChain': GovernanceConfig['approvalChains'];
  'enterprise:governance.setRule': GovernanceConfig['complianceRules'];
  'enterprise:governance.audit': EnterpriseAuditEntry[];
  'enterprise:dashboard': ExecutiveSnapshot;
  'enterprise:process.explore': ProcessExplorerModel;
  'enterprise:process.case': ProcessCaseDetail | null;
  'enterprise:schedule.explore': ScheduleExploreModel;
  'enterprise:execution.explore': ExecutionConsoleModel;
  'enterprise:relationship.explore': RelationshipGraphModel;
  'enterprise:trust.explore': EnterpriseTrustModel;
  'enterprise:context': EnterpriseContext;

  // ── api ──
  'api:request': EnterpriseApiResponse;
  'api:routes': ApiRouteInfo[];
  'api:openapi': OpenApiDocument;

  // ── webhooks ──
  'webhooks:create': WebhookWithSecret;
  'webhooks:list': Webhook[];
  'webhooks:setEnabled': Webhook | null;
  'webhooks:delete': { deleted: boolean };
  'webhooks:deliveries': WebhookDelivery[];
  'webhooks:deadLetters': WebhookDelivery[];
  'webhooks:replay': WebhookDelivery | { error: string };
  'webhooks:stats': WebhookDeliveryStats;

  // ── sandbox ──
  'sandbox:workspace.list': SandboxWorkspace[];
  'sandbox:scenario.list': Scenario[];
  'sandbox:scenario.get': Scenario | null;
  'sandbox:scenario.versions': ScenarioVersion[];
  'sandbox:execution.enqueue': Execution;
  'sandbox:execution.get': Execution | null;
  'sandbox:execution.history': RunHistoryPage;
  'sandbox:execution.cancel': Execution | null;
  'sandbox:execution.timeline': ExecutionTimelineEntry[];
  'sandbox:queue.state': ExecutionQueueState;
  'sandbox:artifact.list': Artifact[];
  'sandbox:result.get': RunResult | null;
  'sandbox:report.get': SandboxReport | null;
  'sandbox:report.generate': SandboxReport | { error: string };
  'sandbox:dataset.list': Dataset[];
  'sandbox:dashboard': SandboxDashboard;
  'sandbox:validation.summary': ValidationSummary;
  'sandbox:validation.dashboard': ValidationDashboard;
  'sandbox:validation.run': ValidationRunDetail;
  'sandbox:validation.run.get': ValidationRunDetail | { error: string };
  'sandbox:validation.schedule.set': ScheduledValidation[];

  // ── enterprise ──
  'enterprise:personalization.get': PersonalizationState;
  'enterprise:personalization.favorite': PersonalizationState;
  'enterprise:personalization.recent': PersonalizationState;
  'enterprise:personalization.clearRecents': PersonalizationState;
  'enterprise:personalization.saveView': PersonalizationState;
  'enterprise:personalization.deleteView': PersonalizationState;
  'enterprise:personalization.renameView': PersonalizationState;
  'enterprise:modules': EnterpriseModuleSummary[];
  'enterprise:module.list': EnterpriseEntity[];
  'enterprise:module.get': EnterpriseEntity | null;
  'enterprise:module.create': EnterpriseModuleMutationResult;
  'enterprise:module.update': EnterpriseModuleMutationResult;
  'enterprise:module.setStatus': EnterpriseModuleMutationResult;
  'enterprise:module.delete': EnterpriseModuleMutationResult;
  'enterprise:module.search': EnterpriseEntity[];
  'enterprise:module.summarize': EnterpriseRecordSummary | null;
  'enterprise:module.action': EnterpriseModuleActionResult;

  // ── ecosystem ──
  'ecosystem:developer.dashboard': DeveloperDashboard;
  'ecosystem:developer.account': DeveloperAccount;
  'ecosystem:developer.setPlan': DeveloperDashboard;
  'ecosystem:keys.list': ApiKey[];
  'ecosystem:keys.create': ApiKeyWithSecret;
  'ecosystem:keys.revoke': ApiKey | null;
  'ecosystem:oauth.list': OAuthApplication[];
  'ecosystem:oauth.create': OAuthApplicationWithSecret;
  'ecosystem:oauth.delete': { deleted: boolean };
  'ecosystem:usage.analytics': DeveloperAnalytics;
  'ecosystem:sdks': SdkArtifact[];
  'ecosystem:marketplace.list': MarketplaceListing[];
  'ecosystem:marketplace.detail': ListingDetail | null;
  'ecosystem:marketplace.stats': MarketplaceStats;
  'ecosystem:marketplace.events': SubmissionEvent[];
  'ecosystem:listing.create': MarketplaceListing;
  'ecosystem:listing.versionCreate': ListingVersion | null;
  'ecosystem:listing.submit': ListingVersion | null;
  'ecosystem:listing.review': ListingVersion | null;
  'ecosystem:listing.publish': ListingVersion | null;
  'ecosystem:listing.rollback': MarketplaceListing | null;
  'ecosystem:listing.install': MarketplaceListing | null;
  'ecosystem:listing.rate': MarketplaceListing | null;
  'ecosystem:gateway.versions': ApiVersionInfo[];
  'ecosystem:gateway.request': GatewayDecision;
  'ecosystem:gateway.audit': GatewayAuditEntry[];
  'ecosystem:gateway.metrics': GatewayMetrics;
  'ecosystem:billing.summary': BillingSummary;
  'ecosystem:billing.plans': Plan[];
  'ecosystem:billing.setPlan': BillingSummary;
  'ecosystem:billing.invoice': Invoice;
  'ecosystem:billing.seats': SeatAssignment[];
  'ecosystem:billing.assignSeat': SeatAssignment | { error: string };
  'ecosystem:billing.releaseSeat': { released: boolean };
  'ecosystem:billing.licenses': License[];
  'ecosystem:billing.purchase':
    { purchase: MarketplacePurchase; license: License } | { error: string };
  'ecosystem:billing.purchases': MarketplacePurchase[];
  'ecosystem:installs.list': Installation[];
  'ecosystem:installs.summary': InstallSummary;
  'ecosystem:installs.install': Installation | { error: string };
  'ecosystem:installs.update': Installation | { error: string };
  'ecosystem:installs.setEnabled': Installation | null;
  'ecosystem:installs.uninstall': { uninstalled: boolean };
  'ecosystem:workers.share': ListingDetail | { error: string };
  'ecosystem:packs.list': ExchangePack[];
  'ecosystem:packs.stats': ExchangeStats;
  'ecosystem:packs.publish': ExchangePack;
  'ecosystem:packs.import': ExchangePack | null;
  'ecosystem:packs.remove': { removed: boolean };
  'ecosystem:partners.list': Partner[];
  'ecosystem:partners.stats': PartnerStats;
  'ecosystem:analytics': EcosystemAnalytics;
  'ecosystem:devplatform.overview': DeveloperPlatformOverview;
  'ecosystem:devplatform.console': DeveloperConsole;
  'ecosystem:devplatform.sdks': SdkRegistry;
  'ecosystem:devplatform.apis': ApiExplorer;
  'ecosystem:devplatform.templates': TemplateRegistry;
  'ecosystem:devplatform.publishing': PublishingConsole;
  'ecosystem:devplatform.analytics': DeveloperPlatformAnalytics;

  // ── industry ──
  'industry:overview': IndustryPlatformOverview;
  'industry:suites': IndustrySuite[];
  'industry:kpis': ExecutiveKpi[];
  'industry:compliance': IndustryComplianceReport;
  'industry:collections': IndustryCollection[];
  'industry:readiness': IndustryReadinessReport;

  // ── strategy ──
  'strategy:overview': StrategyOverview;
  'strategy:goals': GoalManager;
  'strategy:planning': PlanningEngine;
  'strategy:reasoning': ReasoningReport;
  'strategy:optimization': OptimizationEngine;
  'strategy:simulation': SimulationReport;
  'strategy:decisions': DecisionQueue;

  // ── twin ──
  'twin:overview': EnterpriseTwinOverview;
  'twin:domains': TwinDomains;
  'twin:topology': TwinTopology;
  'twin:health': TwinHealthMap;
  'twin:replay': TwinReplay;
  'twin:scenario': TwinScenarioCenter;
  'twin:impact': TwinImpact;
  'twin:executive': TwinCommandCenter;

  // ── fabric ──
  'fabric:overview': FabricOverview;
  'fabric:sources': FabricSourceCatalog;
  'fabric:relationships': FabricRelationshipMap;
  'fabric:classification': FabricClassification;
  'fabric:lineage': FabricLineage;
  'fabric:evidence': FabricEvidenceReport;
  'fabric:governance': FabricGovernance;
  'fabric:analytics': FabricAnalytics;

  // ── orchestration ──
  'orchestration:overview': OrchestrationOverview;
  'orchestration:goals': OrchestrationGoalRouting;
  'orchestration:workforce': OrchestrationWorkforce;
  'orchestration:cloud': OrchestrationCloud;
  'orchestration:knowledge': OrchestrationKnowledge;
  'orchestration:flows': OrchestrationFlowReport;
  'orchestration:coordination': OrchestrationCoordination;
  'orchestration:governance': OrchestrationGovernance;

  // ── network ──
  'network:overview': IntelNetworkOverview;
  'network:exchange': IntelNetworkExchange;
  'network:benchmarks': IntelNetworkBenchmarks;
  'network:insights': IntelNetworkInsights;
  'network:trust': IntelNetworkTrust;
  'network:organizations': IntelNetworkOrganizations;
  'network:collective': IntelNetworkCollective;
  'network:governance': IntelNetworkGovernance;

  // ── autonomousops ──
  'autonomousops:overview': AutoOpsOverview;
  'autonomousops:plans': AutoOpsPlans;
  'autonomousops:execution': AutoOpsExecution;
  'autonomousops:recovery': AutoOpsRecovery;
  'autonomousops:optimization': AutoOpsOptimization;
  'autonomousops:incidents': AutoOpsIncidents;
  'autonomousops:approvals': AutoOpsApprovals;
  'autonomousops:monitoring': AutoOpsMonitoring;
  'autonomousops:analytics': AutoOpsAnalytics;
  'autonomousops:governance': AutoOpsGovernance;

  // ── commercial ──
  'commercial:overview': CommercialOverview;
  'commercial:subscription': CommercialSubscription;
  'commercial:licensing': CommercialLicensing;
  'commercial:billing': CommercialBilling;
  'commercial:metering': CommercialMetering;
  'commercial:deployment': CommercialDeployment;
  'commercial:customers': CommercialCustomers;
  'commercial:analytics': CommercialAnalytics;
  'commercial:releases': CommercialReleases;
  'commercial:administration': CommercialAdministration;
  'commercial:governance': CommercialGovernance;

  // ── experience ──
  'experience:home': ExperienceHome;
  'experience:decisions': ExperienceDecisions;
  'experience:summaries': ExperienceSummaries;
  'experience:intents': ExperienceIntents;
  'experience:governance': ExperienceGovernance;

  // ── intent ──
  'intent:board': IntentBoard;
  'intent:workspaces': IntentWorkspaces;
  'intent:governance': IntentGovernance;

  // ── marketplace ──
  'marketplace:catalog': MarketplaceEntry[];
  'marketplace:entry': MarketplaceEntry | null;
  'marketplace:publishers': PublisherProfile[];
  'marketplace:trust': TrustReport | null;
  'marketplace:plan': InstallPlan;
  'marketplace:analytics': MarketplaceAnalytics;
  'marketplace:policy': OrgMarketplacePolicy;
  'marketplace:policy.set': OrgMarketplacePolicy;
  'marketplace:install': MarketplaceInstallResult;

  // ── cloud ──
  'cloud:regions': CloudRegion[];
  'cloud:tenants.list': CloudTenant[];
  'cloud:tenants.summary': TenantSummary;
  'cloud:tenants.create': CloudTenant;
  'cloud:tenants.setStatus': CloudTenant | { error: string };
  'cloud:projects.list': CloudProject[];
  'cloud:projects.create': CloudProject | { error: string };
  'cloud:projects.delete': { deleted: boolean };
  'cloud:teams.list': CloudTeam[];
  'cloud:teams.create': CloudTeam | { error: string };
  'cloud:tenants.workers': TenantWorker[];
  'cloud:storage.isolation': StorageIsolation[];
  'cloud:identity.connections': SsoConnection[];
  'cloud:identity.summary': IdentitySummary;
  'cloud:identity.createConnection': SsoConnection;
  'cloud:identity.updateConnection': SsoConnection | { error: string };
  'cloud:identity.deleteConnection': { deleted: boolean };
  'cloud:identity.testConnection': FederationResult;
  'cloud:identity.scim': ScimConfig | null;
  'cloud:identity.setScim': ScimConfig;
  'cloud:identity.scimSync': ScimConfig | { error: string };
  'cloud:identity.mfa': MfaPolicy | null;
  'cloud:identity.setMfa': MfaPolicy;

  // ── livesync ──
  'livesync:status': LiveSyncStatus;
  'livesync:detail': LiveSyncDetail;
  'livesync:now': LiveSyncStatus;
  'livesync:setOnline': LiveSyncStatus;
  'livesync:setActiveOrg': LiveSyncStatus;

  // ── cloud ──
  'cloud:api.deployments': ApiDeployment[];
  'cloud:api.summary': ApiPlatformSummary;
  'cloud:api.policies': CloudRateLimitPolicy[];
  'cloud:api.setPolicyEnabled': CloudRateLimitPolicy | { error: string };
  'cloud:api.webhooks': WebhookEndpoint[];
  'cloud:api.createWebhook': WebhookEndpoint;
  'cloud:api.setWebhookStatus': WebhookEndpoint | { error: string };
  'cloud:api.deleteWebhook': { deleted: boolean };
  'cloud:api.testWebhook': WebhookEndpoint | { error: string };
  'cloud:api.publicApis': PublicApi[];
  'cloud:admin.overview': AdminOverview;
  'cloud:admin.compliance': ComplianceReport;
  'cloud:cp.overview': ControlPlaneOverview;
  'cloud:cp.fleet': FleetOverview;
  'cloud:cp.regions': RegionStatus[];
  'cloud:cp.tenants': TenantDirectoryEntry[];
  'cloud:cp.deployments': DeploymentStatusEntry[];
  'cloud:cp.usage': UsageOverview;

  // ── fed ──
  'fed:runtime.orgs': FederatedOrg[];
  'fed:runtime.summary': FederationSummary;
  'fed:runtime.invitations': OrgInvitation[];
  'fed:runtime.invite': OrgInvitation;
  'fed:runtime.respondInvite': OrgInvitation | { error: string };
  'fed:runtime.trust': TrustRelationship[];
  'fed:runtime.setTrust': TrustRelationship | { error: string };
  'fed:runtime.shared': SharedResource[];
  'fed:runtime.share': SharedResource | { error: string };
  'fed:runtime.revokeShare': { ok: boolean };
  'fed:exchange.artifacts': ExchangeArtifact[];
  'fed:exchange.summary': ExchangeSummary;
  'fed:exchange.publish': ExchangeArtifact;
  'fed:exchange.publishVersion': ExchangeArtifact | { error: string };
  'fed:exchange.rate': ExchangeArtifact | { error: string };
  'fed:exchange.setVerification': ExchangeArtifact | { error: string };
  'fed:exchange.rollback': ExchangeArtifact | { error: string };
  'fed:exchange.install': ExchangeArtifact | { error: string };
  'fed:exchange.verifyVersion': { verified: boolean };
  'fed:marketplace.scopes': MarketplaceScopeSummary[];
  'fed:marketplace.setScope': ExchangeArtifact | { error: string };
  'fed:gov.policies': FedPolicy[];
  'fed:gov.summary': GlobalGovSummary;
  'fed:gov.addPolicy': FedPolicy;
  'fed:gov.setPolicyEnabled': FedPolicy | { error: string };
  'fed:gov.approvals': DelegatedApproval[];
  'fed:gov.resolveApproval': DelegatedApproval | { error: string };
  'fed:gov.audit': FedAuditEntry[];
  'fed:gov.compliance': FedComplianceRule[];
  'fed:gov.recordAction': FedActionEvaluation;
  'fed:obs.overview': ObservabilityOverview;
  'fed:obs.usage': UsagePoint[];
  'fed:obs.security': SecurityEvent[];
  'fed:dr.backups': Backup[];
  'fed:dr.replicas': ReplicaState[];
  'fed:dr.validations': RecoveryValidation[];
  'fed:dr.continuity': ContinuityPosture;
  'fed:dr.summary': DrSummary;
  'fed:dr.createBackup': Backup;
  'fed:dr.runValidation': RecoveryValidation | { error: string };
  'fed:dr.checkReplication': ReplicaState[];
  'fed:admin.overview': FedAdminOverview;
  'fed:scalability.report': ScalabilityReport;

  // ── federation ──
  'federation:graph': FederationGraph;
  'federation:timeline': FederationTimelineEntry[];
  'federation:directory': OrgDirectoryEntry[];
  'federation:analytics': FederationAnalytics;
  'federation:search': FederationSearchHit[];
  'federation:overview': FederationOverview;

  // ── update ──
  'help:openDoc': { ok: boolean; error?: string };
  'help:listDocs': HelpDocMeta[];
  'update:getStatus': UpdateStatus;
  'update:checkNow': UpdateStatus;
  'update:download': UpdateStatus;
  'update:installOnQuit': UpdateStatus;
  'update:setChannel': UpdateStatus;

  // ── migration ──
  'migration:status': MigrationStatus;
  'migration:run': MigrationReport;

  // ── backup ──
  'backup:list': BackupInfo[];
  'backup:create': BackupInfo;
  'backup:validate': BackupValidation;
  'backup:restore': RestoreResult;
  'backup:delete': boolean;

  // ── crash ──
  'crash:getStatus': CrashStatus;
  'crash:setOptIn': CrashStatus;
  'crash:export': CrashRecord[];
  'crash:recommendations': RecoveryRecommendation[];
  'crash:report': CrashStatus;

  // ── flags ──
  'flags:get': FeatureFlagState[];
  'flags:setOverride': FeatureFlagState[];
  'flags:clearOverride': FeatureFlagState[];

  // ── license ──
  'license:status': LicenseValidationStatus;
  'license:refresh': LicenseValidationStatus;

  // ── onboarding ──
  'onboarding:status': OnboardingStatus;
  'onboarding:start': OnboardingStatus;
  'onboarding:completeStep': OnboardingStatus;
  'onboarding:dismiss': OnboardingStatus;
  'onboarding:reset': OnboardingStatus;

  // ── aiConfig ──
  'aiConfig:get': AiConfigDto;
  'aiConfig:health': AiHealthDto;
  'aiConfig:detectOllama': OllamaDetectDto;
  'aiConfig:setProvider': AiConfigDto;
  'aiConfig:setModel': AiConfigDto;
  'aiConfig:setCredential': AiConfigDto;
  'aiConfig:clearCredential': AiConfigDto;
  'aiConfig:test': AiTestResultDto;
  'aiConfig:migrationStatus': MigrationStatusDto;
  'aiConfig:migrate': AiConfigDto;
  'aiConfig:resetToEnv': AiConfigDto;

  // ── feedback ──
  'feedback:submit': FeedbackEntry;
  'feedback:list': FeedbackEntry[];
  'feedback:export': FeedbackExport;
  'feedback:clear': number;
  'feedback:exportToFile': string | null;

  // ── pilot ──
  'pilot:status': PilotStatus;
  'pilot:setEnabled': PilotStatus;

  // ── releaseDiagnostics ──
  'releaseDiagnostics:get': ReleaseDiagnostics;
  'releaseDiagnostics:export': { report: ReleaseDiagnostics; text: string };

  // ── recovery ──
  'recovery:safeModeStatus': SafeModeState;
  'recovery:run': RecoveryActionResult;

  // ── support ──
  'support:generateBundle': SupportBundleInfo;

  // ── infra ──
  'infra:platforms': CloudPlatformDto[];
  'infra:stats': CloudPlatformStats;
  'infra:capabilities': Array<{
    platformId: string;
    provider: string;
    domains: string[];
    configured: boolean;
  }>;
  'infra:resourceGraph': ResourceGraphModel;
  'infra:resourceNeighbors': ResourceEdgeToNode[];
  'infra:discover': { ok: boolean; hadAdapter: boolean; resources: number };
  'infra:actions': InfraActionInfo[];
  'infra:action': InfraActionResult;
  'infra:search': InfraSearchResult;

  // ── intel ──
  'intel:report': EnterpriseIntelligenceReport;
  'intel:changeImpact': ChangeImpactReport;
  'intel:rootCause': RootCauseReport;

  // ── insight ──
  'insight:report': InsightReport;
  'insight:rootCause': RootCauseReport;
  'insight:health': InsightHealthFramework;
  'insight:predictions': { predictions: InsightPrediction[] };
  'insight:dashboard': InsightDashboard;

  // ── kb ──
  'kb:inventory': KnowledgeInventory & { hits: KnowledgeSearchHit[] | null };
  'kb:matrix': KnowledgeRelationshipMatrix;
  'kb:impact': KnowledgeImpactAnalysis;
  'kb:lineage': { lineages: DecisionLineage[] };
  'kb:quality': KnowledgeQualityReport;
  'kb:standards': StandardsReport;
  'kb:dashboard': KnowledgeAssetDashboard;

  // ── ap ──
  'ap:catalog': AutomationCatalog;
  'ap:playbooks': { playbooks: PlaybookDefinition[] };
  'ap:plan': AutomationPlan | { playbookId: string; found: false };
  'ap:policies': AutomationPoliciesView;
  'ap:monitor': AutomationMonitorReport;
  'ap:dashboard': AutomationPlatformDashboard;

  // ── eops ──
  'eops:catalog': ServiceCatalog;
  'eops:health': OperationalHealthView;
  'eops:readiness': {
    readiness: ReadinessAssessment;
    sla: SlaReport;
    processes: BusinessProcessReport;
  };
  'eops:incidents': IncidentLifecycleReport;
  'eops:continuity': ContinuityView;
  'eops:dashboard': OperationsDashboard;

  // ── estrat ──
  'estrat:objectives': ObjectivesReport;
  'estrat:portfolio': { portfolio: PortfolioReport; value: BusinessValueReport };
  'estrat:planning': PlanningReport;
  'estrat:health': StrategyHealthView;
  'estrat:dashboard': StrategyDashboard;
  'estrat:report': BoardReport;

  // ── efed ──
  'efed:partners': EfedPartnersReport;
  'efed:trust': EfedTrustReport;
  'efed:exchange': EfedExchangeReport;
  'efed:sharing': EfedSharingReport;
  'efed:dashboard': EfedDashboard;
  'efed:report': EfedBoardReport;

  // ── eana ──
  'eana:kpis': EanaKpiCatalog;
  'eana:trends': EanaTrendReport;
  'eana:forecasts': EanaForecastInventory;
  'eana:decisions': EanaDecisionReport;
  'eana:dashboard': EanaDashboard;
  'eana:report': EanaReport;

  // ── etwin ──
  'etwin:runtime': EtwinRuntimeTwin;
  'etwin:platforms': EtwinPlatformTwins;
  'etwin:coverage': EtwinCoverageMap;
  'etwin:simulation': EtwinSimulationInventory;
  'etwin:history': EtwinHistoryView;
  'etwin:dashboard': EtwinDashboard;
  'etwin:report': EtwinReport;
}

/**
 * Compile-time guard. Every key of `IpcResponseMap` must be a value of
 * `IpcChannel` — a mistyped key would otherwise sit here matching nothing, and
 * the channel it was meant to describe would look uncovered for no visible reason.
 * If this is ever non-`never`, `IpcResponseChannelName` degrades into the tuple
 * below and every `invoke` call stops compiling with the offending key named.
 */
type StrayResponseKeys = Exclude<keyof IpcResponseMap, IpcChannelName>;

/** Channels that carry a response contract — the domain of a typed `invoke`. */
export type IpcResponseChannelName = [StrayResponseKeys] extends [never]
  ? keyof IpcResponseMap
  : ['IpcResponseMap has keys that are not IpcChannel values:', StrayResponseKeys];

/** The shape channel `C` resolves to. */
export type IpcResponseOf<C extends IpcResponseChannelName> = C extends keyof IpcResponseMap
  ? IpcResponseMap[C]
  : never;

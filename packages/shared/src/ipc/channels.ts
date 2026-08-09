/**
 * Canonical IPC channel names. Every renderer<->main message flows through
 * one of these. Keeping them centralized lets the preload bridge, the main
 * router, and the renderer client agree on a single contract.
 *
 * Channels are split into two registration groups: the original auth/app
 * channels (handled by the legacy router) and the runtime-core channels
 * (handled by the secure bridge). The preload allows the union of both.
 */
export const IpcChannel = {
  // ── auth/app (legacy router) ──
  AuthGetStatus: 'auth:getStatus',
  AuthLoginOAuth: 'auth:loginOAuth',
  AuthLoginEmail: 'auth:loginEmail',
  AuthRegisterEmail: 'auth:registerEmail',
  AuthLogout: 'auth:logout',
  AppGetInfo: 'app:getInfo',
  AppSetThemeSource: 'app:setThemeSource',
  AppGetThemeSource: 'app:getThemeSource',
  WindowClose: 'window:close',
  AuthStatusChanged: 'auth:statusChanged',
  ThemeChanged: 'app:themeChanged',
  MenuCommand: 'menu:command',

  // ── workspace contexts (Phase 6 Stage 1 — local desktop workspaces; legacy router) ──
  WorkspaceCtxBootstrap: 'workspace-ctx:bootstrap',
  WorkspaceCtxList: 'workspace-ctx:list',
  WorkspaceCtxCreate: 'workspace-ctx:create',
  WorkspaceCtxRename: 'workspace-ctx:rename',
  WorkspaceCtxDelete: 'workspace-ctx:delete',
  WorkspaceCtxSwitch: 'workspace-ctx:switch',
  WorkspaceCtxUpdateSnapshot: 'workspace-ctx:update-snapshot',

  // ── catalog (secure bridge → backend store API) ──
  CatalogFeatured: 'catalog:featured',
  CatalogCollections: 'catalog:collections',
  CatalogSections: 'catalog:sections',
  CatalogSearch: 'catalog:search',
  CatalogApp: 'catalog:app',
  CatalogReviews: 'catalog:reviews',
  CatalogDeveloper: 'catalog:developer',
  CatalogCategories: 'catalog:categories',
  CatalogBookmarks: 'catalog:bookmarks',
  CatalogToggleBookmark: 'catalog:toggleBookmark',
  CatalogSubmitReview: 'catalog:submitReview',
  CatalogRecommendations: 'catalog:recommendations',
  CatalogCheckUpdate: 'catalog:checkUpdate',

  // ── cloud organizations (secure bridge → backend /organizations) ──
  OrgList: 'org:list',
  OrgCreate: 'org:create',
  OrgGet: 'org:get',
  OrgUpdate: 'org:update',
  OrgMembers: 'org:members',
  OrgInvite: 'org:invite',
  OrgAcceptInvite: 'org:acceptInvite',
  OrgChangeRole: 'org:changeRole',
  OrgRemoveMember: 'org:removeMember',
  OrgWorkspaces: 'org:workspaces',
  OrgCreateWorkspace: 'org:createWorkspace',
  OrgUpdateWorkspace: 'org:updateWorkspace',
  OrgDeleteWorkspace: 'org:deleteWorkspace',

  // ── local application registry ──
  RegistryList: 'registry:list',
  RegistryGet: 'registry:get',
  RegistrySetFlags: 'registry:setFlags',
  RegistryStats: 'registry:stats',
  RegistryExport: 'registry:export',
  RegistryImport: 'registry:import',
  RegistryBackup: 'registry:backup',

  // ── NeuroPause Package Service ──
  NpsInstall: 'nps:install',
  NpsUninstall: 'nps:uninstall',
  NpsUpdate: 'nps:update',
  NpsRollback: 'nps:rollback',
  NpsRepair: 'nps:repair',
  NpsVerify: 'nps:verify',
  NpsOperations: 'nps:operations',
  NpsPause: 'nps:pause',
  NpsResume: 'nps:resume',
  NpsCancel: 'nps:cancel',

  // ── runtime ──
  RuntimeLaunch: 'runtime:launch',
  RuntimeStop: 'runtime:stop',
  RuntimeSuspend: 'runtime:suspend',
  RuntimeResume: 'runtime:resume',
  RuntimeRestart: 'runtime:restart',
  RuntimeList: 'runtime:list',
  RuntimeHealth: 'runtime:health',

  // ── permissions ──
  PermsList: 'perms:list',
  PermsGrant: 'perms:grant',
  PermsRevoke: 'perms:revoke',

  // ── plugin runtime ──
  PluginsList: 'plugins:list',
  PluginsGet: 'plugins:get',
  PluginsInstall: 'plugins:install',
  PluginsEnable: 'plugins:enable',
  PluginsDisable: 'plugins:disable',
  PluginsReload: 'plugins:reload',
  PluginsUpdate: 'plugins:update',
  PluginsRemove: 'plugins:remove',
  PluginsGrant: 'plugins:grant',
  PluginsRevoke: 'plugins:revoke',
  /** Plugin SDK v2 (P3.0) — list the extensions installed plugins have registered. */
  PluginsExtensions: 'plugins:extensions',
  PluginsContributions: 'plugins:contributions',

  // ── runtime-core broadcasts (main → renderer) ──
  RuntimeEventBroadcast: 'runtime:event',
  RuntimeOpenApp: 'runtime:openApp',
  NpsProgress: 'nps:progress',
  PluginEventBroadcast: 'plugins:event',

  // ── platform core (event bus / timeline / diagnostics) ──
  PlatformEmit: 'platform:emit',
  ExecutiveCenterSnapshot: 'executiveCenter:snapshot',
  DecisionList: 'decisions:list',
  DecisionCreateFromRecommendation: 'decisions:createFromRecommendation',
  DecisionSetStatus: 'decisions:setStatus',
  /** Automation Builder rule CRUD (Module 9). */
  AutomationList: 'automations:list',
  AutomationSave: 'automations:save',
  AutomationSetStatus: 'automations:setStatus',
  AutomationRemove: 'automations:remove',
  /** Automation runtime (V4.7): manual run + monitor/history. */
  AutomationRun: 'automations:run',
  AutomationMonitor: 'automations:monitor',
  AutomationHistory: 'automations:history',
  /** NeuroCore system-health snapshot (V5.0). */
  SystemHealthSnapshot: 'neurocore:systemHealth',
  /** Runtime supervisor status + history + recovery (V5.3). */
  SupervisorStatus: 'supervisor:status',
  /** Renderer reports commercial license health for NeuroCore (V6.1). */
  LicenseReportHealth: 'license:reportHealth',
  /** Create a Razorpay subscription checkout for an org+plan (V6.4). */
  BillingCheckout: 'billing:checkout',
  /** Register this device, list an org's devices, revoke a device (V6.5). */
  DevicesRegister: 'devices:register',
  DevicesList: 'devices:list',
  DevicesRevoke: 'devices:revoke',
  /** Renderer reports this device's trust status for NeuroCore (V6.5). */
  DeviceReportHealth: 'device:reportHealth',
  SupervisorHistory: 'supervisor:history',
  SupervisorRecover: 'supervisor:recover',
  SupervisorSetPolicy: 'supervisor:setPolicy',
  /** Execute Engine (V5.4). */
  ExecuteRun: 'execute:run',
  ExecuteSessions: 'execute:sessions',
  ExecuteHistory: 'execute:history',
  ExecuteCancel: 'execute:cancel',
  /** Renderer → main: live voice runtime state (V5.2). */
  VoiceStatus: 'voice:status',
  VoiceTurn: 'voice:turn',
  /** Main → renderer: tray quick-action commands (V4.0). */
  TrayCommand: 'tray:command',
  /** Runtime launch-at-login preference (V4.2). */
  RuntimeGetLoginAtStartup: 'runtime:getLoginAtStartup',
  RuntimeSetLoginAtStartup: 'runtime:setLoginAtStartup',
  TimelineQuery: 'timeline:query',
  TimelineStats: 'timeline:stats',
  TimelineExport: 'timeline:export',
  DiagnosticsGet: 'diagnostics:get',
  PlatformEventBroadcast: 'platform:event',

  // ── connector framework (NCF) ──
  ConnectorsList: 'connectors:list',
  ConnectorGet: 'connectors:get',
  ConnectorStats: 'connectors:stats',
  ConnectorConnect: 'connectors:connect',
  ConnectorDisconnect: 'connectors:disconnect',
  ConnectorReconnect: 'connectors:reconnect',
  ConnectorRefresh: 'connectors:refresh',
  ConnectorSync: 'connectors:sync',
  ConnectorHealthCheck: 'connectors:health',
  ConnectorLogs: 'connectors:logs',
  ConnectorSyncState: 'connectors:sync-state',
  ConnectorEventBroadcast: 'connectors:event',
  // P4.1 Connector Runtime v2 — operator controls (command), runtime-state read, and the
  // lifecycle (from→to transition) broadcast the Runtime Supervisor emits.
  ConnectorControl: 'connectors:control',
  ConnectorRuntime: 'connectors:runtime',
  ConnectorLifecycleBroadcast: 'connectors:lifecycle',
  /** P4.1 — the Live Connector Inspector read (runtime + per-account snapshot/health + logs + lifecycle). */
  ConnectorInspect: 'connectors:inspect',
  // P2.4 — Microsoft 365 write actions (audited, confirmation-gated) + AI drafting.
  M365ActionList: 'connectors:m365.actions',
  M365ActionExecute: 'connectors:m365.execute',
  M365Draft: 'connectors:m365.draft',

  // ── unified knowledge layer (UDM) ──
  UnifiedQuery: 'unified:query',
  UnifiedGet: 'unified:get',
  UnifiedCounts: 'unified:counts',
  UnifiedSearch: 'unified:search',
  UnifiedEventBroadcast: 'unified:event',

  // ── enterprise knowledge graph (EKG) ──
  GraphCounts: 'graph:counts',
  GraphNode: 'graph:node',
  GraphNodes: 'graph:nodes',
  GraphNeighbors: 'graph:neighbors',
  GraphSubgraph: 'graph:subgraph',
  GraphPath: 'graph:path',
  GraphHistory: 'graph:history',
  GraphRebuild: 'graph:rebuild',
  GraphEventBroadcast: 'graph:event',

  // ── AI memory + enterprise search ──
  MemoryRecall: 'memory:recall',
  MemorySemanticRecall: 'memory:semantic-recall',
  MemoryBackfill: 'memory:backfill',
  KnowledgeRelated: 'knowledge:related',
  KnowledgeTopics: 'knowledge:topics',
  KnowledgeHealth: 'knowledge:health',
  MemoryGet: 'memory:get',
  MemoryRemember: 'memory:remember',
  MemoryForget: 'memory:forget',
  MemoryCounts: 'memory:counts',
  MemoryRebuild: 'memory:rebuild',
  MemoryEventBroadcast: 'memory:event',
  // ── Executive conversation memory (Founder AI) ──
  ExecMemorySearch: 'memory:exec-search',
  ExecMemoryForget: 'memory:exec-forget',
  ExecMemoryPin: 'memory:exec-pin',
  ExecMemoryResolve: 'memory:exec-resolve',
  ExecMemoryAudit: 'memory:exec-audit',
  EnterpriseSearch: 'search:enterprise',

  // ── Enterprise timeline (unified work stream) ──
  EnterpriseTimelineQuery: 'enterpriseTimeline:query',
  EnterpriseTimelineReplay: 'enterpriseTimeline:replay',
  EnterpriseTimelineStats: 'enterpriseTimeline:stats',
  EnterpriseTimelineExport: 'enterpriseTimeline:export',
  EnterpriseTimelineEventBroadcast: 'enterpriseTimeline:event',

  // ── Daily intelligence + recommendations ──
  BriefingGenerate: 'intelligence:briefing',
  RecommendationsGenerate: 'recommendations:generate',

  // ── Founder AI ──
  FounderAsk: 'founder:ask',
  FounderAskV2: 'founder:ask-v2',
  FounderSuggestions: 'founder:suggestions',

  // ── Engineering AI ──
  EngineeringAnalyze: 'ai:engineering-analyze',

  // ── Workspace Assistant (Phase 6 Stage 4 — the documented D-1 cluster) ──
  AssistantAsk: 'assistant:ask',
  AssistantConversations: 'assistant:conversations',
  AssistantConversationGet: 'assistant:conversation',
  AssistantConversationSave: 'assistant:conversation.save',
  AssistantConversationDelete: 'assistant:conversation.delete',
  AssistantConversationBranch: 'assistant:conversation.branch',
  AssistantPlanDecide: 'assistant:plan.decide',
  AssistantCancel: 'assistant:cancel',
  AssistantEventBroadcast: 'assistant:event',

  // ── Notification Inbox + delivery preferences (Phase 6 Stage 5 — the D-8
  // cluster; surfaces the EXISTING delivery preference store the capability
  // registry had flagged as "deferred, needs an IPC channel") ──
  NotificationsList: 'notifications:list',
  NotificationsMarkRead: 'notifications:markRead',
  NotificationsPrefsGet: 'notifications:prefs.get',
  NotificationsPrefsSet: 'notifications:prefs.set',
  NotificationsEventBroadcast: 'notifications:event',

  // ── Companion (mobile) gateway — local management surface (Mobile M1-03).
  // The desktop hosts a LAN gateway a paired phone reaches over end-to-end
  // sealed frames; these channels are the DESKTOP Settings pane's controls, not
  // the phone's transport (that is @neuropause/companion-protocol over HTTP). ──
  CompanionStatus: 'companion:status',
  CompanionDevices: 'companion:devices',
  CompanionEnable: 'companion:enable',
  CompanionRevoke: 'companion:revoke',
  CompanionPairingQr: 'companion:pairingQr',
  CompanionEventBroadcast: 'companion:event',

  // ── Traces (governance / context / relationship) ──
  GovernanceList: 'governance:list',
  GovernanceTrace: 'governance:trace',
  ContextTrace: 'context:trace',
  RelationshipTrace: 'relationship:trace',
  RelationshipPath: 'relationship:path',

  // ── AI Workforce ──
  WorkforceWorkers: 'workforce:workers',
  WorkforceIntelligence: 'workforce:intelligence',
  WorkforceWorkerGet: 'workforce:worker',
  WorkforceJobRun: 'workforce:job.run',
  WorkforceJobs: 'workforce:jobs',
  WorkforceJobGet: 'workforce:job',
  WorkforceProposalApprove: 'workforce:proposal.approve',
  WorkforceProposalReject: 'workforce:proposal.reject',
  WorkforceWorkflowRun: 'workforce:workflow.run',
  WorkforceWorkflowRuns: 'workforce:workflow.runs',
  WorkforceWorkflowResume: 'workforce:workflow.resume',
  WorkforceWorkflowCheckpoint: 'workforce:workflow.checkpoint',
  WorkforceAudit: 'workforce:audit',
  WorkforcePolicies: 'workforce:policies',
  WorkforceDelegatePlan: 'workforce:delegate',
  WorkforceEventBroadcast: 'workforce:event',
  // ── P8.5 — Installable Workers ──
  WorkforceInstalls: 'workforce:installs',
  WorkforceInstallGet: 'workforce:install.get',
  WorkforceInstall: 'workforce:install',
  WorkforceInstallUpdate: 'workforce:install.update',
  WorkforceInstallEnable: 'workforce:install.enable',
  WorkforceInstallDisable: 'workforce:install.disable',
  WorkforceInstallRollback: 'workforce:install.rollback',
  WorkforceUninstall: 'workforce:uninstall',

  // ── Enterprise Operating System ──
  EnterpriseOrgGet: 'enterprise:org.get',
  EnterpriseOrgCreateUnit: 'enterprise:org.createUnit',
  EnterpriseOrgUpdateUnit: 'enterprise:org.updateUnit',
  EnterpriseOrgDeleteUnit: 'enterprise:org.deleteUnit',
  EnterpriseOrgCreateUser: 'enterprise:org.createUser',
  EnterpriseOrgUpdateUser: 'enterprise:org.updateUser',
  EnterpriseOrgDeleteUser: 'enterprise:org.deleteUser',
  EnterpriseOrgCreateRole: 'enterprise:org.createRole',
  EnterpriseOrgUpdateRole: 'enterprise:org.updateRole',
  EnterpriseOrgDeleteRole: 'enterprise:org.deleteRole',
  EnterpriseWorkspaceList: 'enterprise:workspace.list',
  EnterpriseWorkspaceActive: 'enterprise:workspace.active',
  EnterpriseWorkspaceCreate: 'enterprise:workspace.create',
  EnterpriseWorkspaceSwitch: 'enterprise:workspace.switch',
  EnterpriseGraph: 'enterprise:graph',
  EnterpriseGraphNeighbors: 'enterprise:graph.neighbors',
  EnterpriseGovernanceConfig: 'enterprise:governance.config',
  EnterpriseGovernanceCompliance: 'enterprise:governance.compliance',
  EnterpriseGovernanceSetChain: 'enterprise:governance.setChain',
  EnterpriseGovernanceSetRule: 'enterprise:governance.setRule',
  EnterpriseGovernanceAudit: 'enterprise:governance.audit',
  EnterpriseDashboard: 'enterprise:dashboard',
  /** Process Explorer — read-only projection of the mined processes (graph + filtered case list + KPIs). */
  EnterpriseProcessExplore: 'enterprise:process.explore',
  /** Process Explorer — full detail for one reconstructed case (every stage + mined recommendations). */
  EnterpriseProcessCase: 'enterprise:process.case',
  /** Production Schedule — read-only routing schedule (Gantt + KPIs + violations + governance proposals). */
  EnterpriseScheduleExplore: 'enterprise:schedule.explore',
  /** Operator Console (MES) — read-only shop-floor execution model (executions + operators + machines + quality + timeline + KPIs). */
  EnterpriseExecutionExplore: 'enterprise:execution.explore',
  /** Relationship Intelligence — read-only ERP entity relationship graph (nodes + typed edges + health/risk + KPIs + narrative). */
  EnterpriseRelationshipExplore: 'enterprise:relationship.explore',
  /** Trust Engine — read-only per-entity deterministic trust model (profiles + factors + trend + KPIs + narrative). */
  EnterpriseTrustExplore: 'enterprise:trust.explore',
  /** Context Engine (P2.5) — entity-360: unified-graph neighbors + ERP impact + timeline + memory for any entity. */
  EnterpriseContext: 'enterprise:context',
  /** Enterprise REST API (P3.0) — single gateway entrypoint: routes a REST request to an existing handler. */
  EnterpriseApiRequest: 'api:request',
  /** Enterprise REST API (P3.0) — the static route index (drives docs + OpenAPI). */
  EnterpriseApiRoutes: 'api:routes',
  /** Enterprise REST API (P3.0) — the generated OpenAPI 3.1 document (auto-synced from routes + Zod). */
  EnterpriseApiOpenApi: 'api:openapi',

  // ── Enterprise Webhooks (P3.0, Increment 4) ──
  WebhookCreate: 'webhooks:create',
  WebhookList: 'webhooks:list',
  WebhookSetEnabled: 'webhooks:setEnabled',
  WebhookDelete: 'webhooks:delete',
  WebhookDeliveries: 'webhooks:deliveries',
  WebhookDeadLetters: 'webhooks:deadLetters',
  WebhookReplay: 'webhooks:replay',
  WebhookStats: 'webhooks:stats',
  /** Broadcast on any webhook/delivery change (renderer refresh). */
  WebhookEventBroadcast: 'webhooks:event',
  // ── AI Sandbox — Sandbox Core (S1) ──
  SandboxWorkspaceList: 'sandbox:workspace.list',
  SandboxWorkspaceCreate: 'sandbox:workspace.create',
  SandboxWorkspaceUpdate: 'sandbox:workspace.update',
  SandboxWorkspaceDelete: 'sandbox:workspace.delete',
  SandboxScenarioList: 'sandbox:scenario.list',
  SandboxScenarioGet: 'sandbox:scenario.get',
  SandboxScenarioCreate: 'sandbox:scenario.create',
  SandboxScenarioUpdate: 'sandbox:scenario.update',
  SandboxScenarioArchive: 'sandbox:scenario.archive',
  SandboxScenarioVersionCreate: 'sandbox:scenario.version.create',
  SandboxScenarioVersions: 'sandbox:scenario.versions',
  SandboxExecutionEnqueue: 'sandbox:execution.enqueue',
  SandboxExecutionGet: 'sandbox:execution.get',
  SandboxExecutionHistory: 'sandbox:execution.history',
  SandboxExecutionCancel: 'sandbox:execution.cancel',
  SandboxExecutionTimeline: 'sandbox:execution.timeline',
  SandboxQueueState: 'sandbox:queue.state',
  SandboxArtifactList: 'sandbox:artifact.list',
  SandboxArtifactGet: 'sandbox:artifact.get',
  SandboxResultGet: 'sandbox:result.get',
  SandboxReportGet: 'sandbox:report.get',
  SandboxReportGenerate: 'sandbox:report.generate',
  SandboxDatasetList: 'sandbox:dataset.list',
  SandboxDatasetCreate: 'sandbox:dataset.create',
  SandboxDatasetDelete: 'sandbox:dataset.delete',
  SandboxDashboard: 'sandbox:dashboard',
  /** S6 Continuous Validation — read-only summary the Developer Portal consumes. */
  SandboxValidationSummary: 'sandbox:validation.summary',
  /** P4 Validation Experience — live dashboard projection (read). */
  SandboxValidationDashboard: 'sandbox:validation.dashboard',
  /** P4 Validation Experience — run a validation pipeline (command, gated sandbox:manage). */
  SandboxValidationRun: 'sandbox:validation.run',
  /** P4 Validation Experience — a single run + certification + regression + exports (read). */
  SandboxValidationRunGet: 'sandbox:validation.run.get',
  /** P4 Validation Experience — enable/disable a registered schedule (command, gated sandbox:manage). */
  SandboxValidationScheduleSet: 'sandbox:validation.schedule.set',
  /** Broadcast on any sandbox execution/queue change (renderer refresh). */
  SandboxEventBroadcast: 'sandbox:event',
  /** Personalization (per-user Favorites / Recently-Opened / Saved Views) — actor-scoped, persisted. */
  EnterprisePersonalizationGet: 'enterprise:personalization.get',
  EnterprisePersonalizationFavorite: 'enterprise:personalization.favorite',
  EnterprisePersonalizationRecent: 'enterprise:personalization.recent',
  EnterprisePersonalizationClearRecents: 'enterprise:personalization.clearRecents',
  EnterprisePersonalizationSaveView: 'enterprise:personalization.saveView',
  EnterprisePersonalizationDeleteView: 'enterprise:personalization.deleteView',
  EnterprisePersonalizationRenameView: 'enterprise:personalization.renameView',
  EnterpriseEventBroadcast: 'enterprise:event',

  // ── Enterprise Module Framework (ERP foundation) ──
  /** List the registered ERP modules + live record counts. */
  EnterpriseModulesList: 'enterprise:modules',
  /** Generic per-module record CRUD (module resolved from the payload). */
  EnterpriseModuleList: 'enterprise:module.list',
  EnterpriseModuleGet: 'enterprise:module.get',
  EnterpriseModuleCreate: 'enterprise:module.create',
  EnterpriseModuleUpdate: 'enterprise:module.update',
  EnterpriseModuleSetStatus: 'enterprise:module.setStatus',
  EnterpriseModuleDelete: 'enterprise:module.delete',
  EnterpriseModuleSearch: 'enterprise:module.search',
  /** AI-assisted summary + risk for one record (through the existing AI pipeline). */
  EnterpriseModuleSummarize: 'enterprise:module.summarize',
  /** Run a module-defined record action (e.g. convert a lead). */
  EnterpriseModuleAction: 'enterprise:module.action',
  // ── ERP document layer (line items + approval).
  // The engines behind these shipped registered but unreachable: no channel
  // existed, so lines could never be entered, totals were always 0, and the
  // approval/SoD engine was never consulted by any mutation. ──
  /** Lines + derived totals for one document. */
  EnterpriseModuleLines: 'enterprise:module.lines',
  /** Replace a document's lines. Validated per document type. */
  EnterpriseModuleSetLines: 'enterprise:module.setLines',
  /** Approval state for one document: required steps, satisfied, next. */
  EnterpriseModuleApproval: 'enterprise:module.approval',
  /** Record an approval decision. Enforces role eligibility and SoD. */
  EnterpriseModuleApprove: 'enterprise:module.approve',
  /** Broadcast on any module record change (create/update/status/delete). */
  EnterpriseModuleEventBroadcast: 'enterprise:module.event',

  // ── Ecosystem Platform (Phase 8) ──
  EcosystemDeveloperDashboard: 'ecosystem:developer.dashboard',
  EcosystemDeveloperAccount: 'ecosystem:developer.account',
  EcosystemDeveloperSetPlan: 'ecosystem:developer.setPlan',
  EcosystemKeysList: 'ecosystem:keys.list',
  EcosystemKeysCreate: 'ecosystem:keys.create',
  EcosystemKeysRevoke: 'ecosystem:keys.revoke',
  /** P3.0 — rotate an API key: issue a fresh secret, revoke the old one. */
  EcosystemKeysRotate: 'ecosystem:keys.rotate',
  EcosystemOAuthList: 'ecosystem:oauth.list',
  EcosystemOAuthCreate: 'ecosystem:oauth.create',
  EcosystemOAuthDelete: 'ecosystem:oauth.delete',
  /** P3.0 — OAuth 2.1 client-credentials token endpoint (mints a Bearer access token). */
  EcosystemOAuthToken: 'ecosystem:oauth.token',
  /** P3.0 — revoke a previously-issued access token by its jti. */
  EcosystemOAuthRevokeToken: 'ecosystem:oauth.revokeToken',
  EcosystemUsageAnalytics: 'ecosystem:usage.analytics',
  EcosystemSdks: 'ecosystem:sdks',
  EcosystemMarketplaceList: 'ecosystem:marketplace.list',
  EcosystemMarketplaceDetail: 'ecosystem:marketplace.detail',
  EcosystemMarketplaceStats: 'ecosystem:marketplace.stats',
  EcosystemMarketplaceEvents: 'ecosystem:marketplace.events',
  EcosystemListingCreate: 'ecosystem:listing.create',
  EcosystemVersionCreate: 'ecosystem:listing.versionCreate',
  EcosystemListingSubmit: 'ecosystem:listing.submit',
  EcosystemListingReview: 'ecosystem:listing.review',
  EcosystemListingPublish: 'ecosystem:listing.publish',
  EcosystemListingRollback: 'ecosystem:listing.rollback',
  EcosystemListingInstall: 'ecosystem:listing.install',
  EcosystemListingRate: 'ecosystem:listing.rate',
  EcosystemGatewayVersions: 'ecosystem:gateway.versions',
  EcosystemGatewayRequest: 'ecosystem:gateway.request',
  EcosystemGatewayAudit: 'ecosystem:gateway.audit',
  EcosystemGatewayMetrics: 'ecosystem:gateway.metrics',
  EcosystemBillingSummary: 'ecosystem:billing.summary',
  EcosystemBillingPlans: 'ecosystem:billing.plans',
  EcosystemBillingSetPlan: 'ecosystem:billing.setPlan',
  EcosystemBillingInvoice: 'ecosystem:billing.invoice',
  EcosystemBillingSeats: 'ecosystem:billing.seats',
  EcosystemBillingAssignSeat: 'ecosystem:billing.assignSeat',
  EcosystemBillingReleaseSeat: 'ecosystem:billing.releaseSeat',
  EcosystemBillingLicenses: 'ecosystem:billing.licenses',
  EcosystemBillingPurchase: 'ecosystem:billing.purchase',
  EcosystemBillingPurchases: 'ecosystem:billing.purchases',

  // ── Enterprise Ecosystem (Phase 8 · Stage 2) ──
  EcosystemInstallsList: 'ecosystem:installs.list',
  EcosystemInstallsSummary: 'ecosystem:installs.summary',
  EcosystemInstall: 'ecosystem:installs.install',
  EcosystemInstallUpdate: 'ecosystem:installs.update',
  EcosystemInstallSetEnabled: 'ecosystem:installs.setEnabled',
  EcosystemUninstall: 'ecosystem:installs.uninstall',
  EcosystemShareWorker: 'ecosystem:workers.share',
  EcosystemPacksList: 'ecosystem:packs.list',
  EcosystemPacksStats: 'ecosystem:packs.stats',
  EcosystemPackPublish: 'ecosystem:packs.publish',
  EcosystemPackImport: 'ecosystem:packs.import',
  EcosystemPackRemove: 'ecosystem:packs.remove',
  EcosystemPartnersList: 'ecosystem:partners.list',
  EcosystemPartnersStats: 'ecosystem:partners.stats',
  EcosystemAnalytics: 'ecosystem:analytics',

  // ── P12 — Developer Platform (registry/rollup layer over the ecosystem developer stack) ──
  DevPlatformOverview: 'ecosystem:devplatform.overview',
  DevPlatformConsole: 'ecosystem:devplatform.console',
  DevPlatformSdks: 'ecosystem:devplatform.sdks',
  DevPlatformApis: 'ecosystem:devplatform.apis',
  DevPlatformTemplates: 'ecosystem:devplatform.templates',
  DevPlatformPublishing: 'ecosystem:devplatform.publishing',
  DevPlatformAnalytics: 'ecosystem:devplatform.analytics',

  // ── P13 — Industry Solution Platform (curated solution-pack catalog + readiness projection) ──
  IndustryOverview: 'industry:overview',
  IndustrySuites: 'industry:suites',
  IndustryKpis: 'industry:kpis',
  IndustryCompliance: 'industry:compliance',
  IndustryCollections: 'industry:collections',
  IndustryReadiness: 'industry:readiness',
  /** IP-03b — the canonical Wave 9 catalog (@neuropause/industry) bridged to the desktop. */
  IndustrySnapshot: 'industry:snapshot',

  // ── P14 — Autonomous Enterprise Intelligence (read-only strategic reasoning/projection layer) ──
  StrategyOverview: 'strategy:overview',
  StrategyGoals: 'strategy:goals',
  StrategyPlanning: 'strategy:planning',
  StrategyReasoning: 'strategy:reasoning',
  StrategyOptimization: 'strategy:optimization',
  StrategySimulation: 'strategy:simulation',
  StrategyDecisions: 'strategy:decisions',

  // ── P15 — Enterprise Digital Twin (read-only visualization/composition layer) ──
  TwinOverview: 'twin:overview',
  TwinDomains: 'twin:domains',
  TwinTopology: 'twin:topology',
  TwinHealth: 'twin:health',
  TwinReplay: 'twin:replay',
  TwinScenario: 'twin:scenario',
  TwinImpact: 'twin:impact',
  TwinExecutive: 'twin:executive',

  // ── P16 — Enterprise Knowledge Fabric (read-only knowledge-projection layer) ──
  FabricOverview: 'fabric:overview',
  FabricSources: 'fabric:sources',
  FabricRelationships: 'fabric:relationships',
  FabricClassification: 'fabric:classification',
  FabricLineage: 'fabric:lineage',
  FabricEvidence: 'fabric:evidence',
  FabricGovernance: 'fabric:governance',
  FabricAnalytics: 'fabric:analytics',

  // ── P17 — Global AI Orchestration Platform (read-only coordination/routing layer) ──
  OrchestrationOverview: 'orchestration:overview',
  OrchestrationGoals: 'orchestration:goals',
  OrchestrationWorkforce: 'orchestration:workforce',
  OrchestrationCloud: 'orchestration:cloud',
  OrchestrationKnowledge: 'orchestration:knowledge',
  OrchestrationFlows: 'orchestration:flows',
  OrchestrationCoordination: 'orchestration:coordination',
  OrchestrationGovernance: 'orchestration:governance',

  // ── P18 — Enterprise Intelligence Network (read-only governed-intelligence exchange layer) ──
  NetworkOverview: 'network:overview',
  NetworkExchange: 'network:exchange',
  NetworkBenchmarks: 'network:benchmarks',
  NetworkInsights: 'network:insights',
  NetworkTrust: 'network:trust',
  NetworkOrganizations: 'network:organizations',
  NetworkCollective: 'network:collective',
  NetworkGovernance: 'network:governance',

  // ── P19 — Autonomous Enterprise Operations (read-only closed-loop operations layer) ──
  AutoOpsOverview: 'autonomousops:overview',
  AutoOpsPlans: 'autonomousops:plans',
  AutoOpsExecution: 'autonomousops:execution',
  AutoOpsRecovery: 'autonomousops:recovery',
  AutoOpsOptimization: 'autonomousops:optimization',
  AutoOpsIncidents: 'autonomousops:incidents',
  AutoOpsApprovals: 'autonomousops:approvals',
  AutoOpsMonitoring: 'autonomousops:monitoring',
  AutoOpsAnalytics: 'autonomousops:analytics',
  AutoOpsGovernance: 'autonomousops:governance',

  // ── P20 — NeuroPause Platform v2 (read-only commercial productization layer) ──
  CommercialOverview: 'commercial:overview',
  CommercialSubscription: 'commercial:subscription',
  CommercialLicensing: 'commercial:licensing',
  CommercialBilling: 'commercial:billing',
  CommercialMetering: 'commercial:metering',
  CommercialDeployment: 'commercial:deployment',
  CommercialCustomers: 'commercial:customers',
  CommercialAnalytics: 'commercial:analytics',
  CommercialReleases: 'commercial:releases',
  CommercialAdministration: 'commercial:administration',
  CommercialGovernance: 'commercial:governance',

  // ── Experience Program v1.0 — Decision-First Experience (read-only compression/summary layer) ──
  ExperienceHome: 'experience:home',
  ExperienceDecisions: 'experience:decisions',
  ExperienceSummaries: 'experience:summaries',
  ExperienceIntents: 'experience:intents',
  ExperienceGovernance: 'experience:governance',

  // ── Intent Experience Program v2.0 — Intent-Native Experience (read-only reprojection of P14 goals) ──
  IntentBoard: 'intent:board',
  IntentWorkspaces: 'intent:workspaces',
  IntentGovernance: 'intent:governance',

  EcosystemEventBroadcast: 'ecosystem:event',

  // ── P9 — Enterprise Marketplace (layer over the ecosystem marketplace) ──
  MarketplaceCatalog: 'marketplace:catalog',
  MarketplaceEntry: 'marketplace:entry',
  MarketplacePublishers: 'marketplace:publishers',
  MarketplaceTrust: 'marketplace:trust',
  MarketplacePlan: 'marketplace:plan',
  MarketplaceAnalytics: 'marketplace:analytics',
  MarketplacePolicyGet: 'marketplace:policy',
  MarketplacePolicySet: 'marketplace:policy.set',
  MarketplaceInstall: 'marketplace:install',
  MarketplaceEventBroadcast: 'marketplace:event',

  // ── Cloud & Federation · Cloud Platform (Phase 9 · Stage 1) ──
  CloudRegions: 'cloud:regions',
  CloudTenants: 'cloud:tenants.list',
  CloudTenantSummary: 'cloud:tenants.summary',
  CloudCreateTenant: 'cloud:tenants.create',
  CloudSetTenantStatus: 'cloud:tenants.setStatus',
  CloudProjects: 'cloud:projects.list',
  CloudCreateProject: 'cloud:projects.create',
  CloudDeleteProject: 'cloud:projects.delete',
  CloudTeams: 'cloud:teams.list',
  CloudCreateTeam: 'cloud:teams.create',
  CloudTenantWorkers: 'cloud:tenants.workers',
  CloudStorageIsolation: 'cloud:storage.isolation',
  CloudSsoConnections: 'cloud:identity.connections',
  CloudIdentitySummary: 'cloud:identity.summary',
  CloudCreateSso: 'cloud:identity.createConnection',
  CloudUpdateSso: 'cloud:identity.updateConnection',
  CloudDeleteSso: 'cloud:identity.deleteConnection',
  CloudTestSso: 'cloud:identity.testConnection',
  CloudScim: 'cloud:identity.scim',
  CloudSetScim: 'cloud:identity.setScim',
  CloudScimSync: 'cloud:identity.scimSync',
  CloudMfa: 'cloud:identity.mfa',
  CloudSetMfa: 'cloud:identity.setMfa',
  LiveSyncStatus: 'livesync:status',
  LiveSyncDetail: 'livesync:detail',
  LiveSyncNow: 'livesync:now',
  LiveSyncSetOnline: 'livesync:setOnline',
  LiveSyncSetActiveOrg: 'livesync:setActiveOrg',
  CloudDeployments: 'cloud:api.deployments',
  CloudApiSummary: 'cloud:api.summary',
  CloudRatePolicies: 'cloud:api.policies',
  CloudSetPolicyEnabled: 'cloud:api.setPolicyEnabled',
  CloudWebhooks: 'cloud:api.webhooks',
  CloudCreateWebhook: 'cloud:api.createWebhook',
  CloudSetWebhookStatus: 'cloud:api.setWebhookStatus',
  CloudDeleteWebhook: 'cloud:api.deleteWebhook',
  CloudTestWebhook: 'cloud:api.testWebhook',
  CloudPublicApis: 'cloud:api.publicApis',
  CloudAdminOverview: 'cloud:admin.overview',
  CloudAdminCompliance: 'cloud:admin.compliance',

  // ── P11 — Cloud Control Plane (management/orchestration rollup over the cloud subsystems) ──
  ControlPlaneOverview: 'cloud:cp.overview',
  ControlPlaneFleet: 'cloud:cp.fleet',
  ControlPlaneRegions: 'cloud:cp.regions',
  ControlPlaneTenants: 'cloud:cp.tenants',
  ControlPlaneDeployments: 'cloud:cp.deployments',
  ControlPlaneUsage: 'cloud:cp.usage',

  CloudEventBroadcast: 'cloud:event',

  // ── Cloud & Federation · Federation Platform (Phase 9 · Stage 2) ──
  FedOrgs: 'fed:runtime.orgs',
  FedSummary: 'fed:runtime.summary',
  FedInvitations: 'fed:runtime.invitations',
  FedInviteOrg: 'fed:runtime.invite',
  FedRespondInvite: 'fed:runtime.respondInvite',
  FedTrust: 'fed:runtime.trust',
  FedSetTrust: 'fed:runtime.setTrust',
  FedShared: 'fed:runtime.shared',
  FedShareResource: 'fed:runtime.share',
  FedRevokeShare: 'fed:runtime.revokeShare',
  FedArtifacts: 'fed:exchange.artifacts',
  FedExchangeSummary: 'fed:exchange.summary',
  FedPublishArtifact: 'fed:exchange.publish',
  FedPublishVersion: 'fed:exchange.publishVersion',
  FedRateArtifact: 'fed:exchange.rate',
  FedSetVerification: 'fed:exchange.setVerification',
  FedRollbackArtifact: 'fed:exchange.rollback',
  FedInstallArtifact: 'fed:exchange.install',
  FedVerifyVersion: 'fed:exchange.verifyVersion',
  FedScopeSummary: 'fed:marketplace.scopes',
  FedSetScope: 'fed:marketplace.setScope',
  FedPolicies: 'fed:gov.policies',
  FedGovSummary: 'fed:gov.summary',
  FedAddPolicy: 'fed:gov.addPolicy',
  FedSetPolicyEnabled: 'fed:gov.setPolicyEnabled',
  FedApprovals: 'fed:gov.approvals',
  FedResolveApproval: 'fed:gov.resolveApproval',
  FedAuditTrail: 'fed:gov.audit',
  FedCompliance: 'fed:gov.compliance',
  FedRecordAction: 'fed:gov.recordAction',
  FedObservability: 'fed:obs.overview',
  FedUsageSeries: 'fed:obs.usage',
  FedSecurityEvents: 'fed:obs.security',
  FedBackups: 'fed:dr.backups',
  FedReplicas: 'fed:dr.replicas',
  FedValidations: 'fed:dr.validations',
  FedContinuity: 'fed:dr.continuity',
  FedDrSummary: 'fed:dr.summary',
  FedCreateBackup: 'fed:dr.createBackup',
  FedRunValidation: 'fed:dr.runValidation',
  FedCheckReplication: 'fed:dr.checkReplication',
  FedAdminOverview: 'fed:admin.overview',
  FedScalability: 'fed:scalability.report',
  FedEventBroadcast: 'fed:event',

  // ── P10 — Federation Platform (intelligence/governance/integration layer over the federation runtime) ──
  FederationGraph: 'federation:graph',
  FederationTimeline: 'federation:timeline',
  FederationDirectory: 'federation:directory',
  FederationAnalytics: 'federation:analytics',
  FederationSearch: 'federation:search',
  FederationOverview: 'federation:overview',

  // ── application self-update (electron-updater) ──
  UpdateGetStatus: 'update:getStatus',
  UpdateCheckNow: 'update:checkNow',
  UpdateDownload: 'update:download',
  UpdateInstallOnQuit: 'update:installOnQuit',
  UpdateSetChannel: 'update:setChannel',
  UpdateEventBroadcast: 'update:event',

  // ── in-app help (Phase 8: bundled documentation) ──
  HelpOpenDoc: 'help:openDoc',
  HelpListDocs: 'help:listDocs',

  // ── release engineering: migration / backup / crash / diagnostics / recovery / support ──
  MigrationStatus: 'migration:status',
  MigrationRun: 'migration:run',
  BackupList: 'backup:list',
  BackupCreate: 'backup:create',
  BackupValidate: 'backup:validate',
  BackupRestore: 'backup:restore',
  BackupDelete: 'backup:delete',
  CrashGetStatus: 'crash:getStatus',
  CrashSetOptIn: 'crash:setOptIn',
  CrashExport: 'crash:export',
  CrashRecommendations: 'crash:recommendations',
  CrashReport: 'crash:report',
  FlagsGet: 'flags:get',
  FlagsSetOverride: 'flags:setOverride',
  FlagsClearOverride: 'flags:clearOverride',
  LicenseStatus: 'license:status',
  LicenseRefresh: 'license:refresh',
  OnboardingStatus: 'onboarding:status',
  OnboardingStart: 'onboarding:start',
  OnboardingCompleteStep: 'onboarding:completeStep',
  OnboardingDismiss: 'onboarding:dismiss',
  OnboardingReset: 'onboarding:reset',
  AiConfigGet: 'aiConfig:get',
  AiConfigHealth: 'aiConfig:health',
  AiConfigDetectOllama: 'aiConfig:detectOllama',
  AiConfigSetProvider: 'aiConfig:setProvider',
  AiConfigSetModel: 'aiConfig:setModel',
  AiConfigSetCredential: 'aiConfig:setCredential',
  AiConfigClearCredential: 'aiConfig:clearCredential',
  AiConfigTest: 'aiConfig:test',
  AiConfigMigrationStatus: 'aiConfig:migrationStatus',
  AiConfigMigrate: 'aiConfig:migrate',
  AiConfigResetToEnv: 'aiConfig:resetToEnv',
  FeedbackSubmit: 'feedback:submit',
  FeedbackList: 'feedback:list',
  FeedbackExport: 'feedback:export',
  FeedbackClear: 'feedback:clear',
  FeedbackExportToFile: 'feedback:exportToFile',
  PilotStatus: 'pilot:status',
  PilotSetEnabled: 'pilot:setEnabled',
  ReleaseDiagnosticsGet: 'releaseDiagnostics:get',
  ReleaseDiagnosticsExport: 'releaseDiagnostics:export',
  RecoverySafeModeStatus: 'recovery:safeModeStatus',
  RecoveryRun: 'recovery:run',
  SupportGenerateBundle: 'support:generateBundle',
  // P6 — Cloud & Infrastructure Control Plane (the Cloud Platform Center reads these; discovery is a manage op).
  InfraPlatforms: 'infra:platforms',
  InfraStats: 'infra:stats',
  InfraCapabilities: 'infra:capabilities',
  InfraResourceGraph: 'infra:resourceGraph',
  InfraResourceNeighbors: 'infra:resourceNeighbors',
  InfraDiscover: 'infra:discover',
  InfraActions: 'infra:actions',
  InfraAction: 'infra:action',
  InfraSearch: 'infra:search',
  InfraEventBroadcast: 'infra:event',
  // P7 — Enterprise Intelligence (read-only; RBAC-gated with intelligence:read via the SecureHandlerDef, mirroring
  // the infra: channels — hence an `intel:` namespace rather than `enterprise:`, which is reserved for the ERP
  // authz-gate registry).
  EnterpriseIntelReport: 'intel:report',
  EnterpriseIntelChangeImpact: 'intel:changeImpact',
  EnterpriseIntelRootCause: 'intel:rootCause',
  // Phase 6 Stage 6 — Enterprise Intelligence Layer (read-only; RBAC-gated with
  // intelligence:read via the SecureHandlerDef, the P7 `intel:` precedent). The
  // composed report / targeted root cause / health framework / predictions /
  // executive dashboard. Nothing here accepts an action.
  InsightReport: 'insight:report',
  InsightRootCause: 'insight:rootCause',
  InsightHealth: 'insight:health',
  InsightPredictions: 'insight:predictions',
  InsightDashboard: 'insight:dashboard',
  // Phase 6 Stage 7 — Enterprise Knowledge & Decision Platform (read-only;
  // RBAC-gated with knowledge:read via the SecureHandlerDef, the P16 `fabric:`
  // precedent). Inventory / relationship matrix + impact / decision lineage /
  // quality / standards / dashboard. Nothing here accepts an action.
  KbInventory: 'kb:inventory',
  KbMatrix: 'kb:matrix',
  // A7 — impact analysis was previously served by `kb:matrix` itself, branching on
  // an optional `assetId`: one channel, two unrelated response shapes. That made the
  // channel's response type unstateable (and meant `kb.impact()` called without an
  // assetId silently returned the relationship matrix typed as an impact analysis).
  // One channel, one shape.
  KbImpact: 'kb:impact',
  KbLineage: 'kb:lineage',
  KbQuality: 'kb:quality',
  KbStandards: 'kb:standards',
  KbDashboard: 'kb:dashboard',
  // Phase 6 Stage 8 — Enterprise Automation Platform (read-only; RBAC-gated
  // with autonomousops:read via the SecureHandlerDef, the P19 precedent).
  // Catalog / playbooks / compiled plan preview / policies / monitor /
  // dashboard. Nothing here accepts an action (D-6/D-9).
  ApCatalog: 'ap:catalog',
  ApPlaybooks: 'ap:playbooks',
  ApPlan: 'ap:plan',
  ApPolicies: 'ap:policies',
  ApMonitor: 'ap:monitor',
  ApDashboard: 'ap:dashboard',

  // ── Phase 6 Stage 9 — the Enterprise Operations Platform (read-only) ──
  // Service catalog / operational health / readiness+SLA+processes /
  // incident lifecycle / continuity / dashboard. Zero mutation surface.
  EopsCatalog: 'eops:catalog',
  EopsHealth: 'eops:health',
  EopsReadiness: 'eops:readiness',
  EopsIncidents: 'eops:incidents',
  EopsContinuity: 'eops:continuity',
  EopsDashboard: 'eops:dashboard',

  // ── Phase 6 Stage 10 — the Enterprise Strategy Platform (read-only) ──
  // Objectives / portfolio+value / planning / strategy health (capability map,
  // risks, alignment) / executive dashboard / board report. The `estrat:*`
  // namespace is DISTINCT from the P14 `strategy:*` cluster (which stays
  // untouched); both read under the same `strategy:read` permission.
  // Zero mutation surface.
  EstratObjectives: 'estrat:objectives',
  EstratPortfolio: 'estrat:portfolio',
  EstratPlanning: 'estrat:planning',
  EstratHealth: 'estrat:health',
  EstratDashboard: 'estrat:dashboard',
  EstratReport: 'estrat:report',

  // ── Phase 6 Stage 11 — the Enterprise Federation Platform (read-only) ──
  // Partners / trust evidence / organization exchange / shared layers /
  // executive dashboard / federation report. The `efed:*` namespace is
  // DISTINCT from the P9-S2 `fed:*` and P10 `federation:*` clusters (which
  // stay untouched); reads ride the same `federation:read` permission.
  // Zero mutation surface.
  EfedPartners: 'efed:partners',
  EfedTrust: 'efed:trust',
  EfedExchange: 'efed:exchange',
  EfedSharing: 'efed:sharing',
  EfedDashboard: 'efed:dashboard',
  EfedReport: 'efed:report',

  // ── Phase 6 Stage 12 — the Enterprise Analytics Platform (read-only) ──
  // Unified KPI catalog / recorded-window trends / forecast-capability
  // inventory / decision intelligence / executive analytics dashboard /
  // analytics report. Pure COMPOSITION over the existing analytics producers —
  // the `eana:*` namespace computes no analytics of its own. Reads ride the
  // existing `intelligence:read` permission (the Stage 6 insight cluster's).
  // Zero mutation surface.
  EanaKpis: 'eana:kpis',
  EanaTrends: 'eana:trends',
  EanaForecasts: 'eana:forecasts',
  EanaDecisions: 'eana:decisions',
  EanaDashboard: 'eana:dashboard',
  EanaReport: 'eana:report',

  // ── Phase 6 Stage 13 — the Enterprise Digital Twin Platform (read-only) ──
  // The additive COMPOSITION layer over the P15 Enterprise Digital Twin: the
  // runtime/execution twin, the Stage 6–12 platform twins, the enterprise
  // state-coverage map, the simulation inventory, the recorded-history view, the
  // platform dashboard and the executive report. `twin:*` (P15) stays
  // authoritative and untouched — `etwin:*` composes it and never replaces it.
  // Reads ride the EXISTING `twin:read` permission (P15's own; no new RBAC
  // scope). Zero mutation surface — there is no `etwin:*` write channel and
  // never will be.
  //
  // Seven channels, not the six the Stage 13 audit tabulated (§5.3). The audit
  // gave `etwin:dashboard` the cell "Composed dashboard + report" while every
  // sibling platform — `estrat:`, `efed:`, `eana:` — publishes the dashboard and
  // the report on SEPARATE channels, and `EtwinDashboard`/`EtwinReport` are two
  // distinct types. Serving both from one channel would have made this the only
  // composite payload in the table; leaving the report off IPC left it
  // unreachable from the renderer (FINDING #5). The seventh channel is the
  // sibling shape: a pure read, the same `EmptyRequest`, the same `twin:read`,
  // no new namespace and no new scope. The count changed; the architecture did
  // not.
  EtwinRuntime: 'etwin:runtime',
  EtwinPlatforms: 'etwin:platforms',
  EtwinCoverage: 'etwin:coverage',
  EtwinSimulation: 'etwin:simulation',
  EtwinHistory: 'etwin:history',
  EtwinDashboard: 'etwin:dashboard',
  EtwinReport: 'etwin:report',

  // ── Phase 6 — Universal Enterprise Data Plane ──────────────────────────
  // `dp:` is a fresh namespace: `data:` would collide with the enterprise
  // permission strings and `enterprise:` is reserved for the ERP authz gate.
  /** Identify a file and report what the plane can and cannot read. */
  DataPlaneInspect: 'dp:inspect',
  /** Full analysis → a reviewable import plan. Writes nothing. */
  DataPlaneAnalyze: 'dp:analyze',
  /** Re-read a previously produced plan summary. */
  DataPlanePlan: 'dp:plan',
  /** Execute an approved plan. The only mutating channel. */
  DataPlaneImport: 'dp:import',
  /** Durable import history. */
  DataPlaneHistory: 'dp:history',
  /** One import run by id. */
  DataPlaneRun: 'dp:run',
  /** Provenance for a single imported record. */
  DataPlaneProvenance: 'dp:provenance',
  /** Saved column→field mappings for a source signature. */
  DataPlaneMappings: 'dp:mappings',
  /** Persist a reviewer-confirmed mapping for reuse. */
  DataPlaneSaveMapping: 'dp:mapping.save',
  /** Forget a saved mapping. */
  DataPlaneForgetMapping: 'dp:mapping.forget',
  /** The canonical ontology (entities, fields, risk) for the review UI. */
  DataPlaneOntology: 'dp:ontology',
  /** Modules that hold importable/exportable records, with live counts. */
  DataPlaneExportable: 'dp:exportable',
  /** Write a module's records to a file the user chooses. */
  DataPlaneExport: 'dp:export',
  /** Declared cross-domain relationships + live resolution counts. */
  DataPlaneRelationshipOverview: 'dp:rel.overview',
  /** References awaiting a human decision. */
  DataPlaneRelationshipQueue: 'dp:rel.queue',
  /** Apply a reviewer's choice of target record. */
  DataPlaneRelationshipDecide: 'dp:rel.decide',
  /** Deliberately leave a reference unlinked. */
  DataPlaneRelationshipSkip: 'dp:rel.skip',
  /** Re-check every parked reference against the records that exist now. */
  DataPlaneRelationshipRetry: 'dp:rel.retry',
  /** The resolved links around one record, both directions. */
  DataPlaneRelationshipGraph: 'dp:rel.graph',

  // ── Medical Device Manufacturing Pack ──
  /** The pack manifest + taxonomies resolved for the active tenant. */
  MedicalDevicePack: 'md:pack',
  /** Products matched on code / name / family / category / material. */
  MedicalDeviceProductSearch: 'md:product.search',
  /** One product with its lots and its change history. */
  MedicalDeviceProductGet: 'md:product.get',
  /** Lot Center page: one view's lots plus every view's count. */
  MedicalDeviceLotList: 'md:lot.list',
  /** One lot with its immediate graph context and legal next states. */
  MedicalDeviceLotGet: 'md:lot.get',
  /** Create a lot — the only path that creates one. */
  MedicalDeviceLotCreate: 'md:lot.create',
  /** Move a lot through the lifecycle state machine. */
  MedicalDeviceLotTransition: 'md:lot.transition',
  /** Divide a lot into child lots, conserving quantity and lineage. */
  MedicalDeviceLotSplit: 'md:lot.split',
  /** Always refuses, with the reason merge is unsupported. */
  MedicalDeviceLotMerge: 'md:lot.merge',
  /** Draw quantity from a lot, optionally against a manufacturing order. */
  MedicalDeviceLotConsume: 'md:lot.consume',
  /** Record a lot's warehouse placement. */
  MedicalDeviceLotMove: 'md:lot.move',
  /** Record a lot leaving on a shipment, to a customer and/or order. */
  MedicalDeviceLotShip: 'md:lot.ship',
  /** Where did this go? */
  MedicalDeviceTraceForward: 'md:trace.forward',
  /** What went into this? */
  MedicalDeviceTraceBackward: 'md:trace.backward',

  // ── Private-First AI experience ──
  /** Set the AI mode (private_first / local_only / external). */
  AiConfigSetMode: 'ai:config.setMode',
  /** Grant or withdraw consent for external processing as a fallback. */
  AiConfigSetExternalConsent: 'ai:config.setExternalConsent',
  /** The live routing picture: mode, consent, per-route state, current plan. */
  AiRoutingStatus: 'ai:routing.status',
  /** Measured routing usage counters. Counts, never inventions. */
  AiRoutingUsage: 'ai:routing.usage',
  /** The first-run experience profile. */
  ExperienceProfileGet: 'xp:profile.get',
  /** Record a first-run decision (workspace type / completion / skip). */
  ExperienceProfileSet: 'xp:profile.set',
  /**
   * Clear the profile and return to first run.
   *
   * The service could always do this (it was built for QA) but nothing could
   * reach it, so a user who skipped setup had no way back — the product asked
   * its questions exactly once, forever. Audited: it discards user state.
   */
  ExperienceProfileReset: 'xp:profile.reset',
  // ── Decision Records + NeuroPause Hold (governance memory over consequential
  // actions). Reads are `governance:read`; resolving a hold is a governed act
  // and carries `governance:manage` + bridge audit. ──
  /** The Decision Record history — newest first. */
  DecisionRecordList: 'decisionRecord:list',
  /** One Decision Record plus every other decision on the same subject. */
  DecisionRecordGet: 'decisionRecord:get',
  /** Open holds + the resolved history, and whether assessment is live. */
  HoldList: 'hold:list',
  /** Resolve an open hold with an explicit outcome. */
  HoldResolve: 'hold:resolve',
  // ── Opportunity Center (Program 4). Findings are DERIVED on read, never
  // stored, so there is no "get" — only a list that recomputes. Reads carry
  // `procurement:read` because the findings are made of procurement records
  // and must not leak past the permission on their source; deciding and
  // executing carry `procurement:manage` + bridge audit. ──
  /** Recompute every opportunity from live records, with the data review. */
  OpportunityList: 'opportunity:list',
  /** Record what the user decided about a finding (accept, dismiss, …). */
  OpportunitySetStatus: 'opportunity:setStatus',
  /** Run an opportunity's plan — governed, verified, and never faked. */
  OpportunityExecute: 'opportunity:execute',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

/** Legacy auth/app invokable channels (handled by ipc/router). */
export const INVOKABLE_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.AuthGetStatus,
  IpcChannel.AuthLoginOAuth,
  IpcChannel.AuthLoginEmail,
  IpcChannel.AuthRegisterEmail,
  IpcChannel.AuthLogout,
  IpcChannel.AppGetInfo,
  IpcChannel.AppSetThemeSource,
  IpcChannel.AppGetThemeSource,
  IpcChannel.WindowClose,
  IpcChannel.RuntimeGetLoginAtStartup,
  IpcChannel.RuntimeSetLoginAtStartup,
  IpcChannel.WorkspaceCtxBootstrap,
  IpcChannel.WorkspaceCtxList,
  IpcChannel.WorkspaceCtxCreate,
  IpcChannel.WorkspaceCtxRename,
  IpcChannel.WorkspaceCtxDelete,
  IpcChannel.WorkspaceCtxSwitch,
  IpcChannel.WorkspaceCtxUpdateSnapshot,
];

/** Legacy broadcasts the renderer may subscribe to. */
export const SUBSCRIBABLE_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.AuthStatusChanged,
  IpcChannel.ThemeChanged,
  IpcChannel.MenuCommand,
  IpcChannel.TrayCommand,
];

/** Runtime-core invokable channels (handled by the secure bridge). */
export const RUNTIME_INVOKABLE_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.CatalogFeatured,
  IpcChannel.CatalogCollections,
  IpcChannel.CatalogSections,
  IpcChannel.CatalogSearch,
  IpcChannel.CatalogApp,
  IpcChannel.CatalogReviews,
  IpcChannel.CatalogDeveloper,
  IpcChannel.CatalogCategories,
  IpcChannel.CatalogBookmarks,
  IpcChannel.CatalogToggleBookmark,
  IpcChannel.CatalogSubmitReview,
  IpcChannel.CatalogRecommendations,
  IpcChannel.CatalogCheckUpdate,
  IpcChannel.OrgList,
  IpcChannel.OrgCreate,
  IpcChannel.OrgGet,
  IpcChannel.OrgUpdate,
  IpcChannel.OrgMembers,
  IpcChannel.OrgInvite,
  IpcChannel.OrgAcceptInvite,
  IpcChannel.OrgChangeRole,
  IpcChannel.OrgRemoveMember,
  IpcChannel.OrgWorkspaces,
  IpcChannel.OrgCreateWorkspace,
  IpcChannel.OrgUpdateWorkspace,
  IpcChannel.OrgDeleteWorkspace,
  IpcChannel.RegistryList,
  IpcChannel.RegistryGet,
  IpcChannel.RegistrySetFlags,
  IpcChannel.RegistryStats,
  IpcChannel.RegistryExport,
  IpcChannel.RegistryImport,
  IpcChannel.RegistryBackup,
  IpcChannel.NpsInstall,
  IpcChannel.NpsUninstall,
  IpcChannel.NpsUpdate,
  IpcChannel.NpsRollback,
  IpcChannel.NpsRepair,
  IpcChannel.NpsVerify,
  IpcChannel.NpsOperations,
  IpcChannel.NpsPause,
  IpcChannel.NpsResume,
  IpcChannel.NpsCancel,
  IpcChannel.RuntimeLaunch,
  IpcChannel.RuntimeStop,
  IpcChannel.RuntimeSuspend,
  IpcChannel.RuntimeResume,
  IpcChannel.RuntimeRestart,
  IpcChannel.RuntimeList,
  IpcChannel.RuntimeHealth,
  IpcChannel.PermsList,
  IpcChannel.PermsGrant,
  IpcChannel.PermsRevoke,
  IpcChannel.PluginsList,
  IpcChannel.PluginsGet,
  IpcChannel.PluginsInstall,
  IpcChannel.PluginsEnable,
  IpcChannel.PluginsDisable,
  IpcChannel.PluginsReload,
  IpcChannel.PluginsUpdate,
  IpcChannel.PluginsRemove,
  IpcChannel.PluginsGrant,
  IpcChannel.PluginsRevoke,
  IpcChannel.PluginsExtensions,
  IpcChannel.PluginsContributions,
  IpcChannel.PlatformEmit,
  IpcChannel.ExecutiveCenterSnapshot,
  IpcChannel.DecisionList,
  IpcChannel.DecisionCreateFromRecommendation,
  IpcChannel.DecisionSetStatus,
  IpcChannel.AutomationList,
  IpcChannel.AutomationSave,
  IpcChannel.AutomationSetStatus,
  IpcChannel.AutomationRemove,
  IpcChannel.AutomationRun,
  IpcChannel.AutomationMonitor,
  IpcChannel.AutomationHistory,
  IpcChannel.SystemHealthSnapshot,
  IpcChannel.SupervisorStatus,
  IpcChannel.LicenseReportHealth,
  IpcChannel.BillingCheckout,
  IpcChannel.DevicesRegister,
  IpcChannel.DevicesList,
  IpcChannel.DevicesRevoke,
  IpcChannel.DeviceReportHealth,
  IpcChannel.SupervisorHistory,
  IpcChannel.SupervisorRecover,
  IpcChannel.SupervisorSetPolicy,
  IpcChannel.ExecuteRun,
  IpcChannel.ExecuteSessions,
  IpcChannel.ExecuteHistory,
  IpcChannel.ExecuteCancel,
  IpcChannel.VoiceStatus,
  IpcChannel.VoiceTurn,
  IpcChannel.TimelineQuery,
  IpcChannel.TimelineStats,
  IpcChannel.TimelineExport,
  IpcChannel.DiagnosticsGet,
  IpcChannel.ConnectorsList,
  IpcChannel.ConnectorGet,
  IpcChannel.ConnectorStats,
  IpcChannel.ConnectorConnect,
  IpcChannel.ConnectorDisconnect,
  IpcChannel.ConnectorReconnect,
  IpcChannel.ConnectorRefresh,
  IpcChannel.ConnectorSync,
  IpcChannel.ConnectorHealthCheck,
  IpcChannel.ConnectorLogs,
  IpcChannel.ConnectorSyncState,
  IpcChannel.ConnectorControl,
  IpcChannel.ConnectorRuntime,
  IpcChannel.ConnectorInspect,
  IpcChannel.M365ActionList,
  IpcChannel.M365ActionExecute,
  IpcChannel.M365Draft,
  IpcChannel.UnifiedQuery,
  IpcChannel.UnifiedGet,
  IpcChannel.UnifiedCounts,
  IpcChannel.UnifiedSearch,
  IpcChannel.GraphCounts,
  IpcChannel.GraphNode,
  IpcChannel.GraphNodes,
  IpcChannel.GraphNeighbors,
  IpcChannel.GraphSubgraph,
  IpcChannel.GraphPath,
  IpcChannel.GraphHistory,
  IpcChannel.GraphRebuild,
  IpcChannel.MemoryRecall,
  IpcChannel.MemorySemanticRecall,
  IpcChannel.MemoryBackfill,
  IpcChannel.KnowledgeRelated,
  IpcChannel.KnowledgeTopics,
  IpcChannel.KnowledgeHealth,
  IpcChannel.WorkforceIntelligence,
  IpcChannel.MemoryGet,
  IpcChannel.MemoryRemember,
  IpcChannel.MemoryForget,
  IpcChannel.MemoryCounts,
  IpcChannel.MemoryRebuild,
  IpcChannel.ExecMemorySearch,
  IpcChannel.ExecMemoryForget,
  IpcChannel.ExecMemoryPin,
  IpcChannel.ExecMemoryResolve,
  IpcChannel.ExecMemoryAudit,
  IpcChannel.EnterpriseSearch,
  IpcChannel.EnterpriseTimelineQuery,
  IpcChannel.EnterpriseTimelineReplay,
  IpcChannel.EnterpriseTimelineStats,
  IpcChannel.EnterpriseTimelineExport,
  IpcChannel.BriefingGenerate,
  IpcChannel.RecommendationsGenerate,
  IpcChannel.FounderAsk,
  IpcChannel.FounderAskV2,
  IpcChannel.FounderSuggestions,
  IpcChannel.EngineeringAnalyze,
  IpcChannel.GovernanceList,
  IpcChannel.GovernanceTrace,
  IpcChannel.ContextTrace,
  IpcChannel.RelationshipTrace,
  IpcChannel.RelationshipPath,
  IpcChannel.WorkforceWorkers,
  IpcChannel.WorkforceWorkerGet,
  IpcChannel.WorkforceJobRun,
  IpcChannel.WorkforceJobs,
  IpcChannel.WorkforceJobGet,
  IpcChannel.WorkforceProposalApprove,
  IpcChannel.WorkforceProposalReject,
  IpcChannel.WorkforceWorkflowRun,
  IpcChannel.WorkforceWorkflowRuns,
  IpcChannel.WorkforceWorkflowResume,
  IpcChannel.WorkforceWorkflowCheckpoint,
  IpcChannel.WorkforceAudit,
  IpcChannel.WorkforcePolicies,
  IpcChannel.WorkforceDelegatePlan,
  IpcChannel.WorkforceInstalls,
  IpcChannel.WorkforceInstallGet,
  IpcChannel.WorkforceInstall,
  IpcChannel.WorkforceInstallUpdate,
  IpcChannel.WorkforceInstallEnable,
  IpcChannel.WorkforceInstallDisable,
  IpcChannel.WorkforceInstallRollback,
  IpcChannel.WorkforceUninstall,
  IpcChannel.EnterpriseOrgGet,
  IpcChannel.EnterpriseOrgCreateUnit,
  IpcChannel.EnterpriseOrgUpdateUnit,
  IpcChannel.EnterpriseOrgDeleteUnit,
  IpcChannel.EnterpriseOrgCreateUser,
  IpcChannel.EnterpriseOrgUpdateUser,
  IpcChannel.EnterpriseOrgDeleteUser,
  IpcChannel.EnterpriseOrgCreateRole,
  IpcChannel.EnterpriseOrgUpdateRole,
  IpcChannel.EnterpriseOrgDeleteRole,
  IpcChannel.EnterpriseWorkspaceList,
  IpcChannel.EnterpriseWorkspaceActive,
  IpcChannel.EnterpriseWorkspaceCreate,
  IpcChannel.EnterpriseWorkspaceSwitch,
  IpcChannel.EnterpriseGraph,
  IpcChannel.EnterpriseGraphNeighbors,
  IpcChannel.EnterpriseGovernanceConfig,
  IpcChannel.EnterpriseGovernanceCompliance,
  IpcChannel.EnterpriseGovernanceSetChain,
  IpcChannel.EnterpriseGovernanceSetRule,
  IpcChannel.EnterpriseGovernanceAudit,
  IpcChannel.EnterpriseDashboard,
  IpcChannel.EnterpriseProcessExplore,
  IpcChannel.EnterpriseProcessCase,
  IpcChannel.EnterpriseScheduleExplore,
  IpcChannel.EnterpriseExecutionExplore,
  IpcChannel.EnterpriseRelationshipExplore,
  IpcChannel.EnterpriseTrustExplore,
  IpcChannel.EnterpriseContext,
  IpcChannel.EnterpriseApiRequest,
  IpcChannel.EnterpriseApiRoutes,
  IpcChannel.EnterpriseApiOpenApi,
  IpcChannel.WebhookCreate,
  IpcChannel.WebhookList,
  IpcChannel.WebhookSetEnabled,
  IpcChannel.WebhookDelete,
  IpcChannel.WebhookDeliveries,
  IpcChannel.WebhookDeadLetters,
  IpcChannel.WebhookReplay,
  IpcChannel.WebhookStats,
  // AI Sandbox — Sandbox Core (S1)
  IpcChannel.SandboxWorkspaceList,
  IpcChannel.SandboxWorkspaceCreate,
  IpcChannel.SandboxWorkspaceUpdate,
  IpcChannel.SandboxWorkspaceDelete,
  IpcChannel.SandboxScenarioList,
  IpcChannel.SandboxScenarioGet,
  IpcChannel.SandboxScenarioCreate,
  IpcChannel.SandboxScenarioUpdate,
  IpcChannel.SandboxScenarioArchive,
  IpcChannel.SandboxScenarioVersionCreate,
  IpcChannel.SandboxScenarioVersions,
  IpcChannel.SandboxExecutionEnqueue,
  IpcChannel.SandboxExecutionGet,
  IpcChannel.SandboxExecutionHistory,
  IpcChannel.SandboxExecutionCancel,
  IpcChannel.SandboxExecutionTimeline,
  IpcChannel.SandboxQueueState,
  IpcChannel.SandboxArtifactList,
  IpcChannel.SandboxArtifactGet,
  IpcChannel.SandboxResultGet,
  IpcChannel.SandboxReportGet,
  IpcChannel.SandboxReportGenerate,
  IpcChannel.SandboxDatasetList,
  IpcChannel.SandboxDatasetCreate,
  IpcChannel.SandboxDatasetDelete,
  IpcChannel.SandboxDashboard,
  // AI Sandbox — Continuous Validation (S6 summary + P4 Validation Experience seams)
  IpcChannel.SandboxValidationSummary,
  IpcChannel.SandboxValidationDashboard,
  IpcChannel.SandboxValidationRun,
  IpcChannel.SandboxValidationRunGet,
  IpcChannel.SandboxValidationScheduleSet,
  IpcChannel.EnterprisePersonalizationGet,
  IpcChannel.EnterprisePersonalizationFavorite,
  IpcChannel.EnterprisePersonalizationRecent,
  IpcChannel.EnterprisePersonalizationClearRecents,
  IpcChannel.EnterprisePersonalizationSaveView,
  IpcChannel.EnterprisePersonalizationDeleteView,
  IpcChannel.EnterprisePersonalizationRenameView,
  IpcChannel.EnterpriseModulesList,
  IpcChannel.EnterpriseModuleList,
  IpcChannel.EnterpriseModuleGet,
  IpcChannel.EnterpriseModuleCreate,
  IpcChannel.EnterpriseModuleUpdate,
  IpcChannel.EnterpriseModuleSetStatus,
  IpcChannel.EnterpriseModuleDelete,
  IpcChannel.EnterpriseModuleSearch,
  IpcChannel.EnterpriseModuleSummarize,
  IpcChannel.EnterpriseModuleAction,
  IpcChannel.EnterpriseModuleLines,
  IpcChannel.EnterpriseModuleSetLines,
  IpcChannel.EnterpriseModuleApproval,
  IpcChannel.EnterpriseModuleApprove,

  // ── Ecosystem Platform ──
  IpcChannel.EcosystemDeveloperDashboard,
  IpcChannel.EcosystemDeveloperAccount,
  IpcChannel.EcosystemDeveloperSetPlan,
  IpcChannel.EcosystemKeysList,
  IpcChannel.EcosystemKeysCreate,
  IpcChannel.EcosystemKeysRevoke,
  IpcChannel.EcosystemKeysRotate,
  IpcChannel.EcosystemOAuthList,
  IpcChannel.EcosystemOAuthCreate,
  IpcChannel.EcosystemOAuthDelete,
  IpcChannel.EcosystemOAuthToken,
  IpcChannel.EcosystemOAuthRevokeToken,
  IpcChannel.EcosystemUsageAnalytics,
  IpcChannel.EcosystemSdks,
  IpcChannel.EcosystemMarketplaceList,
  IpcChannel.EcosystemMarketplaceDetail,
  IpcChannel.EcosystemMarketplaceStats,
  IpcChannel.EcosystemMarketplaceEvents,
  IpcChannel.EcosystemListingCreate,
  IpcChannel.EcosystemVersionCreate,
  IpcChannel.EcosystemListingSubmit,
  IpcChannel.EcosystemListingReview,
  IpcChannel.EcosystemListingPublish,
  IpcChannel.EcosystemListingRollback,
  IpcChannel.EcosystemListingInstall,
  IpcChannel.EcosystemListingRate,
  IpcChannel.EcosystemGatewayVersions,
  IpcChannel.EcosystemGatewayRequest,
  IpcChannel.EcosystemGatewayAudit,
  IpcChannel.EcosystemGatewayMetrics,
  IpcChannel.EcosystemBillingSummary,
  IpcChannel.EcosystemBillingPlans,
  IpcChannel.EcosystemBillingSetPlan,
  IpcChannel.EcosystemBillingInvoice,
  IpcChannel.EcosystemBillingSeats,
  IpcChannel.EcosystemBillingAssignSeat,
  IpcChannel.EcosystemBillingReleaseSeat,
  IpcChannel.EcosystemBillingLicenses,
  IpcChannel.EcosystemBillingPurchase,
  IpcChannel.EcosystemBillingPurchases,

  // ── Enterprise Ecosystem (Stage 2) ──
  IpcChannel.EcosystemInstallsList,
  IpcChannel.EcosystemInstallsSummary,
  IpcChannel.EcosystemInstall,
  IpcChannel.EcosystemInstallUpdate,
  IpcChannel.EcosystemInstallSetEnabled,
  IpcChannel.EcosystemUninstall,
  IpcChannel.EcosystemShareWorker,
  IpcChannel.EcosystemPacksList,
  IpcChannel.EcosystemPacksStats,
  IpcChannel.EcosystemPackPublish,
  IpcChannel.EcosystemPackImport,
  IpcChannel.EcosystemPackRemove,
  IpcChannel.EcosystemPartnersList,
  IpcChannel.EcosystemPartnersStats,
  IpcChannel.EcosystemAnalytics,

  // ── P12 — Developer Platform ──
  IpcChannel.DevPlatformOverview,
  IpcChannel.DevPlatformConsole,
  IpcChannel.DevPlatformSdks,
  IpcChannel.DevPlatformApis,
  IpcChannel.DevPlatformTemplates,
  IpcChannel.DevPlatformPublishing,
  IpcChannel.DevPlatformAnalytics,

  // ── P13 — Industry Solution Platform ──
  IpcChannel.IndustryOverview,
  IpcChannel.IndustrySuites,
  IpcChannel.IndustryKpis,
  IpcChannel.IndustryCompliance,
  IpcChannel.IndustryCollections,
  IpcChannel.IndustryReadiness,
  IpcChannel.IndustrySnapshot,

  // ── P14 — Autonomous Enterprise Intelligence ──
  IpcChannel.StrategyOverview,
  IpcChannel.StrategyGoals,
  IpcChannel.StrategyPlanning,
  IpcChannel.StrategyReasoning,
  IpcChannel.StrategyOptimization,
  IpcChannel.StrategySimulation,
  IpcChannel.StrategyDecisions,

  // ── P15 — Enterprise Digital Twin ──
  IpcChannel.TwinOverview,
  IpcChannel.TwinDomains,
  IpcChannel.TwinTopology,
  IpcChannel.TwinHealth,
  IpcChannel.TwinReplay,
  IpcChannel.TwinScenario,
  IpcChannel.TwinImpact,
  IpcChannel.TwinExecutive,

  // ── P16 — Enterprise Knowledge Fabric ──
  IpcChannel.FabricOverview,
  IpcChannel.FabricSources,
  IpcChannel.FabricRelationships,
  IpcChannel.FabricClassification,
  IpcChannel.FabricLineage,
  IpcChannel.FabricEvidence,
  IpcChannel.FabricGovernance,
  IpcChannel.FabricAnalytics,

  // ── P17 — Global AI Orchestration Platform ──
  IpcChannel.OrchestrationOverview,
  IpcChannel.OrchestrationGoals,
  IpcChannel.OrchestrationWorkforce,
  IpcChannel.OrchestrationCloud,
  IpcChannel.OrchestrationKnowledge,
  IpcChannel.OrchestrationFlows,
  IpcChannel.OrchestrationCoordination,
  IpcChannel.OrchestrationGovernance,

  // ── P18 — Enterprise Intelligence Network ──
  IpcChannel.NetworkOverview,
  IpcChannel.NetworkExchange,
  IpcChannel.NetworkBenchmarks,
  IpcChannel.NetworkInsights,
  IpcChannel.NetworkTrust,
  IpcChannel.NetworkOrganizations,
  IpcChannel.NetworkCollective,
  IpcChannel.NetworkGovernance,

  // ── P19 — Autonomous Enterprise Operations ──
  IpcChannel.AutoOpsOverview,
  IpcChannel.AutoOpsPlans,
  IpcChannel.AutoOpsExecution,
  IpcChannel.AutoOpsRecovery,
  IpcChannel.AutoOpsOptimization,
  IpcChannel.AutoOpsIncidents,
  IpcChannel.AutoOpsApprovals,
  IpcChannel.AutoOpsMonitoring,
  IpcChannel.AutoOpsAnalytics,
  IpcChannel.AutoOpsGovernance,

  // ── P20 — NeuroPause Platform v2 (commercial productization) ──
  IpcChannel.CommercialOverview,
  IpcChannel.CommercialSubscription,
  IpcChannel.CommercialLicensing,
  IpcChannel.CommercialBilling,
  IpcChannel.CommercialMetering,
  IpcChannel.CommercialDeployment,
  IpcChannel.CommercialCustomers,
  IpcChannel.CommercialAnalytics,
  IpcChannel.CommercialReleases,
  IpcChannel.CommercialAdministration,
  IpcChannel.CommercialGovernance,

  // ── Experience Program v1.0 — Decision-First Experience ──
  IpcChannel.ExperienceHome,
  IpcChannel.ExperienceDecisions,
  IpcChannel.ExperienceSummaries,
  IpcChannel.ExperienceIntents,
  IpcChannel.ExperienceGovernance,

  // ── Intent Experience Program v2.0 — Intent-Native Experience ──
  IpcChannel.IntentBoard,
  IpcChannel.IntentWorkspaces,
  IpcChannel.IntentGovernance,

  // ── P9 — Enterprise Marketplace ──
  IpcChannel.MarketplaceCatalog,
  IpcChannel.MarketplaceEntry,
  IpcChannel.MarketplacePublishers,
  IpcChannel.MarketplaceTrust,
  IpcChannel.MarketplacePlan,
  IpcChannel.MarketplaceAnalytics,
  IpcChannel.MarketplacePolicyGet,
  IpcChannel.MarketplacePolicySet,
  IpcChannel.MarketplaceInstall,

  // ── Cloud Platform (Stage 1) ──
  IpcChannel.CloudRegions,
  IpcChannel.CloudTenants,
  IpcChannel.CloudTenantSummary,
  IpcChannel.CloudCreateTenant,
  IpcChannel.CloudSetTenantStatus,
  IpcChannel.CloudProjects,
  IpcChannel.CloudCreateProject,
  IpcChannel.CloudDeleteProject,
  IpcChannel.CloudTeams,
  IpcChannel.CloudCreateTeam,
  IpcChannel.CloudTenantWorkers,
  IpcChannel.CloudStorageIsolation,
  IpcChannel.CloudSsoConnections,
  IpcChannel.CloudIdentitySummary,
  IpcChannel.CloudCreateSso,
  IpcChannel.CloudUpdateSso,
  IpcChannel.CloudDeleteSso,
  IpcChannel.CloudTestSso,
  IpcChannel.CloudScim,
  IpcChannel.CloudSetScim,
  IpcChannel.CloudScimSync,
  IpcChannel.CloudMfa,
  IpcChannel.CloudSetMfa,
  IpcChannel.LiveSyncStatus,
  IpcChannel.LiveSyncDetail,
  IpcChannel.LiveSyncNow,
  IpcChannel.LiveSyncSetOnline,
  IpcChannel.LiveSyncSetActiveOrg,
  IpcChannel.CloudDeployments,
  IpcChannel.CloudApiSummary,
  IpcChannel.CloudRatePolicies,
  IpcChannel.CloudSetPolicyEnabled,
  IpcChannel.CloudWebhooks,
  IpcChannel.CloudCreateWebhook,
  IpcChannel.CloudSetWebhookStatus,
  IpcChannel.CloudDeleteWebhook,
  IpcChannel.CloudTestWebhook,
  IpcChannel.CloudPublicApis,
  IpcChannel.CloudAdminOverview,
  IpcChannel.CloudAdminCompliance,

  // ── P11 — Cloud Control Plane ──
  IpcChannel.ControlPlaneOverview,
  IpcChannel.ControlPlaneFleet,
  IpcChannel.ControlPlaneRegions,
  IpcChannel.ControlPlaneTenants,
  IpcChannel.ControlPlaneDeployments,
  IpcChannel.ControlPlaneUsage,

  // ── Federation Platform (Stage 2) ──
  IpcChannel.FedOrgs,
  IpcChannel.FedSummary,
  IpcChannel.FedInvitations,
  IpcChannel.FedInviteOrg,
  IpcChannel.FedRespondInvite,
  IpcChannel.FedTrust,
  IpcChannel.FedSetTrust,
  IpcChannel.FedShared,
  IpcChannel.FedShareResource,
  IpcChannel.FedRevokeShare,
  IpcChannel.FedArtifacts,
  IpcChannel.FedExchangeSummary,
  IpcChannel.FedPublishArtifact,
  IpcChannel.FedPublishVersion,
  IpcChannel.FedRateArtifact,
  IpcChannel.FedSetVerification,
  IpcChannel.FedRollbackArtifact,
  IpcChannel.FedInstallArtifact,
  IpcChannel.FedVerifyVersion,
  IpcChannel.FedScopeSummary,
  IpcChannel.FedSetScope,
  IpcChannel.FedPolicies,
  IpcChannel.FedGovSummary,
  IpcChannel.FedAddPolicy,
  IpcChannel.FedSetPolicyEnabled,
  IpcChannel.FedApprovals,
  IpcChannel.FedResolveApproval,
  IpcChannel.FedAuditTrail,
  IpcChannel.FedCompliance,
  IpcChannel.FedRecordAction,
  IpcChannel.FedObservability,
  IpcChannel.FedUsageSeries,
  IpcChannel.FedSecurityEvents,
  IpcChannel.FedBackups,
  IpcChannel.FedReplicas,
  IpcChannel.FedValidations,
  IpcChannel.FedContinuity,
  IpcChannel.FedDrSummary,
  IpcChannel.FedCreateBackup,
  IpcChannel.FedRunValidation,
  IpcChannel.FedCheckReplication,
  IpcChannel.FedAdminOverview,
  IpcChannel.FedScalability,

  // ── P10 — Federation Platform ──
  IpcChannel.FederationGraph,
  IpcChannel.FederationTimeline,
  IpcChannel.FederationDirectory,
  IpcChannel.FederationAnalytics,
  IpcChannel.FederationSearch,
  IpcChannel.FederationOverview,
  // Phase 8 (8.14): in-app help over the bundled documentation set.
  IpcChannel.HelpListDocs,
  IpcChannel.HelpOpenDoc,
  IpcChannel.UpdateGetStatus,
  IpcChannel.UpdateCheckNow,
  IpcChannel.UpdateDownload,
  IpcChannel.UpdateInstallOnQuit,
  IpcChannel.UpdateSetChannel,
  IpcChannel.MigrationStatus,
  IpcChannel.MigrationRun,
  IpcChannel.BackupList,
  IpcChannel.BackupCreate,
  IpcChannel.BackupValidate,
  IpcChannel.BackupRestore,
  IpcChannel.BackupDelete,
  IpcChannel.CrashGetStatus,
  IpcChannel.CrashSetOptIn,
  IpcChannel.CrashExport,
  IpcChannel.CrashRecommendations,
  IpcChannel.CrashReport,
  IpcChannel.FlagsGet,
  IpcChannel.FlagsSetOverride,
  IpcChannel.FlagsClearOverride,
  IpcChannel.LicenseStatus,
  IpcChannel.LicenseRefresh,
  IpcChannel.OnboardingStatus,
  IpcChannel.OnboardingStart,
  IpcChannel.OnboardingCompleteStep,
  IpcChannel.OnboardingDismiss,
  IpcChannel.OnboardingReset,
  IpcChannel.AiConfigGet,
  IpcChannel.AiConfigHealth,
  IpcChannel.AiConfigDetectOllama,
  IpcChannel.AiConfigSetProvider,
  IpcChannel.AiConfigSetModel,
  IpcChannel.AiConfigSetCredential,
  IpcChannel.AiConfigClearCredential,
  IpcChannel.AiConfigTest,
  IpcChannel.AiConfigMigrationStatus,
  IpcChannel.AiConfigMigrate,
  IpcChannel.AiConfigResetToEnv,
  IpcChannel.FeedbackSubmit,
  IpcChannel.FeedbackList,
  IpcChannel.FeedbackExport,
  IpcChannel.FeedbackClear,
  IpcChannel.FeedbackExportToFile,
  IpcChannel.PilotStatus,
  IpcChannel.PilotSetEnabled,
  IpcChannel.ReleaseDiagnosticsGet,
  IpcChannel.ReleaseDiagnosticsExport,
  IpcChannel.RecoverySafeModeStatus,
  IpcChannel.RecoveryRun,
  IpcChannel.SupportGenerateBundle,
  // P6 — Cloud & Infrastructure Control Plane.
  IpcChannel.InfraPlatforms,
  IpcChannel.InfraStats,
  IpcChannel.InfraCapabilities,
  IpcChannel.InfraResourceGraph,
  IpcChannel.InfraResourceNeighbors,
  IpcChannel.InfraDiscover,
  IpcChannel.InfraActions,
  IpcChannel.InfraAction,
  IpcChannel.InfraSearch,
  // P7 — Enterprise Intelligence.
  IpcChannel.EnterpriseIntelReport,
  IpcChannel.EnterpriseIntelChangeImpact,
  IpcChannel.EnterpriseIntelRootCause,
  // Phase 6 Stage 6 — Enterprise Intelligence Layer (read-only insight cluster).
  IpcChannel.InsightReport,
  IpcChannel.InsightRootCause,
  IpcChannel.InsightHealth,
  IpcChannel.InsightPredictions,
  IpcChannel.InsightDashboard,
  // Phase 6 Stage 7 — Enterprise Knowledge & Decision Platform (read-only kb cluster).
  IpcChannel.KbInventory,
  IpcChannel.KbMatrix,
  IpcChannel.KbImpact,
  IpcChannel.KbLineage,
  IpcChannel.KbQuality,
  IpcChannel.KbStandards,
  IpcChannel.KbDashboard,
  // Phase 6 Stage 8 — Enterprise Automation Platform (read-only ap cluster).
  IpcChannel.ApCatalog,
  IpcChannel.ApPlaybooks,
  IpcChannel.ApPlan,
  IpcChannel.ApPolicies,
  IpcChannel.ApMonitor,
  IpcChannel.ApDashboard,
  IpcChannel.EopsCatalog,
  IpcChannel.EopsHealth,
  IpcChannel.EopsReadiness,
  IpcChannel.EopsIncidents,
  IpcChannel.EopsContinuity,
  IpcChannel.EopsDashboard,
  IpcChannel.EstratObjectives,
  IpcChannel.EstratPortfolio,
  IpcChannel.EstratPlanning,
  IpcChannel.EstratHealth,
  IpcChannel.EstratDashboard,
  IpcChannel.EstratReport,
  IpcChannel.EfedPartners,
  IpcChannel.EfedTrust,
  IpcChannel.EfedExchange,
  IpcChannel.EfedSharing,
  IpcChannel.EfedDashboard,
  IpcChannel.EfedReport,
  IpcChannel.EanaKpis,
  IpcChannel.EanaTrends,
  IpcChannel.EanaForecasts,
  IpcChannel.EanaDecisions,
  IpcChannel.EanaDashboard,
  IpcChannel.EanaReport,
  IpcChannel.EtwinRuntime,
  IpcChannel.EtwinPlatforms,
  IpcChannel.EtwinCoverage,
  IpcChannel.EtwinSimulation,
  IpcChannel.EtwinHistory,
  IpcChannel.EtwinDashboard,
  IpcChannel.EtwinReport,
  // Phase 6 Stage 4 — Workspace Assistant.
  IpcChannel.AssistantAsk,
  IpcChannel.AssistantConversations,
  IpcChannel.AssistantConversationGet,
  IpcChannel.AssistantConversationSave,
  IpcChannel.AssistantConversationDelete,
  IpcChannel.AssistantConversationBranch,
  IpcChannel.AssistantPlanDecide,
  IpcChannel.AssistantCancel,
  // Phase 6 Stage 5 — Notification Inbox + delivery preferences.
  IpcChannel.NotificationsList,
  IpcChannel.NotificationsMarkRead,
  IpcChannel.NotificationsPrefsGet,
  IpcChannel.NotificationsPrefsSet,
  // Mobile M1-03 — Companion gateway management (Settings pane).
  IpcChannel.CompanionStatus,
  IpcChannel.CompanionDevices,
  IpcChannel.CompanionEnable,
  IpcChannel.CompanionRevoke,
  IpcChannel.CompanionPairingQr,

  // ── Phase 6 — Universal Enterprise Data Plane ──
  IpcChannel.DataPlaneInspect,
  IpcChannel.DataPlaneAnalyze,
  IpcChannel.DataPlanePlan,
  IpcChannel.DataPlaneImport,
  IpcChannel.DataPlaneHistory,
  IpcChannel.DataPlaneRun,
  IpcChannel.DataPlaneProvenance,
  IpcChannel.DataPlaneMappings,
  IpcChannel.DataPlaneSaveMapping,
  IpcChannel.DataPlaneForgetMapping,
  IpcChannel.DataPlaneOntology,
  IpcChannel.DataPlaneExportable,
  IpcChannel.DataPlaneExport,
  IpcChannel.DataPlaneRelationshipOverview,
  IpcChannel.DataPlaneRelationshipQueue,
  IpcChannel.DataPlaneRelationshipDecide,
  IpcChannel.DataPlaneRelationshipSkip,
  IpcChannel.DataPlaneRelationshipRetry,
  IpcChannel.DataPlaneRelationshipGraph,
  // ── Medical Device Manufacturing Pack ──
  IpcChannel.MedicalDevicePack,
  IpcChannel.MedicalDeviceProductSearch,
  IpcChannel.MedicalDeviceProductGet,
  IpcChannel.MedicalDeviceLotList,
  IpcChannel.MedicalDeviceLotGet,
  IpcChannel.MedicalDeviceLotCreate,
  IpcChannel.MedicalDeviceLotTransition,
  IpcChannel.MedicalDeviceLotSplit,
  IpcChannel.MedicalDeviceLotMerge,
  IpcChannel.MedicalDeviceLotConsume,
  IpcChannel.MedicalDeviceLotMove,
  IpcChannel.MedicalDeviceLotShip,
  IpcChannel.MedicalDeviceTraceForward,
  IpcChannel.MedicalDeviceTraceBackward,
  // ── Private-First AI experience ──
  IpcChannel.AiConfigSetMode,
  IpcChannel.AiConfigSetExternalConsent,
  IpcChannel.AiRoutingStatus,
  IpcChannel.AiRoutingUsage,
  IpcChannel.ExperienceProfileGet,
  IpcChannel.ExperienceProfileSet,
  IpcChannel.ExperienceProfileReset,
  // ── Decision Records + NeuroPause Hold ──
  IpcChannel.DecisionRecordList,
  IpcChannel.DecisionRecordGet,
  IpcChannel.HoldList,
  IpcChannel.HoldResolve,
  // ── Opportunity Center ──
  IpcChannel.OpportunityList,
  IpcChannel.OpportunitySetStatus,
  IpcChannel.OpportunityExecute,
];

/** Runtime-core broadcasts. */
export const RUNTIME_BROADCAST_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.RuntimeEventBroadcast,
  IpcChannel.RuntimeOpenApp,
  IpcChannel.NpsProgress,
  IpcChannel.PluginEventBroadcast,
  IpcChannel.PlatformEventBroadcast,
  IpcChannel.ConnectorEventBroadcast,
  // Main broadcasts live sync snapshots on this channel (unified/sync/index.ts); the Connector Health
  // dashboard + Entra panel subscribe to it, so it must be on the subscribe allowlist too (it is also an
  // invokable request channel for the initial pull).
  IpcChannel.ConnectorSyncState,
  IpcChannel.ConnectorLifecycleBroadcast,
  IpcChannel.UnifiedEventBroadcast,
  IpcChannel.GraphEventBroadcast,
  IpcChannel.MemoryEventBroadcast,
  IpcChannel.EnterpriseTimelineEventBroadcast,
  IpcChannel.WorkforceEventBroadcast,
  IpcChannel.EnterpriseEventBroadcast,
  IpcChannel.EnterpriseModuleEventBroadcast,
  IpcChannel.EcosystemEventBroadcast,
  IpcChannel.MarketplaceEventBroadcast,
  IpcChannel.CloudEventBroadcast,
  IpcChannel.FedEventBroadcast,
  IpcChannel.UpdateEventBroadcast,
  IpcChannel.WebhookEventBroadcast,
  IpcChannel.SandboxEventBroadcast,
  IpcChannel.InfraEventBroadcast,
  // Phase 6 Stage 4 — Workspace Assistant streaming progress.
  IpcChannel.AssistantEventBroadcast,
  // Phase 6 Stage 5 — Notification Inbox refresh signal.
  IpcChannel.NotificationsEventBroadcast,
  // Mobile M1-03 — Companion gateway status/device refresh signal.
  IpcChannel.CompanionEventBroadcast,
];

/** The full set the preload bridge permits (legacy + runtime core). */
export const ALL_INVOKABLE_CHANNELS: readonly IpcChannelName[] = [
  ...INVOKABLE_CHANNELS,
  ...RUNTIME_INVOKABLE_CHANNELS,
];

export const ALL_SUBSCRIBABLE_CHANNELS: readonly IpcChannelName[] = [
  ...SUBSCRIBABLE_CHANNELS,
  ...RUNTIME_BROADCAST_CHANNELS,
];

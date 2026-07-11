/**
 * Strongly-typed renderer client over the preload bridge. Components import
 * `ipc` and get full type-safety; the untyped channel/payload plumbing is
 * contained entirely here. The renderer never talks to the backend directly —
 * every catalog/registry/NPS/runtime call goes through these channels into the
 * main process.
 */
import type { WorkforceIntelligence } from '@renderer/workforce/intelligenceTypes';
import { perfRecorder } from '@renderer/lib/perf/perfRecorder';
import {
  IpcChannel,
  type AppInfo,
  type AuthProviderId,
  type AuthStatus,
  type MenuCommandPayload,
  type TrayCommandPayload,
  type ThemeSource,
  type CategorySummary,
  type CollectionDto,
  type FeaturedEntry,
  type InstallationDto,
  type Paginated,
  type ReviewDto,
  type StoreAppCard,
  type StoreAppDetail,
  type StoreSearchParams,
  type UpdateCheck,
  type RegistryEntryDto,
  type RegistryStats,
  type NpsOperationDto,
  type NpsProgressEvent,
  type InstallResultDto,
  type RuntimeInstanceDto,
  type RuntimeEvent,
  type OpenAppRequest,
  type PermissionGrant,
  type RuntimePermissionKey,
  type PluginDto,
  type PluginContribution,
  type PluginHostEvent,
  type PluginInstallResult,
  type PluginSurfaceKind,
  type PlatformEvent,
  type TimelineQuery,
  type TimelinePage,
  type TimelineStats,
  type TimelineExport,
  type DiagnosticsReport,
  type ConnectorDto,
  type ConnectorStats,
  type ConnectorEvent,
  type ConnectorLogEntry,
  type ConnectorConnectResult,
  type ConnectorActionResult,
  type ConnectorSyncSnapshot,
  type ConnectorWriteActionInfo,
  type ConnectorWriteResult,
  type UnifiedEntity,
  type UnifiedQuery,
  type UnifiedQueryResult,
  type UnifiedCounts,
  type SearchQuery,
  type SearchResult,
  type GraphCounts,
  type GraphNode,
  type GraphNodesQuery,
  type GraphNeighbors,
  type GraphNeighborsQuery,
  type GraphSubgraph,
  type GraphSubgraphQuery,
  type GraphPathQuery,
  type GraphPathResult,
  type GraphEdgeEvent,
  type GraphHistoryQuery,
  type MemoryItem,
  type MemoryRecallQuery,
  type MemoryRecallResult,
  type MemoryWriteInput,
  type MemoryCounts,
  type ExecutiveMemoryQuery,
  type ExecutiveMemoryView,
  type ExecutiveMemoryStatus,
  type MemoryAuditAction,
  type MemoryAuditPage,
  type EnterpriseSearchQuery,
  type EnterpriseSearchResult,
  type EnterpriseTimelineQuery,
  type EnterpriseTimelinePage,
  type TimelineReplayQuery,
  type TimelineReplay,
  type EnterpriseTimelineStats,
  type EnterpriseTimelineExport,
  type BriefingPeriod,
  type Briefing,
  type ExecutiveCenterSnapshot,
  type ExecutiveDecision,
  type AutomationRule,
  type AutomationMonitor,
  type AutomationRunRecord,
  type SystemHealthSnapshot,
  type VoiceRuntimeState,
  type SupervisorStatus,
  type RecoveryRecord,
  type SupervisedSubsystem,
  type RecoveryPolicy,
  type ExecutionRequest,
  type ExecutionSession,
  type ExecutionStats,
  type VoiceResponse,
  type RecommendationQuery,
  type RecommendationSet,
  type FounderAnswer,
  type FounderResponse,
  type FounderSuggestedQuestion,
  type EngineeringAnalysis,
  type GovernanceTraceList,
  type GovernanceTrace,
  type ContextTrace,
  type RelationshipTrace,
  type RelationshipPath,
  type WorkerSummary,
  type Worker,
  type Job,
  type JobPage,
  type JobStatus,
  type WorkflowSpec,
  type WorkflowRun,
  type WorkforceAuditPage,
  type PolicyRule,
  type VerdictDecision,
  type DeveloperDashboard,
  type DeveloperAccount,
  type DeveloperAnalytics,
  type PlanTier,
  type ApiKey,
  type ApiKeyWithSecret,
  type ApiScope,
  type OAuthApplication,
  type OAuthApplicationWithSecret,
  type OAuthGrantType,
  type SdkArtifact,
  type MarketplaceListing,
  type ListingDetail,
  type MarketplaceStats,
  type SubmissionEvent,
  type ListingKind,
  type ListingPricing,
  type ListingManifest,
  type ListingVersion,
  type ReviewDecision,
  type ApiVersion,
  type ApiVersionInfo,
  type GatewayDecision,
  type GatewayAuditEntry,
  type GatewayMetrics,
  type BillingSummary,
  type Plan,
  type Invoice,
  type SeatAssignment,
  type License,
  type MarketplacePurchase,
  type Installation,
  type InstallSummary,
  type ExchangePack,
  type ExchangeStats,
  type PackKind,
  type PackItem,
  type Partner,
  type PartnerStats,
  type EcosystemAnalytics,
  // Release engineering (Increment 2 · Stage 2)
  type ReleaseDiagnostics,
  type CrashStatus,
  type CrashRecord,
  type RecoveryRecommendation,
  type MigrationStatus,
  type MigrationReport,
  type BackupInfo,
  type BackupValidation,
  type RestoreResult,
  type RecoveryActionResult,
  type SafeModeState,
  type SupportBundleInfo,
  type MaintenanceDomain,
  type RecoveryAction,
  type CloudOrganizationSummary,
  type CloudOrganization,
  type CloudMembership,
  type CloudWorkspace,
  type CloudOrgCreateResult,
  type CloudInviteResult,
  type CloudOrgRole,
} from '@neuropause/shared';
import type {
  Organization,
  OrgUnit,
  OrgRole,
  OrgUser,
  OrgUnitKind,
  OrgUserStatus,
  EnterprisePermission,
  Workspace,
  WorkspaceSummary,
  OrgGraph,
  OrgGraphNeighbors,
  GovernanceConfig,
  ComplianceFinding,
  EnterpriseAuditEntry,
  ExecutiveSnapshot,
  EnterpriseModuleSummary,
  EnterpriseEntity,
  EnterpriseRecordInput,
  EnterpriseRecordStatus,
  EnterpriseModuleMutationResult,
  EnterpriseModuleActionResult,
  EnterpriseModuleEvent,
  EnterpriseRecordSummary,
  ProcessExplorerModel,
  ProcessExplorerFilter,
  ProcessCaseDetail,
  ScheduleExploreModel,
  ExecutionConsoleModel,
  RelationshipGraphModel,
  EnterpriseTrustModel,
  EnterpriseContext,
  PersonalizationState,
} from '@neuropause/shared';

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

export interface ThemeChangedPayload {
  source: ThemeSource;
}

type Items<T> = { items: T[] };

const rawInvoke = window.neuropause.invoke;
/**
 * The IPC entrypoint every namespace below uses. Wrapped to record REAL per-call round-trip latency and
 * the in-flight count into perfRecorder (which feeds the runtime Performance overlay + Diagnostics). The
 * wrapper is behavior-preserving: it returns the original promise unchanged, so all `as Promise<T>` casts
 * and error propagation stay identical — it only observes timing on a detached branch.
 */
const invoke: typeof rawInvoke = (channel, payload) => {
  const settle = perfRecorder.ipcStart(String(channel));
  const promise = rawInvoke(channel, payload);
  promise.then(settle, settle);
  return promise;
};
import type {
  CloudRegion,
  CloudRegionId,
  CloudTenant,
  CloudProject,
  CloudTeam,
  TenantWorker,
  StorageIsolation,
  TenantSummary,
  TenantTier,
  TenantStatus,
  SsoConnection,
  SsoProtocol,
  SsoStatus,
  ScimConfig,
  MfaPolicy,
  MfaMethod,
  IdentitySummary,
  FederationResult,
  SyncDomain,
  SyncDomainState,
  SyncSummary,
  SyncConflict,
  LiveSyncStatus,
  FeatureFlagState,
  FeatureFlagKey,
  UpdateStatus,
  UpdateChannel,
  UpdateEvent,
  LicenseValidationStatus,
  LicenseState,
  BillingPlanId,
  Device,
  DeviceTrustStatus,
  OnboardingStatus,
  OnboardingStepId,
  FeedbackCategory,
  FeedbackEntry,
  FeedbackExport,
  PilotStatus,
  SyncResult,
  ApiDeployment,
  CloudRateLimitPolicy,
  WebhookEndpoint,
  WebhookStatus,
  PublicApi,
  ApiPlatformSummary,
  AdminOverview,
  ComplianceReport,
} from '@neuropause/shared';

import type {
  FederatedOrg,
  FederationSummary,
  OrgInvitation,
  TrustRelationship,
  SharedResource,
  TrustLevel,
  SharedResourceKind,
  ShareAccess,
  ExchangeArtifact,
  ExchangeSummary,
  ExchangeKind,
  ExchangeScope,
  VerificationStatus,
  MarketplaceScopeSummary,
  FedPolicy,
  FedPolicyScope,
  FedPolicyEffect,
  GlobalGovSummary,
  DelegatedApproval,
  FedAuditEntry,
  FedComplianceRule,
  FedActionEvaluation,
  ObservabilityOverview,
  UsagePoint,
  SecurityEvent,
  Backup,
  BackupScope,
  ReplicaState,
  RecoveryValidation,
  ContinuityPosture,
  DrSummary,
  FedAdminOverview,
  ScalabilityReport,
} from '@neuropause/shared';

const subscribe = window.neuropause.subscribe;

export const ipc = {
  auth: {
    getStatus: () => invoke(IpcChannel.AuthGetStatus) as Promise<AuthStatus>,
    loginOAuth: (provider: OAuthProviderId) =>
      invoke(IpcChannel.AuthLoginOAuth, { provider }) as Promise<AuthStatus>,
    loginEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthLoginEmail, { email, password }) as Promise<AuthStatus>,
    registerEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthRegisterEmail, { email, password }) as Promise<AuthStatus>,
    logout: () => invoke(IpcChannel.AuthLogout) as Promise<AuthStatus>,
    onStatusChanged: (cb: (status: AuthStatus) => void) =>
      subscribe(IpcChannel.AuthStatusChanged, (p) => cb(p as AuthStatus)),
  },
  app: {
    getInfo: () => invoke(IpcChannel.AppGetInfo) as Promise<AppInfo>,
    getThemeSource: () => invoke(IpcChannel.AppGetThemeSource) as Promise<ThemeSource>,
    setThemeSource: (source: ThemeSource) =>
      invoke(IpcChannel.AppSetThemeSource, { source }) as Promise<ThemeSource>,
    onThemeChanged: (cb: (payload: ThemeChangedPayload) => void) =>
      subscribe(IpcChannel.ThemeChanged, (p) => cb(p as ThemeChangedPayload)),
    closeWindow: () => invoke(IpcChannel.WindowClose) as Promise<void>,
  },
  menu: {
    onCommand: (cb: (payload: MenuCommandPayload) => void) =>
      subscribe(IpcChannel.MenuCommand, (p) => cb(p as MenuCommandPayload)),
  },
  tray: {
    /** Subscribe to tray runtime commands (start/pause listening). V4.1. */
    onCommand: (cb: (payload: TrayCommandPayload) => void) =>
      subscribe(IpcChannel.TrayCommand, (p) => cb(p as TrayCommandPayload)),
  },

  /* ── Secure Catalog (proxied to the Store API in the main process) ── */
  catalog: {
    featured: () => invoke(IpcChannel.CatalogFeatured) as Promise<Items<FeaturedEntry>>,
    collections: () => invoke(IpcChannel.CatalogCollections) as Promise<Items<CollectionDto>>,
    sections: (key: string, page?: number, pageSize?: number) =>
      invoke(IpcChannel.CatalogSections, { key, page, pageSize }) as Promise<
        Paginated<StoreAppCard>
      >,
    search: (params: StoreSearchParams) =>
      invoke(IpcChannel.CatalogSearch, params) as Promise<Paginated<StoreAppCard>>,
    app: (slug: string) => invoke(IpcChannel.CatalogApp, { slug }) as Promise<StoreAppDetail>,
    reviews: (slug: string, page?: number, pageSize?: number) =>
      invoke(IpcChannel.CatalogReviews, { slug, page, pageSize }) as Promise<Paginated<ReviewDto>>,
    developer: (slug: string) => invoke(IpcChannel.CatalogDeveloper, { slug }) as Promise<unknown>,
    categories: () => invoke(IpcChannel.CatalogCategories) as Promise<Items<CategorySummary>>,
    bookmarks: () => invoke(IpcChannel.CatalogBookmarks) as Promise<Items<StoreAppCard>>,
    toggleBookmark: (slug: string, bookmarked: boolean) =>
      invoke(IpcChannel.CatalogToggleBookmark, { slug, bookmarked }) as Promise<{
        bookmarked: boolean;
      }>,
    submitReview: (slug: string, body: { rating: number; title?: string; body?: string }) =>
      invoke(IpcChannel.CatalogSubmitReview, { slug, ...body }) as Promise<ReviewDto>,
    recommendations: () =>
      invoke(IpcChannel.CatalogRecommendations) as Promise<Items<StoreAppCard>>,
    checkUpdate: (slug: string) =>
      invoke(IpcChannel.CatalogCheckUpdate, { slug }) as Promise<UpdateCheck>,
  },

  /* ── Cloud Organizations ── */
  org: {
    list: () => invoke(IpcChannel.OrgList) as Promise<CloudOrganizationSummary[]>,
    create: (body: { name: string; slug?: string }) =>
      invoke(IpcChannel.OrgCreate, body) as Promise<CloudOrgCreateResult>,
    get: (orgId: string) => invoke(IpcChannel.OrgGet, { orgId }) as Promise<CloudOrganization>,
    update: (orgId: string, name: string) =>
      invoke(IpcChannel.OrgUpdate, { orgId, name }) as Promise<CloudOrganization>,
    members: (orgId: string) =>
      invoke(IpcChannel.OrgMembers, { orgId }) as Promise<CloudMembership[]>,
    invite: (orgId: string, email: string, role: CloudOrgRole) =>
      invoke(IpcChannel.OrgInvite, { orgId, email, role }) as Promise<CloudInviteResult>,
    acceptInvite: (token: string) =>
      invoke(IpcChannel.OrgAcceptInvite, { token }) as Promise<CloudMembership>,
    changeRole: (orgId: string, membershipId: string, role: CloudOrgRole) =>
      invoke(IpcChannel.OrgChangeRole, { orgId, membershipId, role }) as Promise<CloudMembership>,
    removeMember: (orgId: string, membershipId: string) =>
      invoke(IpcChannel.OrgRemoveMember, { orgId, membershipId }) as Promise<void>,
    workspaces: (orgId: string) =>
      invoke(IpcChannel.OrgWorkspaces, { orgId }) as Promise<CloudWorkspace[]>,
    createWorkspace: (orgId: string, name: string) =>
      invoke(IpcChannel.OrgCreateWorkspace, { orgId, name }) as Promise<CloudWorkspace>,
    updateWorkspace: (orgId: string, workspaceId: string, name: string) =>
      invoke(IpcChannel.OrgUpdateWorkspace, {
        orgId,
        workspaceId,
        name,
      }) as Promise<CloudWorkspace>,
    deleteWorkspace: (orgId: string, workspaceId: string) =>
      invoke(IpcChannel.OrgDeleteWorkspace, { orgId, workspaceId }) as Promise<void>,
  },

  /* ── Local Application Registry ── */
  registry: {
    list: () => invoke(IpcChannel.RegistryList) as Promise<RegistryEntryDto[]>,
    get: (slug: string) =>
      invoke(IpcChannel.RegistryGet, { slug }) as Promise<RegistryEntryDto | null>,
    setFlags: (slug: string, flags: { pinned?: boolean; favorite?: boolean }) =>
      invoke(IpcChannel.RegistrySetFlags, { slug, ...flags }) as Promise<RegistryEntryDto | null>,
    stats: () => invoke(IpcChannel.RegistryStats) as Promise<RegistryStats>,
    export: () => invoke(IpcChannel.RegistryExport) as Promise<{ data: string }>,
    import: (data: string) =>
      invoke(IpcChannel.RegistryImport, { data }) as Promise<{ count: number }>,
    backup: () => invoke(IpcChannel.RegistryBackup) as Promise<{ path: string }>,
  },

  /* ── NeuroPause Package Service ── */
  nps: {
    install: (req: {
      slug: string;
      channel?: string;
      grantedPermissions?: RuntimePermissionKey[];
      installLocation?: string;
    }) => invoke(IpcChannel.NpsInstall, req) as Promise<InstallResultDto>,
    uninstall: (slug: string) =>
      invoke(IpcChannel.NpsUninstall, { slug }) as Promise<{ ok: boolean; message: string | null }>,
    update: (slug: string) => invoke(IpcChannel.NpsUpdate, { slug }) as Promise<InstallResultDto>,
    rollback: (slug: string) =>
      invoke(IpcChannel.NpsRollback, { slug }) as Promise<{ ok: boolean; message: string | null }>,
    repair: (slug: string) =>
      invoke(IpcChannel.NpsRepair, { slug }) as Promise<{ ok: boolean; message: string | null }>,
    verify: (slug: string) =>
      invoke(IpcChannel.NpsVerify, { slug }) as Promise<{ ok: boolean; reason: string | null }>,
    operations: () => invoke(IpcChannel.NpsOperations) as Promise<NpsOperationDto[]>,
    pause: (operationId: string) =>
      invoke(IpcChannel.NpsPause, { operationId }) as Promise<{ ok: boolean }>,
    resume: (operationId: string) =>
      invoke(IpcChannel.NpsResume, { operationId }) as Promise<{ ok: boolean }>,
    cancel: (operationId: string) =>
      invoke(IpcChannel.NpsCancel, { operationId }) as Promise<{ ok: boolean }>,
    onProgress: (cb: (e: NpsProgressEvent) => void) =>
      subscribe(IpcChannel.NpsProgress, (p) => cb(p as NpsProgressEvent)),
  },

  /* ── Runtime ── */
  runtime: {
    launch: (slug: string) =>
      invoke(IpcChannel.RuntimeLaunch, { slug }) as Promise<RuntimeInstanceDto>,
    stop: (instanceId: string) =>
      invoke(IpcChannel.RuntimeStop, { instanceId }) as Promise<{ ok: boolean }>,
    /** Launch-at-login preference (V4.2). */
    getLoginAtStartup: () =>
      invoke(IpcChannel.RuntimeGetLoginAtStartup) as Promise<{ enabled: boolean }>,
    setLoginAtStartup: (enabled: boolean) =>
      invoke(IpcChannel.RuntimeSetLoginAtStartup, { enabled }) as Promise<{ enabled: boolean }>,
    suspend: (instanceId: string) =>
      invoke(IpcChannel.RuntimeSuspend, { instanceId }) as Promise<RuntimeInstanceDto>,
    resume: (instanceId: string) =>
      invoke(IpcChannel.RuntimeResume, { instanceId }) as Promise<RuntimeInstanceDto>,
    restart: (instanceId: string) =>
      invoke(IpcChannel.RuntimeRestart, { instanceId }) as Promise<RuntimeInstanceDto>,
    list: () => invoke(IpcChannel.RuntimeList) as Promise<RuntimeInstanceDto[]>,
    health: (instanceId?: string) =>
      invoke(IpcChannel.RuntimeHealth, { instanceId }) as Promise<
        RuntimeInstanceDto | RuntimeInstanceDto[] | null
      >,
    onEvent: (cb: (e: RuntimeEvent) => void) =>
      subscribe(IpcChannel.RuntimeEventBroadcast, (p) => cb(p as RuntimeEvent)),
    onOpenApp: (cb: (req: OpenAppRequest) => void) =>
      subscribe(IpcChannel.RuntimeOpenApp, (p) => cb(p as OpenAppRequest)),
  },

  /* ── Permissions ── */
  perms: {
    list: (slug: string) => invoke(IpcChannel.PermsList, { slug }) as Promise<PermissionGrant[]>,
    grant: (slug: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PermsGrant, { slug, permission }) as Promise<PermissionGrant[]>,
    revoke: (slug: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PermsRevoke, { slug, permission }) as Promise<PermissionGrant[]>,
  },

  /* ── Plugin Runtime ── */
  plugins: {
    list: () => invoke(IpcChannel.PluginsList) as Promise<PluginDto[]>,
    get: (id: string) => invoke(IpcChannel.PluginsGet, { id }) as Promise<PluginDto | null>,
    install: (source: string) =>
      invoke(IpcChannel.PluginsInstall, { source }) as Promise<PluginInstallResult>,
    enable: (id: string) => invoke(IpcChannel.PluginsEnable, { id }) as Promise<PluginDto>,
    disable: (id: string) => invoke(IpcChannel.PluginsDisable, { id }) as Promise<PluginDto>,
    reload: (id: string) => invoke(IpcChannel.PluginsReload, { id }) as Promise<PluginDto>,
    update: (id: string) =>
      invoke(IpcChannel.PluginsUpdate, { id }) as Promise<PluginInstallResult>,
    remove: (id: string) => invoke(IpcChannel.PluginsRemove, { id }) as Promise<{ ok: boolean }>,
    grant: (id: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PluginsGrant, { id, permission }) as Promise<PluginDto>,
    revoke: (id: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PluginsRevoke, { id, permission }) as Promise<PluginDto>,
    contributions: (surface?: PluginSurfaceKind) =>
      invoke(IpcChannel.PluginsContributions, { surface }) as Promise<PluginContribution[]>,
    onEvent: (cb: (e: PluginHostEvent) => void) =>
      subscribe(IpcChannel.PluginEventBroadcast, (p) => cb(p as PluginHostEvent)),
  },

  /* ── Platform Core (event bus / timeline / diagnostics) ── */
  platform: {
    /** Subscribe to the unified live Platform Event stream. */
    onEvent: (cb: (e: PlatformEvent) => void) =>
      subscribe(IpcChannel.PlatformEventBroadcast, (p) => cb(p as PlatformEvent)),
    /** Publish a UI-origin event (workspace open/close). */
    emit: (
      type: 'workspace.opened' | 'workspace.closed',
      resource?: { id?: string; name?: string },
    ) =>
      invoke(IpcChannel.PlatformEmit, {
        type,
        resourceId: resource?.id,
        resourceName: resource?.name,
      }) as Promise<{ ok: boolean }>,
  },
  timeline: {
    query: (q?: TimelineQuery) =>
      invoke(IpcChannel.TimelineQuery, q ?? {}) as Promise<TimelinePage>,
    stats: () => invoke(IpcChannel.TimelineStats) as Promise<TimelineStats>,
    export: () => invoke(IpcChannel.TimelineExport) as Promise<TimelineExport>,
  },
  diagnostics: {
    get: () => invoke(IpcChannel.DiagnosticsGet) as Promise<DiagnosticsReport>,
  },

  /* ── Connector Framework (NCF) ── */
  connectors: {
    list: () => invoke(IpcChannel.ConnectorsList) as Promise<ConnectorDto[]>,
    get: (connectorId: string) =>
      invoke(IpcChannel.ConnectorGet, { connectorId }) as Promise<ConnectorDto | null>,
    stats: () => invoke(IpcChannel.ConnectorStats) as Promise<ConnectorStats>,
    connect: (connectorId: string) =>
      invoke(IpcChannel.ConnectorConnect, { connectorId }) as Promise<ConnectorConnectResult>,
    disconnect: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorDisconnect, {
        connectorId,
        accountId,
      }) as Promise<ConnectorActionResult>,
    reconnect: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorReconnect, {
        connectorId,
        accountId,
      }) as Promise<ConnectorConnectResult>,
    refresh: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorRefresh, {
        connectorId,
        accountId,
      }) as Promise<ConnectorActionResult>,
    sync: (connectorId: string, accountId?: string | null) =>
      invoke(IpcChannel.ConnectorSync, {
        connectorId,
        accountId,
      }) as Promise<ConnectorActionResult>,
    checkHealth: (connectorId: string, accountId?: string | null) =>
      invoke(IpcChannel.ConnectorHealthCheck, { connectorId, accountId }) as Promise<
        ConnectorDto[]
      >,
    logs: (connectorId?: string) =>
      invoke(IpcChannel.ConnectorLogs, { connectorId }) as Promise<ConnectorLogEntry[]>,
    onEvent: (cb: (e: ConnectorEvent) => void) =>
      subscribe(IpcChannel.ConnectorEventBroadcast, (p) => cb(p as ConnectorEvent)),
    syncState: (connectorId?: string) =>
      invoke(IpcChannel.ConnectorSyncState, connectorId ? { connectorId } : {}) as Promise<
        ConnectorSyncSnapshot[]
      >,
    onSyncState: (cb: (s: ConnectorSyncSnapshot[]) => void) =>
      subscribe(IpcChannel.ConnectorSyncState, (p) => cb(p as ConnectorSyncSnapshot[])),

    /* ── P2.4 Microsoft 365 write actions (audited, confirmation-gated) + AI drafting ── */
    m365Actions: () => invoke(IpcChannel.M365ActionList) as Promise<ConnectorWriteActionInfo[]>,
    m365Execute: (
      connectorId: string,
      accountId: string,
      actionId: string,
      params: Record<string, unknown>,
      confirmed: boolean,
    ) =>
      invoke(IpcChannel.M365ActionExecute, { connectorId, accountId, actionId, params, confirmed }) as Promise<ConnectorWriteResult>,
    m365Draft: (
      connectorId: string,
      accountId: string,
      kind: 'email' | 'summary' | 'agenda',
      instruction: string,
      context?: string,
    ) =>
      invoke(IpcChannel.M365Draft, { connectorId, accountId, kind, instruction, context }) as Promise<{
        ok: boolean;
        text: string;
        model: string;
        grounded: boolean;
        confidence: number;
      }>,
  },

  /* ── Unified Knowledge Layer (UDM) ── */
  unified: {
    query: (q?: UnifiedQuery) =>
      invoke(IpcChannel.UnifiedQuery, q ?? {}) as Promise<UnifiedQueryResult>,
    get: (id: string) => invoke(IpcChannel.UnifiedGet, { id }) as Promise<UnifiedEntity | null>,
    counts: () => invoke(IpcChannel.UnifiedCounts) as Promise<UnifiedCounts>,
    search: (q: SearchQuery) => invoke(IpcChannel.UnifiedSearch, q) as Promise<SearchResult>,
    onChange: (cb: (counts: UnifiedCounts) => void) =>
      subscribe(IpcChannel.UnifiedEventBroadcast, (p) => cb(p as UnifiedCounts)),
  },

  graph: {
    counts: () => invoke(IpcChannel.GraphCounts) as Promise<GraphCounts>,
    node: (id: string) => invoke(IpcChannel.GraphNode, { id }) as Promise<GraphNode | null>,
    nodes: (q?: GraphNodesQuery) => invoke(IpcChannel.GraphNodes, q ?? {}) as Promise<GraphNode[]>,
    neighbors: (q: GraphNeighborsQuery) =>
      invoke(IpcChannel.GraphNeighbors, q) as Promise<GraphNeighbors | null>,
    subgraph: (q: GraphSubgraphQuery) =>
      invoke(IpcChannel.GraphSubgraph, q) as Promise<GraphSubgraph | null>,
    path: (q: GraphPathQuery) => invoke(IpcChannel.GraphPath, q) as Promise<GraphPathResult>,
    history: (q: GraphHistoryQuery) =>
      invoke(IpcChannel.GraphHistory, q) as Promise<GraphEdgeEvent[]>,
    rebuild: () => invoke(IpcChannel.GraphRebuild) as Promise<GraphCounts>,
    onChange: (cb: (counts: GraphCounts) => void) =>
      subscribe(IpcChannel.GraphEventBroadcast, (p) => cb(p as GraphCounts)),
  },

  knowledge: {
    topics: () =>
      invoke(IpcChannel.KnowledgeTopics) as Promise<{
        topics: Array<{
          id: string;
          label: string;
          memoryIds: string[];
          entities: string[];
          size: number;
        }>;
        total: number;
      }>,
    related: (memoryId: string, limit?: number) =>
      invoke(IpcChannel.KnowledgeRelated, { memoryId, limit }) as Promise<{
        memoryId: string;
        related: Array<{
          memoryId: string;
          title: string;
          kind: string;
          content: string;
          score: number;
          sharedEntities: string[];
        }>;
      }>,
  },

  memory: {
    recall: (q?: MemoryRecallQuery) =>
      invoke(IpcChannel.MemoryRecall, q ?? {}) as Promise<MemoryRecallResult>,
    semanticRecall: (q?: MemoryRecallQuery) =>
      invoke(IpcChannel.MemorySemanticRecall, q ?? {}) as Promise<MemoryRecallResult>,
    get: (id: string) => invoke(IpcChannel.MemoryGet, { id }) as Promise<MemoryItem | null>,
    remember: (input: MemoryWriteInput) =>
      invoke(IpcChannel.MemoryRemember, input) as Promise<MemoryItem>,
    forget: (ids: string[]) =>
      invoke(IpcChannel.MemoryForget, { ids }) as Promise<{ forgotten: number }>,
    counts: () => invoke(IpcChannel.MemoryCounts) as Promise<MemoryCounts>,
    rebuild: () => invoke(IpcChannel.MemoryRebuild) as Promise<MemoryCounts>,
    onChange: (cb: (counts: MemoryCounts) => void) =>
      subscribe(IpcChannel.MemoryEventBroadcast, (p) => cb(p as MemoryCounts)),
  },

  execMemory: {
    search: (q?: ExecutiveMemoryQuery) =>
      invoke(IpcChannel.ExecMemorySearch, q ?? {}) as Promise<ExecutiveMemoryView[]>,
    forget: (id: string) =>
      invoke(IpcChannel.ExecMemoryForget, { id }) as Promise<{ forgotten: boolean }>,
    pin: (id: string, pinned: boolean) =>
      invoke(IpcChannel.ExecMemoryPin, { id, pinned }) as Promise<ExecutiveMemoryView | null>,
    resolve: (id: string, status: ExecutiveMemoryStatus) =>
      invoke(IpcChannel.ExecMemoryResolve, { id, status }) as Promise<ExecutiveMemoryView | null>,
    audit: (q?: {
      limit?: number;
      offset?: number;
      action?: MemoryAuditAction;
      memoryId?: string;
    }) => invoke(IpcChannel.ExecMemoryAudit, q ?? {}) as Promise<MemoryAuditPage>,
  },

  search: {
    enterprise: (q: EnterpriseSearchQuery) =>
      invoke(IpcChannel.EnterpriseSearch, q) as Promise<EnterpriseSearchResult>,
  },

  enterpriseTimeline: {
    query: (q?: EnterpriseTimelineQuery) =>
      invoke(IpcChannel.EnterpriseTimelineQuery, q ?? {}) as Promise<EnterpriseTimelinePage>,
    replay: (q?: TimelineReplayQuery) =>
      invoke(IpcChannel.EnterpriseTimelineReplay, q ?? {}) as Promise<TimelineReplay>,
    stats: () => invoke(IpcChannel.EnterpriseTimelineStats) as Promise<EnterpriseTimelineStats>,
    export: () => invoke(IpcChannel.EnterpriseTimelineExport) as Promise<EnterpriseTimelineExport>,
    onChange: (cb: (stats: EnterpriseTimelineStats) => void) =>
      subscribe(IpcChannel.EnterpriseTimelineEventBroadcast, (p) =>
        cb(p as EnterpriseTimelineStats),
      ),
  },

  intelligence: {
    briefing: (period: BriefingPeriod, now?: string) =>
      invoke(IpcChannel.BriefingGenerate, { period, now }) as Promise<Briefing>,
    executiveCenterSnapshot: () =>
      invoke(IpcChannel.ExecutiveCenterSnapshot) as Promise<ExecutiveCenterSnapshot>,
    voiceTurn: (transcript: string, displayName?: string) =>
      invoke(IpcChannel.VoiceTurn, { transcript, displayName }) as Promise<VoiceResponse>,
  },

  decisions: {
    list: () => invoke(IpcChannel.DecisionList) as Promise<{ decisions: ExecutiveDecision[] }>,
    createFromRecommendation: (recommendationId: string) =>
      invoke(IpcChannel.DecisionCreateFromRecommendation, {
        recommendationId,
      }) as Promise<{ decision: ExecutiveDecision | null }>,
    setStatus: (id: string, status: ExecutiveDecision['status']) =>
      invoke(IpcChannel.DecisionSetStatus, { id, status }) as Promise<{
        decision: ExecutiveDecision | null;
      }>,
  },

  automations: {
    list: () =>
      invoke(IpcChannel.AutomationList) as Promise<{
        rules: AutomationRule[];
        summary: { total: number; active: number; paused: number; draft: number };
      }>,
    save: (rule: AutomationRule) =>
      invoke(IpcChannel.AutomationSave, { rule }) as Promise<{
        ok: boolean;
        rule?: AutomationRule;
        issues?: string[];
      }>,
    setStatus: (id: string, status: AutomationRule['status']) =>
      invoke(IpcChannel.AutomationSetStatus, { id, status }) as Promise<{
        rule: AutomationRule | null;
      }>,
    remove: (id: string) =>
      invoke(IpcChannel.AutomationRemove, { id }) as Promise<{ removed: boolean }>,
    run: (id: string) =>
      invoke(IpcChannel.AutomationRun, { id }) as Promise<{ record: AutomationRunRecord | null }>,
    monitor: () => invoke(IpcChannel.AutomationMonitor) as Promise<{ monitor: AutomationMonitor }>,
    history: () =>
      invoke(IpcChannel.AutomationHistory) as Promise<{ records: AutomationRunRecord[] }>,
  },

  system: {
    /** NeuroCore composed system-health snapshot (V5.0). */
    health: () => invoke(IpcChannel.SystemHealthSnapshot) as Promise<SystemHealthSnapshot>,
  },

  supervisor: {
    /** Runtime supervisor status (V5.3). */
    status: () => invoke(IpcChannel.SupervisorStatus) as Promise<SupervisorStatus>,
    history: () => invoke(IpcChannel.SupervisorHistory) as Promise<{ records: RecoveryRecord[] }>,
    recover: (subsystem: SupervisedSubsystem) =>
      invoke(IpcChannel.SupervisorRecover, { subsystem }) as Promise<RecoveryRecord>,
    setPolicy: (subsystem: SupervisedSubsystem, policy: RecoveryPolicy) =>
      invoke(IpcChannel.SupervisorSetPolicy, { subsystem, policy }) as Promise<SupervisorStatus>,
  },

  execute: {
    /** Run any executable through the unified Execute Engine (V5.4). */
    run: (req: ExecutionRequest) => invoke(IpcChannel.ExecuteRun, req) as Promise<ExecutionSession>,
    sessions: () =>
      invoke(IpcChannel.ExecuteSessions) as Promise<{
        sessions: ExecutionSession[];
        stats: ExecutionStats;
      }>,
    history: () => invoke(IpcChannel.ExecuteHistory) as Promise<{ records: ExecutionSession[] }>,
    cancel: (id: string) =>
      invoke(IpcChannel.ExecuteCancel, { id }) as Promise<ExecutionSession | null>,
  },

  voice: {
    /** Report the live voice runtime state to main for NeuroCore (V5.2). */
    reportStatus: (state: VoiceRuntimeState) =>
      invoke(IpcChannel.VoiceStatus, { state }) as Promise<{ ok: boolean }>,
  },

  recommendations: {
    generate: (q?: RecommendationQuery) =>
      invoke(IpcChannel.RecommendationsGenerate, q ?? {}) as Promise<RecommendationSet>,
  },

  founderAI: {
    ask: (text: string, now?: string) =>
      invoke(IpcChannel.FounderAsk, { text, now }) as Promise<FounderAnswer>,
    askV2: (text: string, now?: string) =>
      invoke(IpcChannel.FounderAskV2, { text, now }) as Promise<FounderResponse>,
    suggestions: (now?: string) =>
      invoke(IpcChannel.FounderSuggestions, { now }) as Promise<FounderSuggestedQuestion[]>,
  },

  engineering: {
    analyze: (now?: string) =>
      invoke(IpcChannel.EngineeringAnalyze, { now }) as Promise<EngineeringAnalysis>,
  },

  governance: {
    list: (text?: string, limit?: number) =>
      invoke(IpcChannel.GovernanceList, { text, limit }) as Promise<GovernanceTraceList>,
    trace: (decisionId: string) =>
      invoke(IpcChannel.GovernanceTrace, { decisionId }) as Promise<GovernanceTrace | null>,
  },

  context: {
    trace: (entityRef: string, limit?: number) =>
      invoke(IpcChannel.ContextTrace, { entityRef, limit }) as Promise<ContextTrace>,
  },

  relationship: {
    trace: (nodeId: string, limit?: number) =>
      invoke(IpcChannel.RelationshipTrace, { nodeId, limit }) as Promise<RelationshipTrace>,
    path: (from: string, to: string) =>
      invoke(IpcChannel.RelationshipPath, { from, to }) as Promise<RelationshipPath>,
  },

  workforce: {
    intelligence: () => invoke(IpcChannel.WorkforceIntelligence) as Promise<WorkforceIntelligence>,
    workers: () => invoke(IpcChannel.WorkforceWorkers) as Promise<WorkerSummary[]>,
    worker: (workerId: string) =>
      invoke(IpcChannel.WorkforceWorkerGet, { workerId }) as Promise<Worker | null>,
    runJob: (workerId: string, skillId: string, input?: Record<string, unknown>, now?: string) =>
      invoke(IpcChannel.WorkforceJobRun, { workerId, skillId, input, now }) as Promise<Job>,
    jobs: (q?: { workerId?: string; status?: JobStatus; limit?: number; offset?: number }) =>
      invoke(IpcChannel.WorkforceJobs, q ?? {}) as Promise<JobPage>,
    job: (jobId: string) => invoke(IpcChannel.WorkforceJobGet, { jobId }) as Promise<Job | null>,
    approve: (jobId: string, proposalId: string, note?: string, now?: string) =>
      invoke(IpcChannel.WorkforceProposalApprove, {
        jobId,
        proposalId,
        note,
        now,
      }) as Promise<Job | null>,
    reject: (jobId: string, proposalId: string, note?: string, now?: string) =>
      invoke(IpcChannel.WorkforceProposalReject, {
        jobId,
        proposalId,
        note,
        now,
      }) as Promise<Job | null>,
    runWorkflow: (spec: WorkflowSpec, now?: string) =>
      invoke(IpcChannel.WorkforceWorkflowRun, { spec, now }) as Promise<WorkflowRun>,
    workflowRuns: () => invoke(IpcChannel.WorkforceWorkflowRuns) as Promise<WorkflowRun[]>,
    resumeWorkflow: (runId: string) =>
      invoke(IpcChannel.WorkforceWorkflowResume, { runId }) as Promise<WorkflowRun | null>,
    approveCheckpoint: (runId: string, stepId: string, approved: boolean, now?: string) =>
      invoke(IpcChannel.WorkforceWorkflowCheckpoint, {
        runId,
        stepId,
        approved,
        now,
      }) as Promise<WorkflowRun | null>,
    audit: (q?: {
      workerId?: string;
      decision?: VerdictDecision;
      limit?: number;
      offset?: number;
    }) => invoke(IpcChannel.WorkforceAudit, q ?? {}) as Promise<WorkforceAuditPage>,
    policies: () => invoke(IpcChannel.WorkforcePolicies) as Promise<PolicyRule[]>,
    onEvent: (cb: (snapshot: { workers: number; jobs: number; audit: number }) => void) =>
      subscribe(IpcChannel.WorkforceEventBroadcast, (p) =>
        cb(p as { workers: number; jobs: number; audit: number }),
      ),
  },

  enterprise: {
    org: () =>
      invoke(IpcChannel.EnterpriseOrgGet) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    createUnit: (input: {
      kind: OrgUnitKind;
      name: string;
      parentId?: string | null;
      leadUserId?: string | null;
    }) =>
      invoke(IpcChannel.EnterpriseOrgCreateUnit, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    updateUnit: (input: {
      id: string;
      name?: string;
      parentId?: string | null;
      leadUserId?: string | null;
    }) =>
      invoke(IpcChannel.EnterpriseOrgUpdateUnit, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    deleteUnit: (id: string) =>
      invoke(IpcChannel.EnterpriseOrgDeleteUnit, { id }) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    createUser: (input: {
      name: string;
      email?: string | null;
      title?: string;
      unitId?: string | null;
      roleIds?: string[];
    }) =>
      invoke(IpcChannel.EnterpriseOrgCreateUser, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    updateUser: (input: {
      id: string;
      name?: string;
      email?: string | null;
      title?: string;
      unitId?: string | null;
      roleIds?: string[];
      status?: OrgUserStatus;
    }) =>
      invoke(IpcChannel.EnterpriseOrgUpdateUser, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    deleteUser: (id: string) =>
      invoke(IpcChannel.EnterpriseOrgDeleteUser, { id }) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    createRole: (input: {
      name: string;
      description?: string;
      permissions: EnterprisePermission[];
    }) =>
      invoke(IpcChannel.EnterpriseOrgCreateRole, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    updateRole: (input: {
      id: string;
      name?: string;
      description?: string;
      permissions?: EnterprisePermission[];
    }) =>
      invoke(IpcChannel.EnterpriseOrgUpdateRole, input) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,
    deleteRole: (id: string) =>
      invoke(IpcChannel.EnterpriseOrgDeleteRole, { id }) as Promise<{
        organization: Organization;
        units: OrgUnit[];
        roles: OrgRole[];
        users: OrgUser[];
      }>,

    workspaces: () => invoke(IpcChannel.EnterpriseWorkspaceList) as Promise<WorkspaceSummary[]>,
    activeWorkspace: () => invoke(IpcChannel.EnterpriseWorkspaceActive) as Promise<Workspace>,
    createWorkspace: (name: string, organizationId?: string) =>
      invoke(IpcChannel.EnterpriseWorkspaceCreate, { name, organizationId }) as Promise<
        WorkspaceSummary[]
      >,
    switchWorkspace: (id: string) =>
      invoke(IpcChannel.EnterpriseWorkspaceSwitch, { id }) as Promise<Workspace>,

    graph: () => invoke(IpcChannel.EnterpriseGraph) as Promise<OrgGraph>,
    graphNeighbors: (id: string) =>
      invoke(IpcChannel.EnterpriseGraphNeighbors, { id }) as Promise<OrgGraphNeighbors | null>,

    governanceConfig: () =>
      invoke(IpcChannel.EnterpriseGovernanceConfig) as Promise<GovernanceConfig>,
    compliance: () =>
      invoke(IpcChannel.EnterpriseGovernanceCompliance) as Promise<ComplianceFinding[]>,
    setChain: (id: string, enabled: boolean) =>
      invoke(IpcChannel.EnterpriseGovernanceSetChain, { id, enabled }) as Promise<
        GovernanceConfig['approvalChains']
      >,
    setRule: (id: string, enabled: boolean) =>
      invoke(IpcChannel.EnterpriseGovernanceSetRule, { id, enabled }) as Promise<
        GovernanceConfig['complianceRules']
      >,
    audit: (limit?: number) =>
      invoke(IpcChannel.EnterpriseGovernanceAudit, { limit }) as Promise<EnterpriseAuditEntry[]>,

    dashboard: () => invoke(IpcChannel.EnterpriseDashboard) as Promise<ExecutiveSnapshot>,

    /** Process Explorer — read-only projection of the mined processes (graph + filtered case list + KPIs). */
    processExplore: (filter?: ProcessExplorerFilter) =>
      invoke(IpcChannel.EnterpriseProcessExplore, filter ?? {}) as Promise<ProcessExplorerModel>,
    /** Process Explorer — full detail for one reconstructed case. */
    processCase: (id: string) =>
      invoke(IpcChannel.EnterpriseProcessCase, { id }) as Promise<ProcessCaseDetail | null>,

    /** Production Schedule — read-only routing schedule (Gantt + KPIs + violations + governance proposals). */
    scheduleExplore: () => invoke(IpcChannel.EnterpriseScheduleExplore) as Promise<ScheduleExploreModel>,

    /** Operator Console (MES) — read-only shop-floor execution model (executions + machines + operators + quality + timeline + KPIs). */
    executionExplore: () => invoke(IpcChannel.EnterpriseExecutionExplore) as Promise<ExecutionConsoleModel>,

    /** Relationship Intelligence — read-only ERP entity relationship graph (nodes + typed edges + health/risk + KPIs + narrative). */
    relationshipExplore: () => invoke(IpcChannel.EnterpriseRelationshipExplore) as Promise<RelationshipGraphModel>,

    /** Trust Engine — read-only per-entity deterministic trust model (profiles + factors + trend + KPIs + narrative). */
    trustExplore: () => invoke(IpcChannel.EnterpriseTrustExplore) as Promise<EnterpriseTrustModel>,

    /** Context Engine (P2.5) — entity-360 for any unified-graph / ERP entity id (neighbors + impact + timeline + memory). */
    context: (input: {
      id: string;
      neighborLimit?: number;
      activityLimit?: number;
      memoryLimit?: number;
      impactDepth?: number;
    }) => invoke(IpcChannel.EnterpriseContext, input) as Promise<EnterpriseContext>,

    /** Personalization — per-user Favorites / Recently-Opened / Saved Views (actor resolved server-side). */
    personalization: {
      get: () => invoke(IpcChannel.EnterprisePersonalizationGet) as Promise<PersonalizationState>,
      favorite: (input: { id: string; kind?: string; label?: string; tab: string; query?: string }) =>
        invoke(IpcChannel.EnterprisePersonalizationFavorite, input) as Promise<PersonalizationState>,
      recent: (input: { id: string; kind?: string; label?: string; tab: string; query?: string }) =>
        invoke(IpcChannel.EnterprisePersonalizationRecent, input) as Promise<PersonalizationState>,
      clearRecents: () => invoke(IpcChannel.EnterprisePersonalizationClearRecents) as Promise<PersonalizationState>,
      saveView: (input: { id?: string; label: string; tab: string; query?: string; filters?: string }) =>
        invoke(IpcChannel.EnterprisePersonalizationSaveView, input) as Promise<PersonalizationState>,
      deleteView: (id: string) => invoke(IpcChannel.EnterprisePersonalizationDeleteView, { id }) as Promise<PersonalizationState>,
      renameView: (id: string, label: string) => invoke(IpcChannel.EnterprisePersonalizationRenameView, { id, label }) as Promise<PersonalizationState>,
    },

    onEvent: (cb: (e: { kind: string; at: string }) => void) =>
      subscribe(IpcChannel.EnterpriseEventBroadcast, (p) => cb(p as { kind: string; at: string })),
  },

  /** Enterprise Module Framework — generic CRUD over any registered ERP module. */
  enterpriseModules: {
    list: () => invoke(IpcChannel.EnterpriseModulesList) as Promise<EnterpriseModuleSummary[]>,
    records: (
      moduleId: string,
      opts?: { status?: EnterpriseRecordStatus; search?: string; limit?: number },
    ) =>
      invoke(IpcChannel.EnterpriseModuleList, { moduleId, ...opts }) as Promise<EnterpriseEntity[]>,
    get: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleGet, { moduleId, id }) as Promise<EnterpriseEntity | null>,
    search: (moduleId: string, query: string, limit?: number) =>
      invoke(IpcChannel.EnterpriseModuleSearch, { moduleId, query, limit }) as Promise<
        EnterpriseEntity[]
      >,
    create: (moduleId: string, input: EnterpriseRecordInput) =>
      invoke(IpcChannel.EnterpriseModuleCreate, {
        moduleId,
        ...input,
      }) as Promise<EnterpriseModuleMutationResult>,
    update: (moduleId: string, id: string, input: EnterpriseRecordInput) =>
      invoke(IpcChannel.EnterpriseModuleUpdate, {
        moduleId,
        id,
        ...input,
      }) as Promise<EnterpriseModuleMutationResult>,
    setStatus: (moduleId: string, id: string, status: EnterpriseRecordStatus) =>
      invoke(IpcChannel.EnterpriseModuleSetStatus, {
        moduleId,
        id,
        status,
      }) as Promise<EnterpriseModuleMutationResult>,
    remove: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleDelete, {
        moduleId,
        id,
      }) as Promise<EnterpriseModuleMutationResult>,
    summarize: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleSummarize, {
        moduleId,
        id,
      }) as Promise<EnterpriseRecordSummary | null>,
    action: (moduleId: string, id: string, action: string) =>
      invoke(IpcChannel.EnterpriseModuleAction, {
        moduleId,
        id,
        action,
      }) as Promise<EnterpriseModuleActionResult>,
    onEvent: (cb: (e: EnterpriseModuleEvent) => void) =>
      subscribe(IpcChannel.EnterpriseModuleEventBroadcast, (p) => cb(p as EnterpriseModuleEvent)),
  },

  ecosystem: {
    dashboard: () => invoke(IpcChannel.EcosystemDeveloperDashboard) as Promise<DeveloperDashboard>,
    account: () => invoke(IpcChannel.EcosystemDeveloperAccount) as Promise<DeveloperAccount>,
    setPlan: (planTier: PlanTier) =>
      invoke(IpcChannel.EcosystemDeveloperSetPlan, { planTier }) as Promise<DeveloperDashboard>,
    keys: () => invoke(IpcChannel.EcosystemKeysList) as Promise<ApiKey[]>,
    createKey: (name: string, scopes: ApiScope[], expiresAt?: string | null) =>
      invoke(IpcChannel.EcosystemKeysCreate, {
        name,
        scopes,
        expiresAt,
      }) as Promise<ApiKeyWithSecret>,
    revokeKey: (id: string) =>
      invoke(IpcChannel.EcosystemKeysRevoke, { id }) as Promise<ApiKey | null>,
    oauthApps: () => invoke(IpcChannel.EcosystemOAuthList) as Promise<OAuthApplication[]>,
    createOAuthApp: (input: {
      name: string;
      redirectUris: string[];
      scopes: ApiScope[];
      grantTypes: OAuthGrantType[];
    }) => invoke(IpcChannel.EcosystemOAuthCreate, input) as Promise<OAuthApplicationWithSecret>,
    deleteOAuthApp: (id: string) =>
      invoke(IpcChannel.EcosystemOAuthDelete, { id }) as Promise<{ deleted: boolean }>,
    usage: (windowDays?: number) =>
      invoke(IpcChannel.EcosystemUsageAnalytics, { windowDays }) as Promise<DeveloperAnalytics>,
    sdks: () => invoke(IpcChannel.EcosystemSdks) as Promise<SdkArtifact[]>,

    listings: () => invoke(IpcChannel.EcosystemMarketplaceList) as Promise<MarketplaceListing[]>,
    listing: (id: string) =>
      invoke(IpcChannel.EcosystemMarketplaceDetail, { id }) as Promise<ListingDetail | null>,
    marketplaceStats: () =>
      invoke(IpcChannel.EcosystemMarketplaceStats) as Promise<MarketplaceStats>,
    submissionEvents: (listingId?: string, limit?: number) =>
      invoke(IpcChannel.EcosystemMarketplaceEvents, { listingId, limit }) as Promise<
        SubmissionEvent[]
      >,
    createListing: (input: {
      kind: ListingKind;
      slug: string;
      name: string;
      summary: string;
      category: string;
      pricing: ListingPricing;
      certified?: boolean;
    }) => invoke(IpcChannel.EcosystemListingCreate, input) as Promise<MarketplaceListing>,
    createVersion: (listingId: string, manifest: ListingManifest, changelog: string) =>
      invoke(IpcChannel.EcosystemVersionCreate, {
        listingId,
        manifest,
        changelog,
      }) as Promise<ListingVersion | null>,
    submit: (versionId: string) =>
      invoke(IpcChannel.EcosystemListingSubmit, { versionId }) as Promise<ListingVersion | null>,
    review: (versionId: string, decision: ReviewDecision, notes?: string) =>
      invoke(IpcChannel.EcosystemListingReview, {
        versionId,
        decision,
        notes,
      }) as Promise<ListingVersion | null>,
    publish: (versionId: string) =>
      invoke(IpcChannel.EcosystemListingPublish, { versionId }) as Promise<ListingVersion | null>,
    rollback: (listingId: string) =>
      invoke(IpcChannel.EcosystemListingRollback, {
        listingId,
      }) as Promise<MarketplaceListing | null>,
    install: (listingId: string) =>
      invoke(IpcChannel.EcosystemListingInstall, {
        listingId,
      }) as Promise<MarketplaceListing | null>,
    rate: (listingId: string, stars: number) =>
      invoke(IpcChannel.EcosystemListingRate, {
        listingId,
        stars,
      }) as Promise<MarketplaceListing | null>,

    gatewayVersions: () => invoke(IpcChannel.EcosystemGatewayVersions) as Promise<ApiVersionInfo[]>,
    gatewayRequest: (input: {
      apiKey?: string | null;
      method: string;
      path: string;
      version: ApiVersion;
      scope?: ApiScope | null;
    }) => invoke(IpcChannel.EcosystemGatewayRequest, input) as Promise<GatewayDecision>,
    gatewayAudit: (limit?: number) =>
      invoke(IpcChannel.EcosystemGatewayAudit, { limit }) as Promise<GatewayAuditEntry[]>,
    gatewayMetrics: (windowDays?: number) =>
      invoke(IpcChannel.EcosystemGatewayMetrics, { windowDays }) as Promise<GatewayMetrics>,

    billingSummary: () => invoke(IpcChannel.EcosystemBillingSummary) as Promise<BillingSummary>,
    plans: () => invoke(IpcChannel.EcosystemBillingPlans) as Promise<Plan[]>,
    setBillingPlan: (planTier: PlanTier) =>
      invoke(IpcChannel.EcosystemBillingSetPlan, { planTier }) as Promise<BillingSummary>,
    invoice: (period?: string) =>
      invoke(IpcChannel.EcosystemBillingInvoice, { period }) as Promise<Invoice>,
    seats: () => invoke(IpcChannel.EcosystemBillingSeats) as Promise<SeatAssignment[]>,
    assignSeat: (userId: string, userName: string) =>
      invoke(IpcChannel.EcosystemBillingAssignSeat, { userId, userName }) as Promise<
        SeatAssignment | { error: string }
      >,
    releaseSeat: (seatId: string) =>
      invoke(IpcChannel.EcosystemBillingReleaseSeat, { seatId }) as Promise<{ released: boolean }>,
    licenses: () => invoke(IpcChannel.EcosystemBillingLicenses) as Promise<License[]>,
    purchase: (listingId: string) =>
      invoke(IpcChannel.EcosystemBillingPurchase, { listingId }) as Promise<
        { purchase: MarketplacePurchase; license: License } | { error: string }
      >,
    purchases: () => invoke(IpcChannel.EcosystemBillingPurchases) as Promise<MarketplacePurchase[]>,

    installs: () => invoke(IpcChannel.EcosystemInstallsList) as Promise<Installation[]>,
    installSummary: () => invoke(IpcChannel.EcosystemInstallsSummary) as Promise<InstallSummary>,
    installListing: (listingId: string) =>
      invoke(IpcChannel.EcosystemInstall, { listingId }) as Promise<
        Installation | { error: string }
      >,
    updateInstall: (installationId: string) =>
      invoke(IpcChannel.EcosystemInstallUpdate, { installationId }) as Promise<
        Installation | { error: string }
      >,
    setInstallEnabled: (installationId: string, enabled: boolean) =>
      invoke(IpcChannel.EcosystemInstallSetEnabled, {
        installationId,
        enabled,
      }) as Promise<Installation | null>,
    uninstall: (installationId: string) =>
      invoke(IpcChannel.EcosystemUninstall, { installationId }) as Promise<{
        uninstalled: boolean;
      }>,
    shareWorker: (workerId: string) =>
      invoke(IpcChannel.EcosystemShareWorker, { workerId }) as Promise<
        ListingDetail | { error: string }
      >,
    packs: () => invoke(IpcChannel.EcosystemPacksList) as Promise<ExchangePack[]>,
    packsStats: () => invoke(IpcChannel.EcosystemPacksStats) as Promise<ExchangeStats>,
    publishPack: (input: { name: string; summary: string; kind: PackKind; items: PackItem[] }) =>
      invoke(IpcChannel.EcosystemPackPublish, input) as Promise<ExchangePack>,
    importPack: (id: string) =>
      invoke(IpcChannel.EcosystemPackImport, { id }) as Promise<ExchangePack | null>,
    removePack: (id: string) =>
      invoke(IpcChannel.EcosystemPackRemove, { id }) as Promise<{ removed: boolean }>,
    partners: () => invoke(IpcChannel.EcosystemPartnersList) as Promise<Partner[]>,
    partnersStats: () => invoke(IpcChannel.EcosystemPartnersStats) as Promise<PartnerStats>,
    analytics: () => invoke(IpcChannel.EcosystemAnalytics) as Promise<EcosystemAnalytics>,

    onEvent: (cb: (e: { kind: string; at: string }) => void) =>
      subscribe(IpcChannel.EcosystemEventBroadcast, (p) => cb(p as { kind: string; at: string })),
  },

  cloud: {
    regions: () => invoke(IpcChannel.CloudRegions) as Promise<CloudRegion[]>,
    tenants: () => invoke(IpcChannel.CloudTenants) as Promise<CloudTenant[]>,
    tenantSummary: () => invoke(IpcChannel.CloudTenantSummary) as Promise<TenantSummary>,
    createTenant: (input: { name: string; regionId: CloudRegionId; tier: TenantTier }) =>
      invoke(IpcChannel.CloudCreateTenant, input) as Promise<CloudTenant>,
    setTenantStatus: (tenantId: string, status: TenantStatus) =>
      invoke(IpcChannel.CloudSetTenantStatus, { tenantId, status }) as Promise<
        CloudTenant | { error: string }
      >,
    projects: (tenantId?: string) =>
      invoke(IpcChannel.CloudProjects, { tenantId }) as Promise<CloudProject[]>,
    createProject: (input: { tenantId: string; name: string; description?: string }) =>
      invoke(IpcChannel.CloudCreateProject, input) as Promise<CloudProject | { error: string }>,
    deleteProject: (id: string) =>
      invoke(IpcChannel.CloudDeleteProject, { id }) as Promise<{ deleted: boolean }>,
    teams: (tenantId?: string) =>
      invoke(IpcChannel.CloudTeams, { tenantId }) as Promise<CloudTeam[]>,
    createTeam: (input: { tenantId: string; name: string }) =>
      invoke(IpcChannel.CloudCreateTeam, input) as Promise<CloudTeam | { error: string }>,
    tenantWorkers: (tenantId?: string) =>
      invoke(IpcChannel.CloudTenantWorkers, { tenantId }) as Promise<TenantWorker[]>,
    storageIsolation: () => invoke(IpcChannel.CloudStorageIsolation) as Promise<StorageIsolation[]>,

    ssoConnections: () => invoke(IpcChannel.CloudSsoConnections) as Promise<SsoConnection[]>,
    identitySummary: () => invoke(IpcChannel.CloudIdentitySummary) as Promise<IdentitySummary>,
    createSso: (input: {
      name: string;
      protocol: SsoProtocol;
      issuer: string;
      entityId?: string;
      ssoUrl: string;
      clientId?: string;
      domains: string[];
      attributeMapping?: Record<string, string>;
    }) => invoke(IpcChannel.CloudCreateSso, input) as Promise<SsoConnection>,
    updateSso: (input: {
      id: string;
      status?: SsoStatus;
      enforced?: boolean;
      domains?: string[];
      name?: string;
    }) => invoke(IpcChannel.CloudUpdateSso, input) as Promise<SsoConnection | { error: string }>,
    deleteSso: (id: string) =>
      invoke(IpcChannel.CloudDeleteSso, { id }) as Promise<{ deleted: boolean }>,
    testSso: (id: string) => invoke(IpcChannel.CloudTestSso, { id }) as Promise<FederationResult>,
    scim: () => invoke(IpcChannel.CloudScim) as Promise<ScimConfig | null>,
    setScim: (enabled: boolean) =>
      invoke(IpcChannel.CloudSetScim, { enabled }) as Promise<ScimConfig>,
    scimSync: () => invoke(IpcChannel.CloudScimSync) as Promise<ScimConfig | { error: string }>,
    mfa: () => invoke(IpcChannel.CloudMfa) as Promise<MfaPolicy | null>,
    setMfa: (input: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }) =>
      invoke(IpcChannel.CloudSetMfa, input) as Promise<MfaPolicy>,

    syncStates: () => invoke(IpcChannel.CloudSyncStates) as Promise<SyncDomainState[]>,
    syncSummary: () => invoke(IpcChannel.CloudSyncSummary) as Promise<SyncSummary>,
    syncConflicts: () => invoke(IpcChannel.CloudSyncConflicts) as Promise<SyncConflict[]>,
    syncDomain: (domain: SyncDomain) =>
      invoke(IpcChannel.CloudSyncDomain, { domain }) as Promise<SyncResult | { offline: true }>,
    syncAll: () => invoke(IpcChannel.CloudSyncAll) as Promise<SyncResult[]>,
    setOnline: (online: boolean) =>
      invoke(IpcChannel.CloudSyncSetOnline, { online }) as Promise<SyncSummary>,
    recordChange: (domain: SyncDomain, count?: number) =>
      invoke(IpcChannel.CloudSyncRecordChange, { domain, count }) as Promise<SyncSummary>,

    liveSyncStatus: () => invoke(IpcChannel.LiveSyncStatus) as Promise<LiveSyncStatus>,
    liveSyncNow: () => invoke(IpcChannel.LiveSyncNow) as Promise<LiveSyncStatus>,
    liveSyncSetOnline: (online: boolean) =>
      invoke(IpcChannel.LiveSyncSetOnline, { online }) as Promise<LiveSyncStatus>,
    liveSyncSetActiveOrg: (orgId: string | null) =>
      invoke(IpcChannel.LiveSyncSetActiveOrg, { orgId }) as Promise<LiveSyncStatus>,

    deployments: () => invoke(IpcChannel.CloudDeployments) as Promise<ApiDeployment[]>,
    apiSummary: () => invoke(IpcChannel.CloudApiSummary) as Promise<ApiPlatformSummary>,
    ratePolicies: () => invoke(IpcChannel.CloudRatePolicies) as Promise<CloudRateLimitPolicy[]>,
    setPolicyEnabled: (id: string, enabled: boolean) =>
      invoke(IpcChannel.CloudSetPolicyEnabled, { id, enabled }) as Promise<
        CloudRateLimitPolicy | { error: string }
      >,
    webhooks: () => invoke(IpcChannel.CloudWebhooks) as Promise<WebhookEndpoint[]>,
    createWebhook: (input: { url: string; events: string[] }) =>
      invoke(IpcChannel.CloudCreateWebhook, input) as Promise<WebhookEndpoint>,
    setWebhookStatus: (id: string, status: WebhookStatus) =>
      invoke(IpcChannel.CloudSetWebhookStatus, { id, status }) as Promise<
        WebhookEndpoint | { error: string }
      >,
    deleteWebhook: (id: string) =>
      invoke(IpcChannel.CloudDeleteWebhook, { id }) as Promise<{ deleted: boolean }>,
    testWebhook: (id: string) =>
      invoke(IpcChannel.CloudTestWebhook, { id }) as Promise<WebhookEndpoint | { error: string }>,
    publicApis: () => invoke(IpcChannel.CloudPublicApis) as Promise<PublicApi[]>,

    adminOverview: () => invoke(IpcChannel.CloudAdminOverview) as Promise<AdminOverview>,
    adminCompliance: () => invoke(IpcChannel.CloudAdminCompliance) as Promise<ComplianceReport>,

    onEvent: (cb: (e: { kind: string; at: string }) => void) =>
      subscribe(IpcChannel.CloudEventBroadcast, (p) => cb(p as { kind: string; at: string })),
  },

  federation: {
    orgs: () => invoke(IpcChannel.FedOrgs) as Promise<FederatedOrg[]>,
    summary: () => invoke(IpcChannel.FedSummary) as Promise<FederationSummary>,
    invitations: () => invoke(IpcChannel.FedInvitations) as Promise<OrgInvitation[]>,
    trust: () => invoke(IpcChannel.FedTrust) as Promise<TrustRelationship[]>,
    shared: () => invoke(IpcChannel.FedShared) as Promise<SharedResource[]>,
    inviteOrg: (input: { name: string; trustLevel: TrustLevel; message?: string }) =>
      invoke(IpcChannel.FedInviteOrg, input) as Promise<OrgInvitation>,
    respondInvite: (id: string, accept: boolean) =>
      invoke(IpcChannel.FedRespondInvite, { id, accept }) as Promise<
        OrgInvitation | { error: string }
      >,
    setTrust: (input: {
      peerOrg: string;
      trustLevel?: TrustLevel;
      delegatedApproval?: boolean;
      canShareWorkers?: boolean;
      canShareData?: boolean;
    }) => invoke(IpcChannel.FedSetTrust, input) as Promise<TrustRelationship | { error: string }>,
    shareResource: (input: {
      kind: SharedResourceKind;
      name: string;
      peerOrg: string;
      access: ShareAccess;
    }) => invoke(IpcChannel.FedShareResource, input) as Promise<SharedResource | { error: string }>,
    revokeShare: (id: string) =>
      invoke(IpcChannel.FedRevokeShare, { id }) as Promise<{ ok: boolean }>,

    artifacts: () => invoke(IpcChannel.FedArtifacts) as Promise<ExchangeArtifact[]>,
    exchangeSummary: () => invoke(IpcChannel.FedExchangeSummary) as Promise<ExchangeSummary>,
    publishArtifact: (input: {
      kind: ExchangeKind;
      name: string;
      summary: string;
      scope: ExchangeScope;
      regionId?: CloudRegionId | null;
    }) => invoke(IpcChannel.FedPublishArtifact, input) as Promise<ExchangeArtifact>,
    publishVersion: (input: { artifactId: string; version: string; changelog: string }) =>
      invoke(IpcChannel.FedPublishVersion, input) as Promise<ExchangeArtifact | { error: string }>,
    rate: (artifactId: string, stars: number) =>
      invoke(IpcChannel.FedRateArtifact, { artifactId, stars }) as Promise<
        ExchangeArtifact | { error: string }
      >,
    setVerification: (artifactId: string, verification: VerificationStatus) =>
      invoke(IpcChannel.FedSetVerification, { artifactId, verification }) as Promise<
        ExchangeArtifact | { error: string }
      >,
    rollback: (artifactId: string) =>
      invoke(IpcChannel.FedRollbackArtifact, { artifactId }) as Promise<
        ExchangeArtifact | { error: string }
      >,
    install: (artifactId: string) =>
      invoke(IpcChannel.FedInstallArtifact, { artifactId }) as Promise<
        ExchangeArtifact | { error: string }
      >,
    verifyVersion: (artifactId: string, versionId: string) =>
      invoke(IpcChannel.FedVerifyVersion, { artifactId, versionId }) as Promise<{
        verified: boolean;
      }>,

    scopeSummary: () => invoke(IpcChannel.FedScopeSummary) as Promise<MarketplaceScopeSummary[]>,
    setScope: (artifactId: string, scope: ExchangeScope) =>
      invoke(IpcChannel.FedSetScope, { artifactId, scope }) as Promise<
        ExchangeArtifact | { error: string }
      >,

    policies: () => invoke(IpcChannel.FedPolicies) as Promise<FedPolicy[]>,
    govSummary: () => invoke(IpcChannel.FedGovSummary) as Promise<GlobalGovSummary>,
    addPolicy: (input: {
      name: string;
      description: string;
      scope: FedPolicyScope;
      effect: FedPolicyEffect;
      action: string;
    }) => invoke(IpcChannel.FedAddPolicy, input) as Promise<FedPolicy>,
    setPolicyEnabled: (id: string, enabled: boolean) =>
      invoke(IpcChannel.FedSetPolicyEnabled, { id, enabled }) as Promise<
        FedPolicy | { error: string }
      >,
    approvals: () => invoke(IpcChannel.FedApprovals) as Promise<DelegatedApproval[]>,
    resolveApproval: (id: string, approve: boolean) =>
      invoke(IpcChannel.FedResolveApproval, { id, approve }) as Promise<
        DelegatedApproval | { error: string }
      >,
    audit: () => invoke(IpcChannel.FedAuditTrail) as Promise<FedAuditEntry[]>,
    compliance: () => invoke(IpcChannel.FedCompliance) as Promise<FedComplianceRule[]>,
    recordAction: (input: {
      action: string;
      peerOrg: string;
      peerOrgName: string;
      trustLevel: TrustLevel;
      detail: string;
    }) => invoke(IpcChannel.FedRecordAction, input) as Promise<FedActionEvaluation>,

    observability: () => invoke(IpcChannel.FedObservability) as Promise<ObservabilityOverview>,
    usageSeries: () => invoke(IpcChannel.FedUsageSeries) as Promise<UsagePoint[]>,
    securityEvents: () => invoke(IpcChannel.FedSecurityEvents) as Promise<SecurityEvent[]>,

    backups: () => invoke(IpcChannel.FedBackups) as Promise<Backup[]>,
    replicas: () => invoke(IpcChannel.FedReplicas) as Promise<ReplicaState[]>,
    validations: () => invoke(IpcChannel.FedValidations) as Promise<RecoveryValidation[]>,
    continuity: () => invoke(IpcChannel.FedContinuity) as Promise<ContinuityPosture>,
    drSummary: () => invoke(IpcChannel.FedDrSummary) as Promise<DrSummary>,
    createBackup: (scope: BackupScope) =>
      invoke(IpcChannel.FedCreateBackup, { scope }) as Promise<Backup>,
    runValidation: (backupId: string) =>
      invoke(IpcChannel.FedRunValidation, { backupId }) as Promise<
        RecoveryValidation | { error: string }
      >,
    checkReplication: () => invoke(IpcChannel.FedCheckReplication) as Promise<ReplicaState[]>,

    adminOverview: () => invoke(IpcChannel.FedAdminOverview) as Promise<FedAdminOverview>,
    scalability: () => invoke(IpcChannel.FedScalability) as Promise<ScalabilityReport>,

    onEvent: (cb: (e: { kind: string; at: string }) => void) =>
      subscribe(IpcChannel.FedEventBroadcast, (p) => cb(p as { kind: string; at: string })),
  },

  // ── Release engineering: migration · backup · crash · diagnostics · recovery · support ──
  releaseOps: {
    migrationStatus: () => invoke(IpcChannel.MigrationStatus) as Promise<MigrationStatus>,
    runMigration: (dryRun?: boolean) =>
      invoke(IpcChannel.MigrationRun, { dryRun }) as Promise<MigrationReport>,

    listBackups: () => invoke(IpcChannel.BackupList) as Promise<BackupInfo[]>,
    createBackup: (domains?: MaintenanceDomain[]) =>
      invoke(IpcChannel.BackupCreate, { trigger: 'manual', domains }) as Promise<BackupInfo>,
    validateBackup: (id: string) =>
      invoke(IpcChannel.BackupValidate, { id }) as Promise<BackupValidation>,
    restoreBackup: (id: string, domains?: MaintenanceDomain[]) =>
      invoke(IpcChannel.BackupRestore, { id, domains }) as Promise<RestoreResult>,
    deleteBackup: (id: string) => invoke(IpcChannel.BackupDelete, { id }) as Promise<boolean>,

    crashStatus: () => invoke(IpcChannel.CrashGetStatus) as Promise<CrashStatus>,
    setCrashOptIn: (optedIn: boolean) =>
      invoke(IpcChannel.CrashSetOptIn, { optedIn }) as Promise<CrashStatus>,
    exportCrashes: () => invoke(IpcChannel.CrashExport) as Promise<CrashRecord[]>,
    crashRecommendations: () =>
      invoke(IpcChannel.CrashRecommendations) as Promise<RecoveryRecommendation[]>,
    reportError: (input: { kind: string; message: string; stack?: string }) =>
      invoke(IpcChannel.CrashReport, input) as Promise<CrashStatus>,

    diagnostics: () => invoke(IpcChannel.ReleaseDiagnosticsGet) as Promise<ReleaseDiagnostics>,
    exportDiagnostics: () =>
      invoke(IpcChannel.ReleaseDiagnosticsExport) as Promise<{
        report: ReleaseDiagnostics;
        text: string;
      }>,

    safeModeStatus: () => invoke(IpcChannel.RecoverySafeModeStatus) as Promise<SafeModeState>,
    runRecovery: (
      action: RecoveryAction,
      opts?: { backupId?: string; domains?: MaintenanceDomain[]; reason?: string },
    ) =>
      invoke(IpcChannel.RecoveryRun, { action, ...(opts ?? {}) }) as Promise<RecoveryActionResult>,

    generateSupportBundle: () =>
      invoke(IpcChannel.SupportGenerateBundle) as Promise<SupportBundleInfo>,
  },

  flags: {
    get: (planTier: PlanTier) =>
      invoke(IpcChannel.FlagsGet, { planTier }) as Promise<FeatureFlagState[]>,
    setOverride: (key: FeatureFlagKey, value: boolean, planTier: PlanTier) =>
      invoke(IpcChannel.FlagsSetOverride, { key, value, planTier }) as Promise<FeatureFlagState[]>,
    clearOverride: (key: FeatureFlagKey, planTier: PlanTier) =>
      invoke(IpcChannel.FlagsClearOverride, { key, planTier }) as Promise<FeatureFlagState[]>,
  },

  /**
   * Application self-update (electron-updater), exposed over the existing `update:*` channels.
   * Every method returns the full, serializable UpdateStatus the renderer renders from; `onEvent`
   * subscribes to the main-side status broadcast (already on the runtime broadcast allowlist) and
   * unwraps the `{ status }` envelope. No update behavior lives here — it is a thin, typed seam.
   */
  updater: {
    getStatus: () => invoke(IpcChannel.UpdateGetStatus) as Promise<UpdateStatus>,
    checkNow: () => invoke(IpcChannel.UpdateCheckNow) as Promise<UpdateStatus>,
    download: () => invoke(IpcChannel.UpdateDownload) as Promise<UpdateStatus>,
    installOnQuit: () => invoke(IpcChannel.UpdateInstallOnQuit) as Promise<UpdateStatus>,
    setChannel: (channel: UpdateChannel) =>
      invoke(IpcChannel.UpdateSetChannel, { channel }) as Promise<UpdateStatus>,
    /** Subscribe to live updater status changes. Returns an unsubscribe handle. */
    onEvent: (cb: (status: UpdateStatus) => void) =>
      subscribe(IpcChannel.UpdateEventBroadcast, (p) => cb((p as UpdateEvent).status)),
  },

  license: {
    status: (orgId: string) =>
      invoke(IpcChannel.LicenseStatus, { orgId }) as Promise<LicenseValidationStatus>,
    refresh: (orgId: string) =>
      invoke(IpcChannel.LicenseRefresh, { orgId }) as Promise<LicenseValidationStatus>,
    /** Report license health to main for NeuroCore (V6.1). Pass null state to clear. */
    reportHealth: (state: LicenseState | null, graceDaysRemaining = 0) =>
      invoke(IpcChannel.LicenseReportHealth, { state, graceDaysRemaining }) as Promise<{
        ok: boolean;
      }>,
  },

  billing: {
    /** Create a Razorpay subscription checkout and open the hosted page (V6.4). */
    checkout: (orgId: string, plan: BillingPlanId, seats?: number) =>
      invoke(IpcChannel.BillingCheckout, { orgId, plan, seats }) as Promise<{
        subscriptionId: string;
        checkoutUrl: string;
      }>,
  },

  devices: {
    /** Register THIS device against the org (identity assembled main-side) (V6.5). */
    registerCurrent: (orgId: string) =>
      invoke(IpcChannel.DevicesRegister, { orgId }) as Promise<{ device: Device }>,
    list: (orgId: string) => invoke(IpcChannel.DevicesList, { orgId }) as Promise<Device[]>,
    revoke: (orgId: string, deviceId: string) =>
      invoke(IpcChannel.DevicesRevoke, { orgId, deviceId }) as Promise<{ device: Device }>,
    /** Report THIS device's trust status to main for NeuroCore (V6.5). */
    reportHealth: (trustStatus: DeviceTrustStatus | null) =>
      invoke(IpcChannel.DeviceReportHealth, { trustStatus }) as Promise<{ ok: boolean }>,
  },

  onboarding: {
    status: () => invoke(IpcChannel.OnboardingStatus) as Promise<OnboardingStatus>,
    start: () => invoke(IpcChannel.OnboardingStart) as Promise<OnboardingStatus>,
    completeStep: (step: OnboardingStepId) =>
      invoke(IpcChannel.OnboardingCompleteStep, { step }) as Promise<OnboardingStatus>,
    dismiss: () => invoke(IpcChannel.OnboardingDismiss) as Promise<OnboardingStatus>,
    reset: () => invoke(IpcChannel.OnboardingReset) as Promise<OnboardingStatus>,
  },

  feedback: {
    submit: (category: FeedbackCategory, message: string, context?: string) =>
      invoke(IpcChannel.FeedbackSubmit, { category, message, context }) as Promise<FeedbackEntry>,
    list: () => invoke(IpcChannel.FeedbackList) as Promise<FeedbackEntry[]>,
    exportAll: () => invoke(IpcChannel.FeedbackExport) as Promise<FeedbackExport>,
    exportToFile: () => invoke(IpcChannel.FeedbackExportToFile) as Promise<string | null>,
    clear: () => invoke(IpcChannel.FeedbackClear) as Promise<number>,
  },

  pilot: {
    status: () => invoke(IpcChannel.PilotStatus) as Promise<PilotStatus>,
    setEnabled: (enabled: boolean) =>
      invoke(IpcChannel.PilotSetEnabled, { enabled }) as Promise<PilotStatus>,
  },
};

// Referenced by future surfaces; keeps the import used and the type exported.
export type { InstallationDto };

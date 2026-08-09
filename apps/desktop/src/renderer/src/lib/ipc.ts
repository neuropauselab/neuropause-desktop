/**
 * Strongly-typed renderer client over the preload bridge. Components import
 * `ipc` and get full type-safety; the untyped channel/payload plumbing is
 * contained entirely here. The renderer never talks to the backend directly —
 * every catalog/registry/NPS/runtime call goes through these channels into the
 * main process.
 */
import { perfRecorder } from '@renderer/lib/perf/perfRecorder';
import { createLogger } from '@renderer/lib/logger';
// A7 — channel attribution for a rejected call. See `./ipcError.ts`.
import { attributeIpcChannel, describeIpcFailure } from '@renderer/lib/ipcError';
import {
  IpcChannel,
  // A7 — the response half of the IPC contract. See `packages/shared/src/ipc/responses.ts`.
  type IpcResponseChannelName,
  type IpcResponseOf,
  // A7 — the push half. See `packages/shared/src/ipc/broadcasts.ts`.
  type IpcBroadcastChannelName,
  type IpcBroadcastOf,
  // Mobile M1-03 — Companion gateway status/device change signal.
  type CompanionGatewayEvent,
  type InfraChangedEvent,
  type IpcStoreChangedEvent,
  type ThemeChangedEvent,
  type WorkforceCountsEvent,
  // Phase 6 Stage 4 — Workspace Assistant.
  type AssistantAskRequest,
  type AssistantEvent,
  type AuthProviderId,
  type AuthStatus,
  type MenuCommandPayload,
  type TrayCommandPayload,
  type ThemeSource,
  type ShellSnapshotDto,
  type WorkspaceTemplateId,
  type InstallationDto,
  type StoreSearchParams,
  type NpsProgressEvent,
  type RuntimeEvent,
  type OpenAppRequest,
  type RuntimePermissionKey,
  type PluginHostEvent,
  type PluginSurfaceKind,
  type PlatformEvent,
  type TimelineQuery,
  type ConnectorEvent,
  type ConnectorSyncSnapshot,
  type UnifiedQuery,
  type UnifiedCounts,
  type SearchQuery,
  type GraphCounts,
  // ── Private-First AI experience ──
  type AiMode,
  type WorkspaceType,
  type UnderstandingAttribute,
  type DocumentLineInput,
  type DecisionRecord,
  type DecisionRecordDetail,
  type HoldCenterView,
  type HoldOutcome,
  type Opportunity,
  type OpportunityCenterView,
  type OpportunityExecuteResult,
  type OpportunityStatus,
  type HoldRecord,
  // ── Medical Device Manufacturing Pack ──
  type LotCenterView,
  type LotStatus,
  type MedicalDeviceLotConsumeRequest,
  type MedicalDeviceLotCreateRequest,
  type MedicalDeviceLotShipRequest,
  type TraceNodeType,
  type GraphNodesQuery,
  type GraphNeighborsQuery,
  type GraphSubgraphQuery,
  type GraphPathQuery,
  type GraphHistoryQuery,
  type MemoryRecallQuery,
  type MemoryWriteInput,
  type MemoryCounts,
  type ExecutiveMemoryQuery,
  type ExecutiveMemoryStatus,
  type MemoryAuditAction,
  type EnterpriseSearchQuery,
  type EnterpriseIntelChangeImpactRequest,
  type EnterpriseIntelRootCauseRequest,
  type EnterpriseTimelineQuery,
  type TimelineReplayQuery,
  type EnterpriseTimelineStats,
  type BriefingPeriod,
  type ExecutiveDecision,
  type AutomationRule,
  type VoiceRuntimeState,
  type SupervisedSubsystem,
  type RecoveryPolicy,
  type ExecutionRequest,
  type RecommendationQuery,
  type JobStatus,
  type WorkflowSpec,
  type WorkforceDelegateRequest,
  type WorkerPackage,
  type MarketplaceCatalogQuery,
  type OrgMarketplacePolicy,
  type VerdictDecision,
  type PlanTier,
  type ApiScope,
  type OAuthGrantType,
  type ListingKind,
  type ListingPricing,
  type ListingManifest,
  type ReviewDecision,
  type ApiVersion,
  type PackKind,
  type PackItem,
  type MaintenanceDomain,
  type RecoveryAction,
  type CloudOrgRole,
} from '@neuropause/shared';
import type {
  HelpDocId,
  OrgUnitKind,
  OrgUserStatus,
  EnterprisePermission,
  EnterpriseRecordInput,
  EnterpriseRecordStatus,
  EnterpriseModuleEvent,
  ProcessExplorerFilter,
  EnterpriseApiRequest,
  WebhookDeliveryStats,
  PlatformEventCategory,
  NotificationInboxEvent,
  NotificationsPrefsSetRequest,
} from '@neuropause/shared';

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

/**
 * @deprecated A7 — the theme payload is now described once, in `@neuropause/shared`,
 * where the main process's `broadcast` reads it too. This alias is retained so any
 * existing importer keeps compiling; it names the same type.
 */
export type ThemeChangedPayload = ThemeChangedEvent;

const log = createLogger('ipc');

/**
 * Channels whose first failure has already been logged.
 *
 * A7 — the log below exists so a console or a support bundle shows WHICH channel
 * failed, which the message alone never says. Logging every rejection would be a
 * spam risk rather than a diagnostic: several surfaces poll on an interval and
 * swallow the failure deliberately (`.catch(() => undefined)`), so a main process
 * that is down would emit a line per channel per tick, forever. First failure per
 * channel per session bounds the output at one line per channel while still
 * recording that the channel failed at all. Recurrence is not lost — the call
 * sites surface every failure to the user; this is the trail nobody else leaves.
 */
const loggedFailures = new Set<string>();

const rawInvoke = window.neuropause.invoke;
/**
 * The IPC entrypoint every namespace below uses.
 *
 * Two jobs. It records REAL per-call round-trip latency and the in-flight count into
 * perfRecorder (which feeds the runtime Performance overlay + Diagnostics), on a
 * detached branch that cannot affect the returned promise or its rejection.
 *
 * And it is where the response contract is applied. A7 — the preload bridge returns
 * `Promise<unknown>`, because that is the honest type of a message coming back over
 * an Electron channel. Until now every one of the 636 call sites below recovered a
 * type by asserting one (`as Promise<Foo>`): 636 independent claims about what the
 * main process sends, none of them checked against the handler that actually sends
 * it. They are gone. The type now comes from `IpcResponseMap` in @neuropause/shared,
 * which the main process's `SecureHandlerDef` reads too — so a handler and its
 * caller can no longer disagree without one of them failing to compile.
 *
 * The single `as` below is the whole conversion, and it is the honest kind: exactly
 * one place where `unknown` off the wire becomes the declared contract, rather than
 * 636 places each quietly asserting something different.
 *
 * A7 also gave it a third job, on the failure path. The secure bridge strips a
 * rejection down to a clean message before it crosses the boundary, and Electron
 * serializes only that message, so a denial arrives as `Not authorized` with no
 * indication of what was denied. This is the last frame that still knows which
 * channel was called, so it records that on the way out. The rejection is
 * otherwise untouched — same object, same message, same stack — so the call sites
 * that render `err.message` are unaffected.
 */
function invoke<C extends IpcResponseChannelName>(
  channel: C,
  payload?: unknown,
): Promise<IpcResponseOf<C>> {
  const settle = perfRecorder.ipcStart(String(channel));
  const promise = rawInvoke(channel, payload) as Promise<IpcResponseOf<C>>;
  promise.then(settle, settle);
  // Attribution has to be a link in the returned chain, not another detached
  // branch: a detached handler would race the caller's own `.catch`, and the
  // whole point is that the caller sees the attributed error.
  return promise.catch((err: unknown) => {
    const attributed = attributeIpcChannel(err, String(channel));
    if (!loggedFailures.has(String(channel))) {
      loggedFailures.add(String(channel));
      log.warn(`IPC call failed — ${describeIpcFailure(attributed)}`);
    }
    throw attributed;
  });
}
import type {
  CloudRegionId,
  TenantTier,
  TenantStatus,
  SsoProtocol,
  SsoStatus,
  MfaMethod,
  FeatureFlagKey,
  UpdateStatus,
  UpdateChannel,
  LicenseState,
  BillingPlanId,
  DeviceTrustStatus,
  AiProviderId,
  OnboardingStepId,
  FeedbackCategory,
  WebhookStatus,
} from '@neuropause/shared';

import type {
  TrustLevel,
  SharedResourceKind,
  ShareAccess,
  ExchangeKind,
  ExchangeScope,
  VerificationStatus,
  FedPolicyScope,
  FedPolicyEffect,
  BackupScope,
  FederationSearchKind,
} from '@neuropause/shared';

import type {
  ConnectorControlAction,
  ConnectorLifecycleEvent,
  ExecutionStatus,
  ExecutionTrigger,
  ExecutionPriority,
  ArtifactKind,
  SandboxEvent,
  PipelineKind,
  TriggerKind,
} from '@neuropause/shared';

const rawSubscribe = window.neuropause.subscribe;
/**
 * The push-side counterpart to `invoke`, and the same argument.
 *
 * A7 — the preload bridge hands a listener `unknown`, which is the honest type of a
 * value that arrived over an Electron channel. Every subscription below used to
 * recover a type by asserting one (`(p) => cb(p as RuntimeEvent)`) — an independent
 * claim per channel, none of them checked against the main process that does the
 * sending, and several of them asserting a shape onto a value that reached
 * `webContents.send` as `any` in the first place. The type now comes from
 * `IpcBroadcastMap` in @neuropause/shared, which `broadcast` in the main process is
 * declared against, so sender and listener cannot disagree without one failing to
 * compile.
 *
 * The one `as` here is the whole conversion: the single place `unknown` off the wire
 * becomes the declared contract. It is a cast on the *listener*, not on the payload —
 * we are handing a stricter function to a looser port, which is sound; the payload
 * itself is never asserted about.
 */
function subscribe<C extends IpcBroadcastChannelName>(
  channel: C,
  listener: (payload: IpcBroadcastOf<C>) => void,
): () => void {
  return rawSubscribe(channel, listener as (payload: unknown) => void);
}

export const ipc = {
  auth: {
    getStatus: () => invoke(IpcChannel.AuthGetStatus),
    loginOAuth: (provider: OAuthProviderId) => invoke(IpcChannel.AuthLoginOAuth, { provider }),
    loginEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthLoginEmail, { email, password }),
    registerEmail: (email: string, password: string) =>
      invoke(IpcChannel.AuthRegisterEmail, { email, password }),
    logout: () => invoke(IpcChannel.AuthLogout),
    onStatusChanged: (cb: (status: AuthStatus) => void) =>
      subscribe(IpcChannel.AuthStatusChanged, cb),
  },
  app: {
    getInfo: () => invoke(IpcChannel.AppGetInfo),
    getThemeSource: () => invoke(IpcChannel.AppGetThemeSource),
    setThemeSource: (source: ThemeSource) => invoke(IpcChannel.AppSetThemeSource, { source }),
    onThemeChanged: (cb: (payload: ThemeChangedEvent) => void) =>
      subscribe(IpcChannel.ThemeChanged, cb),
    closeWindow: () => invoke(IpcChannel.WindowClose),
  },
  menu: {
    onCommand: (cb: (payload: MenuCommandPayload) => void) => subscribe(IpcChannel.MenuCommand, cb),
  },
  tray: {
    /** Subscribe to tray runtime commands (start/pause listening). V4.1. */
    onCommand: (cb: (payload: TrayCommandPayload) => void) => subscribe(IpcChannel.TrayCommand, cb),
  },

  /* ── Secure Catalog (proxied to the Store API in the main process) ── */
  catalog: {
    featured: () => invoke(IpcChannel.CatalogFeatured),
    collections: () => invoke(IpcChannel.CatalogCollections),
    sections: (key: string, page?: number, pageSize?: number) =>
      invoke(IpcChannel.CatalogSections, { key, page, pageSize }),
    search: (params: StoreSearchParams) => invoke(IpcChannel.CatalogSearch, params),
    app: (slug: string) => invoke(IpcChannel.CatalogApp, { slug }),
    reviews: (slug: string, page?: number, pageSize?: number) =>
      invoke(IpcChannel.CatalogReviews, { slug, page, pageSize }),
    developer: (slug: string) => invoke(IpcChannel.CatalogDeveloper, { slug }),
    categories: () => invoke(IpcChannel.CatalogCategories),
    bookmarks: () => invoke(IpcChannel.CatalogBookmarks),
    toggleBookmark: (slug: string, bookmarked: boolean) =>
      invoke(IpcChannel.CatalogToggleBookmark, { slug, bookmarked }),
    submitReview: (slug: string, body: { rating: number; title?: string; body?: string }) =>
      invoke(IpcChannel.CatalogSubmitReview, { slug, ...body }),
    recommendations: () => invoke(IpcChannel.CatalogRecommendations),
    checkUpdate: (slug: string) => invoke(IpcChannel.CatalogCheckUpdate, { slug }),
  },

  /* ── Cloud Organizations ── */
  org: {
    list: () => invoke(IpcChannel.OrgList),
    create: (body: { name: string; slug?: string }) => invoke(IpcChannel.OrgCreate, body),
    get: (orgId: string) => invoke(IpcChannel.OrgGet, { orgId }),
    update: (orgId: string, name: string) => invoke(IpcChannel.OrgUpdate, { orgId, name }),
    members: (orgId: string) => invoke(IpcChannel.OrgMembers, { orgId }),
    invite: (orgId: string, email: string, role: CloudOrgRole) =>
      invoke(IpcChannel.OrgInvite, { orgId, email, role }),
    acceptInvite: (token: string) => invoke(IpcChannel.OrgAcceptInvite, { token }),
    changeRole: (orgId: string, membershipId: string, role: CloudOrgRole) =>
      invoke(IpcChannel.OrgChangeRole, { orgId, membershipId, role }),
    removeMember: (orgId: string, membershipId: string) =>
      invoke(IpcChannel.OrgRemoveMember, { orgId, membershipId }),
    workspaces: (orgId: string) => invoke(IpcChannel.OrgWorkspaces, { orgId }),
    createWorkspace: (orgId: string, name: string) =>
      invoke(IpcChannel.OrgCreateWorkspace, { orgId, name }),
    updateWorkspace: (orgId: string, workspaceId: string, name: string) =>
      invoke(IpcChannel.OrgUpdateWorkspace, {
        orgId,
        workspaceId,
        name,
      }),
    deleteWorkspace: (orgId: string, workspaceId: string) =>
      invoke(IpcChannel.OrgDeleteWorkspace, { orgId, workspaceId }),
  },

  /* ── Local Application Registry ── */
  registry: {
    list: () => invoke(IpcChannel.RegistryList),
    get: (slug: string) => invoke(IpcChannel.RegistryGet, { slug }),
    setFlags: (slug: string, flags: { pinned?: boolean; favorite?: boolean }) =>
      invoke(IpcChannel.RegistrySetFlags, { slug, ...flags }),
    stats: () => invoke(IpcChannel.RegistryStats),
    export: () => invoke(IpcChannel.RegistryExport),
    import: (data: string) => invoke(IpcChannel.RegistryImport, { data }),
    backup: () => invoke(IpcChannel.RegistryBackup),
  },

  /* ── NeuroPause Package Service ── */
  nps: {
    install: (req: {
      slug: string;
      channel?: string;
      grantedPermissions?: RuntimePermissionKey[];
      installLocation?: string;
    }) => invoke(IpcChannel.NpsInstall, req),
    uninstall: (slug: string) => invoke(IpcChannel.NpsUninstall, { slug }),
    update: (slug: string) => invoke(IpcChannel.NpsUpdate, { slug }),
    rollback: (slug: string) => invoke(IpcChannel.NpsRollback, { slug }),
    repair: (slug: string) => invoke(IpcChannel.NpsRepair, { slug }),
    verify: (slug: string) => invoke(IpcChannel.NpsVerify, { slug }),
    operations: () => invoke(IpcChannel.NpsOperations),
    pause: (operationId: string) => invoke(IpcChannel.NpsPause, { operationId }),
    resume: (operationId: string) => invoke(IpcChannel.NpsResume, { operationId }),
    cancel: (operationId: string) => invoke(IpcChannel.NpsCancel, { operationId }),
    onProgress: (cb: (e: NpsProgressEvent) => void) => subscribe(IpcChannel.NpsProgress, cb),
  },

  /* ── Runtime ── */
  runtime: {
    launch: (slug: string) => invoke(IpcChannel.RuntimeLaunch, { slug }),
    stop: (instanceId: string) => invoke(IpcChannel.RuntimeStop, { instanceId }),
    /** Launch-at-login preference (V4.2). */
    getLoginAtStartup: () => invoke(IpcChannel.RuntimeGetLoginAtStartup),
    setLoginAtStartup: (enabled: boolean) =>
      invoke(IpcChannel.RuntimeSetLoginAtStartup, { enabled }),
    suspend: (instanceId: string) => invoke(IpcChannel.RuntimeSuspend, { instanceId }),
    resume: (instanceId: string) => invoke(IpcChannel.RuntimeResume, { instanceId }),
    restart: (instanceId: string) => invoke(IpcChannel.RuntimeRestart, { instanceId }),
    list: () => invoke(IpcChannel.RuntimeList),
    health: (instanceId?: string) => invoke(IpcChannel.RuntimeHealth, { instanceId }),
    onEvent: (cb: (e: RuntimeEvent) => void) => subscribe(IpcChannel.RuntimeEventBroadcast, cb),
    onOpenApp: (cb: (req: OpenAppRequest) => void) => subscribe(IpcChannel.RuntimeOpenApp, cb),
  },

  /* ── Permissions ── */
  perms: {
    list: (slug: string) => invoke(IpcChannel.PermsList, { slug }),
    grant: (slug: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PermsGrant, { slug, permission }),
    revoke: (slug: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PermsRevoke, { slug, permission }),
  },

  /* ── Plugin Runtime ── */
  plugins: {
    list: () => invoke(IpcChannel.PluginsList),
    get: (id: string) => invoke(IpcChannel.PluginsGet, { id }),
    install: (source: string) => invoke(IpcChannel.PluginsInstall, { source }),
    enable: (id: string) => invoke(IpcChannel.PluginsEnable, { id }),
    disable: (id: string) => invoke(IpcChannel.PluginsDisable, { id }),
    reload: (id: string) => invoke(IpcChannel.PluginsReload, { id }),
    update: (id: string) => invoke(IpcChannel.PluginsUpdate, { id }),
    remove: (id: string) => invoke(IpcChannel.PluginsRemove, { id }),
    grant: (id: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PluginsGrant, { id, permission }),
    revoke: (id: string, permission: RuntimePermissionKey) =>
      invoke(IpcChannel.PluginsRevoke, { id, permission }),
    contributions: (surface?: PluginSurfaceKind) =>
      invoke(IpcChannel.PluginsContributions, { surface }),
    /** Plugin SDK v2 (P3.0, Increment 6) — the declarative extensions plugins have registered. */
    extensions: () => invoke(IpcChannel.PluginsExtensions),
    onEvent: (cb: (e: PluginHostEvent) => void) => subscribe(IpcChannel.PluginEventBroadcast, cb),
  },

  /* ── Platform Core (event bus / timeline / diagnostics) ── */
  platform: {
    /** Subscribe to the unified live Platform Event stream. */
    onEvent: (cb: (e: PlatformEvent) => void) => subscribe(IpcChannel.PlatformEventBroadcast, cb),
    /** Publish a UI-origin event (workspace open/close). */
    emit: (
      type: 'workspace.opened' | 'workspace.closed',
      resource?: { id?: string; name?: string },
    ) =>
      invoke(IpcChannel.PlatformEmit, {
        type,
        resourceId: resource?.id,
        resourceName: resource?.name,
      }),
  },
  timeline: {
    query: (q?: TimelineQuery) => invoke(IpcChannel.TimelineQuery, q ?? {}),
    stats: () => invoke(IpcChannel.TimelineStats),
    export: () => invoke(IpcChannel.TimelineExport),
  },
  diagnostics: {
    get: () => invoke(IpcChannel.DiagnosticsGet),
  },

  /* ── Connector Framework (NCF) ── */
  connectors: {
    list: () => invoke(IpcChannel.ConnectorsList),
    get: (connectorId: string) => invoke(IpcChannel.ConnectorGet, { connectorId }),
    stats: () => invoke(IpcChannel.ConnectorStats),
    connect: (connectorId: string) => invoke(IpcChannel.ConnectorConnect, { connectorId }),
    disconnect: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorDisconnect, {
        connectorId,
        accountId,
      }),
    reconnect: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorReconnect, {
        connectorId,
        accountId,
      }),
    refresh: (connectorId: string, accountId: string) =>
      invoke(IpcChannel.ConnectorRefresh, {
        connectorId,
        accountId,
      }),
    sync: (connectorId: string, accountId?: string | null) =>
      invoke(IpcChannel.ConnectorSync, {
        connectorId,
        accountId,
      }),
    checkHealth: (connectorId: string, accountId?: string | null) =>
      invoke(IpcChannel.ConnectorHealthCheck, { connectorId, accountId }),
    logs: (connectorId?: string) => invoke(IpcChannel.ConnectorLogs, { connectorId }),
    onEvent: (cb: (e: ConnectorEvent) => void) => subscribe(IpcChannel.ConnectorEventBroadcast, cb),
    syncState: (connectorId?: string) =>
      invoke(IpcChannel.ConnectorSyncState, connectorId ? { connectorId } : {}),
    onSyncState: (cb: (s: ConnectorSyncSnapshot[]) => void) =>
      subscribe(IpcChannel.ConnectorSyncState, cb),

    /* ── P4.1 Connector Runtime v2 — runtime state, operator controls, live inspector, lifecycle stream ── */
    runtime: (connectorId?: string) => invoke(IpcChannel.ConnectorRuntime, { connectorId }),
    inspect: (connectorId: string) => invoke(IpcChannel.ConnectorInspect, { connectorId }),
    control: (connectorId: string, action: ConnectorControlAction, accountId?: string | null) =>
      invoke(IpcChannel.ConnectorControl, { connectorId, accountId, action }),
    onLifecycle: (cb: (e: ConnectorLifecycleEvent) => void) =>
      subscribe(IpcChannel.ConnectorLifecycleBroadcast, cb),

    /* ── P2.4 Microsoft 365 write actions (audited, confirmation-gated) + AI drafting ── */
    m365Actions: () => invoke(IpcChannel.M365ActionList),
    m365Execute: (
      connectorId: string,
      accountId: string,
      actionId: string,
      params: Record<string, unknown>,
      confirmed: boolean,
    ) =>
      invoke(IpcChannel.M365ActionExecute, { connectorId, accountId, actionId, params, confirmed }),
    m365Draft: (
      connectorId: string,
      accountId: string,
      kind: 'email' | 'summary' | 'agenda',
      instruction: string,
      context?: string,
    ) => invoke(IpcChannel.M365Draft, { connectorId, accountId, kind, instruction, context }),
  },

  /* ── Unified Knowledge Layer (UDM) ── */
  unified: {
    query: (q?: UnifiedQuery) => invoke(IpcChannel.UnifiedQuery, q ?? {}),
    get: (id: string) => invoke(IpcChannel.UnifiedGet, { id }),
    counts: () => invoke(IpcChannel.UnifiedCounts),
    search: (q: SearchQuery) => invoke(IpcChannel.UnifiedSearch, q),
    onChange: (cb: (counts: UnifiedCounts) => void) =>
      subscribe(IpcChannel.UnifiedEventBroadcast, cb),
  },

  graph: {
    counts: () => invoke(IpcChannel.GraphCounts),
    node: (id: string) => invoke(IpcChannel.GraphNode, { id }),
    nodes: (q?: GraphNodesQuery) => invoke(IpcChannel.GraphNodes, q ?? {}),
    neighbors: (q: GraphNeighborsQuery) => invoke(IpcChannel.GraphNeighbors, q),
    subgraph: (q: GraphSubgraphQuery) => invoke(IpcChannel.GraphSubgraph, q),
    path: (q: GraphPathQuery) => invoke(IpcChannel.GraphPath, q),
    history: (q: GraphHistoryQuery) => invoke(IpcChannel.GraphHistory, q),
    rebuild: () => invoke(IpcChannel.GraphRebuild),
    onChange: (cb: (counts: GraphCounts) => void) => subscribe(IpcChannel.GraphEventBroadcast, cb),
  },

  // P6 — Cloud & Infrastructure Control Plane (the Cloud Platform Center reads these).
  infra: {
    platforms: () => invoke(IpcChannel.InfraPlatforms),
    stats: () => invoke(IpcChannel.InfraStats),
    capabilities: () => invoke(IpcChannel.InfraCapabilities),
    resourceGraph: (filter?: { platformId?: string; accountId?: string }) =>
      invoke(IpcChannel.InfraResourceGraph, filter ?? {}),
    resourceNeighbors: (resourceId: string) =>
      invoke(IpcChannel.InfraResourceNeighbors, { resourceId }),
    discover: (platformId: string, accountId?: string) =>
      invoke(IpcChannel.InfraDiscover, { platformId, accountId }),
    // P6.1 — automation actions + global search.
    actions: (platformId?: string) =>
      invoke(IpcChannel.InfraActions, platformId ? { platformId } : {}),
    action: (req: {
      platformId: string;
      accountId?: string;
      actionId: string;
      params?: Record<string, unknown>;
      confirmed?: boolean;
    }) => invoke(IpcChannel.InfraAction, req),
    search: (query: string, opts?: { platformId?: string; domain?: string; limit?: number }) =>
      invoke(IpcChannel.InfraSearch, { query, ...opts }),
    onEvent: (cb: (e: InfraChangedEvent) => void) => subscribe(IpcChannel.InfraEventBroadcast, cb),
  },

  // P7.1 — Enterprise Intelligence (read-only). The unified report + the two
  // targeted analyses (change-impact + root-cause). Every channel is RBAC-gated
  // `intelligence:read` and cached ~3s server-side; the renderer never recomputes.
  enterpriseIntel: {
    report: () => invoke(IpcChannel.EnterpriseIntelReport),
    changeImpact: (req: EnterpriseIntelChangeImpactRequest) =>
      invoke(IpcChannel.EnterpriseIntelChangeImpact, req),
    rootCause: (req?: EnterpriseIntelRootCauseRequest) =>
      invoke(IpcChannel.EnterpriseIntelRootCause, req ?? {}),
  },

  /** Phase 6 Stage 6 — the Enterprise Intelligence Layer (read-only; every
   *  channel RBAC-gated `intelligence:read` and cached ~3 s server-side). */
  insight: {
    report: () => invoke(IpcChannel.InsightReport),
    rootCause: (req?: EnterpriseIntelRootCauseRequest) =>
      invoke(IpcChannel.InsightRootCause, req ?? {}),
    health: () => invoke(IpcChannel.InsightHealth),
    predictions: () => invoke(IpcChannel.InsightPredictions),
    dashboard: () => invoke(IpcChannel.InsightDashboard),
  },

  /** Phase 6 Stage 7 — the Enterprise Knowledge Platform (read-only; every
   *  channel RBAC-gated `knowledge:read` and cached ~3 s server-side). */
  kb: {
    inventory: (req?: {
      classId?: string;
      authority?: string;
      lifecycle?: string;
      text?: string;
    }) => invoke(IpcChannel.KbInventory, req ?? {}),
    matrix: () => invoke(IpcChannel.KbMatrix, {}),
    impact: (assetId: string) => invoke(IpcChannel.KbImpact, { assetId }),
    lineage: (decisionId?: string) =>
      invoke(IpcChannel.KbLineage, decisionId ? { decisionId } : {}),
    quality: () => invoke(IpcChannel.KbQuality),
    standards: () => invoke(IpcChannel.KbStandards),
    dashboard: () => invoke(IpcChannel.KbDashboard),
  },

  /** Phase 6 Stage 8 — the Enterprise Automation Platform (read-only; every
   *  channel RBAC-gated `autonomousops:read` and cached ~3 s server-side). */
  ap: {
    catalog: () => invoke(IpcChannel.ApCatalog),
    playbooks: (id?: string) => invoke(IpcChannel.ApPlaybooks, id ? { id } : {}),
    plan: (playbookId: string) => invoke(IpcChannel.ApPlan, { playbookId }),
    policies: () => invoke(IpcChannel.ApPolicies),
    monitor: () => invoke(IpcChannel.ApMonitor),
    dashboard: () => invoke(IpcChannel.ApDashboard),
  },

  /** Phase 6 Stage 9 — the Enterprise Operations Platform (read-only; every
   *  channel RBAC-gated `autonomousops:read` and cached ~3 s server-side). */
  eops: {
    catalog: () => invoke(IpcChannel.EopsCatalog),
    health: () => invoke(IpcChannel.EopsHealth),
    readiness: () => invoke(IpcChannel.EopsReadiness),
    incidents: () => invoke(IpcChannel.EopsIncidents),
    continuity: () => invoke(IpcChannel.EopsContinuity),
    dashboard: () => invoke(IpcChannel.EopsDashboard),
  },

  /** Phase 6 Stage 10 — the Enterprise Strategy Platform (read-only; every
   *  channel RBAC-gated `strategy:read` — the P14 read scope — and cached
   *  ~3 s server-side; distinct from the P14 `strategy:*` cluster below). */
  estrat: {
    objectives: () => invoke(IpcChannel.EstratObjectives),
    portfolio: () => invoke(IpcChannel.EstratPortfolio),
    planning: () => invoke(IpcChannel.EstratPlanning),
    health: () => invoke(IpcChannel.EstratHealth),
    dashboard: () => invoke(IpcChannel.EstratDashboard),
    report: () => invoke(IpcChannel.EstratReport),
  },

  /** Phase 6 Stage 11 — the Enterprise Federation Platform (read-only; every
   *  channel RBAC-gated `federation:read` — the P10 read scope — and cached
   *  ~3 s server-side; distinct from the `fed:*` / `federation:*` clusters). */
  efed: {
    partners: () => invoke(IpcChannel.EfedPartners),
    trust: () => invoke(IpcChannel.EfedTrust),
    exchange: () => invoke(IpcChannel.EfedExchange),
    sharing: () => invoke(IpcChannel.EfedSharing),
    dashboard: () => invoke(IpcChannel.EfedDashboard),
    report: () => invoke(IpcChannel.EfedReport),
  },

  /** Phase 6 Stage 12 — the Enterprise Analytics Platform (read-only; every
   *  channel RBAC-gated `intelligence:read` — the Stage 6 read scope — and
   *  cached ~3 s server-side; pure composition over the existing producers). */
  eana: {
    kpis: () => invoke(IpcChannel.EanaKpis),
    trends: () => invoke(IpcChannel.EanaTrends),
    forecasts: () => invoke(IpcChannel.EanaForecasts),
    decisions: () => invoke(IpcChannel.EanaDecisions),
    dashboard: () => invoke(IpcChannel.EanaDashboard),
    report: () => invoke(IpcChannel.EanaReport),
  },

  /** Phase 6 Stage 13 — the Enterprise Digital Twin Platform (read-only; every
   *  channel RBAC-gated `twin:read` — P15's OWN read scope, no new permission —
   *  and cached ~3 s server-side). Composition over P15, the Execute Engine,
   *  the Runtime Supervisor and the Stage 6–12 platforms: distinct from the
   *  `twin:*` cluster below, which stays authoritative and is untouched. */
  etwin: {
    runtime: () => invoke(IpcChannel.EtwinRuntime),
    platforms: () => invoke(IpcChannel.EtwinPlatforms),
    coverage: () => invoke(IpcChannel.EtwinCoverage),
    simulation: () => invoke(IpcChannel.EtwinSimulation),
    history: () => invoke(IpcChannel.EtwinHistory),
    dashboard: () => invoke(IpcChannel.EtwinDashboard),
    report: () => invoke(IpcChannel.EtwinReport),
  },

  knowledge: {
    topics: () => invoke(IpcChannel.KnowledgeTopics),
    related: (memoryId: string, limit?: number) =>
      invoke(IpcChannel.KnowledgeRelated, { memoryId, limit }),
    /** Registered in main since P6-Stage7 but previously missing from this facade. */
    health: () => invoke(IpcChannel.KnowledgeHealth),
  },

  /** Phase 6 Stage 1 — local workspace contexts (multi-workspace foundation). */
  workspaceContexts: {
    bootstrap: (legacySnapshot: unknown | null) =>
      invoke(IpcChannel.WorkspaceCtxBootstrap, legacySnapshot == null ? {} : { legacySnapshot }),
    list: () => invoke(IpcChannel.WorkspaceCtxList),
    create: (name: string, template: WorkspaceTemplateId, color?: string) =>
      invoke(IpcChannel.WorkspaceCtxCreate, {
        name,
        template,
        ...(color ? { color } : {}),
      }),
    rename: (id: string, name: string) => invoke(IpcChannel.WorkspaceCtxRename, { id, name }),
    remove: (id: string) => invoke(IpcChannel.WorkspaceCtxDelete, { id }),
    switch: (id: string) => invoke(IpcChannel.WorkspaceCtxSwitch, { id }),
    updateSnapshot: (id: string, snapshot: ShellSnapshotDto) =>
      invoke(IpcChannel.WorkspaceCtxUpdateSnapshot, {
        id,
        snapshot,
      }),
  },

  memory: {
    recall: (q?: MemoryRecallQuery) => invoke(IpcChannel.MemoryRecall, q ?? {}),
    semanticRecall: (q?: MemoryRecallQuery) => invoke(IpcChannel.MemorySemanticRecall, q ?? {}),
    get: (id: string) => invoke(IpcChannel.MemoryGet, { id }),
    remember: (input: MemoryWriteInput) => invoke(IpcChannel.MemoryRemember, input),
    forget: (ids: string[]) => invoke(IpcChannel.MemoryForget, { ids }),
    counts: () => invoke(IpcChannel.MemoryCounts),
    rebuild: () => invoke(IpcChannel.MemoryRebuild),
    onChange: (cb: (counts: MemoryCounts) => void) =>
      subscribe(IpcChannel.MemoryEventBroadcast, cb),
  },

  execMemory: {
    search: (q?: ExecutiveMemoryQuery) => invoke(IpcChannel.ExecMemorySearch, q ?? {}),
    forget: (id: string) => invoke(IpcChannel.ExecMemoryForget, { id }),
    pin: (id: string, pinned: boolean) => invoke(IpcChannel.ExecMemoryPin, { id, pinned }),
    resolve: (id: string, status: ExecutiveMemoryStatus) =>
      invoke(IpcChannel.ExecMemoryResolve, { id, status }),
    audit: (q?: {
      limit?: number;
      offset?: number;
      action?: MemoryAuditAction;
      memoryId?: string;
    }) => invoke(IpcChannel.ExecMemoryAudit, q ?? {}),
  },

  search: {
    enterprise: (q: EnterpriseSearchQuery) => invoke(IpcChannel.EnterpriseSearch, q),
  },

  enterpriseTimeline: {
    query: (q?: EnterpriseTimelineQuery) => invoke(IpcChannel.EnterpriseTimelineQuery, q ?? {}),
    replay: (q?: TimelineReplayQuery) => invoke(IpcChannel.EnterpriseTimelineReplay, q ?? {}),
    stats: () => invoke(IpcChannel.EnterpriseTimelineStats),
    export: () => invoke(IpcChannel.EnterpriseTimelineExport),
    onChange: (cb: (stats: EnterpriseTimelineStats) => void) =>
      subscribe(IpcChannel.EnterpriseTimelineEventBroadcast, cb),
  },

  intelligence: {
    briefing: (period: BriefingPeriod, now?: string) =>
      invoke(IpcChannel.BriefingGenerate, { period, now }),
    executiveCenterSnapshot: () => invoke(IpcChannel.ExecutiveCenterSnapshot),
    voiceTurn: (transcript: string, displayName?: string) =>
      invoke(IpcChannel.VoiceTurn, { transcript, displayName }),
  },

  decisions: {
    list: () => invoke(IpcChannel.DecisionList),
    createFromRecommendation: (recommendationId: string) =>
      invoke(IpcChannel.DecisionCreateFromRecommendation, {
        recommendationId,
      }),
    setStatus: (id: string, status: ExecutiveDecision['status']) =>
      invoke(IpcChannel.DecisionSetStatus, { id, status }),
  },

  automations: {
    list: () => invoke(IpcChannel.AutomationList),
    save: (rule: AutomationRule) => invoke(IpcChannel.AutomationSave, { rule }),
    setStatus: (id: string, status: AutomationRule['status']) =>
      invoke(IpcChannel.AutomationSetStatus, { id, status }),
    remove: (id: string) => invoke(IpcChannel.AutomationRemove, { id }),
    run: (id: string) => invoke(IpcChannel.AutomationRun, { id }),
    monitor: () => invoke(IpcChannel.AutomationMonitor),
    history: () => invoke(IpcChannel.AutomationHistory),
  },

  system: {
    /** NeuroCore composed system-health snapshot (V5.0). */
    health: () => invoke(IpcChannel.SystemHealthSnapshot),
  },

  supervisor: {
    /** Runtime supervisor status (V5.3). */
    status: () => invoke(IpcChannel.SupervisorStatus),
    history: () => invoke(IpcChannel.SupervisorHistory),
    recover: (subsystem: SupervisedSubsystem) =>
      invoke(IpcChannel.SupervisorRecover, { subsystem }),
    setPolicy: (subsystem: SupervisedSubsystem, policy: RecoveryPolicy) =>
      invoke(IpcChannel.SupervisorSetPolicy, { subsystem, policy }),
  },

  execute: {
    /** Run any executable through the unified Execute Engine (V5.4). */
    run: (req: ExecutionRequest) => invoke(IpcChannel.ExecuteRun, req),
    sessions: () => invoke(IpcChannel.ExecuteSessions),
    history: () => invoke(IpcChannel.ExecuteHistory),
    cancel: (id: string) => invoke(IpcChannel.ExecuteCancel, { id }),
  },

  voice: {
    /** Report the live voice runtime state to main for NeuroCore (V5.2). */
    reportStatus: (state: VoiceRuntimeState) => invoke(IpcChannel.VoiceStatus, { state }),
  },

  recommendations: {
    generate: (q?: RecommendationQuery) => invoke(IpcChannel.RecommendationsGenerate, q ?? {}),
  },

  founderAI: {
    ask: (text: string, now?: string) => invoke(IpcChannel.FounderAsk, { text, now }),
    askV2: (text: string, now?: string) => invoke(IpcChannel.FounderAskV2, { text, now }),
    suggestions: (now?: string) => invoke(IpcChannel.FounderSuggestions, { now }),
  },

  /** Phase 6 Stage 4 — the Workspace Assistant (documented D-1 cluster). */
  assistant: {
    ask: (req: AssistantAskRequest) => invoke(IpcChannel.AssistantAsk, req),
    conversations: (workspaceId?: string | null, limit?: number) =>
      invoke(IpcChannel.AssistantConversations, { workspaceId, limit }),
    conversation: (conversationId: string) =>
      invoke(IpcChannel.AssistantConversationGet, { conversationId }),
    save: (req: { conversationId: string; title?: string; pinned?: boolean }) =>
      invoke(IpcChannel.AssistantConversationSave, req),
    remove: (conversationId: string) =>
      invoke(IpcChannel.AssistantConversationDelete, { conversationId }),
    branch: (conversationId: string, messageId: string, now?: string) =>
      invoke(IpcChannel.AssistantConversationBranch, { conversationId, messageId, now }),
    decideStep: (req: {
      conversationId: string;
      messageId: string;
      stepId: string;
      decision: 'approve' | 'reject';
      note?: string | null;
    }) => invoke(IpcChannel.AssistantPlanDecide, req),
    cancel: (conversationId: string) => invoke(IpcChannel.AssistantCancel, { conversationId }),
    onEvent: (cb: (event: AssistantEvent) => void) =>
      subscribe(IpcChannel.AssistantEventBroadcast, cb),
  },

  /** Phase 6 Stage 5 (D-8) — the Notification Inbox over the EXISTING delivery
   *  engine's notification-center channel, plus the surfaced preference store. */
  notifications: {
    list: (limit?: number) =>
      invoke(IpcChannel.NotificationsList, limit === undefined ? {} : { limit }),
    markRead: (ids: 'all' | string[]) => invoke(IpcChannel.NotificationsMarkRead, { ids }),
    prefs: () => invoke(IpcChannel.NotificationsPrefsGet),
    setPrefs: (patch: NotificationsPrefsSetRequest) =>
      invoke(IpcChannel.NotificationsPrefsSet, patch),
    onEvent: (cb: (event: NotificationInboxEvent) => void) =>
      subscribe(IpcChannel.NotificationsEventBroadcast, cb),
  },

  /** Mobile M1-03 — the desktop Companion Gateway management surface (Settings → Companion). */
  companion: {
    status: () => invoke(IpcChannel.CompanionStatus),
    devices: () => invoke(IpcChannel.CompanionDevices),
    enable: (enabled: boolean) => invoke(IpcChannel.CompanionEnable, { enabled }),
    revoke: (deviceId: string) => invoke(IpcChannel.CompanionRevoke, { deviceId }),
    pairingQr: () => invoke(IpcChannel.CompanionPairingQr),
    onEvent: (cb: (event: CompanionGatewayEvent) => void) =>
      subscribe(IpcChannel.CompanionEventBroadcast, cb),
  },

  engineering: {
    analyze: (now?: string) => invoke(IpcChannel.EngineeringAnalyze, { now }),
  },

  governance: {
    list: (text?: string, limit?: number) => invoke(IpcChannel.GovernanceList, { text, limit }),
    trace: (decisionId: string) => invoke(IpcChannel.GovernanceTrace, { decisionId }),
  },

  context: {
    trace: (entityRef: string, limit?: number) =>
      invoke(IpcChannel.ContextTrace, { entityRef, limit }),
  },

  relationship: {
    trace: (nodeId: string, limit?: number) =>
      invoke(IpcChannel.RelationshipTrace, { nodeId, limit }),
    path: (from: string, to: string) => invoke(IpcChannel.RelationshipPath, { from, to }),
  },

  workforce: {
    intelligence: () => invoke(IpcChannel.WorkforceIntelligence),
    workers: () => invoke(IpcChannel.WorkforceWorkers),
    worker: (workerId: string) => invoke(IpcChannel.WorkforceWorkerGet, { workerId }),
    runJob: (workerId: string, skillId: string, input?: Record<string, unknown>, now?: string) =>
      invoke(IpcChannel.WorkforceJobRun, { workerId, skillId, input, now }),
    jobs: (q?: { workerId?: string; status?: JobStatus; limit?: number; offset?: number }) =>
      invoke(IpcChannel.WorkforceJobs, q ?? {}),
    job: (jobId: string) => invoke(IpcChannel.WorkforceJobGet, { jobId }),
    approve: (jobId: string, proposalId: string, note?: string, now?: string) =>
      invoke(IpcChannel.WorkforceProposalApprove, {
        jobId,
        proposalId,
        note,
        now,
      }),
    reject: (jobId: string, proposalId: string, note?: string, now?: string) =>
      invoke(IpcChannel.WorkforceProposalReject, {
        jobId,
        proposalId,
        note,
        now,
      }),
    runWorkflow: (spec: WorkflowSpec, now?: string) =>
      invoke(IpcChannel.WorkforceWorkflowRun, { spec, now }),
    workflowRuns: () => invoke(IpcChannel.WorkforceWorkflowRuns),
    resumeWorkflow: (runId: string) => invoke(IpcChannel.WorkforceWorkflowResume, { runId }),
    approveCheckpoint: (runId: string, stepId: string, approved: boolean, now?: string) =>
      invoke(IpcChannel.WorkforceWorkflowCheckpoint, {
        runId,
        stepId,
        approved,
        now,
      }),
    audit: (q?: {
      workerId?: string;
      decision?: VerdictDecision;
      limit?: number;
      offset?: number;
    }) => invoke(IpcChannel.WorkforceAudit, q ?? {}),
    policies: () => invoke(IpcChannel.WorkforcePolicies),
    // P8 — plan the delegation of a goal's task graph across the worker roster.
    delegate: (req: WorkforceDelegateRequest) => invoke(IpcChannel.WorkforceDelegatePlan, req),
    // P8.5 — Installable Workers (install/lifecycle gated by workforce:manage).
    installs: () => invoke(IpcChannel.WorkforceInstalls),
    installDetail: (workerId: string) => invoke(IpcChannel.WorkforceInstallGet, { workerId }),
    install: (pkg: WorkerPackage) => invoke(IpcChannel.WorkforceInstall, { package: pkg }),
    updateInstall: (pkg: WorkerPackage) =>
      invoke(IpcChannel.WorkforceInstallUpdate, { package: pkg }),
    enableInstall: (workerId: string) => invoke(IpcChannel.WorkforceInstallEnable, { workerId }),
    disableInstall: (workerId: string) => invoke(IpcChannel.WorkforceInstallDisable, { workerId }),
    rollbackInstall: (workerId: string) =>
      invoke(IpcChannel.WorkforceInstallRollback, { workerId }),
    uninstall: (workerId: string) => invoke(IpcChannel.WorkforceUninstall, { workerId }),
    onEvent: (cb: (snapshot: WorkforceCountsEvent) => void) =>
      subscribe(IpcChannel.WorkforceEventBroadcast, cb),
  },

  enterprise: {
    org: () => invoke(IpcChannel.EnterpriseOrgGet),
    createUnit: (input: {
      kind: OrgUnitKind;
      name: string;
      parentId?: string | null;
      leadUserId?: string | null;
    }) => invoke(IpcChannel.EnterpriseOrgCreateUnit, input),
    updateUnit: (input: {
      id: string;
      name?: string;
      parentId?: string | null;
      leadUserId?: string | null;
    }) => invoke(IpcChannel.EnterpriseOrgUpdateUnit, input),
    deleteUnit: (id: string) => invoke(IpcChannel.EnterpriseOrgDeleteUnit, { id }),
    createUser: (input: {
      name: string;
      email?: string | null;
      title?: string;
      unitId?: string | null;
      roleIds?: string[];
    }) => invoke(IpcChannel.EnterpriseOrgCreateUser, input),
    updateUser: (input: {
      id: string;
      name?: string;
      email?: string | null;
      title?: string;
      unitId?: string | null;
      roleIds?: string[];
      status?: OrgUserStatus;
    }) => invoke(IpcChannel.EnterpriseOrgUpdateUser, input),
    deleteUser: (id: string) => invoke(IpcChannel.EnterpriseOrgDeleteUser, { id }),
    createRole: (input: {
      name: string;
      description?: string;
      permissions: EnterprisePermission[];
    }) => invoke(IpcChannel.EnterpriseOrgCreateRole, input),
    updateRole: (input: {
      id: string;
      name?: string;
      description?: string;
      permissions?: EnterprisePermission[];
    }) => invoke(IpcChannel.EnterpriseOrgUpdateRole, input),
    deleteRole: (id: string) => invoke(IpcChannel.EnterpriseOrgDeleteRole, { id }),

    workspaces: () => invoke(IpcChannel.EnterpriseWorkspaceList),
    activeWorkspace: () => invoke(IpcChannel.EnterpriseWorkspaceActive),
    createWorkspace: (name: string, organizationId?: string) =>
      invoke(IpcChannel.EnterpriseWorkspaceCreate, { name, organizationId }),
    switchWorkspace: (id: string) => invoke(IpcChannel.EnterpriseWorkspaceSwitch, { id }),

    graph: () => invoke(IpcChannel.EnterpriseGraph),
    graphNeighbors: (id: string) => invoke(IpcChannel.EnterpriseGraphNeighbors, { id }),

    governanceConfig: () => invoke(IpcChannel.EnterpriseGovernanceConfig),
    compliance: () => invoke(IpcChannel.EnterpriseGovernanceCompliance),
    setChain: (id: string, enabled: boolean) =>
      invoke(IpcChannel.EnterpriseGovernanceSetChain, { id, enabled }),
    setRule: (id: string, enabled: boolean) =>
      invoke(IpcChannel.EnterpriseGovernanceSetRule, { id, enabled }),
    audit: (limit?: number) => invoke(IpcChannel.EnterpriseGovernanceAudit, { limit }),

    dashboard: () => invoke(IpcChannel.EnterpriseDashboard),

    /** Process Explorer — read-only projection of the mined processes (graph + filtered case list + KPIs). */
    processExplore: (filter?: ProcessExplorerFilter) =>
      invoke(IpcChannel.EnterpriseProcessExplore, filter ?? {}),
    /** Process Explorer — full detail for one reconstructed case. */
    processCase: (id: string) => invoke(IpcChannel.EnterpriseProcessCase, { id }),

    /** Production Schedule — read-only routing schedule (Gantt + KPIs + violations + governance proposals). */
    scheduleExplore: () => invoke(IpcChannel.EnterpriseScheduleExplore),

    /** Operator Console (MES) — read-only shop-floor execution model (executions + machines + operators + quality + timeline + KPIs). */
    executionExplore: () => invoke(IpcChannel.EnterpriseExecutionExplore),

    /** Relationship Intelligence — read-only ERP entity relationship graph (nodes + typed edges + health/risk + KPIs + narrative). */
    relationshipExplore: () => invoke(IpcChannel.EnterpriseRelationshipExplore),

    /** Trust Engine — read-only per-entity deterministic trust model (profiles + factors + trend + KPIs + narrative). */
    trustExplore: () => invoke(IpcChannel.EnterpriseTrustExplore),

    /** Context Engine (P2.5) — entity-360 for any unified-graph / ERP entity id (neighbors + impact + timeline + memory). */
    context: (input: {
      id: string;
      neighborLimit?: number;
      activityLimit?: number;
      memoryLimit?: number;
      impactDepth?: number;
    }) => invoke(IpcChannel.EnterpriseContext, input),

    /** Personalization — per-user Favorites / Recently-Opened / Saved Views (actor resolved server-side). */
    personalization: {
      get: () => invoke(IpcChannel.EnterprisePersonalizationGet),
      favorite: (input: {
        id: string;
        kind?: string;
        label?: string;
        tab: string;
        query?: string;
      }) => invoke(IpcChannel.EnterprisePersonalizationFavorite, input),
      recent: (input: { id: string; kind?: string; label?: string; tab: string; query?: string }) =>
        invoke(IpcChannel.EnterprisePersonalizationRecent, input),
      clearRecents: () => invoke(IpcChannel.EnterprisePersonalizationClearRecents),
      saveView: (input: {
        id?: string;
        label: string;
        tab: string;
        query?: string;
        filters?: string;
      }) => invoke(IpcChannel.EnterprisePersonalizationSaveView, input),
      deleteView: (id: string) => invoke(IpcChannel.EnterprisePersonalizationDeleteView, { id }),
      renameView: (id: string, label: string) =>
        invoke(IpcChannel.EnterprisePersonalizationRenameView, { id, label }),
    },

    onEvent: (cb: (e: IpcStoreChangedEvent) => void) =>
      subscribe(IpcChannel.EnterpriseEventBroadcast, cb),
  },

  /** Enterprise Module Framework — generic CRUD over any registered ERP module. */
  // Phase 8 (8.14): bundled in-app documentation.
  help: {
    list: () => invoke(IpcChannel.HelpListDocs),
    open: (doc: HelpDocId) => invoke(IpcChannel.HelpOpenDoc, { doc }),
  },

  enterpriseModules: {
    list: () => invoke(IpcChannel.EnterpriseModulesList),
    records: (
      moduleId: string,
      opts?: { status?: EnterpriseRecordStatus; search?: string; limit?: number },
    ) => invoke(IpcChannel.EnterpriseModuleList, { moduleId, ...opts }),
    get: (moduleId: string, id: string) => invoke(IpcChannel.EnterpriseModuleGet, { moduleId, id }),
    search: (moduleId: string, query: string, limit?: number) =>
      invoke(IpcChannel.EnterpriseModuleSearch, { moduleId, query, limit }),
    create: (moduleId: string, input: EnterpriseRecordInput) =>
      invoke(IpcChannel.EnterpriseModuleCreate, {
        moduleId,
        ...input,
      }),
    update: (moduleId: string, id: string, input: EnterpriseRecordInput) =>
      invoke(IpcChannel.EnterpriseModuleUpdate, {
        moduleId,
        id,
        ...input,
      }),
    setStatus: (moduleId: string, id: string, status: EnterpriseRecordStatus) =>
      invoke(IpcChannel.EnterpriseModuleSetStatus, {
        moduleId,
        id,
        status,
      }),
    remove: (moduleId: string, id: string, force?: boolean) =>
      invoke(IpcChannel.EnterpriseModuleDelete, {
        moduleId,
        id,
        ...(force === undefined ? {} : { force }),
      }),
    summarize: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleSummarize, {
        moduleId,
        id,
      }),
    /** Line items + derived totals for a document. */
    lines: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleLines, { moduleId, id }),
    /** Replace a document's lines. Totals are re-derived, never sent. */
    setLines: (moduleId: string, id: string, lines: DocumentLineInput[]) =>
      invoke(IpcChannel.EnterpriseModuleSetLines, { moduleId, id, lines }),
    /** Approval state: required steps, what is satisfied, who may act next. */
    approval: (moduleId: string, id: string) =>
      invoke(IpcChannel.EnterpriseModuleApproval, { moduleId, id }),
    /** Record an approval decision. Role eligibility and SoD are enforced. */
    approve: (
      moduleId: string,
      id: string,
      stepId: string,
      decision: 'approved' | 'rejected',
      note?: string,
    ) =>
      invoke(IpcChannel.EnterpriseModuleApprove, {
        moduleId,
        id,
        stepId,
        decision,
        ...(note ? { note } : {}),
      }),
    action: (moduleId: string, id: string, action: string) =>
      invoke(IpcChannel.EnterpriseModuleAction, {
        moduleId,
        id,
        action,
      }),
    onEvent: (cb: (e: EnterpriseModuleEvent) => void) =>
      subscribe(IpcChannel.EnterpriseModuleEventBroadcast, cb),
  },

  ecosystem: {
    dashboard: () => invoke(IpcChannel.EcosystemDeveloperDashboard),
    account: () => invoke(IpcChannel.EcosystemDeveloperAccount),
    setPlan: (planTier: PlanTier) => invoke(IpcChannel.EcosystemDeveloperSetPlan, { planTier }),
    keys: () => invoke(IpcChannel.EcosystemKeysList),
    createKey: (name: string, scopes: ApiScope[], expiresAt?: string | null) =>
      invoke(IpcChannel.EcosystemKeysCreate, {
        name,
        scopes,
        expiresAt,
      }),
    revokeKey: (id: string) => invoke(IpcChannel.EcosystemKeysRevoke, { id }),
    oauthApps: () => invoke(IpcChannel.EcosystemOAuthList),
    createOAuthApp: (input: {
      name: string;
      redirectUris: string[];
      scopes: ApiScope[];
      grantTypes: OAuthGrantType[];
    }) => invoke(IpcChannel.EcosystemOAuthCreate, input),
    deleteOAuthApp: (id: string) => invoke(IpcChannel.EcosystemOAuthDelete, { id }),
    usage: (windowDays?: number) => invoke(IpcChannel.EcosystemUsageAnalytics, { windowDays }),
    sdks: () => invoke(IpcChannel.EcosystemSdks),

    listings: () => invoke(IpcChannel.EcosystemMarketplaceList),
    listing: (id: string) => invoke(IpcChannel.EcosystemMarketplaceDetail, { id }),
    marketplaceStats: () => invoke(IpcChannel.EcosystemMarketplaceStats),
    submissionEvents: (listingId?: string, limit?: number) =>
      invoke(IpcChannel.EcosystemMarketplaceEvents, { listingId, limit }),
    createListing: (input: {
      kind: ListingKind;
      slug: string;
      name: string;
      summary: string;
      category: string;
      pricing: ListingPricing;
      certified?: boolean;
    }) => invoke(IpcChannel.EcosystemListingCreate, input),
    createVersion: (listingId: string, manifest: ListingManifest, changelog: string) =>
      invoke(IpcChannel.EcosystemVersionCreate, {
        listingId,
        manifest,
        changelog,
      }),
    submit: (versionId: string) => invoke(IpcChannel.EcosystemListingSubmit, { versionId }),
    review: (versionId: string, decision: ReviewDecision, notes?: string) =>
      invoke(IpcChannel.EcosystemListingReview, {
        versionId,
        decision,
        notes,
      }),
    publish: (versionId: string) => invoke(IpcChannel.EcosystemListingPublish, { versionId }),
    rollback: (listingId: string) =>
      invoke(IpcChannel.EcosystemListingRollback, {
        listingId,
      }),
    install: (listingId: string) =>
      invoke(IpcChannel.EcosystemListingInstall, {
        listingId,
      }),
    rate: (listingId: string, stars: number) =>
      invoke(IpcChannel.EcosystemListingRate, {
        listingId,
        stars,
      }),

    gatewayVersions: () => invoke(IpcChannel.EcosystemGatewayVersions),
    gatewayRequest: (input: {
      apiKey?: string | null;
      method: string;
      path: string;
      version: ApiVersion;
      scope?: ApiScope | null;
    }) => invoke(IpcChannel.EcosystemGatewayRequest, input),
    gatewayAudit: (limit?: number) => invoke(IpcChannel.EcosystemGatewayAudit, { limit }),
    gatewayMetrics: (windowDays?: number) =>
      invoke(IpcChannel.EcosystemGatewayMetrics, { windowDays }),

    billingSummary: () => invoke(IpcChannel.EcosystemBillingSummary),
    plans: () => invoke(IpcChannel.EcosystemBillingPlans),
    setBillingPlan: (planTier: PlanTier) =>
      invoke(IpcChannel.EcosystemBillingSetPlan, { planTier }),
    invoice: (period?: string) => invoke(IpcChannel.EcosystemBillingInvoice, { period }),
    seats: () => invoke(IpcChannel.EcosystemBillingSeats),
    assignSeat: (userId: string, userName: string) =>
      invoke(IpcChannel.EcosystemBillingAssignSeat, { userId, userName }),
    releaseSeat: (seatId: string) => invoke(IpcChannel.EcosystemBillingReleaseSeat, { seatId }),
    licenses: () => invoke(IpcChannel.EcosystemBillingLicenses),
    purchase: (listingId: string) => invoke(IpcChannel.EcosystemBillingPurchase, { listingId }),
    purchases: () => invoke(IpcChannel.EcosystemBillingPurchases),

    installs: () => invoke(IpcChannel.EcosystemInstallsList),
    installSummary: () => invoke(IpcChannel.EcosystemInstallsSummary),
    installListing: (listingId: string) => invoke(IpcChannel.EcosystemInstall, { listingId }),
    updateInstall: (installationId: string) =>
      invoke(IpcChannel.EcosystemInstallUpdate, { installationId }),
    setInstallEnabled: (installationId: string, enabled: boolean) =>
      invoke(IpcChannel.EcosystemInstallSetEnabled, {
        installationId,
        enabled,
      }),
    uninstall: (installationId: string) =>
      invoke(IpcChannel.EcosystemUninstall, { installationId }),
    shareWorker: (workerId: string) => invoke(IpcChannel.EcosystemShareWorker, { workerId }),
    packs: () => invoke(IpcChannel.EcosystemPacksList),
    packsStats: () => invoke(IpcChannel.EcosystemPacksStats),
    publishPack: (input: { name: string; summary: string; kind: PackKind; items: PackItem[] }) =>
      invoke(IpcChannel.EcosystemPackPublish, input),
    importPack: (id: string) => invoke(IpcChannel.EcosystemPackImport, { id }),
    removePack: (id: string) => invoke(IpcChannel.EcosystemPackRemove, { id }),
    partners: () => invoke(IpcChannel.EcosystemPartnersList),
    partnersStats: () => invoke(IpcChannel.EcosystemPartnersStats),
    analytics: () => invoke(IpcChannel.EcosystemAnalytics),

    onEvent: (cb: (e: IpcStoreChangedEvent) => void) =>
      subscribe(IpcChannel.EcosystemEventBroadcast, cb),
  },

  // ── P12 — Developer Platform (registry/rollup over the ecosystem developer stack) ──
  developerPlatform: {
    overview: () => invoke(IpcChannel.DevPlatformOverview),
    console: () => invoke(IpcChannel.DevPlatformConsole),
    sdks: () => invoke(IpcChannel.DevPlatformSdks),
    apis: () => invoke(IpcChannel.DevPlatformApis),
    templates: () => invoke(IpcChannel.DevPlatformTemplates),
    publishing: () => invoke(IpcChannel.DevPlatformPublishing),
    analytics: () => invoke(IpcChannel.DevPlatformAnalytics),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P13 — Industry Solution Platform (curated solution-pack catalog + readiness projection) ──
  industryPlatform: {
    overview: () => invoke(IpcChannel.IndustryOverview),
    suites: () => invoke(IpcChannel.IndustrySuites),
    kpis: () => invoke(IpcChannel.IndustryKpis),
    compliance: () => invoke(IpcChannel.IndustryCompliance),
    collections: () => invoke(IpcChannel.IndustryCollections),
    readiness: () => invoke(IpcChannel.IndustryReadiness),
    // IP-03b — the canonical Wave 9 catalog (@neuropause/industry) bridged to the desktop.
    snapshot: () => invoke(IpcChannel.IndustrySnapshot),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P14 — Autonomous Enterprise Intelligence (read-only strategic reasoning/projection layer) ──
  strategyPlatform: {
    overview: () => invoke(IpcChannel.StrategyOverview),
    goals: () => invoke(IpcChannel.StrategyGoals),
    planning: () => invoke(IpcChannel.StrategyPlanning),
    reasoning: () => invoke(IpcChannel.StrategyReasoning),
    optimization: () => invoke(IpcChannel.StrategyOptimization),
    simulation: () => invoke(IpcChannel.StrategySimulation),
    decisions: () => invoke(IpcChannel.StrategyDecisions),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P15 — Enterprise Digital Twin (read-only living projection of the whole enterprise) ──
  twin: {
    overview: () => invoke(IpcChannel.TwinOverview),
    domains: () => invoke(IpcChannel.TwinDomains),
    topology: () => invoke(IpcChannel.TwinTopology),
    health: () => invoke(IpcChannel.TwinHealth),
    replay: () => invoke(IpcChannel.TwinReplay),
    scenario: () => invoke(IpcChannel.TwinScenario),
    impact: () => invoke(IpcChannel.TwinImpact),
    executive: () => invoke(IpcChannel.TwinExecutive),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P16 — Enterprise Knowledge Fabric (read-only knowledge projection over every system) ──
  knowledgeFabric: {
    overview: () => invoke(IpcChannel.FabricOverview),
    sources: () => invoke(IpcChannel.FabricSources),
    relationships: () => invoke(IpcChannel.FabricRelationships),
    classification: () => invoke(IpcChannel.FabricClassification),
    lineage: () => invoke(IpcChannel.FabricLineage),
    evidence: () => invoke(IpcChannel.FabricEvidence),
    governance: () => invoke(IpcChannel.FabricGovernance),
    analytics: () => invoke(IpcChannel.FabricAnalytics),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P17 — Global AI Orchestration Platform (read-only coordination/routing over every system) ──
  orchestration: {
    overview: () => invoke(IpcChannel.OrchestrationOverview),
    goals: () => invoke(IpcChannel.OrchestrationGoals),
    workforce: () => invoke(IpcChannel.OrchestrationWorkforce),
    cloud: () => invoke(IpcChannel.OrchestrationCloud),
    knowledge: () => invoke(IpcChannel.OrchestrationKnowledge),
    flows: () => invoke(IpcChannel.OrchestrationFlows),
    coordination: () => invoke(IpcChannel.OrchestrationCoordination),
    governance: () => invoke(IpcChannel.OrchestrationGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P18 — Enterprise Intelligence Network (read-only governed intelligence exchange; no raw enterprise data) ──
  network: {
    overview: () => invoke(IpcChannel.NetworkOverview),
    exchange: () => invoke(IpcChannel.NetworkExchange),
    benchmarks: () => invoke(IpcChannel.NetworkBenchmarks),
    insights: () => invoke(IpcChannel.NetworkInsights),
    trust: () => invoke(IpcChannel.NetworkTrust),
    organizations: () => invoke(IpcChannel.NetworkOrganizations),
    collective: () => invoke(IpcChannel.NetworkCollective),
    governance: () => invoke(IpcChannel.NetworkGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P19 — Autonomous Enterprise Operations (read-only closed-loop operations; nothing executes here) ──
  autoOps: {
    overview: () => invoke(IpcChannel.AutoOpsOverview),
    plans: () => invoke(IpcChannel.AutoOpsPlans),
    execution: () => invoke(IpcChannel.AutoOpsExecution),
    recovery: () => invoke(IpcChannel.AutoOpsRecovery),
    optimization: () => invoke(IpcChannel.AutoOpsOptimization),
    incidents: () => invoke(IpcChannel.AutoOpsIncidents),
    approvals: () => invoke(IpcChannel.AutoOpsApprovals),
    monitoring: () => invoke(IpcChannel.AutoOpsMonitoring),
    analytics: () => invoke(IpcChannel.AutoOpsAnalytics),
    governance: () => invoke(IpcChannel.AutoOpsGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── P20 — NeuroPause Platform v2 (read-only commercial productization; nothing transacts here) ──
  commercial: {
    overview: () => invoke(IpcChannel.CommercialOverview),
    subscription: () => invoke(IpcChannel.CommercialSubscription),
    licensing: () => invoke(IpcChannel.CommercialLicensing),
    billing: () => invoke(IpcChannel.CommercialBilling),
    metering: () => invoke(IpcChannel.CommercialMetering),
    deployment: () => invoke(IpcChannel.CommercialDeployment),
    customers: () => invoke(IpcChannel.CommercialCustomers),
    analytics: () => invoke(IpcChannel.CommercialAnalytics),
    releases: () => invoke(IpcChannel.CommercialReleases),
    administration: () => invoke(IpcChannel.CommercialAdministration),
    governance: () => invoke(IpcChannel.CommercialGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── Experience Program v1.0 — Decision-First Experience (read-only compression; nothing executes here) ──
  experience: {
    home: () => invoke(IpcChannel.ExperienceHome),
    decisions: () => invoke(IpcChannel.ExperienceDecisions),
    summaries: () => invoke(IpcChannel.ExperienceSummaries),
    intents: () => invoke(IpcChannel.ExperienceIntents),
    governance: () => invoke(IpcChannel.ExperienceGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  // ── Intent Experience Program v2.0 — Intent-Native Experience (read-only reprojection; nothing executes) ──
  intent: {
    board: () => invoke(IpcChannel.IntentBoard),
    workspaces: () => invoke(IpcChannel.IntentWorkspaces),
    governance: () => invoke(IpcChannel.IntentGovernance),
    // Reuses the ecosystem subsystem's existing `ecosystem:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.EcosystemEventBroadcast, () => cb()),
  },

  /* ── P9 — Enterprise Marketplace (governed catalog over the ecosystem) ── */
  marketplace: {
    catalog: (query: MarketplaceCatalogQuery = {}) => invoke(IpcChannel.MarketplaceCatalog, query),
    entry: (listingId: string) => invoke(IpcChannel.MarketplaceEntry, { listingId }),
    publishers: () => invoke(IpcChannel.MarketplacePublishers),
    trust: (listingId: string) => invoke(IpcChannel.MarketplaceTrust, { listingId }),
    plan: (listingId: string) => invoke(IpcChannel.MarketplacePlan, { listingId }),
    analytics: () => invoke(IpcChannel.MarketplaceAnalytics),
    policy: () => invoke(IpcChannel.MarketplacePolicyGet),
    setPolicy: (policy: Omit<OrgMarketplacePolicy, 'updatedAt'>) =>
      invoke(IpcChannel.MarketplacePolicySet, policy),
    install: (listingId: string, pkg?: WorkerPackage) =>
      invoke(IpcChannel.MarketplaceInstall, { listingId, package: pkg }),
    onEvent: (cb: () => void) => subscribe(IpcChannel.MarketplaceEventBroadcast, () => cb()),
  },

  /* ── Enterprise REST API + OpenAPI (P3.0, Increments 1–3) ── */
  api: {
    /** The public route index (drives the API Explorer + reference docs). */
    routes: () => invoke(IpcChannel.EnterpriseApiRoutes),
    /** The live OpenAPI 3.1 document, generated from the route table + Zod contracts. */
    openapi: () => invoke(IpcChannel.EnterpriseApiOpenApi),
    /** Execute a REST call through the real gateway (auth / scope / rate / quota + audit). */
    request: (req: EnterpriseApiRequest) => invoke(IpcChannel.EnterpriseApiRequest, req),
  },

  /* ── Enterprise Webhooks (P3.0, Increment 4) ── */
  webhooks: {
    list: () => invoke(IpcChannel.WebhookList),
    create: (input: {
      label: string;
      url: string;
      categories?: PlatformEventCategory[];
      types?: string[];
    }) => invoke(IpcChannel.WebhookCreate, input),
    setEnabled: (id: string, enabled: boolean) =>
      invoke(IpcChannel.WebhookSetEnabled, { id, enabled }),
    remove: (id: string) => invoke(IpcChannel.WebhookDelete, { id }),
    deliveries: (webhookId?: string, limit?: number) =>
      invoke(IpcChannel.WebhookDeliveries, { webhookId, limit }),
    deadLetters: () => invoke(IpcChannel.WebhookDeadLetters),
    replay: (id: string) => invoke(IpcChannel.WebhookReplay, { id }),
    stats: () => invoke(IpcChannel.WebhookStats),
    onEvent: (cb: (stats: WebhookDeliveryStats) => void) =>
      subscribe(IpcChannel.WebhookEventBroadcast, cb),
  },

  cloud: {
    regions: () => invoke(IpcChannel.CloudRegions),
    tenants: () => invoke(IpcChannel.CloudTenants),
    tenantSummary: () => invoke(IpcChannel.CloudTenantSummary),
    createTenant: (input: { name: string; regionId: CloudRegionId; tier: TenantTier }) =>
      invoke(IpcChannel.CloudCreateTenant, input),
    setTenantStatus: (tenantId: string, status: TenantStatus) =>
      invoke(IpcChannel.CloudSetTenantStatus, { tenantId, status }),
    projects: (tenantId?: string) => invoke(IpcChannel.CloudProjects, { tenantId }),
    createProject: (input: { tenantId: string; name: string; description?: string }) =>
      invoke(IpcChannel.CloudCreateProject, input),
    deleteProject: (id: string) => invoke(IpcChannel.CloudDeleteProject, { id }),
    teams: (tenantId?: string) => invoke(IpcChannel.CloudTeams, { tenantId }),
    createTeam: (input: { tenantId: string; name: string }) =>
      invoke(IpcChannel.CloudCreateTeam, input),
    tenantWorkers: (tenantId?: string) => invoke(IpcChannel.CloudTenantWorkers, { tenantId }),
    storageIsolation: () => invoke(IpcChannel.CloudStorageIsolation),

    ssoConnections: () => invoke(IpcChannel.CloudSsoConnections),
    identitySummary: () => invoke(IpcChannel.CloudIdentitySummary),
    createSso: (input: {
      name: string;
      protocol: SsoProtocol;
      issuer: string;
      entityId?: string;
      ssoUrl: string;
      clientId?: string;
      domains: string[];
      attributeMapping?: Record<string, string>;
    }) => invoke(IpcChannel.CloudCreateSso, input),
    updateSso: (input: {
      id: string;
      status?: SsoStatus;
      enforced?: boolean;
      domains?: string[];
      name?: string;
    }) => invoke(IpcChannel.CloudUpdateSso, input),
    deleteSso: (id: string) => invoke(IpcChannel.CloudDeleteSso, { id }),
    testSso: (id: string) => invoke(IpcChannel.CloudTestSso, { id }),
    scim: () => invoke(IpcChannel.CloudScim),
    setScim: (enabled: boolean) => invoke(IpcChannel.CloudSetScim, { enabled }),
    scimSync: () => invoke(IpcChannel.CloudScimSync),
    mfa: () => invoke(IpcChannel.CloudMfa),
    setMfa: (input: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }) =>
      invoke(IpcChannel.CloudSetMfa, input),

    liveSyncStatus: () => invoke(IpcChannel.LiveSyncStatus),
    liveSyncDetail: () => invoke(IpcChannel.LiveSyncDetail),
    liveSyncNow: () => invoke(IpcChannel.LiveSyncNow),
    liveSyncSetOnline: (online: boolean) => invoke(IpcChannel.LiveSyncSetOnline, { online }),
    liveSyncSetActiveOrg: (orgId: string | null) =>
      invoke(IpcChannel.LiveSyncSetActiveOrg, { orgId }),

    deployments: () => invoke(IpcChannel.CloudDeployments),
    apiSummary: () => invoke(IpcChannel.CloudApiSummary),
    ratePolicies: () => invoke(IpcChannel.CloudRatePolicies),
    setPolicyEnabled: (id: string, enabled: boolean) =>
      invoke(IpcChannel.CloudSetPolicyEnabled, { id, enabled }),
    webhooks: () => invoke(IpcChannel.CloudWebhooks),
    createWebhook: (input: { url: string; events: string[] }) =>
      invoke(IpcChannel.CloudCreateWebhook, input),
    setWebhookStatus: (id: string, status: WebhookStatus) =>
      invoke(IpcChannel.CloudSetWebhookStatus, { id, status }),
    deleteWebhook: (id: string) => invoke(IpcChannel.CloudDeleteWebhook, { id }),
    testWebhook: (id: string) => invoke(IpcChannel.CloudTestWebhook, { id }),
    publicApis: () => invoke(IpcChannel.CloudPublicApis),

    adminOverview: () => invoke(IpcChannel.CloudAdminOverview),
    adminCompliance: () => invoke(IpcChannel.CloudAdminCompliance),

    onEvent: (cb: (e: IpcStoreChangedEvent) => void) =>
      subscribe(IpcChannel.CloudEventBroadcast, cb),
  },

  // ── P11 — Cloud Control Plane (management/orchestration rollup over the cloud subsystems) ──
  controlPlane: {
    overview: () => invoke(IpcChannel.ControlPlaneOverview),
    fleet: () => invoke(IpcChannel.ControlPlaneFleet),
    regions: () => invoke(IpcChannel.ControlPlaneRegions),
    tenants: () => invoke(IpcChannel.ControlPlaneTenants),
    deployments: () => invoke(IpcChannel.ControlPlaneDeployments),
    usage: () => invoke(IpcChannel.ControlPlaneUsage),
    // Reuses the cloud runtime's existing `cloud:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.CloudEventBroadcast, () => cb()),
  },

  federation: {
    orgs: () => invoke(IpcChannel.FedOrgs),
    summary: () => invoke(IpcChannel.FedSummary),
    invitations: () => invoke(IpcChannel.FedInvitations),
    trust: () => invoke(IpcChannel.FedTrust),
    shared: () => invoke(IpcChannel.FedShared),
    inviteOrg: (input: { name: string; trustLevel: TrustLevel; message?: string }) =>
      invoke(IpcChannel.FedInviteOrg, input),
    respondInvite: (id: string, accept: boolean) =>
      invoke(IpcChannel.FedRespondInvite, { id, accept }),
    setTrust: (input: {
      peerOrg: string;
      trustLevel?: TrustLevel;
      delegatedApproval?: boolean;
      canShareWorkers?: boolean;
      canShareData?: boolean;
    }) => invoke(IpcChannel.FedSetTrust, input),
    shareResource: (input: {
      kind: SharedResourceKind;
      name: string;
      peerOrg: string;
      access: ShareAccess;
    }) => invoke(IpcChannel.FedShareResource, input),
    revokeShare: (id: string) => invoke(IpcChannel.FedRevokeShare, { id }),

    artifacts: () => invoke(IpcChannel.FedArtifacts),
    exchangeSummary: () => invoke(IpcChannel.FedExchangeSummary),
    publishArtifact: (input: {
      kind: ExchangeKind;
      name: string;
      summary: string;
      scope: ExchangeScope;
      regionId?: CloudRegionId | null;
    }) => invoke(IpcChannel.FedPublishArtifact, input),
    publishVersion: (input: { artifactId: string; version: string; changelog: string }) =>
      invoke(IpcChannel.FedPublishVersion, input),
    rate: (artifactId: string, stars: number) =>
      invoke(IpcChannel.FedRateArtifact, { artifactId, stars }),
    setVerification: (artifactId: string, verification: VerificationStatus) =>
      invoke(IpcChannel.FedSetVerification, { artifactId, verification }),
    rollback: (artifactId: string) => invoke(IpcChannel.FedRollbackArtifact, { artifactId }),
    install: (artifactId: string) => invoke(IpcChannel.FedInstallArtifact, { artifactId }),
    verifyVersion: (artifactId: string, versionId: string) =>
      invoke(IpcChannel.FedVerifyVersion, { artifactId, versionId }),

    scopeSummary: () => invoke(IpcChannel.FedScopeSummary),
    setScope: (artifactId: string, scope: ExchangeScope) =>
      invoke(IpcChannel.FedSetScope, { artifactId, scope }),

    policies: () => invoke(IpcChannel.FedPolicies),
    govSummary: () => invoke(IpcChannel.FedGovSummary),
    addPolicy: (input: {
      name: string;
      description: string;
      scope: FedPolicyScope;
      effect: FedPolicyEffect;
      action: string;
    }) => invoke(IpcChannel.FedAddPolicy, input),
    setPolicyEnabled: (id: string, enabled: boolean) =>
      invoke(IpcChannel.FedSetPolicyEnabled, { id, enabled }),
    approvals: () => invoke(IpcChannel.FedApprovals),
    resolveApproval: (id: string, approve: boolean) =>
      invoke(IpcChannel.FedResolveApproval, { id, approve }),
    audit: () => invoke(IpcChannel.FedAuditTrail),
    compliance: () => invoke(IpcChannel.FedCompliance),
    recordAction: (input: {
      action: string;
      peerOrg: string;
      peerOrgName: string;
      trustLevel: TrustLevel;
      detail: string;
    }) => invoke(IpcChannel.FedRecordAction, input),

    observability: () => invoke(IpcChannel.FedObservability),
    usageSeries: () => invoke(IpcChannel.FedUsageSeries),
    securityEvents: () => invoke(IpcChannel.FedSecurityEvents),

    backups: () => invoke(IpcChannel.FedBackups),
    replicas: () => invoke(IpcChannel.FedReplicas),
    validations: () => invoke(IpcChannel.FedValidations),
    continuity: () => invoke(IpcChannel.FedContinuity),
    drSummary: () => invoke(IpcChannel.FedDrSummary),
    createBackup: (scope: BackupScope) => invoke(IpcChannel.FedCreateBackup, { scope }),
    runValidation: (backupId: string) => invoke(IpcChannel.FedRunValidation, { backupId }),
    checkReplication: () => invoke(IpcChannel.FedCheckReplication),

    adminOverview: () => invoke(IpcChannel.FedAdminOverview),
    scalability: () => invoke(IpcChannel.FedScalability),

    onEvent: (cb: (e: IpcStoreChangedEvent) => void) => subscribe(IpcChannel.FedEventBroadcast, cb),
  },

  // ── P10 — Federation Platform (intelligence/governance/integration layer) ──
  federationPlatform: {
    graph: () => invoke(IpcChannel.FederationGraph),
    timeline: () => invoke(IpcChannel.FederationTimeline),
    directory: () => invoke(IpcChannel.FederationDirectory),
    analytics: () => invoke(IpcChannel.FederationAnalytics),
    overview: () => invoke(IpcChannel.FederationOverview),
    search: (text: string, kinds?: FederationSearchKind[], limit?: number) =>
      invoke(IpcChannel.FederationSearch, { text, kinds, limit }),
    // Reuses the federation runtime's existing `fed:event` broadcast for liveness.
    onEvent: (cb: () => void) => subscribe(IpcChannel.FedEventBroadcast, () => cb()),
  },

  // ── Release engineering: migration · backup · crash · diagnostics · recovery · support ──
  releaseOps: {
    migrationStatus: () => invoke(IpcChannel.MigrationStatus),
    runMigration: (dryRun?: boolean) => invoke(IpcChannel.MigrationRun, { dryRun }),

    listBackups: () => invoke(IpcChannel.BackupList),
    createBackup: (domains?: MaintenanceDomain[]) =>
      invoke(IpcChannel.BackupCreate, { trigger: 'manual', domains }),
    validateBackup: (id: string) => invoke(IpcChannel.BackupValidate, { id }),
    restoreBackup: (id: string, domains?: MaintenanceDomain[]) =>
      invoke(IpcChannel.BackupRestore, { id, domains }),
    deleteBackup: (id: string) => invoke(IpcChannel.BackupDelete, { id }),

    crashStatus: () => invoke(IpcChannel.CrashGetStatus),
    setCrashOptIn: (optedIn: boolean) => invoke(IpcChannel.CrashSetOptIn, { optedIn }),
    exportCrashes: () => invoke(IpcChannel.CrashExport),
    crashRecommendations: () => invoke(IpcChannel.CrashRecommendations),
    reportError: (input: { kind: string; message: string; stack?: string }) =>
      invoke(IpcChannel.CrashReport, input),

    diagnostics: () => invoke(IpcChannel.ReleaseDiagnosticsGet),
    exportDiagnostics: () => invoke(IpcChannel.ReleaseDiagnosticsExport),

    safeModeStatus: () => invoke(IpcChannel.RecoverySafeModeStatus),
    runRecovery: (
      action: RecoveryAction,
      opts?: { backupId?: string; domains?: MaintenanceDomain[]; reason?: string },
    ) => invoke(IpcChannel.RecoveryRun, { action, ...(opts ?? {}) }),

    generateSupportBundle: () => invoke(IpcChannel.SupportGenerateBundle),
  },

  flags: {
    get: (planTier: PlanTier) => invoke(IpcChannel.FlagsGet, { planTier }),
    setOverride: (key: FeatureFlagKey, value: boolean, planTier: PlanTier) =>
      invoke(IpcChannel.FlagsSetOverride, { key, value, planTier }),
    clearOverride: (key: FeatureFlagKey, planTier: PlanTier) =>
      invoke(IpcChannel.FlagsClearOverride, { key, planTier }),
  },

  /**
   * Application self-update (electron-updater), exposed over the existing `update:*` channels.
   * Every method returns the full, serializable UpdateStatus the renderer renders from; `onEvent`
   * subscribes to the main-side status broadcast (already on the runtime broadcast allowlist) and
   * unwraps the `{ status }` envelope. No update behavior lives here — it is a thin, typed seam.
   */
  updater: {
    getStatus: () => invoke(IpcChannel.UpdateGetStatus),
    checkNow: () => invoke(IpcChannel.UpdateCheckNow),
    download: () => invoke(IpcChannel.UpdateDownload),
    installOnQuit: () => invoke(IpcChannel.UpdateInstallOnQuit),
    setChannel: (channel: UpdateChannel) => invoke(IpcChannel.UpdateSetChannel, { channel }),
    /** Subscribe to live updater status changes. Returns an unsubscribe handle. */
    onEvent: (cb: (status: UpdateStatus) => void) =>
      subscribe(IpcChannel.UpdateEventBroadcast, (p) => cb(p.status)),
  },

  license: {
    status: (orgId: string) => invoke(IpcChannel.LicenseStatus, { orgId }),
    refresh: (orgId: string) => invoke(IpcChannel.LicenseRefresh, { orgId }),
    /** Report license health to main for NeuroCore (V6.1). Pass null state to clear. */
    reportHealth: (state: LicenseState | null, graceDaysRemaining = 0) =>
      invoke(IpcChannel.LicenseReportHealth, { state, graceDaysRemaining }),
  },

  billing: {
    /** Create a Razorpay subscription checkout and open the hosted page (V6.4). */
    checkout: (orgId: string, plan: BillingPlanId, seats?: number) =>
      invoke(IpcChannel.BillingCheckout, { orgId, plan, seats }),
  },

  devices: {
    /** Register THIS device against the org (identity assembled main-side) (V6.5). */
    registerCurrent: (orgId: string) => invoke(IpcChannel.DevicesRegister, { orgId }),
    list: (orgId: string) => invoke(IpcChannel.DevicesList, { orgId }),
    revoke: (orgId: string, deviceId: string) =>
      invoke(IpcChannel.DevicesRevoke, { orgId, deviceId }),
    /** Report THIS device's trust status to main for NeuroCore (V6.5). */
    reportHealth: (trustStatus: DeviceTrustStatus | null) =>
      invoke(IpcChannel.DeviceReportHealth, { trustStatus }),
  },

  onboarding: {
    status: () => invoke(IpcChannel.OnboardingStatus),
    start: () => invoke(IpcChannel.OnboardingStart),
    completeStep: (step: OnboardingStepId) => invoke(IpcChannel.OnboardingCompleteStep, { step }),
    dismiss: () => invoke(IpcChannel.OnboardingDismiss),
    reset: () => invoke(IpcChannel.OnboardingReset),
  },

  aiConfig: {
    get: () => invoke(IpcChannel.AiConfigGet),
    health: () => invoke(IpcChannel.AiConfigHealth),
    detectOllama: () => invoke(IpcChannel.AiConfigDetectOllama),
    setProvider: (provider: AiProviderId) => invoke(IpcChannel.AiConfigSetProvider, { provider }),
    setModel: (model: string) => invoke(IpcChannel.AiConfigSetModel, { model }),
    setCredential: (secret: string) =>
      invoke(IpcChannel.AiConfigSetCredential, { provider: 'claude', secret }),
    clearCredential: () => invoke(IpcChannel.AiConfigClearCredential, { provider: 'claude' }),
    test: (provider: AiProviderId, secret?: string) =>
      invoke(IpcChannel.AiConfigTest, { provider, secret }),
    migrationStatus: () => invoke(IpcChannel.AiConfigMigrationStatus),
    migrate: () => invoke(IpcChannel.AiConfigMigrate),
    resetToEnv: () => invoke(IpcChannel.AiConfigResetToEnv),
    /** Private First: the AI routing mode and external-processing consent. */
    setMode: (mode: AiMode) => invoke(IpcChannel.AiConfigSetMode, { mode }),
    setExternalConsent: (consent: boolean) =>
      invoke(IpcChannel.AiConfigSetExternalConsent, { consent }),
    /** The live routing picture — same assembly + planner a request uses. */
    routingStatus: () => invoke(IpcChannel.AiRoutingStatus),
    /** Measured routing usage. Counts, never inventions. */
    routingUsage: () => invoke(IpcChannel.AiRoutingUsage),
  },

  /**
   * First-run experience profile: workspace type + completion state.
   * (`experience` is taken by the Experience Program's decision surface.)
   */
  firstRun: {
    get: () => invoke(IpcChannel.ExperienceProfileGet),
    set: (patch: {
      workspaceType?: WorkspaceType;
      state?: 'completed' | 'skipped';
      aiModeChosen?: boolean;
      attributes?: UnderstandingAttribute[];
      removeKeys?: string[];
    }) => invoke(IpcChannel.ExperienceProfileSet, patch),
    /** Clear the profile and return to first run. */
    reset: () => invoke(IpcChannel.ExperienceProfileReset),
  },

  /**
   * Decision Records + NeuroPause Hold — the reconstruction trail over
   * consequential actions, and the durable pauses awaiting a person.
   */
  decisionRecords: {
    list: (limit?: number): Promise<DecisionRecord[]> =>
      invoke(IpcChannel.DecisionRecordList, limit === undefined ? {} : { limit }),
    get: (id: string): Promise<DecisionRecordDetail | null> =>
      invoke(IpcChannel.DecisionRecordGet, { id }),
  },

  holds: {
    list: (limit?: number): Promise<HoldCenterView> =>
      invoke(IpcChannel.HoldList, limit === undefined ? {} : { limit }),
    resolve: (id: string, outcome: HoldOutcome, note?: string): Promise<HoldRecord | null> =>
      invoke(IpcChannel.HoldResolve, { id, outcome, ...(note ? { note } : {}) }),
  },

  opportunities: {
    /** Recomputes on every call — there is no cached finding to go stale. */
    list: (lookbackDays?: number): Promise<OpportunityCenterView> =>
      invoke(IpcChannel.OpportunityList, lookbackDays === undefined ? {} : { lookbackDays }),
    setStatus: (
      id: string,
      status: OpportunityStatus,
      note?: string,
    ): Promise<Opportunity | null> =>
      invoke(IpcChannel.OpportunitySetStatus, { id, status, ...(note ? { note } : {}) }),
    execute: (id: string): Promise<OpportunityExecuteResult> =>
      invoke(IpcChannel.OpportunityExecute, { id }),
  },

  feedback: {
    submit: (category: FeedbackCategory, message: string, context?: string) =>
      invoke(IpcChannel.FeedbackSubmit, { category, message, context }),
    list: () => invoke(IpcChannel.FeedbackList),
    exportAll: () => invoke(IpcChannel.FeedbackExport),
    exportToFile: () => invoke(IpcChannel.FeedbackExportToFile),
    clear: () => invoke(IpcChannel.FeedbackClear),
  },

  pilot: {
    status: () => invoke(IpcChannel.PilotStatus),
    setEnabled: (enabled: boolean) => invoke(IpcChannel.PilotSetEnabled, { enabled }),
  },

  /**
   * AI Sandbox (S1–S6 backend) + the Validation Experience (P4). A thin, typed seam over the
   * EXISTING sandbox channels — the renderer never reaches a new engine/store; it reads the
   * S1 core (dashboard/scenarios/executions/artifacts/queue) and the S6 continuous-validation
   * projections (summary/dashboard/run detail), and drives the two audited mutations the
   * workspace needs (run a pipeline, toggle a schedule). Reads gate on `sandbox:read`,
   * mutations on `sandbox:manage` (enforced in main).
   */
  sandbox: {
    dashboard: (workspaceId?: string) => invoke(IpcChannel.SandboxDashboard, { workspaceId }),
    workspaces: () => invoke(IpcChannel.SandboxWorkspaceList, {}),
    scenarios: (workspaceId?: string, includeArchived?: boolean) =>
      invoke(IpcChannel.SandboxScenarioList, { workspaceId, includeArchived }),
    scenario: (id: string) => invoke(IpcChannel.SandboxScenarioGet, { id }),
    scenarioVersions: (scenarioId: string) =>
      invoke(IpcChannel.SandboxScenarioVersions, { scenarioId }),
    executionHistory: (q?: {
      workspaceId?: string;
      scenarioId?: string;
      status?: ExecutionStatus;
      limit?: number;
      cursor?: string | null;
    }) => invoke(IpcChannel.SandboxExecutionHistory, q ?? {}),
    execution: (id: string) => invoke(IpcChannel.SandboxExecutionGet, { id }),
    timeline: (executionId: string, limit?: number) =>
      invoke(IpcChannel.SandboxExecutionTimeline, { executionId, limit }),
    queueState: (workspaceId?: string) => invoke(IpcChannel.SandboxQueueState, { workspaceId }),
    artifacts: (executionId: string, kind?: ArtifactKind) =>
      invoke(IpcChannel.SandboxArtifactList, { executionId, kind }),
    result: (executionId: string) => invoke(IpcChannel.SandboxResultGet, { executionId }),
    report: (executionId: string) => invoke(IpcChannel.SandboxReportGet, { executionId }),
    datasets: (workspaceId?: string) => invoke(IpcChannel.SandboxDatasetList, { workspaceId }),
    enqueue: (
      scenarioId: string,
      opts?: {
        version?: number;
        trigger?: ExecutionTrigger;
        priority?: ExecutionPriority;
        datasetId?: string;
      },
    ) => invoke(IpcChannel.SandboxExecutionEnqueue, { scenarioId, ...(opts ?? {}) }),
    cancel: (id: string) => invoke(IpcChannel.SandboxExecutionCancel, { id }),
    generateReport: (executionId: string) =>
      invoke(IpcChannel.SandboxReportGenerate, { executionId }),
    validationSummary: () => invoke(IpcChannel.SandboxValidationSummary, {}),
    validationDashboard: () => invoke(IpcChannel.SandboxValidationDashboard, {}),
    validationRun: (pipeline: PipelineKind, trigger?: TriggerKind) =>
      invoke(IpcChannel.SandboxValidationRun, { pipeline, trigger }),
    validationRunGet: (runId: string) => invoke(IpcChannel.SandboxValidationRunGet, { runId }),
    setSchedule: (id: string, enabled: boolean) =>
      invoke(IpcChannel.SandboxValidationScheduleSet, { id, enabled }),
    onEvent: (cb: (e: SandboxEvent) => void) => subscribe(IpcChannel.SandboxEventBroadcast, cb),
  },

  /**
   * Phase 6 — Universal Enterprise Data Plane.
   *
   * Explicit methods only: the renderer never calls `invoke` with an arbitrary
   * channel, and never hands the main process a filesystem PATH. The caller
   * passes the CONTENT it already holds (base64), so an untrusted renderer
   * cannot direct main to read an arbitrary location on disk.
   */
  data: {
    /** What is this file, and can we read it? Cheap pre-flight; writes nothing. */
    inspect: (filename: string, contentBase64: string) =>
      invoke(IpcChannel.DataPlaneInspect, { filename, contentBase64 }),
    /** Full analysis → a reviewable import plan. Still writes nothing. */
    analyze: (filename: string, contentBase64: string) =>
      invoke(IpcChannel.DataPlaneAnalyze, { filename, contentBase64 }),
    /** Re-read a plan produced earlier in this session. */
    plan: (planId: string) => invoke(IpcChannel.DataPlanePlan, { planId }),
    /**
     * Execute an approved plan. Approvals are explicit and per-table — an
     * omitted table is NOT approved and will not be written.
     */
    import: (
      planId: string,
      approvals: { tableName: string; approved: boolean; skipRows?: number[] }[],
      reason?: string,
    ) => invoke(IpcChannel.DataPlaneImport, { planId, approvals, ...(reason ? { reason } : {}) }),
    history: (limit?: number) => invoke(IpcChannel.DataPlaneHistory, limit === undefined ? {} : { limit }),
    run: (planId: string) => invoke(IpcChannel.DataPlaneRun, { planId }),
    /** Where did this record come from? */
    provenance: (recordId: string) => invoke(IpcChannel.DataPlaneProvenance, { recordId }),
    mappings: (signature?: string) =>
      invoke(IpcChannel.DataPlaneMappings, signature === undefined ? {} : { signature }),
    saveMapping: (signature: string, entityId: string, columns: { header: string; fieldKey: string }[]) =>
      invoke(IpcChannel.DataPlaneSaveMapping, { signature, entityId, columns }),
    forgetMapping: (signature: string) => invoke(IpcChannel.DataPlaneForgetMapping, { signature }),
    /** The canonical entities and the formats we deliberately cannot read. */
    ontology: () => invoke(IpcChannel.DataPlaneOntology, {}),
    /** Modules that actually hold records, with live counts. */
    exportable: () => invoke(IpcChannel.DataPlaneExportable, {}),
    /**
     * Write a module's records to a file. The main process shows the save
     * dialog, so the renderer never touches a path; a cancelled dialog comes
     * back as `cancelled: true`, which is a normal outcome, not an error.
     */
    export: (moduleId: string, format: 'csv' | 'xlsx' | 'json', includeProvenance?: boolean) =>
      invoke(IpcChannel.DataPlaneExport, {
        moduleId,
        format,
        ...(includeProvenance === undefined ? {} : { includeProvenance }),
      }),
    /**
     * Cross-domain relationships: what the engine can link, what it has linked,
     * and what still needs a person.
     */
    relationships: {
      overview: () => invoke(IpcChannel.DataPlaneRelationshipOverview, {}),
      queue: (limit?: number) =>
        invoke(IpcChannel.DataPlaneRelationshipQueue, limit === undefined ? {} : { limit }),
      /** Apply a reviewer's choice. Writes a business fact, so it is audited. */
      decide: (pendingId: string, targetRecordId: string) =>
        invoke(IpcChannel.DataPlaneRelationshipDecide, { pendingId, targetRecordId }),
      skip: (pendingId: string) => invoke(IpcChannel.DataPlaneRelationshipSkip, { pendingId }),
      /** Re-check parked references against the records that exist now. */
      retry: () => invoke(IpcChannel.DataPlaneRelationshipRetry, {}),
      graph: (recordId: string) => invoke(IpcChannel.DataPlaneRelationshipGraph, { recordId }),
    },
  },

  /**
   * Medical Device Manufacturing Pack.
   *
   * Product CREATE / UPDATE / DELETE are absent here on purpose — products are
   * an Enterprise Module, so those go through `ipc.enterprise.module.*` like
   * every other module's records. What lives here is what the generic surface
   * cannot express: field-scoped product search, and every lot operation.
   */
  medicalDevice: {
    /** The pack, its taxonomies resolved for this workspace, and live counts. */
    pack: () => invoke(IpcChannel.MedicalDevicePack, {}),
    products: {
      search: (filters: {
        query?: string;
        family?: string;
        category?: string;
        material?: string;
        status?: 'active' | 'inactive' | 'discontinued';
        limit?: number;
      } = {}) => invoke(IpcChannel.MedicalDeviceProductSearch, filters),
      get: (productId: string) => invoke(IpcChannel.MedicalDeviceProductGet, { productId }),
    },
    lots: {
      list: (query: { view?: LotCenterView; search?: string; productId?: string; limit?: number } = {}) =>
        invoke(IpcChannel.MedicalDeviceLotList, query),
      get: (lotId: string) => invoke(IpcChannel.MedicalDeviceLotGet, { lotId }),
      create: (input: MedicalDeviceLotCreateRequest) => invoke(IpcChannel.MedicalDeviceLotCreate, input),
      transition: (lotId: string, status: LotStatus, reason?: string) =>
        invoke(IpcChannel.MedicalDeviceLotTransition, {
          lotId,
          status,
          ...(reason ? { reason } : {}),
        }),
      split: (lotId: string, parts: { lotNumber: string; quantity: number }[]) =>
        invoke(IpcChannel.MedicalDeviceLotSplit, { lotId, parts }),
      /** Always refuses. Called so the reason is shown rather than inferred. */
      merge: (lotIds: string[]) => invoke(IpcChannel.MedicalDeviceLotMerge, { lotIds }),
      consume: (input: MedicalDeviceLotConsumeRequest) =>
        invoke(IpcChannel.MedicalDeviceLotConsume, input),
      move: (lotId: string, warehouseId: string) =>
        invoke(IpcChannel.MedicalDeviceLotMove, { lotId, warehouseId }),
      ship: (input: MedicalDeviceLotShipRequest) => invoke(IpcChannel.MedicalDeviceLotShip, input),
    },
    trace: {
      /** Where did this go? */
      forward: (nodeType: TraceNodeType, nodeId: string, maxDepth?: number) =>
        invoke(IpcChannel.MedicalDeviceTraceForward, {
          nodeType,
          nodeId,
          ...(maxDepth === undefined ? {} : { maxDepth }),
        }),
      /** What went into this? */
      backward: (nodeType: TraceNodeType, nodeId: string, maxDepth?: number) =>
        invoke(IpcChannel.MedicalDeviceTraceBackward, {
          nodeType,
          nodeId,
          ...(maxDepth === undefined ? {} : { maxDepth }),
        }),
    },
  },
};

// Referenced by future surfaces; keeps the import used and the type exported.
export type { InstallationDto };

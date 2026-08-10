import { z } from 'zod';
import { HELP_DOC_IDS } from '../types/helpDocs';
// Type-only (erased at compile time, so no runtime cycle with ../types).
import type { ConflictStrategy, SyncEntityType } from '../types/sync';

/**
 * Zod contracts for every IPC payload. The main process validates *all*
 * inbound IPC arguments against these before doing any work — untrusted
 * renderer input is never trusted by shape alone.
 */

export const AuthProviderIdSchema = z.enum(['google', 'github', 'microsoft', 'apple', 'email']);

export const OAuthProviderIdSchema = z.enum(['google', 'github', 'microsoft', 'apple']);

export const LoginOAuthRequest = z.object({
  provider: OAuthProviderIdSchema,
});

export const EmailCredentialsRequest = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

export const ThemeSourceSchema = z.enum(['system', 'light', 'dark']);

export const SetThemeSourceRequest = z.object({
  source: ThemeSourceSchema,
});

// Empty-payload requests still get a schema so the router is uniform.
export const EmptyRequest = z.object({}).strict();

// V4.2 — runtime launch-at-login toggle.
export const SetLoginAtStartupRequest = z.object({ enabled: z.boolean() }).strict();

// Phase 6 Stage 1 — Workspace Contexts (local desktop workspaces).
export const WorkspaceTemplateIdSchema = z.enum(['blank', 'operations', 'enterprise', 'research']);
export const WorkspaceCtxSnapshotSchema = z
  .object({
    activeSection: z.string().min(1).max(100),
    tabs: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          appId: z.string().min(1).max(256),
          title: z.string().max(300),
          openedAt: z.number(),
        }),
      )
      .max(200),
    activeTabId: z.string().max(128).nullable(),
  })
  .strict();
export const WorkspaceCtxBootstrapRequest = z
  .object({ legacySnapshot: z.unknown().optional() })
  .strict();
export const WorkspaceCtxCreateRequest = z
  .object({
    name: z.string().min(1).max(60),
    template: WorkspaceTemplateIdSchema,
    color: z.string().max(32).optional(),
  })
  .strict();
export const WorkspaceCtxRenameRequest = z
  .object({ id: z.string().min(1).max(64), name: z.string().min(1).max(60) })
  .strict();
export const WorkspaceCtxDeleteRequest = z.object({ id: z.string().min(1).max(64) }).strict();
export const WorkspaceCtxSwitchRequest = z.object({ id: z.string().min(1).max(64) }).strict();
export const WorkspaceCtxUpdateSnapshotRequest = z
  .object({ id: z.string().min(1).max(64), snapshot: WorkspaceCtxSnapshotSchema })
  .strict();
export type WorkspaceTemplateId = z.infer<typeof WorkspaceTemplateIdSchema>;
export type WorkspaceCtxBootstrapRequest = z.infer<typeof WorkspaceCtxBootstrapRequest>;
export type WorkspaceCtxCreateRequest = z.infer<typeof WorkspaceCtxCreateRequest>;
export type WorkspaceCtxRenameRequest = z.infer<typeof WorkspaceCtxRenameRequest>;
export type WorkspaceCtxDeleteRequest = z.infer<typeof WorkspaceCtxDeleteRequest>;
export type WorkspaceCtxSwitchRequest = z.infer<typeof WorkspaceCtxSwitchRequest>;
export type WorkspaceCtxUpdateSnapshotRequest = z.infer<typeof WorkspaceCtxUpdateSnapshotRequest>;
/** Snapshot DTO as stored and returned (sanitized in the main process). */
export type ShellSnapshotDto = z.infer<typeof WorkspaceCtxSnapshotSchema>;
export interface WorkspaceContextRecordDto {
  id: string;
  name: string;
  color: string;
  template: WorkspaceTemplateId;
  createdAt: number;
  lastOpenedAt: number;
  snapshot: ShellSnapshotDto;
}
export interface WorkspaceContextStateDto {
  workspaces: WorkspaceContextRecordDto[];
  activeId: string;
  activeSnapshot: ShellSnapshotDto;
}

// V5.4 — Execute Engine.
export const ExecuteRunRequest = z
  .object({
    kind: z.enum([
      'task',
      'worker',
      'automation',
      'decision',
      'workflow',
      'memory',
      'connector',
      'voice',
      'runtime',
      'executive',
    ]),
    targetId: z.string().max(200).optional(),
    input: z.string().max(10_000).optional(),
    label: z.string().max(200).optional(),
  })
  .strict();

export const ExecuteCancelRequest = z.object({ id: z.string().max(200) }).strict();

// V6.5 — renderer reports this device's trust to main (for NeuroCore). Null clears.
export const DeviceReportHealthRequest = z
  .object({ trustStatus: z.enum(['trusted', 'blocked', 'revoked']).nullable() })
  .strict();

// V6.5 — device trust: register this device / list / revoke.
export const DevicesRegisterRequest = z.object({ orgId: z.string().min(1) }).strict();
export const DevicesListRequest = z.object({ orgId: z.string().min(1) }).strict();
export const DevicesRevokeRequest = z
  .object({ orgId: z.string().min(1), deviceId: z.string().min(1) })
  .strict();

// V6.4 — create a subscription checkout for an org + plan.
export const BillingCheckoutRequest = z
  .object({
    orgId: z.string().min(1),
    plan: z.enum(['trial', 'starter', 'professional', 'enterprise']),
    seats: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

// V6.1 — renderer reports license health to main (for NeuroCore). Nullable via a
// sentinel: absent state clears the signal.
export const LicenseReportHealthRequest = z
  .object({
    state: z.enum(['valid', 'grace', 'invalid']).nullable(),
    graceDaysRemaining: z.number().int().min(0).max(3660).default(0),
  })
  .strict();

// V5.3 — runtime supervisor recovery + policy.
export const SupervisorRecoverRequest = z
  .object({
    subsystem: z.enum(['runtime', 'platform', 'automation', 'voice', 'backend']),
  })
  .strict();

export const SupervisorSetPolicyRequest = z
  .object({
    subsystem: z.enum(['runtime', 'platform', 'automation', 'voice', 'backend']),
    policy: z.enum(['automatic', 'manual', 'disabled']),
  })
  .strict();

// V5.2 — live voice runtime state from the renderer.
export const VoiceStatusRequest = z
  .object({
    state: z.enum(['idle', 'listening', 'thinking', 'speaking', 'recovering', 'disconnected']),
  })
  .strict();

// Module 9 — Automation Builder. The rule is validated in the store via the shared
// engine; the contract only guards the transport shape.
export const AutomationSaveRequest = z.object({ rule: z.record(z.unknown()) }).strict();
export const AutomationIdRequest = z.object({ id: z.string().trim().min(1).max(128) }).strict();
export const AutomationSetStatusRequest = z
  .object({
    id: z.string().trim().min(1).max(128),
    status: z.enum(['draft', 'active', 'paused', 'error']),
  })
  .strict();

// V3.3 — Executive Decision Intelligence.
export const DecisionCreateFromRecommendationRequest = z
  .object({ recommendationId: z.string().trim().min(1).max(128) })
  .strict();
export const DecisionSetStatusRequest = z
  .object({
    id: z.string().trim().min(1).max(128),
    status: z.enum([
      'draft',
      'suggested',
      'accepted',
      'in_progress',
      'completed',
      'rejected',
      'archived',
    ]),
  })
  .strict();

export type LoginOAuthRequest = z.infer<typeof LoginOAuthRequest>;
export type EmailCredentialsRequest = z.infer<typeof EmailCredentialsRequest>;
export type SetThemeSourceRequest = z.infer<typeof SetThemeSourceRequest>;
export type ThemeSource = z.infer<typeof ThemeSourceSchema>;

/* ───────────────────────── Runtime-core IPC contracts ────────────────────── */

/** Reusable primitives. */
const SlugSchema = z.string().trim().min(1).max(128);

export const SlugRequest = z.object({ slug: SlugSchema });
export const InstanceRequest = z.object({ instanceId: z.string().trim().min(1).max(128) });
export const OperationRequest = z.object({ operationId: z.string().trim().min(1).max(128) });

export const RuntimePermissionSchema = z.enum([
  'network',
  'filesystem_read',
  'filesystem_write',
  'clipboard',
  'notifications',
  'camera',
  'microphone',
  'local_models',
  'automation',
  'background',
  'shell_execution',
]);

/* catalog */
export const CatalogSectionsRequest = z.object({
  key: z.string().trim().min(1).max(64),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
});

export const CatalogSearchRequest = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().max(64)).max(20).optional(),
  pricing: z.enum(['free', 'freemium', 'paid', 'subscription', 'enterprise']).optional(),
  type: z
    .enum(['web', 'desktop_plugin', 'electron', 'native', 'ai_agent', 'mcp_server', 'automation'])
    .optional(),
  openSource: z.boolean().optional(),
  verified: z.boolean().optional(),
  sort: z
    .enum(['relevance', 'trending', 'installs', 'rating', 'newest', 'updated', 'name'])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
});

export const CatalogReviewsRequest = z.object({
  slug: SlugSchema,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(60).optional(),
});

export const CatalogToggleBookmarkRequest = z.object({
  slug: SlugSchema,
  bookmarked: z.boolean(),
});

export const CatalogSubmitReviewRequest = z.object({
  slug: SlugSchema,
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).optional(),
});

/* registry */
export const RegistrySetFlagsRequest = z.object({
  slug: SlugSchema,
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
});

export const RegistryImportRequest = z.object({
  data: z.string().min(2).max(5_000_000),
});

/* nps */
export const NpsInstallRequest = z.object({
  slug: SlugSchema,
  channel: z.string().trim().max(32).optional(),
  grantedPermissions: z.array(RuntimePermissionSchema).max(16).optional(),
  installLocation: z.string().trim().max(512).optional(),
});

/* runtime */
export const RuntimeHealthRequest = z.object({
  instanceId: z.string().trim().min(1).max(128).optional(),
});

/* permissions */
export const PermissionMutationRequest = z.object({
  slug: SlugSchema,
  permission: RuntimePermissionSchema,
});

/* cloud organizations */
const OrgRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
const OrgIdSchema = z.string().trim().min(1).max(128);
export const OrgCreateRequest = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(48).optional(),
});
export const OrgIdRequest = z.object({ orgId: OrgIdSchema });
export const OrgUpdateRequest = z.object({
  orgId: OrgIdSchema,
  name: z.string().trim().min(1).max(120),
});
export const OrgInviteRequest = z.object({
  orgId: OrgIdSchema,
  email: z.string().trim().email(),
  role: OrgRoleSchema,
});
export const OrgAcceptInviteRequest = z.object({ token: z.string().min(1).max(512) });
export const OrgChangeRoleRequest = z.object({
  orgId: OrgIdSchema,
  membershipId: OrgIdSchema,
  role: OrgRoleSchema,
});
export const OrgMembershipRequest = z.object({ orgId: OrgIdSchema, membershipId: OrgIdSchema });
export const OrgCreateWorkspaceRequest = z.object({
  orgId: OrgIdSchema,
  name: z.string().trim().min(1).max(120),
});
export const OrgWorkspaceRequest = z.object({
  orgId: OrgIdSchema,
  workspaceId: z.string().trim().min(1).max(128),
});
export const OrgUpdateWorkspaceRequest = z.object({
  orgId: OrgIdSchema,
  workspaceId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(120),
});

export type SlugRequest = z.infer<typeof SlugRequest>;
export type InstanceRequest = z.infer<typeof InstanceRequest>;
export type OperationRequest = z.infer<typeof OperationRequest>;
export type CatalogSectionsRequest = z.infer<typeof CatalogSectionsRequest>;
export type CatalogSearchRequest = z.infer<typeof CatalogSearchRequest>;
export type CatalogReviewsRequest = z.infer<typeof CatalogReviewsRequest>;
export type CatalogToggleBookmarkRequest = z.infer<typeof CatalogToggleBookmarkRequest>;
export type CatalogSubmitReviewRequest = z.infer<typeof CatalogSubmitReviewRequest>;
export type RegistrySetFlagsRequest = z.infer<typeof RegistrySetFlagsRequest>;
export type RegistryImportRequest = z.infer<typeof RegistryImportRequest>;
export type NpsInstallRequest = z.infer<typeof NpsInstallRequest>;
export type RuntimeHealthRequest = z.infer<typeof RuntimeHealthRequest>;
export type PermissionMutationRequest = z.infer<typeof PermissionMutationRequest>;
export type OrgCreateRequest = z.infer<typeof OrgCreateRequest>;
export type OrgIdRequest = z.infer<typeof OrgIdRequest>;
export type OrgUpdateRequest = z.infer<typeof OrgUpdateRequest>;
export type OrgInviteRequest = z.infer<typeof OrgInviteRequest>;
export type OrgAcceptInviteRequest = z.infer<typeof OrgAcceptInviteRequest>;
export type OrgChangeRoleRequest = z.infer<typeof OrgChangeRoleRequest>;
export type OrgMembershipRequest = z.infer<typeof OrgMembershipRequest>;
export type OrgCreateWorkspaceRequest = z.infer<typeof OrgCreateWorkspaceRequest>;
export type OrgWorkspaceRequest = z.infer<typeof OrgWorkspaceRequest>;
export type OrgUpdateWorkspaceRequest = z.infer<typeof OrgUpdateWorkspaceRequest>;

/* ───────────────────────── Plugin runtime contracts ──────────────────────── */

export const PluginIdRequest = z.object({ id: z.string().trim().min(1).max(128) });

export const PluginInstallRequest = z.object({
  source: z.string().trim().min(1).max(1024),
});

export const PluginPermissionRequest = z.object({
  id: z.string().trim().min(1).max(128),
  permission: RuntimePermissionSchema,
});

export const PluginContributionsRequest = z.object({
  surface: z.enum(['sidebar', 'toolbar', 'panel', 'widget']).optional(),
});

export type PluginIdRequest = z.infer<typeof PluginIdRequest>;
export type PluginInstallRequest = z.infer<typeof PluginInstallRequest>;
export type PluginPermissionRequest = z.infer<typeof PluginPermissionRequest>;
export type PluginContributionsRequest = z.infer<typeof PluginContributionsRequest>;

/* ───────────────────────── Platform-core IPC contracts ───────────────────── */

/** Event types the *renderer* is permitted to publish (UI-origin only). */
export const UiEmittableEventSchema = z.enum(['workspace.opened', 'workspace.closed']);

export const PlatformEmitRequest = z.object({
  type: UiEmittableEventSchema,
  resourceId: z.string().trim().max(256).optional(),
  resourceName: z.string().trim().max(256).optional(),
});

const IsoOptional = z.string().datetime({ offset: true }).optional();

export const TimelineQueryRequest = z.object({
  types: z.array(z.string().max(64)).max(40).optional(),
  categories: z.array(z.string().max(32)).max(20).optional(),
  source: z.string().max(64).optional(),
  actorId: z.string().max(128).optional(),
  resourceId: z.string().max(256).optional(),
  correlationId: z.string().max(128).optional(),
  priorities: z
    .array(z.enum(['low', 'normal', 'high', 'critical']))
    .max(4)
    .optional(),
  search: z.string().max(200).optional(),
  since: IsoOptional,
  until: IsoOptional,
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().max(64).nullable().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export type PlatformEmitRequest = z.infer<typeof PlatformEmitRequest>;
export type TimelineQueryRequest = z.infer<typeof TimelineQueryRequest>;

/* ─────────────────────── Connector Framework (NCF) contracts ─────────────── */

const ConnectorIdSchema = z.string().trim().min(1).max(128);
const AccountIdSchema = z.string().trim().min(1).max(128);

export const ConnectorIdRequest = z.object({ connectorId: ConnectorIdSchema });

/** Targets a specific account of a connector (disconnect, reconnect, refresh). */
export const ConnectorAccountRequest = z.object({
  connectorId: ConnectorIdSchema,
  accountId: AccountIdSchema,
});

/** Targets a connector, optionally narrowed to one account (sync, health). */
export const ConnectorScopedRequest = z.object({
  connectorId: ConnectorIdSchema,
  accountId: AccountIdSchema.nullable().optional(),
});

/** Optional connector filter for the log feed. */
export const ConnectorLogsRequest = z.object({
  connectorId: ConnectorIdSchema.optional(),
});

export type ConnectorIdRequest = z.infer<typeof ConnectorIdRequest>;
export type ConnectorAccountRequest = z.infer<typeof ConnectorAccountRequest>;
export type ConnectorScopedRequest = z.infer<typeof ConnectorScopedRequest>;
export type ConnectorLogsRequest = z.infer<typeof ConnectorLogsRequest>;

/** P2.4 — execute an audited Microsoft 365 write action. `confirmed` MUST be true for mutating actions. */
export const M365ActionExecuteRequest = z.object({
  connectorId: ConnectorIdSchema,
  accountId: AccountIdSchema,
  actionId: z.string().trim().min(1).max(64),
  params: z.record(z.unknown()).default({}),
  confirmed: z.boolean().default(false),
});

/** P2.4 — ask the existing AI engine to draft/summarize (never sends; returns text for the user to confirm). */
export const M365DraftRequest = z.object({
  connectorId: ConnectorIdSchema,
  accountId: AccountIdSchema,
  kind: z.enum(['email', 'summary', 'agenda']),
  instruction: z.string().trim().min(1).max(4000),
  context: z.string().max(20000).optional(),
});

export type M365ActionExecuteRequest = z.infer<typeof M365ActionExecuteRequest>;
export type M365DraftRequest = z.infer<typeof M365DraftRequest>;

/** P4.1 — an operator control command over a connector (or one of its accounts). */
export const ConnectorControlRequest = z.object({
  connectorId: ConnectorIdSchema,
  accountId: AccountIdSchema.nullable().optional(),
  action: z.enum(['pause', 'resume', 'disable', 'enable']),
});
export type ConnectorControlRequest = z.infer<typeof ConnectorControlRequest>;

/** P4.1 — read runtime state (+ control flags) for all connectors, or one. */
export const ConnectorRuntimeRequest = z.object({
  connectorId: ConnectorIdSchema.optional(),
});
export type ConnectorRuntimeRequest = z.infer<typeof ConnectorRuntimeRequest>;

/** P4.1 — deep-inspect one connector (Live Connector Inspector). */
export const ConnectorInspectRequest = z.object({
  connectorId: ConnectorIdSchema,
});
export type ConnectorInspectRequest = z.infer<typeof ConnectorInspectRequest>;

/* ─────────────────────── Unified Knowledge Layer (UDM) contracts ─────────── */

const UnifiedEntityKindSchema = z.enum([
  'account',
  'workspace',
  'organization',
  'project',
  'task',
  'conversation',
  'message',
  'document',
  'file',
  'event',
  'calendar_event',
  'notification',
  'contact',
  'label',
  'activity',
  'attachment',
]);

const ConnectorIdField = z.string().trim().min(1).max(128);

export const UnifiedQueryRequest = z.object({
  kinds: z.array(UnifiedEntityKindSchema).max(16).optional(),
  connectorId: ConnectorIdField.optional(),
  accountId: z.string().trim().min(1).max(128).optional(),
  containerId: z.string().trim().min(1).max(256).optional(),
  parentId: z.string().trim().min(1).max(256).optional(),
  status: z.string().trim().min(1).max(128).optional(),
  text: z.string().max(200).optional(),
  since: IsoOptional,
  until: IsoOptional,
  includeDeleted: z.boolean().optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'timestamp', 'title']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().max(64).nullable().optional(),
});

export const UnifiedGetRequest = z.object({ id: z.string().trim().min(1).max(512) });

export const UnifiedSearchRequest = z.object({
  text: z.string().trim().min(1).max(200),
  kinds: z.array(UnifiedEntityKindSchema).max(16).optional(),
  connectorId: ConnectorIdField.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type UnifiedQueryRequest = z.infer<typeof UnifiedQueryRequest>;
export type UnifiedGetRequest = z.infer<typeof UnifiedGetRequest>;
export type UnifiedSearchRequest = z.infer<typeof UnifiedSearchRequest>;

/** Optional connector filter for the sync-state snapshot read. */
export const ConnectorSyncStateRequest = z.object({
  connectorId: z.string().trim().min(1).max(128).optional(),
});
export type ConnectorSyncStateRequest = z.infer<typeof ConnectorSyncStateRequest>;

/* ─────────────────────── Enterprise Knowledge Graph contracts ────────────── */

const GraphNodeTypeSchema = z.enum([
  'person',
  'organization',
  'team',
  'department',
  'project',
  'task',
  'document',
  'file',
  'meeting',
  'calendar_event',
  'conversation',
  'message',
  'customer',
  'vendor',
  'policy',
  'ai_worker',
  'connector',
  'application',
]);
const GraphEdgeTypeSchema = z.enum([
  'assigned_to',
  'created_by',
  'depends_on',
  'belongs_to',
  'references',
  'participated_in',
  'discussed_in',
  'generated_by',
  'approved_by',
  'linked_to',
]);
const GraphId = z.string().trim().min(1).max(512);

export const GraphNodeRequest = z.object({ id: GraphId });
export const GraphNodesRequest = z.object({
  type: GraphNodeTypeSchema.optional(),
  connectorId: z.string().trim().min(1).max(128).optional(),
  text: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
export const GraphNeighborsRequest = z.object({
  id: GraphId,
  direction: z.enum(['both', 'out', 'in']).optional(),
  edgeTypes: z.array(GraphEdgeTypeSchema).max(10).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export const GraphSubgraphRequest = z.object({
  id: GraphId,
  depth: z.number().int().min(1).max(4).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export const GraphPathRequest = z.object({
  from: GraphId,
  to: GraphId,
  maxDepth: z.number().int().min(1).max(8).optional(),
});
export const GraphHistoryRequest = z.object({
  id: GraphId,
  limit: z.number().int().min(1).max(500).optional(),
});

export type GraphNodeRequest = z.infer<typeof GraphNodeRequest>;
export type GraphNodesRequest = z.infer<typeof GraphNodesRequest>;
export type GraphNeighborsRequest = z.infer<typeof GraphNeighborsRequest>;
export type GraphSubgraphRequest = z.infer<typeof GraphSubgraphRequest>;
export type GraphPathRequest = z.infer<typeof GraphPathRequest>;
export type GraphHistoryRequest = z.infer<typeof GraphHistoryRequest>;

/* ───────────────────────── AI Memory + Enterprise Search ─────────────────── */

const MemoryKindSchema = z.enum([
  'decision',
  'conversation',
  'document',
  'task',
  'meeting',
  'context',
  'relationship',
  'note',
]);
const SearchSourceSchema = z.enum(['entity', 'graph', 'memory', 'timeline', 'federation']);
const MemoryMetaSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
const IsoString = z.string().datetime({ offset: true });

export const MemoryRecallRequest = z.object({
  text: z.string().max(400).optional(),
  kinds: z.array(MemoryKindSchema).max(8).optional(),
  entityRef: z.string().trim().min(1).max(512).optional(),
  tag: z.string().trim().min(1).max(120).optional(),
  since: IsoString.optional(),
  until: IsoString.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const MemoryGetRequest = z.object({ id: z.string().trim().min(1).max(512) });
export const KnowledgeRelatedRequest = z.object({
  memoryId: z.string().trim().min(1).max(512),
  limit: z.number().int().min(1).max(100).optional(),
});
export type KnowledgeRelatedRequest = z.infer<typeof KnowledgeRelatedRequest>;
export const MemoryRememberRequest = z.object({
  kind: MemoryKindSchema,
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(20000),
  entityRefs: z.array(z.string().trim().min(1).max(512)).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  occurredAt: IsoString.nullable().optional(),
  metadata: MemoryMetaSchema.optional(),
});
export const MemoryForgetRequest = z.object({
  ids: z.array(z.string().trim().min(1).max(512)).min(1).max(200),
});

const ExecutiveMemoryTypeSchema = z.enum([
  'conversation',
  'decision',
  'action',
  'preference',
  'project',
]);
const ExecutiveMemoryStatusSchema = z.enum(['open', 'resolved']);
const ExecMemoryId = z.string().trim().min(1).max(512);

export const ExecMemorySearchRequest = z.object({
  text: z.string().max(400).optional(),
  type: ExecutiveMemoryTypeSchema.optional(),
  project: z.string().trim().min(1).max(200).optional(),
  worker: z.string().trim().min(1).max(120).optional(),
  connectorId: z.string().trim().min(1).max(120).optional(),
  decisionsOnly: z.boolean().optional(),
  status: ExecutiveMemoryStatusSchema.optional(),
  pinnedOnly: z.boolean().optional(),
  since: IsoString.optional(),
  until: IsoString.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const ExecMemoryForgetRequest = z.object({ id: ExecMemoryId });
export const ExecMemoryPinRequest = z.object({ id: ExecMemoryId, pinned: z.boolean() });
export const ExecMemoryResolveRequest = z.object({
  id: ExecMemoryId,
  status: ExecutiveMemoryStatusSchema,
});
export const ExecMemoryAuditRequest = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  action: z.enum(['created', 'updated', 'used', 'forgotten', 'rejected', 'pinned']).optional(),
  memoryId: ExecMemoryId.optional(),
});

export const EnterpriseSearchRequest = z.object({
  text: z.string().trim().min(1).max(400),
  sources: z.array(SearchSourceSchema).max(5).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequest>;
export type MemoryGetRequest = z.infer<typeof MemoryGetRequest>;
export type MemoryRememberRequest = z.infer<typeof MemoryRememberRequest>;
export type MemoryForgetRequest = z.infer<typeof MemoryForgetRequest>;
export type ExecMemorySearchRequest = z.infer<typeof ExecMemorySearchRequest>;
export type ExecMemoryForgetRequest = z.infer<typeof ExecMemoryForgetRequest>;
export type ExecMemoryPinRequest = z.infer<typeof ExecMemoryPinRequest>;
export type ExecMemoryResolveRequest = z.infer<typeof ExecMemoryResolveRequest>;
export type ExecMemoryAuditRequest = z.infer<typeof ExecMemoryAuditRequest>;
export type EnterpriseSearchRequest = z.infer<typeof EnterpriseSearchRequest>;

/* ─────────────────────────── Enterprise Timeline ─────────────────────────── */

const TimelineEntrySourceSchema = z.enum(['platform', 'activity']);
const TimelineOrderSchema = z.enum(['asc', 'desc']);

export const EnterpriseTimelineQueryRequest = z.object({
  text: z.string().max(400).optional(),
  sources: z.array(TimelineEntrySourceSchema).max(2).optional(),
  kinds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  connectorId: z.string().trim().min(1).max(120).optional(),
  actorId: z.string().trim().min(1).max(512).optional(),
  entityRef: z.string().trim().min(1).max(512).optional(),
  since: IsoString.optional(),
  until: IsoString.optional(),
  order: TimelineOrderSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().max(120).optional(),
});

export const EnterpriseTimelineReplayRequest = z.object({
  since: IsoString.optional(),
  until: IsoString.optional(),
  sources: z.array(TimelineEntrySourceSchema).max(2).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export type EnterpriseTimelineQueryRequest = z.infer<typeof EnterpriseTimelineQueryRequest>;
export type EnterpriseTimelineReplayRequest = z.infer<typeof EnterpriseTimelineReplayRequest>;

/* ──────────────────── Daily Intelligence + Recommendations ───────────────── */

// Phase 6 Stage 5 — 'afternoon' added additively (the Afternoon Update).
const BriefingPeriodSchema = z.enum([
  'morning',
  'afternoon',
  'evening',
  'weekly',
  'monthly',
  'quarterly',
]);
const RecommendationKindSchema = z.enum([
  'next_task',
  'stale_task',
  'blocked_project',
  'pending_document',
  'unanswered',
  'upcoming_deadline',
  // Phase 6 Stage 5 — additive productivity kinds.
  'open_approval',
  'connector_issue',
  'automation_opportunity',
  'followup_conversation',
  'unanswered_email',
]);

export const BriefingRequest = z.object({
  period: BriefingPeriodSchema,
  now: IsoString.optional(),
});

export const RecommendationQueryRequest = z.object({
  kinds: z.array(RecommendationKindSchema).max(6).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  now: IsoString.optional(),
});

export type BriefingRequest = z.infer<typeof BriefingRequest>;
export type RecommendationQueryRequest = z.infer<typeof RecommendationQueryRequest>;

/* ──────────────────────────────── Founder AI ────────────────────────────── */

export const FounderAskRequest = z.object({
  text: z.string().trim().min(1).max(1000),
  now: IsoString.optional(),
});
export type FounderAskRequest = z.infer<typeof FounderAskRequest>;

export const FounderAskV2Request = z.object({
  text: z.string().trim().min(1).max(1000),
  now: IsoString.optional(),
});
export type FounderAskV2Request = z.infer<typeof FounderAskV2Request>;

export const FounderSuggestionsRequest = z.object({
  now: IsoString.optional(),
});
export type FounderSuggestionsRequest = z.infer<typeof FounderSuggestionsRequest>;

export const EngineeringAiRequest = z.object({
  /** Optional focus (e.g. a repo name); omitted = all active repositories. */
  subject: z.string().trim().min(1).max(200).optional(),
  now: IsoString.optional(),
});
export type EngineeringAiRequest = z.infer<typeof EngineeringAiRequest>;

/* ─────────────── Workspace Assistant (Phase 6 Stage 4, D-1 cluster) ─────────────── */

export const AssistantModeSchema = z.enum(['ask', 'analyze', 'plan', 'execute', 'monitor']);

export const AssistantUiContextSchema = z.object({
  section: z.string().trim().max(60).optional(),
  workspaceLabel: z.string().trim().max(120).optional(),
  tabCount: z.number().int().min(0).max(10_000).optional(),
  query: z.string().trim().max(400).optional(),
});

export const AssistantAskRequest = z.object({
  text: z.string().trim().min(1).max(4000),
  mode: AssistantModeSchema.optional(),
  conversationId: z.string().trim().min(1).max(80).optional(),
  workspaceId: z.string().trim().min(1).max(80).nullable().optional(),
  uiContext: AssistantUiContextSchema.optional(),
  now: IsoString.optional(),
});
export type AssistantAskRequest = z.infer<typeof AssistantAskRequest>;

export const AssistantConversationsRequest = z.object({
  workspaceId: z.string().trim().min(1).max(80).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type AssistantConversationsRequest = z.infer<typeof AssistantConversationsRequest>;

export const AssistantConversationGetRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
});
export type AssistantConversationGetRequest = z.infer<typeof AssistantConversationGetRequest>;

export const AssistantConversationSaveRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
});
export type AssistantConversationSaveRequest = z.infer<typeof AssistantConversationSaveRequest>;

export const AssistantConversationDeleteRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
});
export type AssistantConversationDeleteRequest = z.infer<typeof AssistantConversationDeleteRequest>;

export const AssistantConversationBranchRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
  messageId: z.string().trim().min(1).max(80),
  now: IsoString.optional(),
});
export type AssistantConversationBranchRequest = z.infer<typeof AssistantConversationBranchRequest>;

export const AssistantPlanDecideRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
  messageId: z.string().trim().min(1).max(80),
  stepId: z.string().trim().min(1).max(80),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).nullable().optional(),
  now: IsoString.optional(),
});
export type AssistantPlanDecideRequest = z.infer<typeof AssistantPlanDecideRequest>;

export const AssistantCancelRequest = z.object({
  conversationId: z.string().trim().min(1).max(80),
});
export type AssistantCancelRequest = z.infer<typeof AssistantCancelRequest>;

/* ───────── Notification Inbox + delivery preferences (Phase 6 Stage 5) ───────── */

export const NotificationsListRequest = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});
export type NotificationsListRequest = z.infer<typeof NotificationsListRequest>;

export const NotificationsMarkReadRequest = z.object({
  /** Specific inbox ids, or 'all'. */
  ids: z.union([z.literal('all'), z.array(z.string().trim().min(1).max(200)).min(1).max(200)]),
});
export type NotificationsMarkReadRequest = z.infer<typeof NotificationsMarkReadRequest>;

const IntelligencePrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

/** Explicit, bounded patch over the EXISTING delivery preference store. */
export const NotificationsPrefsSetRequest = z.object({
  enabled: z.boolean().optional(),
  doNotDisturb: z.boolean().optional(),
  minPriority: IntelligencePrioritySchema.optional(),
  timezoneOffsetMinutes: z
    .number()
    .int()
    .min(-14 * 60)
    .max(14 * 60)
    .nullable()
    .optional(),
  morningBriefMinutes: z.number().int().min(0).max(1439).optional(),
  afternoonUpdateMinutes: z.number().int().min(0).max(1439).optional(),
  eveningSummaryMinutes: z.number().int().min(0).max(1439).optional(),
  weeklyReportDay: z.number().int().min(0).max(6).optional(),
  mutedSources: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});
export type NotificationsPrefsSetRequest = z.infer<typeof NotificationsPrefsSetRequest>;

/* ───────── Companion (mobile) gateway management (Mobile M1-03) ───────── */

/** Turn the LAN companion gateway on or off. */
export const CompanionEnableRequest = z.object({ enabled: z.boolean() }).strict();
export type CompanionEnableRequest = z.infer<typeof CompanionEnableRequest>;

/** Revoke (unpair) a specific device by its registry id. */
export const CompanionRevokeRequest = z
  .object({ deviceId: z.string().trim().min(1).max(200) })
  .strict();
export type CompanionRevokeRequest = z.infer<typeof CompanionRevokeRequest>;

/* ────────────────────────────────── Traces ──────────────────────────────── */

export const GovernanceTraceListRequest = z.object({
  text: z.string().trim().min(1).max(400).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const GovernanceTraceRequest = z.object({
  decisionId: z.string().trim().min(1).max(512),
});
export const ContextTraceRequest = z.object({
  entityRef: z.string().trim().min(1).max(512),
  limit: z.number().int().min(1).max(500).optional(),
});
export const RelationshipTraceRequest = z.object({
  nodeId: z.string().trim().min(1).max(512),
  limit: z.number().int().min(1).max(500).optional(),
});
export const RelationshipPathRequest = z.object({
  from: z.string().trim().min(1).max(512),
  to: z.string().trim().min(1).max(512),
});

export type GovernanceTraceListRequest = z.infer<typeof GovernanceTraceListRequest>;
export type GovernanceTraceRequest = z.infer<typeof GovernanceTraceRequest>;
export type ContextTraceRequest = z.infer<typeof ContextTraceRequest>;
export type RelationshipTraceRequest = z.infer<typeof RelationshipTraceRequest>;
export type RelationshipPathRequest = z.infer<typeof RelationshipPathRequest>;

/* ───────────────────────────── AI Workforce ─────────────────────────────── */

const WorkforceWorkerId = z.string().trim().min(1).max(128);
const WorkforceSkillId = z.string().trim().min(1).max(128);
const WorkforceJobId = z.string().trim().min(1).max(512);
const JobStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);
const VerdictDecisionSchema = z.enum(['allow', 'deny', 'require_approval']);

export const WorkforceWorkerGetRequest = z.object({ workerId: WorkforceWorkerId });

export const WorkforceJobRunRequest = z.object({
  workerId: WorkforceWorkerId,
  skillId: WorkforceSkillId,
  input: z.record(z.unknown()).optional(),
  requestedBy: z.string().trim().min(1).max(128).optional(),
  now: IsoString.optional(),
});

export const WorkforceJobsRequest = z.object({
  workerId: WorkforceWorkerId.optional(),
  status: JobStatusSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export const WorkforceJobGetRequest = z.object({ jobId: WorkforceJobId });

export const WorkforceProposalDecideRequest = z.object({
  jobId: WorkforceJobId,
  proposalId: z.string().trim().min(1).max(512),
  note: z.string().trim().max(2000).optional(),
  now: IsoString.optional(),
});

const WorkflowStepSchema = z.object({
  id: z.string().trim().min(1).max(128),
  kind: z.enum(['worker', 'approval']),
  workerId: WorkforceWorkerId.optional(),
  skillId: WorkforceSkillId.optional(),
  input: z.record(z.unknown()).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(128)).max(50),
  retry: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(0).max(600_000).optional(),
  approvalPrompt: z.string().trim().max(500).optional(),
});

export const WorkforceWorkflowRunRequest = z.object({
  spec: z.object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000),
    steps: z.array(WorkflowStepSchema).min(1).max(50),
  }),
  now: IsoString.optional(),
});

export const WorkforceAuditRequest = z.object({
  workerId: WorkforceWorkerId.optional(),
  decision: VerdictDecisionSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

export type WorkforceWorkerGetRequest = z.infer<typeof WorkforceWorkerGetRequest>;
export type WorkforceJobRunRequest = z.infer<typeof WorkforceJobRunRequest>;
export type WorkforceJobsRequest = z.infer<typeof WorkforceJobsRequest>;
export type WorkforceJobGetRequest = z.infer<typeof WorkforceJobGetRequest>;
export type WorkforceProposalDecideRequest = z.infer<typeof WorkforceProposalDecideRequest>;
export type WorkforceWorkflowRunRequest = z.infer<typeof WorkforceWorkflowRunRequest>;
export type WorkforceAuditRequest = z.infer<typeof WorkforceAuditRequest>;

export const WorkforceWorkflowResumeRequest = z.object({
  runId: z.string().trim().min(1).max(512),
});
export const WorkforceWorkflowCheckpointRequest = z.object({
  runId: z.string().trim().min(1).max(512),
  stepId: z.string().trim().min(1).max(128),
  approved: z.boolean(),
  now: IsoString.optional(),
});
export type WorkforceWorkflowResumeRequest = z.infer<typeof WorkforceWorkflowResumeRequest>;
export type WorkforceWorkflowCheckpointRequest = z.infer<typeof WorkforceWorkflowCheckpointRequest>;

// ── P8.5 — Installable Workers ──
const WorkerPackageRoleSchema = z.enum([
  'founder',
  'research',
  'engineering',
  'marketing',
  'sales',
  'finance',
  'legal',
  'operations',
  'support',
  'executive',
  'infrastructure',
  'hr',
  'procurement',
]);
const WorkerPackageScopeSchema = z.enum([
  'read:entities',
  'read:graph',
  'read:timeline',
  'read:memory',
  'read:health',
  'read:connectors',
  'write:memory',
  'write:reminder',
  'propose:draft',
  'propose:message',
  'execute:action',
]);
const WorkerSkillSpecSchema = z.object({
  kind: z.enum(['advisory', 'draft', 'note', 'mail', 'infra']),
  id: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(200),
  target: z.string().trim().max(64).optional(),
  accountId: z.string().trim().max(200).optional(),
  actionId: z.string().trim().max(128).optional(),
  required: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
  optional: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
  refKey: z.string().trim().max(64).optional(),
});
const WorkerPackageManifestSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(40),
  author: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  role: WorkerPackageRoleSchema,
  memoryScope: z.enum(['none', 'self', 'team', 'org']).optional(),
  goals: z.array(z.string().trim().min(1).max(400)).max(16),
  capabilities: z.array(z.string().trim().min(1).max(120)).max(64),
  permissions: z.array(WorkerPackageScopeSchema).max(16),
  skills: z.array(WorkerSkillSpecSchema).min(1).max(32),
  dependencies: z.array(z.string().trim().min(1).max(128)).max(32),
  engine: z.object({ neuropause: z.string().trim().min(1).max(64) }),
});
export const WorkerPackageSchema = z.object({
  manifest: WorkerPackageManifestSchema,
  checksum: z.string().trim().min(1).max(128),
  signatureKeyId: z.string().trim().max(200).nullable(),
  signature: z.string().trim().max(1024).nullable(),
});
export const WorkforceInstallRequest = z.object({ package: WorkerPackageSchema });
export const WorkforceInstallActionRequest = z.object({
  workerId: z.string().trim().min(1).max(128),
});
export type WorkforceInstallRequest = z.infer<typeof WorkforceInstallRequest>;
export type WorkforceInstallActionRequest = z.infer<typeof WorkforceInstallActionRequest>;

// ── P9 — Enterprise Marketplace ──
const MarketplacePackageTypeSchema = z.enum([
  'worker',
  'connector',
  'template',
  'workflow_pack',
  'knowledge_pack',
  'automation_pack',
  'dashboard_pack',
  'policy_pack',
  'blueprint',
  'prompt_pack',
]);
const ReleaseChannelSchema = z.enum(['stable', 'beta', 'canary', 'lts']);
const PublisherTierSchema = z.enum(['unverified', 'verified', 'trusted', 'official']);

export const MarketplaceCatalogRequest = z.object({
  q: z.string().trim().max(200).optional(),
  type: MarketplacePackageTypeSchema.optional(),
  category: z.string().trim().max(80).optional(),
  channel: ReleaseChannelSchema.optional(),
  verifiedOnly: z.boolean().optional(),
  installedOnly: z.boolean().optional(),
  updatesOnly: z.boolean().optional(),
  collection: z.string().trim().max(80).optional(),
  sort: z.enum(['relevance', 'trending', 'installs', 'rating', 'recent', 'trust']).optional(),
});
export const MarketplaceListingRequest = z.object({ listingId: z.string().trim().min(1).max(200) });
export const MarketplacePolicySetRequest = z.object({
  requireApproval: z.boolean(),
  allowedPublishers: z.array(z.string().trim().min(1).max(200)).max(500),
  blockedPublishers: z.array(z.string().trim().min(1).max(200)).max(500),
  blockedTypes: z.array(MarketplacePackageTypeSchema).max(10),
  minPublisherTier: PublisherTierSchema,
  requireSignature: z.boolean(),
});
export const MarketplaceInstallRequest = z.object({
  listingId: z.string().trim().min(1).max(200),
  // For worker packages, the signed WorkerPackage payload routed to WorkerInstallService.
  package: WorkerPackageSchema.optional(),
});
export type MarketplaceCatalogRequest = z.infer<typeof MarketplaceCatalogRequest>;
export type MarketplaceListingRequest = z.infer<typeof MarketplaceListingRequest>;
export type MarketplacePolicySetRequest = z.infer<typeof MarketplacePolicySetRequest>;
export type MarketplaceInstallRequest = z.infer<typeof MarketplaceInstallRequest>;

// P8 — delegate a goal's task graph across the worker roster (read-only planning).
const WorkerRoleSchema = z.enum([
  'founder',
  'research',
  'engineering',
  'marketing',
  'sales',
  'finance',
  'legal',
  'operations',
  'support',
]);
const WorkerScopeSchema = z.enum([
  'read:entities',
  'read:graph',
  'read:timeline',
  'read:memory',
  'read:health',
  'read:connectors',
  'write:memory',
  'write:reminder',
  'propose:draft',
  'propose:message',
]);
export const WorkforceDelegateRequest = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  tasks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(128),
        title: z.string().trim().min(1).max(300),
        role: WorkerRoleSchema.optional(),
        requiredScopes: z.array(WorkerScopeSchema).max(10).optional(),
        dependsOn: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
        priority: z.number().int().min(-1000).max(1000).optional(),
        effort: z.number().min(0).max(100000).optional(),
      }),
    )
    .max(500),
});
export type WorkforceDelegateRequest = z.infer<typeof WorkforceDelegateRequest>;

/* ── Enterprise Operating System ── */

const EntId = z.string().trim().min(1).max(256);
const EntName = z.string().trim().min(1).max(200);

export const EnterpriseOrgUnitKindSchema = z.enum(['business_unit', 'department', 'team']);
export const EnterpriseUserStatusSchema = z.enum(['active', 'invited', 'suspended']);
export const EnterprisePermissionSchema = z.enum([
  'org:read',
  'org:manage',
  'people:read',
  'people:manage',
  'workspace:read',
  'workspace:manage',
  'workforce:read',
  'workforce:operate',
  'workforce:approve',
  'workforce:manage',
  'marketplace:read',
  'marketplace:manage',
  'governance:read',
  'governance:manage',
  'intelligence:read',
  'operations:read',
  'operations:manage',
  'crm:read',
  'crm:manage',
  'sales:read',
  'sales:manage',
  'inventory:read',
  'inventory:manage',
  'procurement:read',
  'procurement:manage',
  'warehouse:read',
  'warehouse:manage',
  'manufacturing:read',
  'manufacturing:manage',
  'maintenance:read',
  'maintenance:manage',
  'dashboard:read',
  'federation:read',
  'federation:manage',
  'federation:approve',
  'cloud:read',
  'cloud:manage',
  'developer:read',
  'developer:manage',
  'industry:read',
  'strategy:read',
  'twin:read',
  'knowledge:read',
  'orchestration:read',
  'network:read',
  'autonomousops:read',
  'commercial:read',
  'experience:read',
  'intent:read',
]);

export const EnterpriseOrgCreateUnitRequest = z.object({
  kind: EnterpriseOrgUnitKindSchema,
  name: EntName,
  parentId: EntId.nullable().optional(),
  leadUserId: EntId.nullable().optional(),
});
export const EnterpriseOrgUpdateUnitRequest = z.object({
  id: EntId,
  name: EntName.optional(),
  parentId: EntId.nullable().optional(),
  leadUserId: EntId.nullable().optional(),
});
export const EnterpriseOrgDeleteUnitRequest = z.object({ id: EntId });

export const EnterpriseOrgCreateUserRequest = z.object({
  name: EntName,
  email: z.string().email().max(320).nullable().optional(),
  title: z.string().trim().max(120).optional(),
  unitId: EntId.nullable().optional(),
  roleIds: z.array(EntId).max(20).optional(),
});
export const EnterpriseOrgUpdateUserRequest = z.object({
  id: EntId,
  name: EntName.optional(),
  email: z.string().email().max(320).nullable().optional(),
  title: z.string().trim().max(120).optional(),
  unitId: EntId.nullable().optional(),
  roleIds: z.array(EntId).max(20).optional(),
  status: EnterpriseUserStatusSchema.optional(),
});
export const EnterpriseOrgDeleteUserRequest = z.object({ id: EntId });

export const EnterpriseOrgCreateRoleRequest = z.object({
  name: EntName,
  description: z.string().trim().max(400).optional(),
  permissions: z.array(EnterprisePermissionSchema).max(20),
});
export const EnterpriseOrgUpdateRoleRequest = z.object({
  id: EntId,
  name: EntName.optional(),
  description: z.string().trim().max(400).optional(),
  permissions: z.array(EnterprisePermissionSchema).max(20).optional(),
});
export const EnterpriseOrgDeleteRoleRequest = z.object({ id: EntId });

export const EnterpriseWorkspaceCreateRequest = z.object({
  name: EntName,
  organizationId: EntId.optional(),
});
export const EnterpriseWorkspaceSwitchRequest = z.object({ id: EntId });

/**
 * P13C Part 3 — multi-organization.
 *
 * Note what the CREATE request does NOT contain: an owner, a member list, a
 * role, or an id. The creator becomes the owner because they are the session,
 * and the id is generated server-side. Every one of those fields, if accepted,
 * would be a caller-supplied answer to an authorization question — which is the
 * shape `EnterpriseWorkspaceCreateRequest.organizationId` had before P11
 * demoted it to an assertion.
 */
export const EnterpriseOrganizationCreateRequest = z.object({
  name: EntName,
  description: z.string().trim().max(400).optional(),
  /** The first workspace's name. Defaults server-side when absent. */
  workspaceName: EntName.optional(),
});
export const EnterpriseOrganizationSwitchRequest = z.object({ id: EntId });

export const EnterpriseGraphNeighborsRequest = z.object({ id: EntId });

export const EnterpriseGovernanceSetChainRequest = z.object({ id: EntId, enabled: z.boolean() });
export const EnterpriseGovernanceSetRuleRequest = z.object({ id: EntId, enabled: z.boolean() });
export const EnterpriseGovernanceAuditRequest = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

/** Process Explorer query — read-only filter over the mined cases (all fields optional). */
export const EnterpriseProcessExploreRequest = z
  .object({
    processType: z.enum(['order_to_cash', 'procure_to_pay', 'make_to_complete']).optional(),
    status: z.string().trim().max(64).optional(),
    riskBand: z.enum(['low', 'medium', 'high']).optional(),
    customer: z.string().trim().max(256).optional(),
    supplier: z.string().trim().max(256).optional(),
    product: z.string().trim().max(256).optional(),
    machine: z.string().trim().max(256).optional(),
    workCenter: z.string().trim().max(256).optional(),
    warehouse: z.string().trim().max(256).optional(),
    search: z.string().trim().max(256).optional(),
    sinceMs: z.number().int().nonnegative().optional(),
    untilMs: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
export const EnterpriseProcessCaseRequest = z.object({ id: EntId }).strict();

/** Enterprise REST API (P3.0) — one gateway entrypoint; the method+path select the underlying route. */
export const EnterpriseApiRequestRequest = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().trim().min(1).max(512),
    version: z.enum(['v1', 'v2']).optional(),
    apiKey: z.string().trim().max(200).nullish(),
    query: z.record(z.string().max(64), z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
  })
  .strict();

/* ══════════════════ Enterprise Webhooks (P3.0, Increment 4) ═══════════ */

const WebhookCategory = z.enum([
  'application',
  'runtime',
  'plugin',
  'permission',
  'download',
  'update',
  'session',
  'diagnostics',
  'connector',
  'knowledge',
  'automation',
  'enterprise',
  'system',
]);

export const WebhookCreateRequest = z
  .object({
    label: z.string().trim().min(1).max(120),
    url: z.string().url().max(2048),
    categories: z.array(WebhookCategory).max(20).optional(),
    types: z.array(z.string().trim().min(1).max(80)).max(80).optional(),
  })
  .strict();
export type WebhookCreateRequest = z.infer<typeof WebhookCreateRequest>;

export const WebhookSetEnabledRequest = z.object({ id: EntId, enabled: z.boolean() }).strict();
export type WebhookSetEnabledRequest = z.infer<typeof WebhookSetEnabledRequest>;

export const WebhookIdRequest = z.object({ id: EntId }).strict();
export type WebhookIdRequest = z.infer<typeof WebhookIdRequest>;

export const WebhookDeliveriesRequest = z
  .object({ webhookId: EntId.optional(), limit: z.number().int().min(1).max(500).optional() })
  .strict();
export type WebhookDeliveriesRequest = z.infer<typeof WebhookDeliveriesRequest>;

/** Context Engine (P2.5) — entity-360 for any unified-graph / ERP entity id. */
export const EnterpriseContextRequest = z
  .object({
    /** Graph node id (`erp:`-prefixed for ERP entities) or a raw entity/record id. */
    id: z.string().trim().min(1).max(256),
    neighborLimit: z.number().int().min(1).max(200).optional(),
    activityLimit: z.number().int().min(1).max(200).optional(),
    memoryLimit: z.number().int().min(1).max(100).optional(),
    impactDepth: z.number().int().min(1).max(6).optional(),
  })
  .strict();

/* Personalization (per-user Favorites / Recently-Opened / Saved Views). The actor is resolved server-side. */
const EntTab = z.string().trim().min(1).max(64);
const EntQuery = z.string().trim().max(256).optional();
export const EnterprisePersonalizationFavoriteRequest = z
  .object({
    id: EntId,
    kind: z.string().trim().max(64).optional(),
    label: z.string().trim().max(200).optional(),
    tab: EntTab,
    query: EntQuery,
  })
  .strict();
export const EnterprisePersonalizationRecentRequest = z
  .object({
    id: EntId,
    kind: z.string().trim().max(64).optional(),
    label: z.string().trim().max(200).optional(),
    tab: EntTab,
    query: EntQuery,
  })
  .strict();
export const EnterprisePersonalizationSaveViewRequest = z
  .object({
    id: EntId.optional(),
    label: EntName,
    tab: EntTab,
    query: EntQuery,
    filters: z.string().max(8192).optional(),
  })
  .strict();
export const EnterprisePersonalizationDeleteViewRequest = z.object({ id: EntId }).strict();
export const EnterprisePersonalizationRenameViewRequest = z
  .object({ id: EntId, label: EntName })
  .strict();

export type EnterpriseOrgCreateUnitRequest = z.infer<typeof EnterpriseOrgCreateUnitRequest>;
export type EnterpriseOrgUpdateUnitRequest = z.infer<typeof EnterpriseOrgUpdateUnitRequest>;
export type EnterpriseOrgDeleteUnitRequest = z.infer<typeof EnterpriseOrgDeleteUnitRequest>;
export type EnterpriseOrgCreateUserRequest = z.infer<typeof EnterpriseOrgCreateUserRequest>;
export type EnterpriseOrgUpdateUserRequest = z.infer<typeof EnterpriseOrgUpdateUserRequest>;
export type EnterpriseOrgDeleteUserRequest = z.infer<typeof EnterpriseOrgDeleteUserRequest>;
export type EnterpriseOrgCreateRoleRequest = z.infer<typeof EnterpriseOrgCreateRoleRequest>;
export type EnterpriseOrgUpdateRoleRequest = z.infer<typeof EnterpriseOrgUpdateRoleRequest>;
export type EnterpriseOrgDeleteRoleRequest = z.infer<typeof EnterpriseOrgDeleteRoleRequest>;
export type EnterpriseWorkspaceCreateRequest = z.infer<typeof EnterpriseWorkspaceCreateRequest>;
export type EnterpriseWorkspaceSwitchRequest = z.infer<typeof EnterpriseWorkspaceSwitchRequest>;
export type EnterpriseOrganizationCreateRequest = z.infer<
  typeof EnterpriseOrganizationCreateRequest
>;
export type EnterpriseOrganizationSwitchRequest = z.infer<
  typeof EnterpriseOrganizationSwitchRequest
>;
export type EnterpriseGraphNeighborsRequest = z.infer<typeof EnterpriseGraphNeighborsRequest>;
export type EnterpriseProcessExploreRequest = z.infer<typeof EnterpriseProcessExploreRequest>;
export type EnterpriseProcessCaseRequest = z.infer<typeof EnterpriseProcessCaseRequest>;
export type EnterpriseContextRequest = z.infer<typeof EnterpriseContextRequest>;
export type EnterpriseApiRequestRequest = z.infer<typeof EnterpriseApiRequestRequest>;
export type EnterpriseGovernanceSetChainRequest = z.infer<
  typeof EnterpriseGovernanceSetChainRequest
>;
export type EnterpriseGovernanceSetRuleRequest = z.infer<typeof EnterpriseGovernanceSetRuleRequest>;
export type EnterpriseGovernanceAuditRequest = z.infer<typeof EnterpriseGovernanceAuditRequest>;
export type EnterprisePersonalizationFavoriteRequest = z.infer<
  typeof EnterprisePersonalizationFavoriteRequest
>;
export type EnterprisePersonalizationRecentRequest = z.infer<
  typeof EnterprisePersonalizationRecentRequest
>;
export type EnterprisePersonalizationSaveViewRequest = z.infer<
  typeof EnterprisePersonalizationSaveViewRequest
>;
export type EnterprisePersonalizationDeleteViewRequest = z.infer<
  typeof EnterprisePersonalizationDeleteViewRequest
>;
export type EnterprisePersonalizationRenameViewRequest = z.infer<
  typeof EnterprisePersonalizationRenameViewRequest
>;

/* ══════════════════ Enterprise Module Framework (ERP foundation) ═══════════ */

const ModuleId = z.string().trim().min(1).max(64);
const RecordStatus = z.enum(['active', 'archived', 'deleted']);
const RecordFieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const RecordFields = z.record(z.string().max(128), RecordFieldValue);
const RecordMeta = z.record(z.string().max(128), RecordFieldValue);
const RecordTags = z.array(z.string().trim().min(1).max(64)).max(50);

export const ModuleListRequest = z
  .object({
    moduleId: ModuleId,
    status: RecordStatus.optional(),
    search: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export const ModuleGetRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();

export const ModuleCreateRequest = z
  .object({
    moduleId: ModuleId,
    title: z.string().trim().max(400).optional(),
    fields: RecordFields.optional(),
    tags: RecordTags.optional(),
    metadata: RecordMeta.optional(),
  })
  .strict();

export const ModuleUpdateRequest = z
  .object({
    moduleId: ModuleId,
    id: EntId,
    title: z.string().trim().max(400).optional(),
    fields: RecordFields.optional(),
    tags: RecordTags.optional(),
    metadata: RecordMeta.optional(),
  })
  .strict();

export const ModuleSetStatusRequest = z
  .object({ moduleId: ModuleId, id: EntId, status: RecordStatus })
  .strict();

export const ModuleDeleteRequest = z
  .object({
    moduleId: ModuleId,
    id: EntId,
    /**
     * Acknowledge a HIGH RISK assessment and delete anyway. Absent = the
     * deterministic dependency assessment gates the delete; a linked record
     * refuses without this flag, returning the assessment instead.
     */
    force: z.boolean().optional(),
  })
  .strict();

export const ModuleSummarizeRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();

export const ModuleActionRequest = z
  .object({ moduleId: ModuleId, id: EntId, action: z.string().trim().min(1).max(64) })
  .strict();

/* ── ERP document layer: lines + approval ──────────────────────────────────
 * These are the requests for engines that already existed but had no channel.
 * Bounds are deliberate: MAX_LINES_PER_DOCUMENT is enforced again in the line
 * store, but a payload cap belongs at the boundary so a malformed renderer
 * cannot make the main process do the work before refusing it. */

export const ModuleLinesRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();
export type ModuleLinesRequest = z.infer<typeof ModuleLinesRequest>;

const DocumentLineInput = z
  .object({
    productId: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(400).optional(),
    quantity: z.number().finite(),
    unit: z.string().trim().max(24).nullable().optional(),
    unitPrice: z.number().finite().optional(),
    discountPercent: z.number().finite().nullable().optional(),
    discountAmount: z.number().finite().nullable().optional(),
    taxRatePercent: z.number().finite().nullable().optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    accountId: z.string().trim().max(120).nullable().optional(),
    warehouseId: z.string().trim().max(120).nullable().optional(),
    projectId: z.string().trim().max(120).nullable().optional(),
    costCenterId: z.string().trim().max(120).nullable().optional(),
    batchId: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export const ModuleSetLinesRequest = z
  .object({ moduleId: ModuleId, id: EntId, lines: z.array(DocumentLineInput).max(500) })
  .strict();
export type ModuleSetLinesRequest = z.infer<typeof ModuleSetLinesRequest>;

export const ModuleApprovalRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();
export type ModuleApprovalRequest = z.infer<typeof ModuleApprovalRequest>;

export const ModuleApproveRequest = z
  .object({
    moduleId: ModuleId,
    id: EntId,
    stepId: z.string().trim().min(1).max(80),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(400).optional(),
  })
  .strict();
export type ModuleApproveRequest = z.infer<typeof ModuleApproveRequest>;

export const ModuleSearchRequest = z
  .object({
    moduleId: ModuleId,
    query: z.string().trim().max(200),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type ModuleListRequest = z.infer<typeof ModuleListRequest>;
export type ModuleGetRequest = z.infer<typeof ModuleGetRequest>;
export type ModuleCreateRequest = z.infer<typeof ModuleCreateRequest>;
export type ModuleUpdateRequest = z.infer<typeof ModuleUpdateRequest>;
export type ModuleSetStatusRequest = z.infer<typeof ModuleSetStatusRequest>;
export type ModuleDeleteRequest = z.infer<typeof ModuleDeleteRequest>;
export type ModuleSearchRequest = z.infer<typeof ModuleSearchRequest>;
export type ModuleSummarizeRequest = z.infer<typeof ModuleSummarizeRequest>;
export type ModuleActionRequest = z.infer<typeof ModuleActionRequest>;

/* ════════════════════════ Ecosystem Platform (Phase 8) ════════════════════ */

const EcoId = z.string().min(1).max(200);
const EcoPlanTier = z.enum(['free', 'pro', 'enterprise']);
const EcoApiScope = z.enum([
  'marketplace:read',
  'marketplace:publish',
  'workers:read',
  'workers:manage',
  'connectors:read',
  'connectors:manage',
  'plugins:read',
  'plugins:manage',
  'usage:read',
  'billing:read',
]);
const EcoListingKind = z.enum([
  'ai_app',
  'ai_worker',
  'connector',
  'plugin',
  'automation_template',
  'enterprise_template',
]);
const EcoPricingModel = z.enum(['free', 'one_time', 'subscription']);
const EcoApiVersion = z.enum(['v1', 'v2']);
const EcoGrantType = z.enum(['authorization_code', 'client_credentials', 'refresh_token']);
const EcoReviewDecision = z.enum(['approved', 'rejected', 'changes_requested']);

const EcoListingPricing = z.object({
  model: EcoPricingModel,
  amount: z.number().min(0),
  currency: z.string().min(3).max(3),
});

const EcoListingManifest = z.object({
  kind: EcoListingKind,
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(40),
  entry: z.string().max(400),
  permissions: z.array(z.string().max(120)).max(64),
  capabilities: z.array(z.string().max(120)).max(64),
  dependencies: z.array(z.string().max(200)).max(128),
  network: z.array(z.string().max(200)).max(64),
  metadata: z.record(z.string().max(400)),
});

export const EcosystemDeveloperSetPlanRequest = z.object({ planTier: EcoPlanTier });
export type EcosystemDeveloperSetPlanRequest = z.infer<typeof EcosystemDeveloperSetPlanRequest>;

export const EcosystemKeysCreateRequest = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(EcoApiScope).min(1),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type EcosystemKeysCreateRequest = z.infer<typeof EcosystemKeysCreateRequest>;

export const EcosystemKeysRevokeRequest = z.object({ id: EcoId });
export type EcosystemKeysRevokeRequest = z.infer<typeof EcosystemKeysRevokeRequest>;

export const EcosystemOAuthCreateRequest = z.object({
  name: z.string().min(1).max(120),
  redirectUris: z.array(z.string().url()).max(16),
  scopes: z.array(EcoApiScope),
  grantTypes: z.array(EcoGrantType).min(1),
});
export type EcosystemOAuthCreateRequest = z.infer<typeof EcosystemOAuthCreateRequest>;

export const EcosystemOAuthDeleteRequest = z.object({ id: EcoId });
export type EcosystemOAuthDeleteRequest = z.infer<typeof EcosystemOAuthDeleteRequest>;

/** P3.0 — rotate an API key (issue a new secret, revoke the old one). */
export const EcosystemKeysRotateRequest = z.object({ id: EcoId });
export type EcosystemKeysRotateRequest = z.infer<typeof EcosystemKeysRotateRequest>;

/** P3.0 — OAuth 2.1 client-credentials token request. `scope` is space-delimited (RFC 6749). */
export const EcosystemOAuthTokenRequest = z
  .object({
    grantType: z.literal('client_credentials'),
    clientId: z.string().trim().min(1).max(128),
    clientSecret: z.string().trim().min(1).max(256),
    scope: z.string().trim().max(512).optional(),
  })
  .strict();
export type EcosystemOAuthTokenRequest = z.infer<typeof EcosystemOAuthTokenRequest>;

/** P3.0 — revoke a previously-issued access token by its jti. */
export const EcosystemOAuthRevokeTokenRequest = z
  .object({ jti: z.string().trim().min(1).max(128) })
  .strict();
export type EcosystemOAuthRevokeTokenRequest = z.infer<typeof EcosystemOAuthRevokeTokenRequest>;

export const EcosystemUsageAnalyticsRequest = z.object({
  windowDays: z.number().int().min(1).max(90).optional(),
});
export type EcosystemUsageAnalyticsRequest = z.infer<typeof EcosystemUsageAnalyticsRequest>;

export const EcosystemMarketplaceDetailRequest = z.object({ id: EcoId });
export type EcosystemMarketplaceDetailRequest = z.infer<typeof EcosystemMarketplaceDetailRequest>;

export const EcosystemMarketplaceEventsRequest = z.object({
  listingId: EcoId.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type EcosystemMarketplaceEventsRequest = z.infer<typeof EcosystemMarketplaceEventsRequest>;

export const EcosystemListingCreateRequest = z.object({
  kind: EcoListingKind,
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  summary: z.string().max(500),
  category: z.string().max(120),
  pricing: EcoListingPricing,
  certified: z.boolean().optional(),
});
export type EcosystemListingCreateRequest = z.infer<typeof EcosystemListingCreateRequest>;

export const EcosystemVersionCreateRequest = z.object({
  listingId: EcoId,
  manifest: EcoListingManifest,
  changelog: z.string().max(2000),
});
export type EcosystemVersionCreateRequest = z.infer<typeof EcosystemVersionCreateRequest>;

export const EcosystemListingSubmitRequest = z.object({ versionId: EcoId });
export type EcosystemListingSubmitRequest = z.infer<typeof EcosystemListingSubmitRequest>;

export const EcosystemListingReviewRequest = z.object({
  versionId: EcoId,
  decision: EcoReviewDecision,
  notes: z.string().max(2000).optional(),
});
export type EcosystemListingReviewRequest = z.infer<typeof EcosystemListingReviewRequest>;

export const EcosystemListingPublishRequest = z.object({ versionId: EcoId });
export type EcosystemListingPublishRequest = z.infer<typeof EcosystemListingPublishRequest>;

export const EcosystemListingRollbackRequest = z.object({ listingId: EcoId });
export type EcosystemListingRollbackRequest = z.infer<typeof EcosystemListingRollbackRequest>;

export const EcosystemListingInstallRequest = z.object({ listingId: EcoId });
export type EcosystemListingInstallRequest = z.infer<typeof EcosystemListingInstallRequest>;

export const EcosystemListingRateRequest = z.object({
  listingId: EcoId,
  stars: z.number().int().min(1).max(5),
});
export type EcosystemListingRateRequest = z.infer<typeof EcosystemListingRateRequest>;

export const EcosystemGatewayRequestRequest = z.object({
  apiKey: z.string().max(400).nullable().optional(),
  method: z.string().min(1).max(10),
  path: z.string().min(1).max(400),
  version: EcoApiVersion,
  scope: EcoApiScope.nullable().optional(),
});
export type EcosystemGatewayRequestRequest = z.infer<typeof EcosystemGatewayRequestRequest>;

export const EcosystemGatewayAuditRequest = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type EcosystemGatewayAuditRequest = z.infer<typeof EcosystemGatewayAuditRequest>;

export const EcosystemGatewayMetricsRequest = z.object({
  windowDays: z.number().int().min(1).max(90).optional(),
});
export type EcosystemGatewayMetricsRequest = z.infer<typeof EcosystemGatewayMetricsRequest>;

export const EcosystemBillingSetPlanRequest = z.object({ planTier: EcoPlanTier });
export type EcosystemBillingSetPlanRequest = z.infer<typeof EcosystemBillingSetPlanRequest>;

export const EcosystemBillingInvoiceRequest = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export type EcosystemBillingInvoiceRequest = z.infer<typeof EcosystemBillingInvoiceRequest>;

export const EcosystemBillingAssignSeatRequest = z.object({
  userId: EcoId,
  userName: z.string().min(1).max(200),
});
export type EcosystemBillingAssignSeatRequest = z.infer<typeof EcosystemBillingAssignSeatRequest>;

export const EcosystemBillingReleaseSeatRequest = z.object({ seatId: EcoId });
export type EcosystemBillingReleaseSeatRequest = z.infer<typeof EcosystemBillingReleaseSeatRequest>;

export const EcosystemBillingPurchaseRequest = z.object({ listingId: EcoId });
export type EcosystemBillingPurchaseRequest = z.infer<typeof EcosystemBillingPurchaseRequest>;

/* ════════════════════════ Enterprise Ecosystem (Stage 2) ══════════════════ */

const EcoPackKind = z.enum(['knowledge', 'ai_worker', 'automation', 'connector']);

export const EcosystemInstallRequest = z.object({ listingId: EcoId });
export type EcosystemInstallRequest = z.infer<typeof EcosystemInstallRequest>;

export const EcosystemInstallUpdateRequest = z.object({ installationId: EcoId });
export type EcosystemInstallUpdateRequest = z.infer<typeof EcosystemInstallUpdateRequest>;

export const EcosystemInstallSetEnabledRequest = z.object({
  installationId: EcoId,
  enabled: z.boolean(),
});
export type EcosystemInstallSetEnabledRequest = z.infer<typeof EcosystemInstallSetEnabledRequest>;

export const EcosystemUninstallRequest = z.object({ installationId: EcoId });
export type EcosystemUninstallRequest = z.infer<typeof EcosystemUninstallRequest>;

export const EcosystemShareWorkerRequest = z.object({ workerId: EcoId });
export type EcosystemShareWorkerRequest = z.infer<typeof EcosystemShareWorkerRequest>;

export const EcosystemPackPublishRequest = z.object({
  name: z.string().min(1).max(200),
  summary: z.string().max(500),
  kind: EcoPackKind,
  items: z
    .array(
      z.object({
        kind: z.string().max(60),
        name: z.string().min(1).max(200),
        detail: z.string().max(200),
      }),
    )
    .max(64),
});
export type EcosystemPackPublishRequest = z.infer<typeof EcosystemPackPublishRequest>;

export const EcosystemPackImportRequest = z.object({ id: EcoId });
export type EcosystemPackImportRequest = z.infer<typeof EcosystemPackImportRequest>;

export const EcosystemPackRemoveRequest = z.object({ id: EcoId });
export type EcosystemPackRemoveRequest = z.infer<typeof EcosystemPackRemoveRequest>;

/* ════════════════════════ Cloud Platform (Phase 9 · Stage 1) ══════════════ */

const CloudId = z.string().min(1).max(128);
const CloudRegionZ = z.enum([
  'us-east',
  'us-west',
  'eu-west',
  'eu-central',
  'ap-south',
  'ap-southeast',
]);
const CloudTenantTierZ = z.enum(['free', 'business', 'enterprise']);
const CloudTenantStatusZ = z.enum(['active', 'suspended', 'provisioning']);
const CloudSsoProtocolZ = z.enum(['saml', 'oidc']);
const CloudSsoStatusZ = z.enum(['active', 'disabled', 'error']);
const CloudMfaMethodZ = z.enum(['totp', 'webauthn', 'sms']);
const CloudWebhookStatusZ = z.enum(['active', 'paused', 'failing']);

const ByTenant = z.object({ tenantId: z.string().optional() });
export type ByTenantRequest = z.infer<typeof ByTenant>;
export {
  ByTenant as CloudProjectsRequest,
  ByTenant as CloudTeamsRequest,
  ByTenant as CloudTenantWorkersRequest,
};

export const CloudCreateTenantRequest = z.object({
  name: z.string().min(1).max(120),
  regionId: CloudRegionZ,
  tier: CloudTenantTierZ,
});
export type CloudCreateTenantRequest = z.infer<typeof CloudCreateTenantRequest>;

export const CloudSetTenantStatusRequest = z.object({
  tenantId: CloudId,
  status: CloudTenantStatusZ,
});
export type CloudSetTenantStatusRequest = z.infer<typeof CloudSetTenantStatusRequest>;

export const CloudCreateProjectRequest = z.object({
  tenantId: CloudId,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});
export type CloudCreateProjectRequest = z.infer<typeof CloudCreateProjectRequest>;

export const CloudDeleteProjectRequest = z.object({ id: CloudId });
export type CloudDeleteProjectRequest = z.infer<typeof CloudDeleteProjectRequest>;

export const CloudCreateTeamRequest = z.object({
  tenantId: CloudId,
  name: z.string().min(1).max(120),
});
export type CloudCreateTeamRequest = z.infer<typeof CloudCreateTeamRequest>;

export const CloudCreateSsoRequest = z.object({
  name: z.string().min(1).max(120),
  protocol: CloudSsoProtocolZ,
  issuer: z.string().min(1).max(400),
  entityId: z.string().max(400).optional(),
  ssoUrl: z.string().min(1).max(400),
  clientId: z.string().max(200).optional(),
  domains: z.array(z.string().max(200)).max(32),
  attributeMapping: z.record(z.string()).optional(),
});
export type CloudCreateSsoRequest = z.infer<typeof CloudCreateSsoRequest>;

export const CloudUpdateSsoRequest = z.object({
  id: CloudId,
  status: CloudSsoStatusZ.optional(),
  enforced: z.boolean().optional(),
  domains: z.array(z.string().max(200)).max(32).optional(),
  name: z.string().min(1).max(120).optional(),
});
export type CloudUpdateSsoRequest = z.infer<typeof CloudUpdateSsoRequest>;

export const CloudDeleteSsoRequest = z.object({ id: CloudId });
export type CloudDeleteSsoRequest = z.infer<typeof CloudDeleteSsoRequest>;

export const CloudTestSsoRequest = z.object({ id: CloudId });
export type CloudTestSsoRequest = z.infer<typeof CloudTestSsoRequest>;

export const CloudSetScimRequest = z.object({ enabled: z.boolean() });
export type CloudSetScimRequest = z.infer<typeof CloudSetScimRequest>;

export const CloudSetMfaRequest = z.object({
  required: z.boolean().optional(),
  methods: z.array(CloudMfaMethodZ).optional(),
  graceDays: z.number().int().min(0).max(90).optional(),
});
export type CloudSetMfaRequest = z.infer<typeof CloudSetMfaRequest>;

// --- Live cloud sync (real record-level sync) ---
export const LiveSyncSetOnlineRequest = z.object({ online: z.boolean() });
export type LiveSyncSetOnlineRequest = z.infer<typeof LiveSyncSetOnlineRequest>;

export const LiveSyncSetActiveOrgRequest = z.object({ orgId: z.string().nullable() });
export type LiveSyncSetActiveOrgRequest = z.infer<typeof LiveSyncSetActiveOrgRequest>;

/** Observable status of the live sync engine, surfaced to the renderer. */
export interface LiveSyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  online: boolean;
  pendingCount: number;
  failures: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  cursor: number;
}

/**
 * One syncable entity type's real local state: outbound changes still queued on this
 * device and records already reconciled into the local mirror. Projected from the
 * engine's own queue + mirror — nothing is estimated.
 */
export interface LiveSyncEntityState {
  entityType: SyncEntityType;
  /** Local edits queued for the next push. */
  pending: number;
  /** Records held in the local mirror for the active org. */
  synced: number;
  /** Newest `updatedAt` across the queued and mirrored records, or null when empty. */
  lastChangeAt: string | null;
}

/**
 * A conflict the engine actually resolved during a sync cycle. `direction` records
 * which leg surfaced it: `push` when the server reported a conflicting write,
 * `pull` when an incoming change tied with the local copy.
 */
export interface LiveSyncConflict {
  entityType: SyncEntityType;
  entityId: string;
  direction: 'push' | 'pull';
  resolution: ConflictStrategy;
  at: string;
}

/**
 * The full live-sync view the Cloud → Sync panel renders: engine status, the active
 * org and device the engine is bound to, the per-entity breakdown, and the bounded
 * resolved-conflict log (newest first).
 */
export interface LiveSyncDetail {
  status: LiveSyncStatus;
  /** The org the engine is currently syncing, or null when signed out / no org selected. */
  orgId: string | null;
  deviceId: string;
  entities: LiveSyncEntityState[];
  conflicts: LiveSyncConflict[];
}

export const CloudSetPolicyEnabledRequest = z.object({ id: CloudId, enabled: z.boolean() });
export type CloudSetPolicyEnabledRequest = z.infer<typeof CloudSetPolicyEnabledRequest>;

export const CloudCreateWebhookRequest = z.object({
  url: z.string().min(1).max(400),
  events: z.array(z.string().max(80)).max(32),
});
export type CloudCreateWebhookRequest = z.infer<typeof CloudCreateWebhookRequest>;

export const CloudSetWebhookStatusRequest = z.object({ id: CloudId, status: CloudWebhookStatusZ });
export type CloudSetWebhookStatusRequest = z.infer<typeof CloudSetWebhookStatusRequest>;

export const CloudDeleteWebhookRequest = z.object({ id: CloudId });
export type CloudDeleteWebhookRequest = z.infer<typeof CloudDeleteWebhookRequest>;

export const CloudTestWebhookRequest = z.object({ id: CloudId });
export type CloudTestWebhookRequest = z.infer<typeof CloudTestWebhookRequest>;

/* ════════════════════════ Federation Platform (Phase 9 · Stage 2) ═════════ */

const FedId = z.string().min(1).max(128);
const TrustLevelZ = z.enum(['none', 'basic', 'verified', 'full']);
const SharedResourceKindZ = z.enum([
  'project',
  'workspace',
  'ai_worker',
  'governance_policy',
  'connector',
]);
const ShareAccessZ = z.enum(['read', 'collaborate']);
const ExchangeKindZ = z.enum([
  'ai_worker',
  'connector_pack',
  'governance_policy',
  'workflow_template',
  'knowledge_package',
  'dashboard_template',
]);
const ExchangeScopeZ = z.enum(['private', 'public', 'partner', 'regional']);
const VerificationStatusZ = z.enum(['unverified', 'verified', 'official']);
const FedPolicyScopeZ = z.enum(['all', 'trusted', 'partner']);
const FedPolicyEffectZ = z.enum(['allow', 'deny', 'require_approval']);
const FedRegionZ = z.enum([
  'us-east',
  'us-west',
  'eu-west',
  'eu-central',
  'ap-south',
  'ap-southeast',
]);
const BackupScopeZ = z.enum(['full', 'incremental']);

export const FedInviteOrgRequest = z.object({
  name: z.string().min(1).max(120),
  trustLevel: TrustLevelZ,
  message: z.string().max(500).optional(),
});
export type FedInviteOrgRequest = z.infer<typeof FedInviteOrgRequest>;

export const FedRespondInviteRequest = z.object({ id: FedId, accept: z.boolean() });
export type FedRespondInviteRequest = z.infer<typeof FedRespondInviteRequest>;

export const FedSetTrustRequest = z.object({
  peerOrg: FedId,
  trustLevel: TrustLevelZ.optional(),
  delegatedApproval: z.boolean().optional(),
  canShareWorkers: z.boolean().optional(),
  canShareData: z.boolean().optional(),
});
export type FedSetTrustRequest = z.infer<typeof FedSetTrustRequest>;

export const FedShareResourceRequest = z.object({
  kind: SharedResourceKindZ,
  name: z.string().min(1).max(120),
  peerOrg: FedId,
  access: ShareAccessZ,
});
export type FedShareResourceRequest = z.infer<typeof FedShareResourceRequest>;

export const FedRevokeShareRequest = z.object({ id: FedId });
export type FedRevokeShareRequest = z.infer<typeof FedRevokeShareRequest>;

export const FedPublishArtifactRequest = z.object({
  kind: ExchangeKindZ,
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  scope: ExchangeScopeZ,
  regionId: FedRegionZ.nullable().optional(),
});
export type FedPublishArtifactRequest = z.infer<typeof FedPublishArtifactRequest>;

export const FedPublishVersionRequest = z.object({
  artifactId: FedId,
  version: z.string().min(1).max(40),
  changelog: z.string().max(500),
});
export type FedPublishVersionRequest = z.infer<typeof FedPublishVersionRequest>;

export const FedRateArtifactRequest = z.object({
  artifactId: FedId,
  stars: z.number().int().min(1).max(5),
});
export type FedRateArtifactRequest = z.infer<typeof FedRateArtifactRequest>;

export const FedSetVerificationRequest = z.object({
  artifactId: FedId,
  verification: VerificationStatusZ,
});
export type FedSetVerificationRequest = z.infer<typeof FedSetVerificationRequest>;

export const FedRollbackArtifactRequest = z.object({ artifactId: FedId });
export type FedRollbackArtifactRequest = z.infer<typeof FedRollbackArtifactRequest>;

export const FedInstallArtifactRequest = z.object({ artifactId: FedId });
export type FedInstallArtifactRequest = z.infer<typeof FedInstallArtifactRequest>;

export const FedVerifyVersionRequest = z.object({ artifactId: FedId, versionId: FedId });
export type FedVerifyVersionRequest = z.infer<typeof FedVerifyVersionRequest>;

export const FedSetScopeRequest = z.object({ artifactId: FedId, scope: ExchangeScopeZ });
export type FedSetScopeRequest = z.infer<typeof FedSetScopeRequest>;

export const FedAddPolicyRequest = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  scope: FedPolicyScopeZ,
  effect: FedPolicyEffectZ,
  action: z.string().min(1).max(60),
});
export type FedAddPolicyRequest = z.infer<typeof FedAddPolicyRequest>;

export const FedSetPolicyEnabledRequest = z.object({ id: FedId, enabled: z.boolean() });
export type FedSetPolicyEnabledRequest = z.infer<typeof FedSetPolicyEnabledRequest>;

export const FedResolveApprovalRequest = z.object({ id: FedId, approve: z.boolean() });
export type FedResolveApprovalRequest = z.infer<typeof FedResolveApprovalRequest>;

export const FedRecordActionRequest = z.object({
  action: z.string().min(1).max(60),
  peerOrg: FedId,
  peerOrgName: z.string().min(1).max(120),
  trustLevel: TrustLevelZ,
  detail: z.string().max(300),
});
export type FedRecordActionRequest = z.infer<typeof FedRecordActionRequest>;

export const FedCreateBackupRequest = z.object({ scope: BackupScopeZ });
export type FedCreateBackupRequest = z.infer<typeof FedCreateBackupRequest>;

export const FedRunValidationRequest = z.object({ backupId: FedId });
export type FedRunValidationRequest = z.infer<typeof FedRunValidationRequest>;

/* ───────────────────────── P10 — Federation Platform contracts ───────────── */

export const FederationSearchKindSchema = z.enum([
  'organization',
  'artifact',
  'policy',
  'shared_resource',
]);
export const FederationSearchRequest = z.object({
  text: z.string().trim().max(200),
  kinds: z.array(FederationSearchKindSchema).max(4).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type FederationSearchRequest = z.infer<typeof FederationSearchRequest>;

/* ───────────────────────── Application self-update contracts ─────────────── */

export const UpdateChannelSchema = z.enum(['stable', 'beta', 'internal']);
export type UpdateChannelName = z.infer<typeof UpdateChannelSchema>;

export const HelpOpenDocRequest = z.object({ doc: z.enum(HELP_DOC_IDS) });
export type HelpOpenDocRequest = z.infer<typeof HelpOpenDocRequest>;

export const UpdateSetChannelRequest = z.object({ channel: UpdateChannelSchema });
export type UpdateSetChannelRequest = z.infer<typeof UpdateSetChannelRequest>;

/* ───────────────────────── Release engineering contracts ────────────────── */

export const MaintenanceDomainSchema = z.enum([
  'database',
  'registry',
  'configuration',
  'workspace',
  'knowledgeGraph',
  'aiWorker',
  'plugin',
  'aiMemory',
  'timeline',
]);
export type MaintenanceDomainName = z.infer<typeof MaintenanceDomainSchema>;

export const RecoveryActionSchema = z.enum([
  'safeMode',
  'disablePlugins',
  'resetSettings',
  'restoreBackup',
  'repairInstallation',
  'verifyIntegrity',
  'rebuildSearchIndexes',
  'rebuildKnowledgeGraph',
]);
export type RecoveryActionName = z.infer<typeof RecoveryActionSchema>;

export const MigrationRunRequest = z.object({ dryRun: z.boolean().optional() });
export type MigrationRunRequest = z.infer<typeof MigrationRunRequest>;

export const BackupCreateRequest = z.object({
  trigger: z.enum(['manual', 'scheduled']).optional(),
  domains: z.array(MaintenanceDomainSchema).optional(),
});
export type BackupCreateRequest = z.infer<typeof BackupCreateRequest>;

const BackupIdSchema = z.string().trim().min(1).max(128);
export const BackupIdRequest = z.object({ id: BackupIdSchema });
export type BackupIdRequest = z.infer<typeof BackupIdRequest>;

export const BackupRestoreRequest = z.object({
  id: BackupIdSchema,
  domains: z.array(MaintenanceDomainSchema).optional(),
});
export type BackupRestoreRequest = z.infer<typeof BackupRestoreRequest>;

export const CrashSetOptInRequest = z.object({ optedIn: z.boolean() });

/** A renderer-side error (e.g. from an ErrorBoundary) forwarded to the crash store. */
export const CrashReportRequest = z.object({
  kind: z.string().min(1).max(120),
  message: z.string().max(2000),
  stack: z.string().max(20000).optional(),
});
export type CrashReportRequest = z.infer<typeof CrashReportRequest>;

// --- Feature flags ---
const FlagPlanTierZ = z.enum(['free', 'pro', 'enterprise']);
const FeatureFlagKeyZ = z.enum([
  'cloud_sync',
  'automation_builder',
  'ai_memory_search',
  'advanced_analytics',
  'multi_workspace',
]);

export const FlagsGetRequest = z.object({ planTier: FlagPlanTierZ });
export type FlagsGetRequest = z.infer<typeof FlagsGetRequest>;

export const FlagsSetOverrideRequest = z.object({
  key: FeatureFlagKeyZ,
  value: z.boolean(),
  planTier: FlagPlanTierZ,
});
export type FlagsSetOverrideRequest = z.infer<typeof FlagsSetOverrideRequest>;

export const FlagsClearOverrideRequest = z.object({
  key: FeatureFlagKeyZ,
  planTier: FlagPlanTierZ,
});
export type FlagsClearOverrideRequest = z.infer<typeof FlagsClearOverrideRequest>;

// --- License validation ---
export const LicenseOrgRequest = z.object({ orgId: z.string().min(1) });
export type LicenseOrgRequest = z.infer<typeof LicenseOrgRequest>;

// --- Onboarding ---
export const OnboardingCompleteStepRequest = z.object({
  step: z.enum(['welcome', 'organization', 'connectors', 'ai_setup', 'pilot']),
});
export type OnboardingCompleteStepRequest = z.infer<typeof OnboardingCompleteStepRequest>;

// --- AI configuration (M6 writes) ---
export const AiSetProviderRequest = z.object({ provider: z.enum(['claude', 'ollama']) }).strict();
export type AiSetProviderRequest = z.infer<typeof AiSetProviderRequest>;
export const AiSetModelRequest = z.object({ model: z.string() }).strict();
export type AiSetModelRequest = z.infer<typeof AiSetModelRequest>;
export const AiSetCredentialRequest = z
  .object({ provider: z.literal('claude'), secret: z.string().min(1) })
  .strict();
export type AiSetCredentialRequest = z.infer<typeof AiSetCredentialRequest>;
export const AiClearCredentialRequest = z.object({ provider: z.literal('claude') }).strict();
export type AiClearCredentialRequest = z.infer<typeof AiClearCredentialRequest>;
export const AiTestRequest = z
  .object({ provider: z.enum(['claude', 'ollama']), secret: z.string().optional() })
  .strict();
export type AiTestRequest = z.infer<typeof AiTestRequest>;

// --- Feedback ---
export const FeedbackSubmitRequest = z.object({
  category: z.enum(['bug', 'idea', 'question', 'praise']),
  message: z.string().min(1),
  context: z.string().optional(),
});
export type FeedbackSubmitRequest = z.infer<typeof FeedbackSubmitRequest>;

// --- Pilot mode ---
export const PilotSetEnabledRequest = z.object({ enabled: z.boolean() });
export type PilotSetEnabledRequest = z.infer<typeof PilotSetEnabledRequest>;
export type CrashSetOptInRequest = z.infer<typeof CrashSetOptInRequest>;

export const RecoveryRunRequest = z.object({
  action: RecoveryActionSchema,
  backupId: BackupIdSchema.optional(),
  domains: z.array(MaintenanceDomainSchema).optional(),
  reason: z.string().max(300).optional(),
});
export type RecoveryRunRequest = z.infer<typeof RecoveryRunRequest>;

/* ══════════════════ AI Sandbox — Sandbox Core (S1) ══════════════════ */

const SbName = z.string().trim().min(1).max(160);
const SbText = z.string().trim().max(2000);
const SbKey = z.string().trim().min(1).max(120);
const SbStatus = z.enum([
  'queued',
  'running',
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
]);
const SbLabels = z.record(z.string().max(64), z.string().max(512));
const SbSpec = z.record(z.string().max(120), z.unknown());
const SbMetadata = z
  .object({
    tags: z.array(z.string().trim().min(1).max(64)).max(50),
    category: z.string().trim().max(64).nullable(),
    owner: z.string().trim().max(120).nullable(),
    labels: SbLabels,
  })
  .partial();
const SbSettings = z
  .object({
    defaultTimeoutMs: z.number().int().min(1000).max(3_600_000),
    maxConcurrency: z.number().int().min(1).max(32),
    retentionDays: z.number().int().min(0).max(3650),
  })
  .partial();

/* Workspace */
export const SandboxWorkspaceCreateRequest = z
  .object({ name: SbName, description: SbText.optional(), settings: SbSettings.optional() })
  .strict();
export type SandboxWorkspaceCreateRequest = z.infer<typeof SandboxWorkspaceCreateRequest>;
export const SandboxWorkspaceUpdateRequest = z
  .object({
    id: EntId,
    name: SbName.optional(),
    description: SbText.optional(),
    settings: SbSettings.optional(),
  })
  .strict();
export type SandboxWorkspaceUpdateRequest = z.infer<typeof SandboxWorkspaceUpdateRequest>;
export const SandboxWorkspaceDeleteRequest = z.object({ id: EntId }).strict();
export type SandboxWorkspaceDeleteRequest = z.infer<typeof SandboxWorkspaceDeleteRequest>;

/* Scenario */
export const SandboxScenarioCreateRequest = z
  .object({
    workspaceId: EntId,
    key: SbKey,
    name: SbName,
    description: SbText.optional(),
    metadata: SbMetadata.optional(),
  })
  .strict();
export type SandboxScenarioCreateRequest = z.infer<typeof SandboxScenarioCreateRequest>;
export const SandboxScenarioGetRequest = z.object({ id: EntId }).strict();
export type SandboxScenarioGetRequest = z.infer<typeof SandboxScenarioGetRequest>;
export const SandboxScenarioListRequest = z
  .object({ workspaceId: EntId.optional(), includeArchived: z.boolean().optional() })
  .strict();
export type SandboxScenarioListRequest = z.infer<typeof SandboxScenarioListRequest>;
export const SandboxScenarioUpdateRequest = z
  .object({
    id: EntId,
    name: SbName.optional(),
    description: SbText.optional(),
    metadata: SbMetadata.optional(),
  })
  .strict();
export type SandboxScenarioUpdateRequest = z.infer<typeof SandboxScenarioUpdateRequest>;
export const SandboxScenarioArchiveRequest = z
  .object({ id: EntId, archived: z.boolean() })
  .strict();
export type SandboxScenarioArchiveRequest = z.infer<typeof SandboxScenarioArchiveRequest>;
export const SandboxScenarioVersionCreateRequest = z
  .object({ scenarioId: EntId, spec: SbSpec, changelog: SbText.optional() })
  .strict();
export type SandboxScenarioVersionCreateRequest = z.infer<
  typeof SandboxScenarioVersionCreateRequest
>;
export const SandboxScenarioVersionsRequest = z.object({ scenarioId: EntId }).strict();
export type SandboxScenarioVersionsRequest = z.infer<typeof SandboxScenarioVersionsRequest>;

/* Execution */
export const SandboxExecutionEnqueueRequest = z
  .object({
    scenarioId: EntId,
    version: z.number().int().min(1).optional(),
    trigger: z.enum(['manual', 'api', 'scheduled', 'ci']).optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    datasetId: EntId.optional(),
  })
  .strict();
export type SandboxExecutionEnqueueRequest = z.infer<typeof SandboxExecutionEnqueueRequest>;
export const SandboxExecutionGetRequest = z.object({ id: EntId }).strict();
export type SandboxExecutionGetRequest = z.infer<typeof SandboxExecutionGetRequest>;
export const SandboxExecutionHistoryRequest = z
  .object({
    workspaceId: EntId.optional(),
    scenarioId: EntId.optional(),
    status: SbStatus.optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().max(256).nullable().optional(),
  })
  .strict();
export type SandboxExecutionHistoryRequest = z.infer<typeof SandboxExecutionHistoryRequest>;
export const SandboxExecutionCancelRequest = z.object({ id: EntId }).strict();
export type SandboxExecutionCancelRequest = z.infer<typeof SandboxExecutionCancelRequest>;
export const SandboxExecutionTimelineRequest = z
  .object({ executionId: EntId, limit: z.number().int().min(1).max(1000).optional() })
  .strict();
export type SandboxExecutionTimelineRequest = z.infer<typeof SandboxExecutionTimelineRequest>;

/* Queue / artifacts / result / report / dataset / dashboard */
export const SandboxQueueStateRequest = z.object({ workspaceId: EntId.optional() }).strict();
export type SandboxQueueStateRequest = z.infer<typeof SandboxQueueStateRequest>;
export const SandboxArtifactListRequest = z
  .object({
    executionId: EntId,
    kind: z.enum(['screenshot', 'video', 'log', 'report', 'result', 'trace', 'other']).optional(),
  })
  .strict();
export type SandboxArtifactListRequest = z.infer<typeof SandboxArtifactListRequest>;
export const SandboxArtifactGetRequest = z.object({ id: EntId }).strict();
export type SandboxArtifactGetRequest = z.infer<typeof SandboxArtifactGetRequest>;
export const SandboxExecutionRefRequest = z.object({ executionId: EntId }).strict();
export type SandboxExecutionRefRequest = z.infer<typeof SandboxExecutionRefRequest>;
export const SandboxDatasetListRequest = z.object({ workspaceId: EntId.optional() }).strict();
export type SandboxDatasetListRequest = z.infer<typeof SandboxDatasetListRequest>;
export const SandboxDatasetCreateRequest = z
  .object({
    workspaceId: EntId,
    name: SbName,
    description: SbText.optional(),
    rows: z.number().int().min(0).max(1_000_000_000).optional(),
    schema: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    storageRef: z.string().trim().max(1024).nullable().optional(),
  })
  .strict();
export type SandboxDatasetCreateRequest = z.infer<typeof SandboxDatasetCreateRequest>;
export const SandboxDatasetDeleteRequest = z.object({ id: EntId }).strict();
export type SandboxDatasetDeleteRequest = z.infer<typeof SandboxDatasetDeleteRequest>;
export const SandboxDashboardRequest = z.object({ workspaceId: EntId.optional() }).strict();
export type SandboxDashboardRequest = z.infer<typeof SandboxDashboardRequest>;

/* ── P4 Validation Experience — thin read/command seams over the S6 subsystem ── */
const SANDBOX_PIPELINE_KINDS = [
  'quick',
  'smoke',
  'regression',
  'performance',
  'security',
  'enterprise',
  'connector',
  'plugin',
  'sdk',
  'cli',
  'desktop',
  'release-candidate',
  'certification',
] as const;
const SANDBOX_TRIGGER_KINDS = [
  'manual',
  'scheduled',
  'nightly',
  'weekly',
  'pre-release',
  'post-upgrade',
  'regression',
  'certification',
] as const;
export const SandboxValidationRunRequest = z
  .object({
    pipeline: z.enum(SANDBOX_PIPELINE_KINDS),
    trigger: z.enum(SANDBOX_TRIGGER_KINDS).optional(),
  })
  .strict();
export type SandboxValidationRunRequest = z.infer<typeof SandboxValidationRunRequest>;
export const SandboxValidationRunGetRequest = z.object({ runId: EntId }).strict();
export type SandboxValidationRunGetRequest = z.infer<typeof SandboxValidationRunGetRequest>;
export const SandboxValidationScheduleSetRequest = z
  .object({ id: EntId, enabled: z.boolean() })
  .strict();
export type SandboxValidationScheduleSetRequest = z.infer<
  typeof SandboxValidationScheduleSetRequest
>;

// P6 — Cloud & Infrastructure Control Plane. Reads take no args (EmptyRequest); the graph/neighbors reads
// take an optional platform / resource filter; discovery is a scoped manage op.
export const InfraResourceGraphRequest = z
  .object({ platformId: z.string().optional(), accountId: z.string().optional() })
  .strict();
export type InfraResourceGraphRequest = z.infer<typeof InfraResourceGraphRequest>;
export const InfraResourceNeighborsRequest = z.object({ resourceId: z.string().min(1) }).strict();
export type InfraResourceNeighborsRequest = z.infer<typeof InfraResourceNeighborsRequest>;
export const InfraDiscoverRequest = z
  .object({ platformId: z.string().min(1), accountId: z.string().optional() })
  .strict();
export type InfraDiscoverRequest = z.infer<typeof InfraDiscoverRequest>;

// P6.1 — automation actions + global search. The action catalog is a read (optional platform filter); an
// action run is a scoped manage op whose `confirmed` flag MUST default false (a mutating action is refused
// unless the caller sets it true from an explicit human confirmation — AI can never reach the mutation path).
export const InfraActionsRequest = z.object({ platformId: z.string().optional() }).strict();
export type InfraActionsRequest = z.infer<typeof InfraActionsRequest>;
export const InfraActionRequest = z
  .object({
    platformId: z.string().min(1),
    accountId: z.string().optional(),
    actionId: z.string().min(1),
    params: z.record(z.unknown()).default({}),
    confirmed: z.boolean().default(false),
  })
  .strict();
export type InfraActionRequest = z.infer<typeof InfraActionRequest>;
export const InfraSearchRequest = z
  .object({
    query: z.string().min(1),
    platformId: z.string().optional(),
    domain: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();
export type InfraSearchRequest = z.infer<typeof InfraSearchRequest>;

// P7 — Enterprise Intelligence (read-only). Change-impact takes a unified graph node id; root-cause an optional
// target resource + correlation window.
export const EnterpriseIntelChangeImpactRequest = z.object({ nodeId: z.string().min(1) }).strict();
export type EnterpriseIntelChangeImpactRequest = z.infer<typeof EnterpriseIntelChangeImpactRequest>;
export const EnterpriseIntelRootCauseRequest = z
  .object({
    targetResourceId: z.string().min(1).optional(),
    windowMs: z.number().int().positive().max(2_592_000_000).optional(),
  })
  .strict();
export type EnterpriseIntelRootCauseRequest = z.infer<typeof EnterpriseIntelRootCauseRequest>;

// Phase 6 Stage 7 — Enterprise Knowledge & Decision Platform (read-only kb:* cluster).
// Inventory accepts optional class/authority/lifecycle filters + a text query the
// search LENS joins over the EXISTING federated search; matrix takes no arguments
// and impact a required asset ref; lineage an optional decision id.
export const KbInventoryRequest = z
  .object({
    classId: z.string().trim().min(1).max(64).optional(),
    authority: z.string().trim().min(1).max(64).optional(),
    lifecycle: z.string().trim().min(1).max(32).optional(),
    text: z.string().trim().max(200).optional(),
  })
  .strict();
export type KbInventoryRequest = z.infer<typeof KbInventoryRequest>;
/**
 * A7 — `assetId` moved out of this schema and into `KbImpactRequest`. `kb:matrix`
 * used to accept an optional assetId and, when it was present, return an impact
 * analysis instead of the relationship matrix: one channel, two unrelated shapes.
 * Impact analysis is now its own channel, so this request takes no arguments and a
 * stray `{ assetId }` fails validation loudly instead of quietly swapping the
 * response out from under the caller's type.
 */
export const KbMatrixRequest = z.object({}).strict();
export type KbMatrixRequest = z.infer<typeof KbMatrixRequest>;
export const KbImpactRequest = z.object({ assetId: z.string().trim().min(1).max(256) }).strict();
export type KbImpactRequest = z.infer<typeof KbImpactRequest>;
export const KbLineageRequest = z
  .object({ decisionId: z.string().trim().min(1).max(128).optional() })
  .strict();
export type KbLineageRequest = z.infer<typeof KbLineageRequest>;

// Phase 6 Stage 8 — Enterprise Automation Platform (read-only ap:* cluster).
// Playbooks takes an optional id (detail); plan compiles one playbook into the
// existing WorkflowSpec + policy/approval/rollback/simulation preview.
export const ApPlaybooksRequest = z
  .object({ id: z.string().trim().min(1).max(128).optional() })
  .strict();
export type ApPlaybooksRequest = z.infer<typeof ApPlaybooksRequest>;
export const ApPlanRequest = z.object({ playbookId: z.string().trim().min(1).max(128) }).strict();
export type ApPlanRequest = z.infer<typeof ApPlanRequest>;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Universal Enterprise Data Plane (dp:* cluster).
//
// File bytes cross IPC as base64. The renderer never sends a filesystem path:
// the main process must not be talked into reading an arbitrary location by an
// untrusted caller, so the caller supplies the CONTENT it already holds. Size is
// bounded here, before any parsing work is scheduled.
// ─────────────────────────────────────────────────────────────────────────────

/** 64 MiB of base64 ≈ 48 MiB of file. Beyond this, ingestion is a batch concern. */
export const DP_MAX_CONTENT_BASE64 = 64 * 1024 * 1024;

const DpFileName = z.string().trim().min(1).max(400);
const DpContentBase64 = z.string().max(DP_MAX_CONTENT_BASE64);
const DpPlanId = z.string().trim().min(1).max(128);

export const DataPlaneInspectRequest = z
  .object({ filename: DpFileName, contentBase64: DpContentBase64 })
  .strict();
export type DataPlaneInspectRequest = z.infer<typeof DataPlaneInspectRequest>;

export const DataPlaneAnalyzeRequest = z
  .object({ filename: DpFileName, contentBase64: DpContentBase64 })
  .strict();
export type DataPlaneAnalyzeRequest = z.infer<typeof DataPlaneAnalyzeRequest>;

export const DataPlanePlanRequest = z.object({ planId: DpPlanId }).strict();
export type DataPlanePlanRequest = z.infer<typeof DataPlanePlanRequest>;

/**
 * Execute an approved plan. `approvals` is explicit and per-table: an omitted
 * table is NOT approved. `reason` is retained on the audit record for
 * high-risk approvals.
 */
export const DataPlaneImportRequest = z
  .object({
    planId: DpPlanId,
    approvals: z
      .array(
        z
          .object({
            tableName: z.string().trim().min(1).max(200),
            approved: z.boolean(),
            skipRows: z.array(z.number().int().min(0)).max(50_000).optional(),
            /**
             * Per-row decisions the reviewer made in the preview.
             *
             * `update` replaces the matched record's mapped fields — the only
             * way an import may touch an existing record, and only ever a row
             * at a time after the reviewer has seen what differs. `create`
             * overrides the default skip on a row that matched something.
             * Rows not named here keep whatever the plan decided.
             */
            rowActions: z
              .array(
                z
                  .object({
                    rowIndex: z.number().int().min(0),
                    action: z.enum(['create', 'update', 'skip']),
                    /**
                     * The record the reviewer was looking at when they chose
                     * `update`. The import re-resolves the match against the
                     * destination as it is NOW — correct, because acting on a
                     * stale match is its own bug — but that means the target
                     * can move between the review and the click. Carrying the
                     * id makes the import refuse rather than overwrite a
                     * record nobody approved.
                     */
                    expectRecordId: z.string().trim().max(120).optional(),
                  })
                  .strict(),
              )
              .max(50_000)
              .optional(),
          })
          .strict(),
      )
      .max(200),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type DataPlaneImportRequest = z.infer<typeof DataPlaneImportRequest>;

export const DataPlaneHistoryRequest = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();
export type DataPlaneHistoryRequest = z.infer<typeof DataPlaneHistoryRequest>;

export const DataPlaneRunRequest = z.object({ planId: DpPlanId }).strict();
export type DataPlaneRunRequest = z.infer<typeof DataPlaneRunRequest>;

export const DataPlaneProvenanceRequest = z
  .object({ recordId: z.string().trim().min(1).max(128) })
  .strict();
export type DataPlaneProvenanceRequest = z.infer<typeof DataPlaneProvenanceRequest>;

export const DataPlaneMappingsRequest = z
  .object({ signature: z.string().trim().min(1).max(256).optional() })
  .strict();
export type DataPlaneMappingsRequest = z.infer<typeof DataPlaneMappingsRequest>;

export const DataPlaneSaveMappingRequest = z
  .object({
    signature: z.string().trim().min(1).max(256),
    entityId: z.string().trim().min(1).max(64),
    columns: z
      .array(
        z
          .object({
            header: z.string().trim().min(1).max(200),
            fieldKey: z.string().trim().min(1).max(64),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type DataPlaneSaveMappingRequest = z.infer<typeof DataPlaneSaveMappingRequest>;

export const DataPlaneForgetMappingRequest = z
  .object({ signature: z.string().trim().min(1).max(256) })
  .strict();
export type DataPlaneForgetMappingRequest = z.infer<typeof DataPlaneForgetMappingRequest>;

/**
 * Export a module's records. `includeProvenance` adds the source file/sheet/row
 * columns, so an exported sheet can be traced back to what produced it.
 */
/**
 * What an export covers.
 *
 * Shared verbatim between the plan and the run so the two can never describe
 * different things — the whole point of previewing an export is that the
 * preview and the file are computed from one input.
 *
 * `recordIds` and `filters` are both bounded. An unbounded id list is a way to
 * ask for the entire store one id at a time, and an unbounded filter map is a
 * way to make the scan quadratic.
 */

/* ── Program 10 — Identity + External Services ─────────────────────────── */

export const IdentityQueueRequest = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();
export type IdentityQueueRequest = z.infer<typeof IdentityQueueRequest>;

export const IdentityListRequest = z
  .object({
    limit: z.number().int().min(1).max(500).optional(),
    /** Narrow to the identities of one NeuroPause record. */
    subjectId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type IdentityListRequest = z.infer<typeof IdentityListRequest>;

export const IdentityConfirmRequest = z
  .object({
    matchId: z.string().trim().min(1).max(80),
    decision: z.enum(['confirm', 'create_new', 'reject']),
    /**
     * Required for `confirm` and meaningless otherwise. Validated in the
     * handler against the OFFERED candidates: a subject id that was never
     * offered is refused, so this cannot be used to link to an arbitrary
     * record.
     */
    subjectId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type IdentityConfirmRequest = z.infer<typeof IdentityConfirmRequest>;

export const IdentityUnlinkRequest = z
  .object({
    identityId: z.string().trim().min(1).max(80),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type IdentityUnlinkRequest = z.infer<typeof IdentityUnlinkRequest>;

export const IdentityServiceStatusRequest = z
  .object({
    serviceId: z.string().trim().min(1).max(120),
    status: z.enum(['active', 'disabled']),
  })
  .strict();
export type IdentityServiceStatusRequest = z.infer<typeof IdentityServiceStatusRequest>;

/* ── Program 8 — Document Intelligence ─────────────────────────────────── */

const DocumentId = z.string().trim().min(1).max(80);

/**
 * The document kinds a reviewer may choose.
 *
 * `unknown` is deliberately absent: a person correcting a classification is
 * answering the question, and "I do not know either" is what leaving it alone
 * already means.
 */
export const DocumentKindEnum = z.enum([
  'invoice',
  'purchase_order',
  'receipt',
  'quote',
  'contract',
  'statement',
  'report',
  'other',
]);

export const DocumentListRequest = z
  .object({
    search: z.string().trim().max(200).optional(),
    kind: DocumentKindEnum.optional(),
    status: z.enum(['stored', 'extracted', 'needs_review', 'unsupported']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type DocumentListRequest = z.infer<typeof DocumentListRequest>;

export const DocumentDetailRequest = z.object({ documentId: DocumentId }).strict();
export type DocumentDetailRequest = z.infer<typeof DocumentDetailRequest>;

export const DocumentUploadRequest = z
  .object({
    filename: z.string().trim().min(1).max(255),
    /** Bytes, base64. The renderer never supplies a filesystem path. */
    contentBase64: DpContentBase64,
    mimeType: z.string().trim().max(200).optional(),
  })
  .strict();
export type DocumentUploadRequest = z.infer<typeof DocumentUploadRequest>;

export const DocumentReclassifyRequest = z
  .object({
    documentId: DocumentId,
    kind: DocumentKindEnum,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type DocumentReclassifyRequest = z.infer<typeof DocumentReclassifyRequest>;

export const DocumentCorrectRequest = z
  .object({
    documentId: DocumentId,
    fieldKey: z.string().trim().min(1).max(120),
    value: z.union([z.string().trim().max(500), z.number(), z.null()]),
    /**
     * Required, and not merely present — a correction is kept forever next to
     * what it replaced, and a reason of "." makes the record useless to the
     * next person reading it.
     */
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type DocumentCorrectRequest = z.infer<typeof DocumentCorrectRequest>;

export const DocumentLinkRequest = z
  .object({
    documentId: DocumentId,
    moduleId: z.string().trim().min(1).max(128),
    recordId: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(120),
    basis: z.string().trim().min(1).max(500),
  })
  .strict();
export type DocumentLinkRequest = z.infer<typeof DocumentLinkRequest>;

export const DocumentDeleteRequest = z.object({ documentId: DocumentId }).strict();
export type DocumentDeleteRequest = z.infer<typeof DocumentDeleteRequest>;

export const DataPlaneExportScope = z
  .object({
    /**
     * Explicit records. Present for a single-record or multi-select export;
     * absent means "whatever the filters match".
     */
    recordIds: z.array(z.string().trim().min(1).max(120)).max(10_000).optional(),
    /** Field/value equality filters, exactly as the list view showed them. */
    filters: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(120),
            value: z.string().trim().max(200),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    /** Free-text match across the record title and its visible values. */
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type DataPlaneExportScope = z.infer<typeof DataPlaneExportScope>;

export const DataPlaneExportPlanRequest = z
  .object({
    moduleId: z.string().trim().min(1).max(128),
    scope: DataPlaneExportScope.optional(),
    /** Which fields the reviewer has ticked. Absent means "the defaults". */
    fields: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    includeRestricted: z.boolean().optional(),
  })
  .strict();
export type DataPlaneExportPlanRequest = z.infer<typeof DataPlaneExportPlanRequest>;

export const DataPlaneExportRequest = z
  .object({
    moduleId: z.string().trim().min(1).max(128),
    format: z.enum(['csv', 'xlsx', 'json']),
    includeProvenance: z.boolean().optional(),
    scope: DataPlaneExportScope.optional(),
    fields: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
    /**
     * A deliberate, attributable request for personal or financial
     * identifiers. Refused unless the actor administers the module, and named
     * in both the manifest and the audit line when granted.
     */
    includeRestricted: z.boolean().optional(),
    /**
     * Write a zip containing the data file and `manifest.json` rather than a
     * bare data file. The manifest carries no business values.
     */
    withManifest: z.boolean().optional(),
  })
  .strict();
export type DataPlaneExportRequest = z.infer<typeof DataPlaneExportRequest>;

/** Reviewer decisions on a parked reference. */
export const DataPlaneRelationshipDecideRequest = z
  .object({
    pendingId: z.string().trim().min(1).max(128),
    targetRecordId: z.string().trim().min(1).max(128),
  })
  .strict();
export type DataPlaneRelationshipDecideRequest = z.infer<typeof DataPlaneRelationshipDecideRequest>;

export const DataPlaneRelationshipSkipRequest = z
  .object({ pendingId: z.string().trim().min(1).max(128) })
  .strict();
export type DataPlaneRelationshipSkipRequest = z.infer<typeof DataPlaneRelationshipSkipRequest>;

export const DataPlaneRelationshipQueueRequest = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();
export type DataPlaneRelationshipQueueRequest = z.infer<typeof DataPlaneRelationshipQueueRequest>;

export const DataPlaneReclassifyRequest = z
  .object({
    planId: z.string().trim().min(1).max(80),
    tableName: z.string().trim().min(1).max(200),
    /** A canonical entity id. Validated against the live ontology in the handler. */
    entityId: z.string().trim().min(1).max(80),
    reason: z.string().trim().max(400).optional(),
  })
  .strict();
export type DataPlaneReclassifyRequest = z.infer<typeof DataPlaneReclassifyRequest>;

export const DataPlanePreviewRequest = z
  .object({
    planId: z.string().trim().min(1).max(80),
    tableName: z.string().trim().min(1).max(200),
    /** Which rows to look at. */
    mode: z.enum(['all', 'valid', 'warning', 'invalid', 'duplicate', 'ambiguous']).optional(),
    search: z.string().trim().max(120).optional(),
    offset: z.number().int().min(0).max(200_000).optional(),
    /** Hard-capped: a preview that can return 200,000 rows is not a preview. */
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type DataPlanePreviewRequest = z.infer<typeof DataPlanePreviewRequest>;

export const DataPlaneRelationshipGraphRequest = z
  .object({ recordId: z.string().trim().min(1).max(128) })
  .strict();
export type DataPlaneRelationshipGraphRequest = z.infer<typeof DataPlaneRelationshipGraphRequest>;

/* ── Medical Device Manufacturing Pack ────────────────────────────────────── */

/**
 * Product search, scoped to the fields the charter names — code, name, family,
 * category, material. Deliberately NOT routed through the record store's
 * generic search, which is a substring match over the string form of every
 * field and would return a product because an unrelated note mentioned "steel".
 */
export const MedicalDeviceProductSearchRequest = z
  .object({
    query: z.string().trim().max(200).optional(),
    family: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    material: z.string().trim().max(120).optional(),
    status: z.enum(['active', 'inactive', 'discontinued']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type MedicalDeviceProductSearchRequest = z.infer<typeof MedicalDeviceProductSearchRequest>;

export const MedicalDeviceProductGetRequest = z
  .object({ productId: z.string().trim().min(1).max(128) })
  .strict();
export type MedicalDeviceProductGetRequest = z.infer<typeof MedicalDeviceProductGetRequest>;

export const MedicalDeviceLotListRequest = z
  .object({
    view: z.enum(['all', 'quarantined', 'released', 'blocked', 'expired', 'recalled']).optional(),
    search: z.string().trim().max(200).optional(),
    productId: z.string().trim().max(128).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type MedicalDeviceLotListRequest = z.infer<typeof MedicalDeviceLotListRequest>;

export const MedicalDeviceLotGetRequest = z
  .object({ lotId: z.string().trim().min(1).max(128) })
  .strict();
export type MedicalDeviceLotGetRequest = z.infer<typeof MedicalDeviceLotGetRequest>;

/**
 * Create a lot. `quantity` has no upper bound beyond the numeric guard because
 * a legitimate raw-material lot can be very large; it is the ARITHMETIC that
 * protects the record, not an arbitrary ceiling.
 */
export const MedicalDeviceLotCreateRequest = z
  .object({
    lotNumber: z.string().trim().min(1).max(120),
    productId: z.string().trim().min(1).max(128),
    quantity: z.number().finite().positive(),
    unit: z.string().trim().max(32).optional(),
    manufactureDate: z.string().trim().max(40).optional(),
    expiryDate: z.string().trim().max(40).optional(),
    warehouseId: z.string().trim().max(128).optional(),
    supplierId: z.string().trim().max(128).optional(),
    manufacturingOrderId: z.string().trim().max(128).optional(),
    sourceLotId: z.string().trim().max(128).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type MedicalDeviceLotCreateRequest = z.infer<typeof MedicalDeviceLotCreateRequest>;

export const MedicalDeviceLotTransitionRequest = z
  .object({
    lotId: z.string().trim().min(1).max(128),
    status: z.enum([
      'created',
      'quarantined',
      'released',
      'blocked',
      'partially_consumed',
      'consumed',
      'exhausted',
      'expired',
      'recalled',
    ]),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type MedicalDeviceLotTransitionRequest = z.infer<typeof MedicalDeviceLotTransitionRequest>;

export const MedicalDeviceLotSplitRequest = z
  .object({
    lotId: z.string().trim().min(1).max(128),
    parts: z
      .array(
        z
          .object({
            lotNumber: z.string().trim().min(1).max(120),
            quantity: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type MedicalDeviceLotSplitRequest = z.infer<typeof MedicalDeviceLotSplitRequest>;

/**
 * Merge exists as a channel so the refusal is DISCOVERABLE and carries its
 * reason. A missing channel would leave a caller assuming the feature was
 * merely unbuilt; this one answers, every time, with why it will not be.
 */
export const MedicalDeviceLotMergeRequest = z
  .object({ lotIds: z.array(z.string().trim().min(1).max(128)).min(1).max(50) })
  .strict();
export type MedicalDeviceLotMergeRequest = z.infer<typeof MedicalDeviceLotMergeRequest>;

export const MedicalDeviceLotConsumeRequest = z
  .object({
    lotId: z.string().trim().min(1).max(128),
    quantity: z.number().finite().positive(),
    manufacturingOrderId: z.string().trim().max(128).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type MedicalDeviceLotConsumeRequest = z.infer<typeof MedicalDeviceLotConsumeRequest>;

export const MedicalDeviceLotMoveRequest = z
  .object({
    lotId: z.string().trim().min(1).max(128),
    warehouseId: z.string().trim().min(1).max(128),
  })
  .strict();
export type MedicalDeviceLotMoveRequest = z.infer<typeof MedicalDeviceLotMoveRequest>;

export const MedicalDeviceLotShipRequest = z
  .object({
    lotId: z.string().trim().min(1).max(128),
    shipmentId: z.string().trim().min(1).max(128),
    customerId: z.string().trim().max(128).optional(),
    orderId: z.string().trim().max(128).optional(),
    quantity: z.number().finite().positive().optional(),
  })
  .strict();
export type MedicalDeviceLotShipRequest = z.infer<typeof MedicalDeviceLotShipRequest>;

export const MedicalDeviceTraceRequest = z
  .object({
    nodeType: z.enum([
      'lot',
      'product',
      'manufacturing_order',
      'warehouse',
      'shipment',
      'customer',
      'order',
      'supplier',
    ]),
    nodeId: z.string().trim().min(1).max(128),
    maxDepth: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type MedicalDeviceTraceRequest = z.infer<typeof MedicalDeviceTraceRequest>;

/* ── Private-First AI experience ──────────────────────────────────────────── */

export const AiSetModeRequest = z
  .object({ mode: z.enum(['private_first', 'local_only', 'external']) })
  .strict();
export type AiSetModeRequest = z.infer<typeof AiSetModeRequest>;

export const AiSetExternalConsentRequest = z.object({ consent: z.boolean() }).strict();
export type AiSetExternalConsentRequest = z.infer<typeof AiSetExternalConsentRequest>;

/**
 * A first-run decision. Partial on purpose: the experience records each choice
 * the moment it is made (workspace type when chosen, completion when finished),
 * so a quit mid-flow loses nothing the user already decided.
 */
export const ExperienceProfileSetRequest = z
  .object({
    workspaceType: z.enum(['personal', 'professional', 'business']).optional(),
    state: z.enum(['completed', 'skipped']).optional(),
    aiModeChosen: z.boolean().optional(),
    /** Understanding attributes to upsert — provenance-marked, never secret. */
    attributes: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(120),
            value: z.string().trim().min(1).max(400),
            status: z.enum(['stated', 'inferred', 'corrected', 'imported', 'connected', 'system_derived']),
            source: z.string().trim().max(400),
            updatedAt: z.string().max(40),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    /**
     * Remove understanding attributes by key. A person must be able to tell
     * NeuroPause to forget something it believes about them, not only to
     * overwrite it — an understanding profile you can only add to is a profile
     * you do not control.
     */
    removeKeys: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  })
  .strict();
export type ExperienceProfileSetRequest = z.infer<typeof ExperienceProfileSetRequest>;

/* ── Decision Records + NeuroPause Hold ────────────────────────────────────── */

export const DecisionRecordListRequest = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();
export type DecisionRecordListRequest = z.infer<typeof DecisionRecordListRequest>;

export const DecisionRecordGetRequest = z.object({ id: z.string().trim().min(1).max(80) }).strict();
export type DecisionRecordGetRequest = z.infer<typeof DecisionRecordGetRequest>;

export const HoldListRequest = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();
export type HoldListRequest = z.infer<typeof HoldListRequest>;

export const HoldResolveRequest = z
  .object({
    id: z.string().trim().min(1).max(80),
    outcome: z.enum(['proceeded', 'took_alternative', 'cancelled']),
    /** What actually happened, in the resolver's own words. */
    note: z.string().trim().max(400).optional(),
  })
  .strict();
export type HoldResolveRequest = z.infer<typeof HoldResolveRequest>;

/* ── Opportunity Center ────────────────────────────────────────────────────── */

export const OpportunityListRequest = z
  .object({
    /**
     * How far back to look. Optional; the engine's default is stated in the UI
     * rather than applied silently, so a narrower window is always the user's
     * choice and never a hidden reason a finding disappeared.
     */
    lookbackDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();
export type OpportunityListRequest = z.infer<typeof OpportunityListRequest>;

export const OpportunitySetStatusRequest = z
  .object({
    id: z.string().trim().min(1).max(80),
    status: z.enum([
      'new',
      'investigating',
      'recommended',
      'accepted',
      'rejected',
      'in_progress',
      'completed',
      'measured',
    ]),
    note: z.string().trim().max(400).optional(),
  })
  .strict();
export type OpportunitySetStatusRequest = z.infer<typeof OpportunitySetStatusRequest>;

export const OpportunityExecuteRequest = z
  .object({ id: z.string().trim().min(1).max(80) })
  .strict();
export type OpportunityExecuteRequest = z.infer<typeof OpportunityExecuteRequest>;

export const CrossDomainRelatedRequest = z
  .object({
    recordId: z.string().trim().min(1).max(120),
    /**
     * The record's own module. Supplied rather than inferred from its links,
     * because a record with NO links has none to infer from — and inferring
     * left "this record is connected to nothing" indistinguishable from "the
     * link engine is not running", which are opposite answers.
     */
    moduleId: z.string().trim().min(1).max(80),
    /** Bounded at the schema too, so a huge traversal is unrequestable. */
    depth: z.number().int().min(1).max(3).optional(),
  })
  .strict();
export type CrossDomainRelatedRequest = z.infer<typeof CrossDomainRelatedRequest>;

export const OutcomeGetRequest = z
  .object({ opportunityId: z.string().trim().min(1).max(80) })
  .strict();
export type OutcomeGetRequest = z.infer<typeof OutcomeGetRequest>;

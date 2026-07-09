import { z } from 'zod';

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
const SearchSourceSchema = z.enum(['entity', 'graph', 'memory', 'timeline']);
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
  sources: z.array(SearchSourceSchema).max(4).optional(),
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

const BriefingPeriodSchema = z.enum(['morning', 'evening', 'weekly', 'monthly', 'quarterly']);
const RecommendationKindSchema = z.enum([
  'next_task',
  'stale_task',
  'blocked_project',
  'pending_document',
  'unanswered',
  'upcoming_deadline',
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

export const EnterpriseGraphNeighborsRequest = z.object({ id: EntId });

export const EnterpriseGovernanceSetChainRequest = z.object({ id: EntId, enabled: z.boolean() });
export const EnterpriseGovernanceSetRuleRequest = z.object({ id: EntId, enabled: z.boolean() });
export const EnterpriseGovernanceAuditRequest = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

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
export type EnterpriseGraphNeighborsRequest = z.infer<typeof EnterpriseGraphNeighborsRequest>;
export type EnterpriseGovernanceSetChainRequest = z.infer<
  typeof EnterpriseGovernanceSetChainRequest
>;
export type EnterpriseGovernanceSetRuleRequest = z.infer<typeof EnterpriseGovernanceSetRuleRequest>;
export type EnterpriseGovernanceAuditRequest = z.infer<typeof EnterpriseGovernanceAuditRequest>;

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

export const ModuleDeleteRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();

export const ModuleSummarizeRequest = z.object({ moduleId: ModuleId, id: EntId }).strict();

export const ModuleActionRequest = z
  .object({ moduleId: ModuleId, id: EntId, action: z.string().trim().min(1).max(64) })
  .strict();

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
const CloudSyncDomainZ = z.enum([
  'knowledge_graph',
  'ai_memory',
  'timeline',
  'governance',
  'ai_workers',
  'templates',
  'connectors',
  'marketplace',
]);
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

export const CloudSyncDomainRequest = z.object({ domain: CloudSyncDomainZ });
export type CloudSyncDomainRequest = z.infer<typeof CloudSyncDomainRequest>;

export const CloudSyncSetOnlineRequest = z.object({ online: z.boolean() });
export type CloudSyncSetOnlineRequest = z.infer<typeof CloudSyncSetOnlineRequest>;

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

export const CloudSyncRecordChangeRequest = z.object({
  domain: CloudSyncDomainZ,
  count: z.number().int().min(1).max(100).optional(),
});
export type CloudSyncRecordChangeRequest = z.infer<typeof CloudSyncRecordChangeRequest>;

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

/* ───────────────────────── Application self-update contracts ─────────────── */

export const UpdateChannelSchema = z.enum(['stable', 'beta', 'internal']);
export type UpdateChannelName = z.infer<typeof UpdateChannelSchema>;

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

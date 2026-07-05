/**
 * The Platform Event contract — the single typed vocabulary for everything
 * significant that happens inside NeuroPause. Every module publishes these and
 * every future capability (Connector Framework, Activity Intelligence, AI
 * Memory, Automation, Analytics) subscribes to them rather than reaching into
 * implementation details.
 *
 * This file is intentionally types-only (no runtime values) so it can be shared
 * by the main process, the renderer, and unit tests without pulling in any
 * environment-specific code.
 */

/** Routing/QoS hint. Higher-urgency events can be prioritized by subscribers. */
export type EventPriority = 'low' | 'normal' | 'high' | 'critical';

/** Broad family an event belongs to — used for coarse filtering and metrics. */
export type PlatformEventCategory =
  | 'application'
  | 'runtime'
  | 'plugin'
  | 'permission'
  | 'download'
  | 'update'
  | 'session'
  | 'diagnostics'
  | 'connector'
  | 'knowledge'
  | 'automation'
  | 'system';

/**
 * The canonical, versioned set of event types. Adding a new type is additive;
 * changing the shape of an existing one bumps its `version`.
 */
export type PlatformEventType =
  // application lifecycle
  | 'application.installed'
  | 'application.updated'
  | 'application.removed'
  // runtime lifecycle
  | 'runtime.started'
  | 'runtime.stopped'
  | 'runtime.crashed'
  | 'runtime.health_changed'
  // plugins
  | 'plugin.installed'
  | 'plugin.enabled'
  | 'plugin.disabled'
  | 'plugin.removed'
  | 'plugin.crashed'
  // permissions
  | 'permission.granted'
  | 'permission.revoked'
  // downloads
  | 'download.started'
  | 'download.progress'
  | 'download.completed'
  | 'download.failed'
  // updates
  | 'update.available'
  // session: user + workspace
  | 'user.signed_in'
  | 'user.signed_out'
  | 'workspace.opened'
  | 'workspace.closed'
  // connectors
  | 'connector.connected'
  | 'connector.disconnected'
  | 'connector.reauth_required'
  | 'connector.sync_started'
  | 'connector.sync_completed'
  | 'connector.error'
  | 'connector.sync_failed'
  | 'connector.rate_limited'
  | 'connector.offline'
  | 'connector.online'
  | 'connector.conflict_detected'
  | 'connector.conflict_resolved'
  // knowledge layer (UDM)
  | 'knowledge.entity_created'
  | 'knowledge.entity_updated'
  | 'knowledge.entity_deleted'
  // diagnostics / system
  | 'diagnostics.health_changed'
  | 'system.ready'
  // automation (V4.8)
  | 'automation.completed'
  | 'automation.failed'
  // runtime telemetry (V5.1)
  | 'runtime.backend.connected'
  | 'runtime.backend.disconnected'
  | 'runtime.voice.changed'
  | 'runtime.health.changed'
  | 'runtime.memory.warning'
  // voice runtime (V5.2)
  | 'voice.idle'
  | 'voice.listening'
  | 'voice.thinking'
  | 'voice.speaking'
  | 'voice.recovering'
  | 'voice.disconnected'
  // runtime supervisor (V5.3)
  | 'runtime.recovery.started'
  | 'runtime.recovery.completed'
  | 'runtime.recovery.failed'
  | 'runtime.supervisor.warning'
  | 'runtime.supervisor.critical'
  // execute engine (V5.4)
  | 'execution.started'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled';

/** Who or what caused the event. */
export interface EventActor {
  kind: 'user' | 'system' | 'plugin' | 'connector';
  id: string | null;
}

/** The thing an event is about (an app, a plugin, an operation, …). */
export interface EventResource {
  type: string;
  id: string;
  name: string | null;
}

/** Free-form, primitive-valued metadata. Kept flat for cheap serialization. */
export type PlatformEventMeta = Record<string, string | number | boolean | null>;

/** A fully materialized event as stored and delivered. */
export interface PlatformEvent {
  /** Globally unique id for this event instance. */
  id: string;
  type: PlatformEventType;
  category: PlatformEventCategory;
  /** Schema version of this event type (starts at 1). */
  version: number;
  priority: EventPriority;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** The module that published it (runtime, nps, plugins, permissions, …). */
  source: string;
  actor: EventActor;
  resource: EventResource | null;
  /** Groups related events into a logical chain/workflow. */
  correlationId: string;
  /** The id of the event that directly caused this one, if any. */
  causationId: string | null;
  metadata: PlatformEventMeta;
}

/**
 * Input to `publish`. The bus fills in id/timestamp and sensible defaults for
 * version/priority/actor/correlation so producers stay terse.
 */
export interface PlatformEventInput {
  type: PlatformEventType;
  category: PlatformEventCategory;
  source: string;
  actor?: EventActor;
  resource?: EventResource | null;
  priority?: EventPriority;
  version?: number;
  metadata?: PlatformEventMeta;
  correlationId?: string;
  causationId?: string | null;
}

/* ───────────────────────────── Timeline ─────────────────────────────────── */

/** A query against the Timeline. All fields are optional and AND-combined. */
export interface TimelineQuery {
  types?: PlatformEventType[];
  categories?: PlatformEventCategory[];
  source?: string;
  actorId?: string;
  resourceId?: string;
  correlationId?: string;
  priorities?: EventPriority[];
  /** Free-text match over type, source, resource, and metadata values. */
  search?: string;
  /** ISO lower/upper time bounds (inclusive). */
  since?: string;
  until?: string;
  /** Page size (default applied by the service). */
  limit?: number;
  /** Opaque pagination cursor returned by a previous page. */
  cursor?: string | null;
  order?: 'asc' | 'desc';
}

export interface TimelinePage {
  events: PlatformEvent[];
  nextCursor: string | null;
  /** Total matching events across all pages (best-effort over the live window). */
  total: number;
}

export interface TimelineStats {
  total: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  oldest: string | null;
  newest: string | null;
}

export interface TimelineExport {
  format: 'jsonl';
  generatedAt: string;
  count: number;
  /** The exported events as newline-delimited JSON. */
  data: string;
}

/* ──────────────────────────── Diagnostics ───────────────────────────────── */

export type DiagnosticStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string | null;
  latencyMs: number | null;
  lastChecked: string;
  /** Actionable recovery hint shown when the check is not healthy. */
  recommendation: string | null;
}

export interface EventBusMetrics {
  eventsPublished: number;
  eventsPerMinute: number;
  subscribers: number;
  droppedEvents: number;
  avgDispatchMs: number;
  bufferedEvents: number;
}

export interface SubscriberStatus {
  id: string;
  events: number;
  errors: number;
  lastError: string | null;
  avgMs: number;
}

export interface DiagnosticsReport {
  generatedAt: string;
  overall: DiagnosticStatus;
  uptimeMs: number;
  checks: DiagnosticCheck[];
  metrics: EventBusMetrics;
  timeline: TimelineStats;
  subscribers: SubscriberStatus[];
}

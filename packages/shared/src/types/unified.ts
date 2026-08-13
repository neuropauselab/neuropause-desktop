/**
 * The Unified Data Model (UDM) — NeuroPause's universal knowledge layer.
 *
 * Every connector maps its provider objects into these canonical entities. From
 * here up, the rest of the product (Query Engine, Search, Activity Intelligence,
 * AI Memory, Automation, Daily Summary, Analytics) reads ONLY the UDM and never
 * talks to a provider API. The caller never needs to know which connector owns a
 * record.
 *
 * Types-only so the main process, renderer, and tests can share them.
 */
import type { ConnectorId } from './connectors';

/** The canonical entity kinds every connector maps into. */
export type UnifiedEntityKind =
  | 'account'
  | 'workspace'
  | 'organization'
  | 'project'
  | 'task'
  | 'conversation'
  | 'message'
  | 'document'
  | 'file'
  | 'event'
  | 'calendar_event'
  | 'notification'
  | 'contact'
  | 'label'
  | 'activity'
  | 'attachment';

/** All canonical kinds, as a runtime list (kept in sync with the union). */
export const UNIFIED_ENTITY_KINDS: readonly UnifiedEntityKind[] = [
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
] as const;

/** Per-record sync status within the UDM. */
export type EntitySyncState = 'active' | 'deleted';

/** Flat, primitive-valued metadata bag (provider-specific extras). */
export type UnifiedMetadata = Record<string, string | number | boolean | null>;

/**
 * One canonical record. Every entity — whatever its kind or source connector —
 * has the same shape and the same required envelope. Kind-specific meaning lives
 * in the shared semantic fields (null when not applicable to a kind) and in
 * `metadata`. This single, flat shape is what makes the store, query engine, and
 * search index uniform across all 16 kinds and all connectors.
 */
export interface UnifiedEntity {
  /* ── identity envelope (required on every entity) ── */
  /** Unified Identifier — stable, globally unique within NeuroPause. */
  id: string;
  kind: UnifiedEntityKind;

  /* ── tenant ownership (P13B) ── */
  /**
   * The organization this record belongs to.
   *
   * THE UNIFIED STORE IS THE ROOT OF THE DATA GRAPH, so this field is the root
   * of the boundary. Memory projects from here, the graph projects from here,
   * the search index mirrors it, and every briefing, finding and analytics
   * rollup reads it through `query({limit: 1_000_000})`. Program 13A could give
   * a projected memory an owner but not a TRUSTWORTHY one, because the thing it
   * projected from had none — that limitation is this field.
   *
   * Absent or empty means UNRESOLVED: visible to no tenant. Records synced
   * before P13B have no owner and are inert until re-synced, which is the same
   * treatment every other store gives its pre-migration rows.
   */
  tenantId?: string | null;
  /** Absent means tenant-level: readable from every workspace in the tenant. */
  workspaceId?: string | null;
  /** Source Connector. */
  connectorId: ConnectorId;
  /** The connected account this record was synced through. */
  accountId: string;
  /** Source Identifier — the provider's own id for the object. */
  sourceId: string;
  /** Created timestamp in the source (ISO). */
  createdAt: string;
  /** Updated timestamp in the source (ISO). */
  updatedAt: string;
  /** Sync Status. */
  syncState: EntitySyncState;
  /** When NeuroPause last synced this record (ISO). */
  syncedAt: string;
  /** Provider-specific extras. */
  metadata: UnifiedMetadata;

  /* ── common display ── */
  /** Human-facing label (repo/project name, task/doc title, event summary…). */
  title: string;
  /** Canonical link to the object in the provider, if any. */
  url: string | null;

  /* ── relationships (by Unified Identifier) ── */
  /** Direct parent (message → conversation, task → project, attachment → message). */
  parentId: string | null;
  /** Containing scope (workspace / project / repo / calendar). */
  containerId: string | null;

  /* ── shared semantic fields (kind-dependent; null when N/A) ── */
  /** Message text, document excerpt, task description, notification body. */
  body: string | null;
  /** Lifecycle status (task/issue/PR state, event response, …). */
  status: string | null;
  /** Display name of the author / assignee / owner / organizer. */
  author: string | null;
  /** Primary time for the record (event start, message sent, activity occurred). */
  timestamp: string | null;
  /** Secondary time (event end). */
  endTimestamp: string | null;
  /** Label names attached to the record. */
  labels: string[];
}

/** A structured query over the UDM. All fields optional and AND-combined. */
export interface UnifiedQuery {
  kinds?: UnifiedEntityKind[];
  connectorId?: ConnectorId;
  accountId?: string;
  /** Restrict to a container (e.g. tasks in a project, messages in a channel). */
  containerId?: string;
  /** Restrict to a direct parent. */
  parentId?: string;
  /** Match a lifecycle status exactly. */
  status?: string;
  /** Case-insensitive substring match over title + body. */
  text?: string;
  /** updatedAt >= since (ISO). */
  since?: string;
  /** updatedAt <= until (ISO). */
  until?: string;
  /** Include soft-deleted records (default false). */
  includeDeleted?: boolean;
  sortBy?: 'updatedAt' | 'createdAt' | 'timestamp' | 'title';
  order?: 'asc' | 'desc';
  limit?: number;
  /** Opaque pagination cursor returned by a prior query. */
  cursor?: string | null;
}

/** A page of query results. */
export interface UnifiedQueryResult {
  items: UnifiedEntity[];
  /** Total matches across all pages. */
  total: number;
  /** Cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
}

/** Aggregate counts for the dashboard. */
export interface UnifiedCounts {
  total: number;
  byKind: Record<string, number>;
  byConnector: Record<string, number>;
  /** Most recent updatedAt across all records (ISO), or null when empty. */
  lastUpdatedAt: string | null;
}

/* ───────────────────────────── Search ──────────────────────────────────── */

/** A single search hit (lightweight; hydrate the full entity by id if needed). */
export interface SearchHit {
  id: string;
  kind: UnifiedEntityKind;
  connectorId: ConnectorId;
  title: string;
  /** A short contextual snippet around the match. */
  snippet: string;
  /** Relevance score (higher is better; backend-relative). */
  score: number;
}

/** A search request over the UDM. */
export interface SearchQuery {
  text: string;
  kinds?: UnifiedEntityKind[];
  connectorId?: ConnectorId;
  limit?: number;
}

/** Search results, tagged with the backend that served them. */
export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** Which backend answered: 'local' now; 'meilisearch' / 'qdrant' later. */
  backend: string;
}

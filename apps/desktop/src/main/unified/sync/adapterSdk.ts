/**
 * The Adapter SDK — the only surface a new connector has to implement.
 *
 * An adapter is `{ connectorId, resources[] }`. Each resource knows how to pull
 * one page of a provider's objects and map them into canonical `UnifiedEntity`
 * records. The orchestrator drives the paging loop, persists cursors, resolves
 * conflicts, emits events, and handles rate limits / retries / offline — so an
 * adapter contains *only* provider-specific request + mapping logic.
 *
 * Adding Linear, Jira, Google Drive, or Microsoft 365 later means writing one of
 * these; nothing in the engine changes.
 */
import type {
  ConnectorId,
  UnifiedEntity,
  UnifiedEntityKind,
  UnifiedMetadata,
} from '@neuropause/shared';
import { makeUnifiedId } from '../ids';
import type { HttpClient } from './http';

/** Everything a resource needs to pull one page. */
export interface SyncContext {
  connectorId: ConnectorId;
  accountId: string;
  /** Authenticated, rate-gated HTTP client (token attached automatically). */
  http: HttpClient;
  /** Cursor persisted from the previous run of THIS resource (null on first sync). */
  cursor: string | null;
  /** Logical timestamp for the run (ISO). */
  now: string;
}

/** The result of pulling one page. */
export interface SyncPage {
  /** Canonical entities produced this page. */
  entities: UnifiedEntity[];
  /** Provider ids deleted at the source (soft-deleted in the store). */
  deletedSourceIds?: string[];
  /** Cursor to persist for the next run. */
  cursor: string | null;
  /** Whether more pages remain to pull right now. */
  hasMore: boolean;
}

/** One stream of data within an adapter (e.g. GitHub repos, issues, notifications). */
export interface AdapterResource {
  /** Stable id, unique within the adapter — used as the cursor key. */
  id: string;
  label: string;
  /** The primary entity kind this resource produces. */
  kind: UnifiedEntityKind;
  pull(ctx: SyncContext): Promise<SyncPage>;
}

/** A provider mapping. */
export interface ConnectorAdapter {
  connectorId: ConnectorId;
  /** Headers applied to every request (e.g. `Notion-Version`). */
  baseHeaders?: Record<string, string>;
  resources: AdapterResource[];
}

/** Fields an adapter supplies; the envelope defaults are filled in for it. */
export interface EntityInput {
  connectorId: ConnectorId;
  accountId: string;
  kind: UnifiedEntityKind;
  sourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The run timestamp (becomes `syncedAt`). */
  now: string;
  url?: string | null;
  parentId?: string | null;
  containerId?: string | null;
  body?: string | null;
  status?: string | null;
  author?: string | null;
  timestamp?: string | null;
  endTimestamp?: string | null;
  labels?: string[];
  metadata?: UnifiedMetadata;
}

/** Build a canonical entity with a deterministic Unified Identifier. */
export function makeEntity(i: EntityInput): UnifiedEntity {
  return {
    id: makeUnifiedId(i.connectorId, i.accountId, i.kind, i.sourceId),
    kind: i.kind,
    connectorId: i.connectorId,
    accountId: i.accountId,
    sourceId: i.sourceId,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    syncState: 'active',
    syncedAt: i.now,
    metadata: i.metadata ?? {},
    title: i.title || '(untitled)',
    url: i.url ?? null,
    parentId: i.parentId ?? null,
    containerId: i.containerId ?? null,
    body: i.body ?? null,
    status: i.status ?? null,
    author: i.author ?? null,
    timestamp: i.timestamp ?? null,
    endTimestamp: i.endTimestamp ?? null,
    labels: i.labels ?? [],
  };
}

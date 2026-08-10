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
  /**
   * The organization this sync run belongs to (P13B).
   *
   * Supplied by the orchestrator from the resolved tenant, never by an adapter.
   * Adapters need it because they mint Unified Identifiers — including the
   * `parentId`/`containerId` references that point at other entities — and the
   * tenant is part of that identity domain. A reference built without it would
   * point at an id that no longer exists, or worse, at another tenant's.
   */
  tenantId: string;
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
  /**
   * Set when a resource returned an empty page because it was *gracefully skipped* rather than
   * genuinely empty — a swallowed 403 (unauthorized: missing permission / unlicensed) or 404
   * (unprovisioned: mailbox/OneDrive not set up yet). The orchestrator records this per resource so
   * the UI can show the module as degraded instead of a bare "0". Absent on a normal successful pull.
   */
  degraded?: { kind: 'unauthorized' | 'unprovisioned'; reason: string };
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
  /** The owning organization (P13B). Part of the entity's identity domain. */
  tenantId: string;
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

/**
 * A connector's synced surface, derived from its declared resources — the runtime's
 * capability / schema report (P5 — Increment 1). Pure projection of what an adapter already
 * declares; consumed by the sync subsystem's `capabilities()` and, later, the connector UI /
 * marketplace so a connector's real streams and entity kinds are discoverable without guessing.
 */
export interface AdapterCapability {
  connectorId: ConnectorId;
  resources: Array<{ id: string; label: string; kind: UnifiedEntityKind }>;
  /** Distinct entity kinds this connector produces, in first-seen order. */
  kinds: UnifiedEntityKind[];
}

/** Project an adapter into its capability report (what streams + entity kinds it syncs). Pure. */
export function describeAdapter(adapter: ConnectorAdapter): AdapterCapability {
  const resources = adapter.resources.map((r) => ({ id: r.id, label: r.label, kind: r.kind }));
  const kinds = [...new Set(resources.map((r) => r.kind))];
  return { connectorId: adapter.connectorId, resources, kinds };
}

/** Build a canonical entity with a deterministic Unified Identifier. */
export function makeEntity(i: EntityInput): UnifiedEntity {
  return {
    id: makeUnifiedId(i.tenantId, i.connectorId, i.accountId, i.kind, i.sourceId),
    kind: i.kind,
    // Stamped here as well as in `upsertMany`. The store's stamp is the
    // authoritative one — it overwrites whatever arrives — but an entity that
    // is already owned in flight cannot be mistaken for an unowned one by any
    // code between the adapter and the store.
    tenantId: i.tenantId,
    workspaceId: null,
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

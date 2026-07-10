/**
 * Builders that translate sync activity into Platform Events. Wiring the engine
 * to the existing Platform Event Bus means sync shows up in the Timeline,
 * Activity feed, and Diagnostics alongside everything else — no parallel bus.
 *
 * Connector lifecycle events use the `connector` category; entity mutations use
 * the `knowledge` category (the UDM changed). Entity events are emitted once per
 * sync as aggregate counts rather than per-record, to keep the timeline readable.
 */
import type { ConnectorId, PlatformEventInput, PlatformEventMeta } from '@neuropause/shared';

interface SyncCounts {
  created: number;
  updated: number;
  deleted: number;
  durationMs: number;
}

function evt(
  connectorId: ConnectorId,
  name: string,
  type: PlatformEventInput['type'],
  category: PlatformEventInput['category'],
  accountId: string,
  extra: PlatformEventMeta = {},
  priority?: PlatformEventInput['priority'],
): PlatformEventInput {
  return {
    type,
    category,
    source: 'sync',
    actor: { kind: 'connector', id: connectorId },
    resource: { type: 'connector', id: connectorId, name },
    metadata: { accountId, ...extra },
    ...(priority ? { priority } : {}),
  };
}

export const syncEvents = {
  started: (c: ConnectorId, n: string, a: string): PlatformEventInput =>
    evt(c, n, 'connector.sync_started', 'connector', a),
  completed: (c: ConnectorId, n: string, a: string, counts: SyncCounts): PlatformEventInput =>
    evt(c, n, 'connector.sync_completed', 'connector', a, {
      created: counts.created,
      updated: counts.updated,
      deleted: counts.deleted,
      durationMs: counts.durationMs,
    }),
  failed: (c: ConnectorId, n: string, a: string, error: string): PlatformEventInput =>
    evt(c, n, 'connector.sync_failed', 'connector', a, { error }, 'high'),
  entityCreated: (c: ConnectorId, n: string, a: string, count: number): PlatformEventInput =>
    evt(c, n, 'knowledge.entity_created', 'knowledge', a, { count }),
  entityUpdated: (c: ConnectorId, n: string, a: string, count: number): PlatformEventInput =>
    evt(c, n, 'knowledge.entity_updated', 'knowledge', a, { count }),
  entityDeleted: (c: ConnectorId, n: string, a: string, count: number): PlatformEventInput =>
    evt(c, n, 'knowledge.entity_deleted', 'knowledge', a, { count }),
  conflictDetected: (c: ConnectorId, n: string, a: string, count: number): PlatformEventInput =>
    evt(c, n, 'connector.conflict_detected', 'connector', a, { count }),
  conflictResolved: (c: ConnectorId, n: string, a: string, count: number): PlatformEventInput =>
    evt(c, n, 'connector.conflict_resolved', 'connector', a, { count }),
  rateLimited: (c: ConnectorId, n: string, a: string, retryAfterMs: number): PlatformEventInput =>
    evt(c, n, 'connector.rate_limited', 'connector', a, { retryAfterMs }, 'high'),
  offline: (c: ConnectorId, n: string, a: string): PlatformEventInput =>
    evt(c, n, 'connector.offline', 'connector', a, {}, 'high'),
  online: (c: ConnectorId, n: string, a: string): PlatformEventInput =>
    evt(c, n, 'connector.online', 'connector', a),
};

/**
 * Write-operation events (P2.4). Every audited Microsoft 365 write emits started → completed|failed on the
 * SAME platform bus as sync, so writes land in the Timeline, Audit log, Diagnostics, and Executive Center by
 * reuse. `action` is the write verb (e.g. `mail.send`), `meta` carries flat, non-sensitive descriptors only.
 */
export const writeEvents = {
  started: (c: ConnectorId, n: string, a: string, action: string, meta: PlatformEventMeta = {}): PlatformEventInput =>
    evt(c, n, 'connector.write_started', 'connector', a, { action, ...meta }),
  completed: (c: ConnectorId, n: string, a: string, action: string, meta: PlatformEventMeta = {}): PlatformEventInput =>
    evt(c, n, 'connector.write_completed', 'connector', a, { action, ...meta }),
  failed: (
    c: ConnectorId,
    n: string,
    a: string,
    action: string,
    error: string,
    meta: PlatformEventMeta = {},
  ): PlatformEventInput => evt(c, n, 'connector.write_failed', 'connector', a, { action, error, ...meta }, 'high'),
};

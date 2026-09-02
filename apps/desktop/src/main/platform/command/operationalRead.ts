/**
 * NeuroPause Platform — governed operational READ projection (ERP Session 32).
 *
 * A tenant-scoped, bounded, SANITIZED read over the EXISTING durable command journal (Session 18)
 * and the S31 delivered-event sink. It is a READ PROJECTION, not a query framework and not a second
 * data-access layer: it holds no state, opens no store of its own, and performs NO mutation — it only
 * shapes what the journal + sink already expose (both already tenant-filtered by construction) into an
 * operator-safe view.
 *
 * SECURITY POSTURE:
 *   • the caller passes the AUTHORITATIVE tenant id (resolved server-side from the principal) — this
 *     module never reads a renderer-claimed tenant;
 *   • only operationally-useful, non-sensitive fields are returned — no raw command payloads
 *     (`result`), no raw event `detail`, no secrets/tokens/credentials (the domain commands carry
 *     none, but the projection excludes those fields regardless);
 *   • pagination is BOUNDED (never "return everything") and a malformed filter FAILS CLOSED.
 */
import type { CommittedCommand, DurableCommandJournal } from './durableCommandJournal';
import type { DeliveredEventLog } from './deliveredEventLog';

/**
 * The operations this read surface answers — anything else is not a read (falls to the write path).
 * `QueryDeliveryOperations` (ERP Session 35) is the delivery-failure drill-down; it is a SIBLING read
 * on this SAME branch (no new channel/command/bus), routed to `buildDeliveryOperations`.
 */
export const OPERATIONAL_READ_OPERATIONS: ReadonlySet<string> = new Set([
  'QueryOperationalHistory',
  'QueryDeliveryOperations',
]);

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
export const OUTBOX_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING', 'DELIVERED', 'RETRYABLE']);

export interface OperationalReadParams {
  limit?: unknown;
  outboxStatus?: unknown;
}

export type OperationalReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/** Clamp any client-supplied limit into (0, MAX] — a non-integer / non-positive / oversized value is bounded, never trusted, never unbounded. */
export function boundLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export const trimError = (e: unknown): string => String(e).slice(0, 200);

/** Operator-safe projection of a committed command — ids/type/actor/status/timestamps only, no payloads. */
function sanitizeCommand(rec: CommittedCommand): Record<string, unknown> {
  return {
    txId: rec.id,
    commandType: rec.commandType,
    actor: rec.event.actor,
    aggregateId: rec.event.aggregateId,
    ...(rec.event.aggregateType ? { aggregateType: rec.event.aggregateType } : {}),
    eventType: rec.event.type,
    correlationId: rec.event.correlationId,
    committedAt: rec.committedAt,
    idempotencyKey: rec.idempotencyKey,
    outbox: {
      status: rec.outbox.status,
      attempts: rec.outbox.attempts,
      ...(rec.outbox.deliveredAt ? { deliveredAt: rec.outbox.deliveredAt } : {}),
      ...(rec.outbox.lastError ? { lastError: trimError(rec.outbox.lastError) } : {}),
    },
  };
}

/**
 * Build the tenant-scoped operational history. `tenantId` MUST be the authoritative server-resolved
 * tenant. Reads only — never mutates the journal or the sink, so it can run concurrently with the S31
 * serialized drain without racing it.
 */
export function buildOperationalHistory(
  journal: DurableCommandJournal,
  deliveredLog: DeliveredEventLog | undefined,
  tenantId: string,
  params: OperationalReadParams,
): OperationalReadResult {
  const limit = boundLimit(params.limit);

  // Optional outbox-status filter — validated against the known set; an unknown value FAILS CLOSED
  // (never silently returns everything).
  let statusFilter: string | undefined;
  if (params.outboxStatus !== undefined && params.outboxStatus !== null && params.outboxStatus !== '') {
    const s = String(params.outboxStatus);
    if (!OUTBOX_STATUSES.has(s)) return { ok: false, error: 'INVALID_STATUS_FILTER' };
    statusFilter = s;
  }

  const all = journal.records(tenantId); // tenant-scoped by construction
  const filtered = statusFilter ? all.filter((r) => r.outbox.status === statusFilter) : all;
  // Most-recent-first, bounded.
  const commands = filtered.slice(-limit).reverse().map(sanitizeCommand);

  const pending = journal.pendingOutbox(tenantId); // PENDING | RETRYABLE, tenant-scoped
  const delivered = deliveredLog ? deliveredLog.delivered(tenantId) : [];

  return {
    ok: true,
    data: {
      tenantId,
      limit,
      counts: { commands: all.length, pendingOutbox: pending.length, delivered: delivered.length },
      commands,
      pendingOutbox: pending.slice(0, limit).map((r) => ({
        txId: r.id,
        commandType: r.commandType,
        status: r.outbox.status,
        attempts: r.outbox.attempts,
        ...(r.outbox.lastError ? { lastError: trimError(r.outbox.lastError) } : {}),
      })),
      delivered: delivered.slice(-limit).reverse().map((d) => ({
        eventId: d.id,
        type: d.type,
        aggregateId: d.aggregateId,
        ...(d.aggregateType ? { aggregateType: d.aggregateType } : {}),
        correlationId: d.correlationId,
        deliveredAt: d.deliveredAt,
      })),
    },
  };
}

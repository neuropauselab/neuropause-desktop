/**
 * NeuroPause Platform — governed DELIVERY-OPERATIONS read projection (ERP Session 35).
 *
 * A tenant-scoped, bounded, SANITIZED read that makes real outbox/delivery FAILURES from the S31
 * delivery relay observable to an authenticated operator. It answers, from the SINGLE source of
 * delivery truth (the Session-18 durable command journal's outbox state — never a second store):
 *
 *   1. What deliveries are PENDING?          → outbox.status === 'PENDING'  (never attempted)
 *   2. Which deliveries FAILED / are retrying? → outbox.status === 'RETRYABLE' (attempted, failed)
 *   3. WHAT event failed?                    → the domain event type + aggregate
 *   4. WHEN was it queued / delivered?       → committedAt (queued) / outbox.deliveredAt (completed)
 *   5. HOW MANY attempts occurred?           → outbox.attempts (persisted, incremented per drain pass)
 *   6. Current delivery STATE?               → a pure derivation over outbox.status (no invented policy)
 *   7. Safe to inspect?                      → yes — ids/type/status/timestamps/bounded error ONLY
 *
 * It is a READ PROJECTION over the SAME journal S32/S34 already read — NOT a second outbox, delivery
 * engine, event bus, queue, monitoring service, or data-access layer. It holds no state, opens no
 * store, performs NO mutation, and mints no event. It is READ-ONLY by construction: retry / replay /
 * force-deliver are DELIBERATELY OUT OF SCOPE (their policy is undefined — see the S35 evidence), so
 * this surface never offers a mutating action.
 *
 * SECURITY POSTURE (identical to S32/S34):
 *   • the caller passes the AUTHORITATIVE tenant id (resolved server-side from the principal);
 *   • only operationally-useful, non-sensitive fields are returned — no raw command result, no raw
 *     event `detail`/payload, no secrets/tokens/credentials, no filesystem paths;
 *   • pagination is BOUNDED and a malformed filter FAILS CLOSED.
 */
import type { CommittedCommand, DurableCommandJournal } from './durableCommandJournal';
import type { DeliveredEventLog } from './deliveredEventLog';
import { OUTBOX_STATUSES, boundLimit, trimError } from './operationalRead';

/**
 * The operator-facing delivery state — a PURE derivation over the existing persisted `outbox.status`.
 * No new lifecycle, no invented policy: exactly the four outbox statuses re-labelled for an operator.
 *   PENDING    → never attempted (queued, not yet drained)
 *   IN_FLIGHT  → a delivery attempt is underway (PROCESSING)
 *   RETRYING   → attempted, failed, will be retried (RETRYABLE)  ← the failure the operator hunts
 *   DELIVERED  → confirmed delivered into the S31 sink
 */
export type DeliveryState = 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'DELIVERED';

function deriveState(status: string): DeliveryState {
  switch (status) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'PROCESSING':
      return 'IN_FLIGHT';
    case 'RETRYABLE':
      return 'RETRYING';
    default:
      return 'PENDING'; // PENDING (the only remaining known status)
  }
}

export type DeliveryOperationsResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/** Operator-safe delivery projection of a committed command — delivery fields ONLY, no payloads. */
function sanitizeDelivery(rec: CommittedCommand): Record<string, unknown> {
  return {
    txId: rec.id,
    eventId: rec.event.eventId,
    eventType: rec.event.type,
    aggregateId: rec.event.aggregateId,
    ...(rec.event.aggregateType ? { aggregateType: rec.event.aggregateType } : {}),
    correlationId: rec.event.correlationId,
    deliveryState: deriveState(rec.outbox.status),
    status: rec.outbox.status,
    attempts: rec.outbox.attempts,
    /** When the event was committed/queued for delivery (the closest persisted "created" instant). */
    queuedAt: rec.committedAt,
    ...(rec.outbox.deliveredAt ? { deliveredAt: rec.outbox.deliveredAt } : {}),
    /** Bounded, sanitized last failure reason (present only for a failed/retrying delivery). */
    ...(rec.outbox.lastError ? { lastError: trimError(rec.outbox.lastError) } : {}),
  };
}

/**
 * Build the tenant-scoped DELIVERY OPERATIONS view. `tenantId` MUST be the authoritative
 * server-resolved tenant. Reads only — never mutates the journal or the sink, so it runs safely
 * concurrent with the S31 serialized drain. `params.status` optionally narrows to one outbox status
 * (validated; unknown value FAILS CLOSED). `params.limit` is bounded, never "everything".
 */
export function buildDeliveryOperations(
  journal: DurableCommandJournal,
  deliveredLog: DeliveredEventLog | undefined,
  tenantId: string,
  params: { limit?: unknown; status?: unknown },
): DeliveryOperationsResult {
  const limit = boundLimit(params.limit);

  // Optional outbox-status filter — validated against the known set; an unknown value FAILS CLOSED
  // (never silently returns everything).
  let statusFilter: string | undefined;
  if (params.status !== undefined && params.status !== null && params.status !== '') {
    const s = String(params.status);
    if (!OUTBOX_STATUSES.has(s)) return { ok: false, error: 'INVALID_STATUS_FILTER' };
    statusFilter = s;
  }

  const all = journal.records(tenantId); // tenant-scoped by construction

  // Counts always reflect the FULL tenant picture (never the filtered/paginated slice), so the
  // operator sees the true number of failed/pending deliveries even while filtering.
  const counts = {
    total: all.length,
    pending: all.filter((r) => r.outbox.status === 'PENDING').length,
    inFlight: all.filter((r) => r.outbox.status === 'PROCESSING').length,
    retryable: all.filter((r) => r.outbox.status === 'RETRYABLE').length,
    delivered: all.filter((r) => r.outbox.status === 'DELIVERED').length,
  };

  const filtered = statusFilter ? all.filter((r) => r.outbox.status === statusFilter) : all;
  // Most-recent-first, bounded.
  const deliveries = filtered.slice(-limit).reverse().map(sanitizeDelivery);

  // The delivered-event sink is the S31 downstream confirmation; expose its count as a
  // corroborating figure only (the journal's DELIVERED count is the authority for state).
  const sinkDelivered = deliveredLog ? deliveredLog.count(tenantId) : 0;

  // ERP Session 40 — surface crash-orphaned commands HELD for reconciliation (intent-first recovery),
  // tenant-scoped and sanitized (ids/reason/reservedAt only — no filesystem paths, no secrets), so the
  // operator can see a command that a crash left in RECONCILIATION_REQUIRED rather than re-executed.
  const held = journal.heldIntents(tenantId);

  return {
    ok: true,
    data: {
      tenantId,
      limit,
      counts: { ...counts, heldReconciliations: held.length },
      sinkDelivered,
      deliveries,
      heldReconciliations: held.slice(0, limit),
    },
  };
}

/**
 * NeuroPause Platform — governed OPERATIONAL EXCEPTIONS read projection (S139).
 *
 * A tenant-scoped, bounded, SANITIZED read that UNIFIES the operational signals that already need an
 * operator's follow-up into ONE "needs attention" queue, from the SINGLE source of truth (the Session-18
 * durable command journal — never a second store):
 *
 *   1. RETRYING deliveries    → outbox.status === 'RETRYABLE' (attempted, failed — the S35 failure)
 *   2. HELD reconciliations   → journal.heldIntents (crash-orphaned command intents held for
 *                               reconciliation — S40 — never re-executed)
 *
 * WHY THIS EXISTS (S139 discovery): every one of these signals is ALREADY a governed read, but they are
 * surfaced across THREE disjoint surfaces (the delivery panel renders neither held reconciliations nor a
 * unified exception list; stale PROCESSING is silently reclaimed to RETRYABLE at boot). There was no single
 * operator "what needs follow-up" queue. This closes that gap.
 *
 * IT IS A READ PROJECTION over the SAME journal S32/S34/S35 already read — NOT a second store, queue,
 * monitor, ticket system, or data-access layer. It holds no state, opens no store, mints no event, and
 * performs NO mutation. It is READ-ONLY by construction: resolve / retry / replay are DELIBERATELY OUT OF
 * SCOPE (hold resolution already lives, governed by `governance:manage`, in the Hold Center — this surface
 * never offers a mutating action and never expands authority).
 *
 * NO INVENTED POLICY: it invents NO severity, priority, SLA, SLO, or urgency ranking. It is a pure UNION of
 * two existing persisted states, each item carrying only fields that already exist, ordered by the item's
 * own existing timestamp (most-recent-first). "Exception" here means exactly "a persisted RETRYABLE outbox
 * entry or a held reconciliation intent" — nothing is scored or judged.
 *
 * SECURITY POSTURE (identical to S32/S34/S35):
 *   • the caller passes the AUTHORITATIVE tenant id (resolved server-side from the principal);
 *   • only operationally-useful, non-sensitive fields are returned — no raw command result, no raw event
 *     `detail`/payload, no secrets/tokens/credentials, no filesystem paths;
 *   • pagination is BOUNDED and a malformed filter FAILS CLOSED.
 */
import type { DurableCommandJournal } from './durableCommandJournal';
import { boundLimit, trimError } from './operationalRead';

/** The kind of operational exception — exactly the two persisted follow-up states, never invented. */
export type OperationalExceptionKind = 'delivery_retrying' | 'held_reconciliation';

export interface OperationalExceptionItem {
  kind: OperationalExceptionKind;
  /** Stable per-item id: the txId for a delivery, the held-intent id for a reconciliation. */
  id: string;
  /** The item's own existing timestamp (committedAt / reservedAt), used only for ordering — no urgency policy. */
  at: string;
  /** A short, sanitized operator label derived from fields that already exist. */
  summary: string;
  /** Delivery-only: the domain event type / aggregate / attempts / bounded last error / correlation. */
  eventType?: string;
  aggregateId?: string;
  attempts?: number;
  lastError?: string;
  correlationId?: string;
  /** Held-only: the idempotency key / reservation state / bounded reason. */
  idempotencyKey?: string;
  state?: string;
  reason?: string;
}

export type OperationalExceptionsResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Build the tenant-scoped OPERATIONAL EXCEPTIONS view. `tenantId` MUST be the authoritative
 * server-resolved tenant. Reads only — never mutates the journal, so it runs safely concurrent with the
 * S31 serialized drain. `params.kind` optionally narrows to one exception kind (validated; unknown value
 * FAILS CLOSED). `params.limit` is bounded, never "everything". Counts always reflect the FULL tenant
 * picture (never the paginated slice).
 */
export function buildOperationalExceptions(
  journal: DurableCommandJournal,
  tenantId: string,
  params: { limit?: unknown; kind?: unknown },
): OperationalExceptionsResult {
  const limit = boundLimit(params.limit);

  // Optional kind filter — validated against the known set; an unknown value FAILS CLOSED.
  let kindFilter: OperationalExceptionKind | undefined;
  if (params.kind !== undefined && params.kind !== null && params.kind !== '') {
    const k = String(params.kind);
    if (k !== 'delivery_retrying' && k !== 'held_reconciliation') return { ok: false, error: 'INVALID_KIND_FILTER' };
    kindFilter = k;
  }

  const records = journal.records(tenantId); // tenant-scoped by construction
  const held = journal.heldIntents(tenantId); // tenant-scoped by construction

  const retryingDeliveries = records.filter((r) => r.outbox.status === 'RETRYABLE');

  // Full-tenant counts (never the filtered/paginated slice).
  const counts = {
    retryingDeliveries: retryingDeliveries.length,
    heldReconciliations: held.length,
    total: retryingDeliveries.length + held.length,
  };

  const deliveryItems: OperationalExceptionItem[] = retryingDeliveries.map((r) => ({
    kind: 'delivery_retrying' as const,
    id: r.id,
    at: r.committedAt,
    summary: `Delivery retrying: ${r.event.type}`,
    eventType: r.event.type,
    ...(r.event.aggregateId ? { aggregateId: r.event.aggregateId } : {}),
    attempts: r.outbox.attempts,
    ...(r.outbox.lastError ? { lastError: trimError(r.outbox.lastError) } : {}),
    correlationId: r.event.correlationId,
  }));

  const heldItems: OperationalExceptionItem[] = held.map((h) => ({
    kind: 'held_reconciliation' as const,
    id: h.id,
    at: h.reservedAt,
    summary: `Held for reconciliation: ${h.idempotencyKey}`,
    idempotencyKey: h.idempotencyKey,
    state: h.state,
    ...(h.reason ? { reason: trimError(h.reason) } : {}),
  }));

  const merged = [...deliveryItems, ...heldItems].filter((it) => !kindFilter || it.kind === kindFilter);
  // Most-recent-first by the item's OWN timestamp (ordering only — no urgency/severity policy).
  merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const exceptions = merged.slice(0, limit);

  return {
    ok: true,
    data: {
      tenantId,
      limit,
      counts,
      exceptions,
    },
  };
}

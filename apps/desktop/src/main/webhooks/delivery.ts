/**
 * Webhook delivery state (P3.0, Increment 4) — pure.
 * Applies the result of a single POST attempt to a delivery record (success →
 * delivered; failure → failed with a scheduled retry, or dead once the schedule is
 * exhausted), selects which deliveries are due, and builds the signed payload body.
 * No I/O — the runtime dispatcher supplies the clock + the HTTP `post`.
 */
import type { PlatformEvent, WebhookDelivery, WebhookDeliveryStatus, WebhookEventPayload } from '@neuropause/shared';
import { planNextAttempt } from './retry';

export interface AttemptResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

/** Fold one attempt's result into the delivery record. Pure. */
export function applyAttemptResult(d: WebhookDelivery, result: AttemptResult, nowMs: number): WebhookDelivery {
  const attempts = d.attempts + 1;
  const updatedAt = new Date(nowMs).toISOString();
  if (result.ok) {
    return { ...d, status: 'delivered', attempts, lastStatusCode: result.statusCode, lastError: null, nextAttemptAt: null, updatedAt };
  }
  const plan = planNextAttempt(attempts, nowMs);
  return {
    ...d,
    status: plan.status === 'dead' ? 'dead' : 'failed',
    attempts,
    lastStatusCode: result.statusCode,
    lastError: result.error,
    nextAttemptAt: plan.nextAttemptAtMs != null ? new Date(plan.nextAttemptAtMs).toISOString() : null,
    updatedAt,
  };
}

/** Deliveries eligible to be (re)attempted now. Pure. */
export function dueDeliveries(list: WebhookDelivery[], nowMs: number): WebhookDelivery[] {
  return list.filter(
    (d) => (d.status === 'pending' || d.status === 'failed') && (!d.nextAttemptAt || Date.parse(d.nextAttemptAt) <= nowMs),
  );
}

/** A delivery row as the evictor sees it: an id, a status, an age and an OWNER. */
export interface EvictableDelivery {
  id: string;
  status: WebhookDeliveryStatus;
  createdAt: string;
  tenantId?: string | null;
  workspaceId?: string | null;
}

/**
 * The retention budget a delivery is charged to. P13C ROUND 10 — NEW-H2.
 *
 * Exactly the boundary `recordInScope` enforces on `deliveriesFor`, `deadLetters`,
 * `replay` and `stats`: a different tenant is denied, an absent/empty workspace is
 * tenant-wide, a different workspace is denied. Every row the store writes carries
 * `workspaceId: null`, so in practice this IS the tenant — the pair is used anyway
 * so a row that somehow carries a workspace is never evicted by a sibling workspace
 * the reads would have hidden it from.
 *
 * JSON-encoded so a tenant id containing the separator cannot merge two budgets;
 * an unowned row keys to `[null, null]`, which no owned row can produce.
 */
function deliveryOwnerKey(row: EvictableDelivery): string {
  const tenant = typeof row.tenantId === 'string' && row.tenantId !== '' ? row.tenantId : null;
  const workspace = typeof row.workspaceId === 'string' && row.workspaceId !== '' ? row.workspaceId : null;
  return JSON.stringify([tenant, workspace]);
}

/**
 * Choose which deliveries to evict to bring EACH OWNER's outbox down to `capPerOwner`
 * (P3.0, Increment 10; made per-owner in P13C Round 10 — NEW-H2): within an owner,
 * terminal (delivered/dead) rows oldest-first, then — only if a stuck non-terminal
 * backlog is still over cap — that owner's oldest non-terminal rows. Pure.
 *
 * IT USED TO SORT EVERY OWNER'S ROWS TOGETHER and return `rows.length - cap` ids off
 * the front. Terminal-first made it worse than a plain age cap: a quiet tenant's
 * DEAD-LETTERED rows sorted to the very front of the eviction order, so a busy
 * tenant's traffic destroyed exactly the rows that are the replay and forensics
 * surface. Tenant B holding 5 deliveries (2 dead-lettered) was left with zero of
 * both after tenant A enqueued 5,100 — and the reads (`deliveriesFor`,
 * `deadLetters`, `replay`, `stats`) were all correctly scoped the whole time,
 * which is precisely why nothing caught it.
 *
 * Guarantees: each owner's surviving row count ≤ `capPerOwner`; no id is ever
 * returned for an owner that is at or under cap. Total size is therefore
 * `capPerOwner × owners`, which is the same honest trade the graph history and the
 * timeline window make — the alternative is one customer able to delete another's.
 */
export function selectEvictions(rows: ReadonlyArray<EvictableDelivery>, capPerOwner: number): string[] {
  // No single owner can exceed the cap while the whole set does not.
  if (rows.length <= capPerOwner) return [];
  const byOwner = new Map<string, EvictableDelivery[]>();
  for (const row of rows) {
    const key = deliveryOwnerKey(row);
    const bucket = byOwner.get(key);
    if (bucket) bucket.push(row);
    else byOwner.set(key, [row]);
  }
  const isTerminal = (s: WebhookDeliveryStatus): boolean => s === 'delivered' || s === 'dead';
  const out: string[] = [];
  for (const bucket of byOwner.values()) {
    if (bucket.length <= capPerOwner) continue;
    const ordered = [...bucket].sort((a, b) => {
      const ta = isTerminal(a.status) ? 0 : 1;
      const tb = isTerminal(b.status) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
    for (const d of ordered.slice(0, bucket.length - capPerOwner)) out.push(d.id);
  }
  return out;
}

/** Build the payload body posted to the endpoint. Pure. */
export function buildEventPayload(deliveryId: string, event: PlatformEvent, nowMs: number): WebhookEventPayload {
  return {
    deliveryId,
    event: {
      id: event.id,
      type: event.type,
      category: event.category,
      timestamp: event.timestamp,
      source: event.source,
      resource: event.resource,
      metadata: event.metadata,
    },
    sentAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Webhook delivery state (P3.0, Increment 4) — pure.
 * Applies the result of a single POST attempt to a delivery record (success →
 * delivered; failure → failed with a scheduled retry, or dead once the schedule is
 * exhausted), selects which deliveries are due, and builds the signed payload body.
 * No I/O — the runtime dispatcher supplies the clock + the HTTP `post`.
 */
import type { PlatformEvent, WebhookDelivery, WebhookEventPayload } from '@neuropause/shared';
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

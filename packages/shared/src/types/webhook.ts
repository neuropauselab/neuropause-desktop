/**
 * Enterprise Webhooks (P3.0, Increment 4).
 *
 * Webhooks are a delivery layer ON TOP OF the existing platform event bus — not a
 * second event stream. A registered endpoint subscribes to event categories/types;
 * a bus subscriber matches each published `PlatformEvent` to endpoints and enqueues a
 * delivery. Deliveries are an outbox: signed HMAC-SHA256, retried with backoff, and
 * dead-lettered after the schedule is exhausted, with a bounded delivery history and
 * replay. Types-only.
 */
import type { PlatformEventCategory, PlatformEventType } from './platform';

/** Header names carried on every outbound delivery. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-neuropause-signature';
export const WEBHOOK_DELIVERY_HEADER = 'x-neuropause-delivery';
export const WEBHOOK_EVENT_HEADER = 'x-neuropause-event';

/** What an endpoint wants to receive. Empty categories AND types ⇒ everything. */
export interface WebhookSubscription {
  categories: PlatformEventCategory[];
  types: PlatformEventType[];
}

export interface Webhook {
  id: string;
  /**
   * The organization that registered this endpoint (P13C part 2).
   *
   * THE MOST CONSEQUENTIAL SCOPE FIELD IN THE SYSTEM, because a webhook is the
   * only surface that sends platform data OFF THE DEVICE to an address a user
   * chose. Every other boundary in Programs 11-13B is a read filter, and a read
   * filter can be added later; a payload already POSTed to someone else's URL
   * cannot be recalled.
   *
   * Absent means UNRESOLVED — the endpoint belongs to no tenant, receives no
   * events, and is visible to nobody. Endpoints registered before P13C are
   * therefore inert rather than firehoses.
   */
  tenantId?: string | null;
  /** Absent means tenant-level: fed by events from anywhere in the tenant. */
  workspaceId?: string | null;
  label: string;
  url: string;
  subscription: WebhookSubscription;
  enabled: boolean;
  /** Non-secret tail of the signing secret (the secret is returned once at creation). */
  secretLast4: string;
  createdAt: string;
}

/** Returned only once, at creation — the signing secret in clear. */
export interface WebhookWithSecret {
  webhook: Webhook;
  secret: string;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

/** The signed body POSTed to an endpoint. */
export interface WebhookEventPayload {
  /** The delivery id (idempotency key for the receiver). */
  deliveryId: string;
  event: {
    id: string;
    type: PlatformEventType;
    category: PlatformEventCategory;
    timestamp: string;
    source: string;
    resource: unknown;
    metadata: Record<string, unknown>;
  };
  sentAt: string;
}

export interface WebhookDelivery {
  id: string;
  /**
   * The tenant this delivery belongs to (P13C part 2).
   *
   * Carried on the DELIVERY as well as the endpoint, because a delivery
   * outlives the moment it was created: it sits in an outbox, retries on a
   * schedule for up to six hours, and can be replayed by hand long afterwards.
   * Re-deriving its tenant at send time would mean asking "who is active now?"
   * about work queued for someone else — exactly the mistake the memory
   * live-sync bridge made in Program 13A.
   */
  tenantId?: string | null;
  workspaceId?: string | null;
  webhookId: string;
  eventId: string;
  eventType: PlatformEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  /** ISO time of the next scheduled attempt, or null when terminal. */
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryStats {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  dead: number;
}

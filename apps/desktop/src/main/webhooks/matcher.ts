/**
 * Webhook subscription matching (P3.0, Increment 4) — pure.
 * An endpoint receives an event if it subscribes to the event's category OR its
 * specific type. An endpoint with no category and no type filter receives everything
 * (a firehose). This is the only place delivery eligibility is decided.
 */
import type { PlatformEventCategory, PlatformEventType, WebhookSubscription } from '@neuropause/shared';

export function matchesSubscription(
  sub: WebhookSubscription,
  event: { type: PlatformEventType; category: PlatformEventCategory },
): boolean {
  if (sub.categories.length === 0 && sub.types.length === 0) return true; // firehose
  if (sub.categories.includes(event.category)) return true;
  if (sub.types.includes(event.type)) return true;
  return false;
}

/**
 * Webhook producer (P3.0, Increment 4) — bridges the platform event bus to the
 * delivery outbox. It subscribes to the bus, and for each event enqueues a delivery
 * to every enabled endpoint whose subscription matches. Pure fan-out: it duplicates
 * no event logic and publishes nothing. The subscribe + clock are injected.
 */
import type { PlatformEvent } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { WebhookStore } from './webhookStore';
import { matchesSubscription } from './matcher';

const log = createLogger('webhook-producer');

export interface WebhookProducerDeps {
  store: WebhookStore;
  /** Subscribe to every platform event; returns a disposer. */
  subscribe: (handler: (e: PlatformEvent) => void) => { dispose: () => void };
  /** Called when at least one delivery was enqueued (nudges the dispatcher). */
  onEnqueued?: () => void;
  now: () => number;
}

export function wireWebhookProducers(deps: WebhookProducerDeps): { dispose: () => void } {
  const sub = deps.subscribe((event) => {
    let enqueued = 0;
    for (const wh of deps.store.enabledWebhooks()) {
      if (matchesSubscription(wh.subscription, event)) {
        deps.store.enqueue(wh.id, event, deps.now());
        enqueued += 1;
      }
    }
    if (enqueued > 0) {
      log.info('webhook deliveries enqueued', { event: event.type, count: enqueued });
      deps.onEnqueued?.();
    }
  });
  log.info('Webhook producers wired');
  return sub;
}

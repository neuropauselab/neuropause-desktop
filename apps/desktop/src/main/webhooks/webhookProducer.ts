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
    /**
     * P13C — THE EGRESS BOUNDARY. This loop is where a platform event becomes
     * an outbound HTTP request to an address a user chose.
     *
     * It used to iterate EVERY enabled endpoint on the install and match only
     * on category/type. The bus hands this subscriber the entire firehose —
     * every tenant's events — so an endpoint registered by tenant B received
     * tenant A's events, including `resource` and `metadata`, POSTed off the
     * device. Worse, the payload builder strips `tenantId`, so the receiver
     * could not even tell whose data it had been sent.
     *
     * The fan-out set is now selected BY THE EVENT'S OWN TENANT. Two properties
     * follow, and both matter:
     *
     *   - An event can only reach endpoints its own tenant registered.
     *   - An event with no tenant reaches NOTHING. That covers system events
     *     and anything published before a tenant resolved. Fail-closed is the
     *     only defensible default for a boundary whose mistakes are
     *     irreversible: a read filter can be added tomorrow, but a payload
     *     already delivered to a third party cannot be recalled.
     */
    let enqueued = 0;
    for (const wh of deps.store.enabledWebhooksForTenant(event.tenantId)) {
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

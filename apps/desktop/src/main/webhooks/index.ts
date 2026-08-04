/**
 * Enterprise Webhooks subsystem (P3.0, Increment 4) — composition root.
 *
 * Loads the store, wires a bus producer (every platform event → matching endpoints'
 * outbox), and starts the dispatcher (signs + POSTs due deliveries, retries, dead-
 * letters). Exposes register / list / enable / delete / deliveries / dead-letters /
 * replay / stats over the secure bridge. The real HTTP `post` (a timeout-bounded
 * fetch) is injected here; tests drive the pure cores + a fake poster.
 */
import {
  EmptyRequest,
  IpcChannel,
  WebhookCreateRequest,
  WebhookDeliveriesRequest,
  WebhookIdRequest,
  WebhookSetEnabledRequest,
} from '@neuropause/shared';
import type {
  PlatformEvent,
  PlatformEventCategory,
  PlatformEventType,
  WebhookCreateRequest as TWebhookCreate,
  WebhookDeliveriesRequest as TWebhookDeliveries,
  WebhookIdRequest as TWebhookId,
  WebhookSetEnabledRequest as TWebhookSetEnabled,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { webhookStore } from './webhookInstance';
import { WebhookDispatcher, type WebhookPoster } from './webhookDispatcher';
import { wireWebhookProducers } from './webhookProducer';

const log = createLogger('webhooks');

/** Timeout-bounded POST — the real delivery transport. Redirects are refused so a
 *  302 to an internal target can't defeat the SSRF egress guard. */
const httpPost: WebhookPoster = async (url, body, headers) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { method: 'POST', body, headers, signal: controller.signal, redirect: 'error' });
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
};

export interface WebhookSubsystemDeps {
  broadcast: IpcBroadcaster;
  /** Subscribe to every platform event (the bus). */
  subscribe: (handler: (e: PlatformEvent) => void) => { dispose: () => void };
  /** Override the delivery transport (tests). */
  post?: WebhookPoster;
}

export interface WebhookSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

export async function initWebhooks(deps: WebhookSubsystemDeps): Promise<WebhookSubsystem> {
  await webhookStore.load();

  const dispatcher = new WebhookDispatcher({ store: webhookStore, post: deps.post ?? httpPost, now: () => Date.now() });
  const producer = wireWebhookProducers({
    store: webhookStore,
    subscribe: deps.subscribe,
    onEnqueued: () => dispatcher.kick(),
    now: () => Date.now(),
  });
  dispatcher.start();

  const onChanged = (): void => deps.broadcast(IpcChannel.WebhookEventBroadcast, webhookStore.stats());
  webhookStore.on('changed', onChanged);

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.WebhookCreate,
      schema: WebhookCreateRequest,
      requireAuth: true,
      permission: 'governance:manage',
      audit: true,
      handler: (p) => {
        const r = p as TWebhookCreate;
        return webhookStore.create(r.label, r.url, {
          categories: (r.categories ?? []) as PlatformEventCategory[],
          types: (r.types ?? []) as PlatformEventType[],
        });
      },
    },
    { channel: IpcChannel.WebhookList, schema: EmptyRequest, requireAuth: true, permission: 'governance:read', handler: () => webhookStore.list() },
    {
      channel: IpcChannel.WebhookSetEnabled,
      schema: WebhookSetEnabledRequest,
      requireAuth: true,
      permission: 'governance:manage',
      audit: true,
      handler: (p) => {
        const r = p as TWebhookSetEnabled;
        return webhookStore.setEnabled(r.id, r.enabled);
      },
    },
    {
      channel: IpcChannel.WebhookDelete,
      schema: WebhookIdRequest,
      requireAuth: true,
      permission: 'governance:manage',
      audit: true,
      handler: (p) => ({ deleted: webhookStore.delete((p as TWebhookId).id) }),
    },
    {
      channel: IpcChannel.WebhookDeliveries,
      schema: WebhookDeliveriesRequest,
      requireAuth: true,
      permission: 'governance:read',
      handler: (p) => {
        const r = p as TWebhookDeliveries;
        return webhookStore.deliveriesFor({ webhookId: r.webhookId, limit: r.limit });
      },
    },
    { channel: IpcChannel.WebhookDeadLetters, schema: EmptyRequest, requireAuth: true, permission: 'governance:read', handler: () => webhookStore.deadLetters() },
    {
      channel: IpcChannel.WebhookReplay,
      schema: WebhookIdRequest,
      requireAuth: true,
      permission: 'governance:manage',
      audit: true,
      handler: (p) => {
        const replayed = webhookStore.replay((p as TWebhookId).id, Date.now());
        if (replayed) dispatcher.kick();
        return replayed ?? { error: 'not_found' };
      },
    },
    { channel: IpcChannel.WebhookStats, schema: EmptyRequest, requireAuth: true, permission: 'governance:read', handler: () => webhookStore.stats() },
  ];

  log.info('Enterprise Webhooks initialized', { webhooks: webhookStore.list().length });

  return {
    handlers,
    dispose: () => {
      producer.dispose();
      dispatcher.stop();
      webhookStore.off('changed', onChanged);
    },
  };
}

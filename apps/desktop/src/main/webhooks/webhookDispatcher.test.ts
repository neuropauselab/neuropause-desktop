/**
 * P3.0 Increment 4 — dispatcher + store integration: signed delivery on 2xx, retry
 * → dead-letter on repeated failure, and replay. Real store on a temp file, fake POST.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlatformEvent } from '@neuropause/shared';
import { WEBHOOK_SIGNATURE_HEADER } from '@neuropause/shared';
import { WebhookStore } from './webhookStore';
import { WebhookDispatcher } from './webhookDispatcher';
import { WEBHOOK_MAX_ATTEMPTS } from './retry';

let seq = 0;
async function tempStore(): Promise<WebhookStore> {
  seq += 1;
  const store = new WebhookStore(join(tmpdir(), `wh-test-${Date.now()}-${seq}.json`));
  await store.load();
  return store;
}

function event(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    id: 'evt1', type: 'enterprise.record.created', category: 'enterprise', version: 1, priority: 'normal',
    timestamp: '2026-01-01T00:00:00.000Z', source: 'test', actor: { kind: 'system', id: null },
    resource: null, correlationId: 'c1', causationId: null, metadata: { total: 5 }, ...over,
  } as PlatformEvent;
}

describe('WebhookDispatcher', () => {
  it('signs and delivers on a 2xx response', async () => {
    const store = await tempStore();
    const { webhook } = store.create('t', 'https://example.test/hook', { categories: ['enterprise'], types: [] });
    store.enqueue(webhook.id, event(), 1000);

    const posts: Array<{ url: string; headers: Record<string, string> }> = [];
    const dispatcher = new WebhookDispatcher({
      store,
      post: async (url, _body, headers) => {
        posts.push({ url, headers });
        return { status: 200 };
      },
      now: () => 2000,
    });

    const attempted = await dispatcher.tick();
    expect(attempted).toBe(1);
    expect(posts[0].url).toBe('https://example.test/hook');
    expect(posts[0].headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^sha256=/);

    const [d] = store.deliveriesFor({});
    expect(d.status).toBe('delivered');
    expect(d.attempts).toBe(1);
    expect(store.stats().delivered).toBe(1);
  });

  it('retries a failing endpoint and dead-letters after the schedule is exhausted', async () => {
    const store = await tempStore();
    const { webhook } = store.create('t', 'https://example.test/hook', { categories: ['enterprise'], types: [] });
    store.enqueue(webhook.id, event(), 0);

    let clock = 0;
    const dispatcher = new WebhookDispatcher({ store, post: async () => ({ status: 500 }), now: () => clock });

    for (let i = 0; i < 12 && store.deliveriesFor({})[0].status !== 'dead'; i += 1) {
      await dispatcher.tick();
      clock += 1_000_000_000; // jump past any backoff
    }

    const [d] = store.deliveriesFor({});
    expect(d.status).toBe('dead');
    expect(d.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(store.deadLetters()).toHaveLength(1);
    expect(store.stats().dead).toBe(1);
  });

  it('replays a delivery as a fresh pending row', async () => {
    const store = await tempStore();
    const { webhook } = store.create('t', 'https://example.test/hook', { categories: ['enterprise'], types: [] });
    const first = store.enqueue(webhook.id, event(), 0);

    const replayed = store.replay(first.id, 100);
    expect(replayed?.id).not.toBe(first.id);
    expect(replayed?.status).toBe('pending');
    expect(replayed?.attempts).toBe(0);
    expect(replayed?.eventId).toBe('evt1');
  });

  it('only enqueues to enabled endpoints via the store', async () => {
    const store = await tempStore();
    const { webhook } = store.create('t', 'https://example.test/hook', { categories: ['enterprise'], types: [] });
    expect(store.enabledWebhooks()).toHaveLength(1);
    store.setEnabled(webhook.id, false);
    expect(store.enabledWebhooks()).toHaveLength(0);
  });
});

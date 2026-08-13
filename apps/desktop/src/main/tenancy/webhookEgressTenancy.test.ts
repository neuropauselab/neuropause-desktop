/**
 * External egress: the webhook boundary (P13C part 2).
 *
 * WHY THIS FILE IS DIFFERENT FROM EVERY OTHER TENANCY TEST.
 *
 * Every other boundary in Programs 11-13B is a READ FILTER. If one is wrong,
 * the data stayed on the device and the fix is retroactive — close the filter
 * and the exposure ends.
 *
 * A webhook POSTs a payload to a URL a user chose. If that is wrong, the data
 * has left the machine and no filter added later can recall it. So the
 * assertions here are not "the query returned nothing" but "the transport was
 * never invoked" — the dispatcher's `post` is a spy, and a leak is a call that
 * should not have happened.
 *
 * The producer used to iterate every enabled endpoint on the install against
 * the whole event firehose, and the payload builder strips `tenantId`, so the
 * receiving system could not even tell whose data it had been handed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { WebhookStore } from '../webhooks/webhookStore';
import { WebhookDispatcher } from '../webhooks/webhookDispatcher';
import { wireWebhookProducers } from '../webhooks/webhookProducer';
import { EventBus } from '../platform/eventBus';
import { resolveTenantScope, runAsPrincipal, systemPrincipal } from './backgroundPrincipal';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

const A_SECRET = 'NP-A-WEBHOOK-SECRET-9281';

describe('webhook external egress', () => {
  let dir: string;
  let store: WebhookStore;
  let bus: EventBus;
  let scope: TenantScope | null;
  /** The transport. Every call is an outbound HTTP request that really happened. */
  let post: ReturnType<typeof vi.fn>;
  let dispatcher: WebhookDispatcher;
  let aEndpointId: string;
  let bEndpointId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-webhook-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = new WebhookStore(join(dir, 'webhooks.json'));
    /**
     * Bound through the shared precedence, exactly as `runtimeCore` binds it to
     * `activeTenantScope` — so a background principal outranks the UI scope
     * here as it does in the app. Binding the raw variable instead would make
     * the dispatcher's per-delivery principal invisible to the store, and the
     * retry test would fail for a reason that does not exist in production.
     */
    store.bindScope(() => resolveTenantScope(() => scope));
    await store.load();

    post = vi.fn(async () => ({ ok: true, status: 200 }));
    dispatcher = new WebhookDispatcher({ store, post, now: () => Date.now() });

    bus = new EventBus();
    bus.bindTenant(() => resolveTenantScope(() => scope)?.tenantId ?? null);
    wireWebhookProducers({ store, subscribe: (h) => bus.subscribe(h), now: () => Date.now() });

    // Each tenant registers its own endpoint. Both subscribe to EVERYTHING —
    // the firehose subscription, which is what makes a leak maximally likely.
    scope = A;
    aEndpointId = store.create('A endpoint', 'https://a.example.com/hook', {
      categories: [],
      types: [],
    }).webhook.id;

    scope = B;
    bEndpointId = store.create('B endpoint', 'https://b.example.com/hook', {
      categories: [],
      types: [],
    }).webhook.id;
  });

  afterEach(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /* ── Phases 4-7: registration ownership ───────────────────────────────── */

  it('each tenant sees only its own endpoints', () => {
    scope = A;
    expect(store.list().map((w) => w.id)).toEqual([aEndpointId]);
    scope = B;
    expect(store.list().map((w) => w.id)).toEqual([bEndpointId]);
  });

  it('an endpoint id is a reference, not an authorization', () => {
    scope = B;
    expect(store.get(aEndpointId)).toBeNull();
    // The signing secret is the sharpest field: it lets its holder FORGE
    // deliveries the receiver will accept as genuine.
    expect(store.secretFor(aEndpointId)).toBeNull();
    expect(store.setEnabled(aEndpointId, false)).toBeNull();
    expect(store.delete(aEndpointId)).toBe(false);

    scope = A;
    expect(store.get(aEndpointId)).not.toBeNull(); // …and A still has it
  });

  it('the owner comes from the active scope, not from the payload', () => {
    scope = B;
    const created = store.create('forged', 'https://b2.example.com/h', { categories: [], types: [] });
    scope = A;
    expect(store.list().map((w) => w.id)).not.toContain(created.webhook.id);
  });

  it('unbound denies reads and refuses registration', () => {
    scope = null;
    expect(store.list()).toEqual([]);
    expect(store.stats()).toEqual({ total: 0, delivered: 0, failed: 0, pending: 0, dead: 0 });
    expect(() => store.create('x', 'https://x.example.com/h', { categories: [], types: [] })).toThrow(
      /no organization and workspace are active/i,
    );
  });

  /* ── Phase 12: the egress test that matters ───────────────────────────── */

  /**
   * THE HEADLINE. A tenant A event must not reach tenant B's URL.
   *
   * Asserted on the TRANSPORT, not the database: `post` is the function that
   * performs the HTTP request, so a call to B's URL is a leak that already
   * happened, regardless of what any store would report afterwards.
   */
  it('a tenant A event never reaches a tenant B endpoint', async () => {
    scope = A;
    bus.publish({
      type: 'enterprise.record.created',
      category: 'enterprise',
      source: 'test',
      resource: { kind: 'record', id: A_SECRET, name: `Confidential ${A_SECRET}` },
      metadata: { secret: A_SECRET },
    });

    await dispatcher.tick();

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] as [string, string];
    expect(url).toBe('https://a.example.com/hook');
    expect(body).toContain(A_SECRET);

    // Nothing was sent anywhere else, and B's URL was never contacted at all.
    const urls = post.mock.calls.map((c) => c[0] as string);
    expect(urls).not.toContain('https://b.example.com/hook');
    const everythingSent = JSON.stringify(post.mock.calls);
    expect(everythingSent).toContain(A_SECRET); // to A
    expect(everythingSent.split('https://b.example.com').length).toBe(1); // never to B
  });

  it('and the reverse: a tenant B event never reaches tenant A', async () => {
    scope = B;
    bus.publish({
      type: 'enterprise.record.created',
      category: 'enterprise',
      source: 'test',
      metadata: { marker: 'B-ONLY' },
    });

    await dispatcher.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('https://b.example.com/hook');
  });

  /**
   * A SYSTEM event has no tenant, so it has no endpoint to go to.
   *
   * Fail-closed on purpose. Delivering it to every endpoint would mean one
   * customer's registered URL receiving signals about an install they do not
   * own; delivering it to none costs a notification nobody had before.
   */
  it('a system event is delivered to no external endpoint', async () => {
    runAsPrincipal(systemPrincipal('health'), () => {
      bus.publish({ type: 'diagnostics.health_changed', category: 'diagnostics', source: 'monitor' });
    });

    await dispatcher.tick();
    expect(post).not.toHaveBeenCalled();
  });

  it('an event published with no tenant at all is delivered to nothing', async () => {
    scope = null;
    bus.publish({ type: 'system.ready', category: 'system', source: 'boot' });
    await dispatcher.tick();
    expect(post).not.toHaveBeenCalled();
  });

  /* ── Phase 14: retry keeps its tenant ─────────────────────────────────── */

  /**
   * A retry is a SECOND transmission, hours later, under whatever conditions
   * then hold. It must still belong to the tenant that queued it — the same
   * mistake the memory live-sync bridge made in 13A, on a pipe that leaves the
   * device.
   */
  it('a failed delivery retries under its own tenant, not whoever is active', async () => {
    post.mockImplementationOnce(async () => ({ ok: false, status: 500 }));

    scope = A;
    bus.publish({
      type: 'enterprise.record.created',
      category: 'enterprise',
      source: 'test',
      metadata: { secret: A_SECRET },
    });
    await dispatcher.tick(); // fails

    // The user switches to B, and signs out entirely for good measure.
    scope = null;

    // Force the retry to be due, then drain.
    const pending = (() => {
      scope = A;
      return store.deliveriesFor({ limit: 10 })[0];
    })();
    expect(pending?.attempts).toBe(1);
    scope = A;
    store.update({ ...pending!, nextAttemptAt: new Date(Date.now() - 1000).toISOString() });

    scope = null; // nobody signed in when the timer fires
    await dispatcher.tick();

    const sent = post.mock.calls.map((c) => c[0] as string);
    expect(sent).toEqual(['https://a.example.com/hook', 'https://a.example.com/hook']);
  });

  /* ── Phase 5/16: history and counters ─────────────────────────────────── */

  it('delivery history and stats do not span tenants', async () => {
    scope = A;
    bus.publish({ type: 'enterprise.record.created', category: 'enterprise', source: 't', metadata: { secret: A_SECRET } });
    await dispatcher.tick();

    scope = B;
    // `webhookId` is optional in the IPC contract — omitting it used to
    // enumerate every tenant's delivery history.
    expect(store.deliveriesFor({ limit: 100 })).toEqual([]);
    expect(store.stats().total).toBe(0);
    expect(store.deadLetters()).toEqual([]);

    scope = A;
    expect(store.deliveriesFor({ limit: 100 }).length).toBe(1);
    expect(store.stats().total).toBe(1);
  });

  it('replay cannot re-transmit another tenant’s stored payload', async () => {
    scope = A;
    bus.publish({ type: 'enterprise.record.created', category: 'enterprise', source: 't', metadata: { secret: A_SECRET } });
    await dispatcher.tick();
    const aDelivery = store.deliveriesFor({ limit: 10 })[0]!;

    scope = B;
    expect(store.replay(aDelivery.id, Date.now())).toBeNull();

    post.mockClear();
    await dispatcher.tick();
    expect(post).not.toHaveBeenCalled();
  });

  /* ── Phase 13: payload contents ───────────────────────────────────────── */

  it('a delivered payload carries only the owning tenant’s event', async () => {
    scope = B;
    bus.publish({ type: 'enterprise.record.created', category: 'enterprise', source: 't', metadata: { marker: 'B-DATA' } });
    scope = A;
    bus.publish({ type: 'enterprise.record.created', category: 'enterprise', source: 't', metadata: { secret: A_SECRET } });

    await dispatcher.tick();

    for (const [url, body] of post.mock.calls as Array<[string, string]>) {
      if (url.includes('a.example.com')) expect(body).not.toContain('B-DATA');
      if (url.includes('b.example.com')) expect(body).not.toContain(A_SECRET);
    }
  });
});

/** A tiny structural guard: the producer must not have a global fan-out again. */
describe('webhook producer shape', () => {
  it('selects endpoints by the event’s tenant, not by the whole registry', async () => {
    const src = await fs.readFile(
      new URL('../webhooks/webhookProducer.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('enabledWebhooksForTenant(event.tenantId)');
    // The unscoped accessor must not exist to be called by accident.
    expect(src).not.toContain('enabledWebhooks()');
  });
});

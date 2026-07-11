/**
 * Webhook store (P3.0, Increment 4) — endpoints + the delivery outbox, persisted.
 *
 * Holds registered endpoints (with their signing secret — needed to HMAC-sign every
 * outbound body) and the delivery outbox (each delivery keeps its payload so retries
 * + replay re-POST the exact body). The delivery log is capped; dead-lettered rows
 * are the DLQ. Electron-free (the file path is injected); the singleton lives in
 * webhookInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  PlatformEvent,
  Webhook,
  WebhookDelivery,
  WebhookDeliveryStats,
  WebhookEventPayload,
  WebhookSubscription,
  WebhookWithSecret,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { buildEventPayload, dueDeliveries, selectEvictions } from './delivery';
import { assertSafeWebhookUrl } from './urlGuard';

const log = createLogger('webhook-store');
const DELIVERY_CAP = 5000;

interface StoredWebhook extends Webhook {
  secret: string;
}
interface StoredDelivery extends WebhookDelivery {
  payload: WebhookEventPayload;
}
interface WebhookFile {
  webhooks: StoredWebhook[];
  deliveries: StoredDelivery[];
}

function stripWebhook(w: StoredWebhook): Webhook {
  const { secret: _secret, ...rest } = w;
  return rest;
}
function stripDelivery(d: StoredDelivery): WebhookDelivery {
  const { payload: _payload, ...rest } = d;
  return rest;
}

export class WebhookStore extends EventEmitter {
  private webhooks = new Map<string, StoredWebhook>();
  private deliveries = new Map<string, StoredDelivery>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<WebhookFile>;
      for (const w of data.webhooks ?? []) if (w?.id) this.webhooks.set(w.id, w);
      for (const d of data.deliveries ?? []) if (d?.id) this.deliveries.set(d.id, d);
    } catch {
      // first run
    }
    this.loaded = true;
    log.info('Webhook store ready', { webhooks: this.webhooks.size, deliveries: this.deliveries.size });
  }

  private async persist(): Promise<void> {
    const file: WebhookFile = { webhooks: [...this.webhooks.values()], deliveries: [...this.deliveries.values()] };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Webhook persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /* ── endpoints ── */

  create(label: string, url: string, subscription: WebhookSubscription): WebhookWithSecret {
    assertSafeWebhookUrl(url); // SSRF guard — only public HTTPS endpoints (P3.0, Increment 10).
    const id = `wh_${randomUUID()}`;
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const stored: StoredWebhook = {
      id,
      label,
      url,
      subscription,
      enabled: true,
      secretLast4: secret.slice(-4),
      createdAt: new Date().toISOString(),
      secret,
    };
    this.webhooks.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { webhook: stripWebhook(stored), secret };
  }

  list(): Webhook[] {
    return [...this.webhooks.values()].map(stripWebhook);
  }
  get(id: string): Webhook | null {
    const w = this.webhooks.get(id);
    return w ? stripWebhook(w) : null;
  }
  /** The signing secret for an endpoint (internal — used by the dispatcher only). */
  secretFor(id: string): string | null {
    return this.webhooks.get(id)?.secret ?? null;
  }
  enabledWebhooks(): Webhook[] {
    return [...this.webhooks.values()].filter((w) => w.enabled).map(stripWebhook);
  }
  setEnabled(id: string, enabled: boolean): Webhook | null {
    const w = this.webhooks.get(id);
    if (!w) return null;
    const next = { ...w, enabled };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return stripWebhook(next);
  }
  delete(id: string): boolean {
    const ok = this.webhooks.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /* ── delivery outbox ── */

  enqueue(webhookId: string, event: PlatformEvent, nowMs: number): WebhookDelivery {
    const id = `whd_${randomUUID()}`;
    const iso = new Date(nowMs).toISOString();
    const stored: StoredDelivery = {
      id,
      webhookId,
      eventId: event.id,
      eventType: event.type,
      status: 'pending',
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: iso,
      createdAt: iso,
      updatedAt: iso,
      payload: buildEventPayload(id, event, nowMs),
    };
    this.deliveries.set(id, stored);
    this.prune();
    this.schedulePersist();
    return stripDelivery(stored);
  }

  /** Due deliveries with their payload (dispatcher input). */
  due(nowMs: number): Array<{ delivery: WebhookDelivery; payload: WebhookEventPayload; webhookId: string }> {
    const all = [...this.deliveries.values()];
    return dueDeliveries(all, nowMs).map((d) => {
      const stored = this.deliveries.get(d.id)!;
      return { delivery: stripDelivery(stored), payload: stored.payload, webhookId: stored.webhookId };
    });
  }

  /** Persist an updated delivery (dispatcher output). */
  update(delivery: WebhookDelivery): void {
    const prev = this.deliveries.get(delivery.id);
    if (!prev) return;
    this.deliveries.set(delivery.id, { ...prev, ...delivery });
    this.schedulePersist();
    this.emit('changed');
  }

  deliveriesFor(query: { webhookId?: string; limit?: number } = {}): WebhookDelivery[] {
    let out = [...this.deliveries.values()];
    if (query.webhookId) out = out.filter((d) => d.webhookId === query.webhookId);
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return out.slice(0, query.limit ?? 200).map(stripDelivery);
  }

  deadLetters(): WebhookDelivery[] {
    return [...this.deliveries.values()].filter((d) => d.status === 'dead').map(stripDelivery);
  }

  /** Re-enqueue a fresh delivery for an existing delivery's event + endpoint. */
  replay(deliveryId: string, nowMs: number): WebhookDelivery | null {
    const prev = this.deliveries.get(deliveryId);
    if (!prev) return null;
    const id = `whd_${randomUUID()}`;
    const iso = new Date(nowMs).toISOString();
    const replayed: StoredDelivery = {
      ...prev,
      id,
      status: 'pending',
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: iso,
      createdAt: iso,
      updatedAt: iso,
      payload: { ...prev.payload, deliveryId: id, sentAt: iso },
    };
    this.deliveries.set(id, replayed);
    this.prune();
    this.schedulePersist();
    this.emit('changed');
    return stripDelivery(replayed);
  }

  stats(): WebhookDeliveryStats {
    let delivered = 0;
    let failed = 0;
    let pending = 0;
    let dead = 0;
    for (const d of this.deliveries.values()) {
      if (d.status === 'delivered') delivered += 1;
      else if (d.status === 'failed') failed += 1;
      else if (d.status === 'pending') pending += 1;
      else if (d.status === 'dead') dead += 1;
    }
    return { total: this.deliveries.size, delivered, failed, pending, dead };
  }

  /**
   * Hard-cap the outbox. Evicts terminal (delivered/dead) rows oldest-first, then —
   * if a stuck backlog of pending/failed rows is still over the cap — the oldest
   * non-terminal rows too, so the Map + persisted file can never grow without bound
   * (a black-holed endpoint used to pin every delivery non-terminal for ~6h).
   */
  private prune(): void {
    for (const id of selectEvictions([...this.deliveries.values()], DELIVERY_CAP)) {
      this.deliveries.delete(id);
    }
  }
}

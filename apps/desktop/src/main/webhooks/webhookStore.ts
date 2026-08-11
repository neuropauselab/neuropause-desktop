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
import type { TenantScope } from '@neuropause/shared';
import { ownershipOf, recordInScope } from '@neuropause/shared';
import { createLogger } from '../logger';
import { buildEventPayload, dueDeliveries, selectEvictions } from './delivery';
import { assertSafeWebhookUrl } from './urlGuard';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 10 — NEW-H2. The structural scope declaration. See tenancy/storeScope.ts.
 *
 * The file satisfied the gate through `registerTenantStore` alone, which asks
 * whether a boundary is bound and never asks what a REMOVAL reaches. Endpoints and
 * deliveries live in one file and are declared together because they are one
 * persistence unit with one owner field apiece.
 */
declareStoreScope({
  name: 'webhook-endpoints',
  scope: 'TENANT',
  persistence: 'file',
  // Every mutating channel (`webhook:create/setEnabled/delete/replay`) is gated on
  // `governance:manage`, an organization role, over rows that belong to that
  // organization. Scope and authority are on the same axis.
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention:
    'The delivery outbox is capped PER OWNER (DELIVERY_CAP_PER_OWNER rows for each (tenant, ' +
    'workspace) pair — the pair `recordInScope` enforces on `deliveriesFor`, `deadLetters`, `replay` ' +
    'and `stats`) as of Round 10; `prune()` runs from `enqueue` and `replay` and is then persisted. ' +
    'It was ONE install-wide `selectEvictions` over every tenant\'s rows, sorted terminal-first then ' +
    'oldest-first, so a busy tenant\'s traffic deleted a quiet tenant\'s deliveries — DEAD-LETTERED ' +
    'rows FIRST, because terminal sorts to the front. That is the replay and forensics surface, so ' +
    'the removal destroyed evidence rather than history: B holding 5 deliveries (2 dead) had 0 of ' +
    'both after A enqueued 5,100, with `stats` reading all zeros. Rows with no resolvable owner are ' +
    "retained in their own bucket, evictable by nobody else's traffic. Endpoints are NOT capped and " +
    'are removed only by `delete(id)`, which resolves through `visibleWebhook` first, so a caller ' +
    "holding another tenant's endpoint id deletes nothing.",
  reason:
    'A delivery row carries the event id, the event type and the full stored payload (resource + ' +
    'metadata), and an endpoint carries the URL a customer chose plus its HMAC signing secret — the ' +
    'one field whose disclosure lets another party FORGE deliveries the receiver accepts as genuine. ' +
    'TENANT rather than WORKSPACE because both endpoints and deliveries are stamped ' +
    '`workspaceId: null` and are meant to be reachable from any of the tenant\'s workspaces: an ' +
    'endpoint is an organization-level integration, and the dispatcher re-enters a delivery under a ' +
    'tenant-level principal hours after it was queued.',
});

const log = createLogger('webhook-store');
/**
 * Max retained deliveries PER OWNER. Per owner, not per install — see `prune`.
 *
 * Exported so the isolation suite floods a real cap rather than a number it
 * guessed: a test that hard-codes 5000 keeps passing if the constant moves.
 */
export const DELIVERY_CAP_PER_OWNER = 5000;

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

/**
 * The tenant boundary for webhooks (P13C part 2). A FUNCTION; `null` DENIES.
 */
export type WebhookScopeSource = () => TenantScope | null;

/** A process-wide fallback scope, for TESTS ONLY. Same seam and guard as the others. */
let ambientWebhookScope: WebhookScopeSource | null = null;

export function setAmbientWebhookScopeForTests(source: WebhookScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientWebhookScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientWebhookScope = source;
}

export class WebhookStore extends EventEmitter {
  private scopeSource: WebhookScopeSource | null = null;

  /** Bind the tenant boundary. Chainable. UNBOUND DENIES. */
  bindScope(source: WebhookScopeSource): this {
    this.scopeSource = source;
    return this;
  }

  /** Whether a boundary has been bound. For the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The active scope, or `null` meaning DENY. */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientWebhookScope;
    return source === null ? null : source();
  }

  /**
   * The scope a REGISTRATION needs. Throws rather than denying quietly — an
   * endpoint with no owner would receive nothing and belong to nobody, which
   * presents as a broken integration rather than as a boundary.
   */
  private requireScope(): TenantScope {
    const scope = this.scopeOrDeny();
    if (scope === null) {
      throw new Error(
        'Cannot register a webhook: no organization and workspace are active, so it would have no owner.',
      );
    }
    return scope;
  }

  /** An endpoint IF this caller may see it, else null. */
  private visibleWebhook(id: string): StoredWebhook | null {
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const w = this.webhooks.get(id);
    return w && recordInScope(w, scope) ? w : null;
  }

  /** Ownership counts across every endpoint. For the migration inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    let assigned = 0;
    let unresolved = 0;
    for (const w of this.webhooks.values()) {
      if (ownershipOf(w) === 'assigned') assigned += 1;
      else unresolved += 1;
    }
    return { total: this.webhooks.size, assigned, unresolved };
  }

  private webhooks = new Map<string, StoredWebhook>();
  private deliveries = new Map<string, StoredDelivery>();
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
    /**
     * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate. The seam
     * below predates the registry, so the gate could not see it: an unbound
     * instance denied every read (correct) and shipped silently (not correct).
     */
    registerTenantStore('webhook-endpoints', () => this.hasScope());
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
    // P13C — the owner comes from the active scope, never from the caller.
    const scope = this.requireScope();
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
      tenantId: scope.tenantId,
      workspaceId: null,
    };
    this.webhooks.set(id, stored);
    this.schedulePersist();
    this.emit('changed');
    return { webhook: stripWebhook(stored), secret };
  }

  list(): Webhook[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return [...this.webhooks.values()].filter((w) => recordInScope(w, scope)).map(stripWebhook);
  }
  /** One endpoint. An id is a reference, not an authorization. */
  get(id: string): Webhook | null {
    const w = this.visibleWebhook(id);
    return w ? stripWebhook(w) : null;
  }
  /**
   * The signing secret for an endpoint (internal — the dispatcher only).
   *
   * Scoped like everything else: a secret is the one field whose disclosure
   * lets another party FORGE deliveries that the receiver will accept as
   * genuine, so it must not be reachable across the boundary even internally.
   */
  secretFor(id: string): string | null {
    return this.visibleWebhook(id)?.secret ?? null;
  }
  /**
   * Enabled endpoints FOR ONE TENANT — the fan-out set.
   *
   * Takes the tenant explicitly rather than reading the ambient scope, because
   * its only caller is the producer, which is answering "who should receive
   * THIS EVENT?" — a question about the event's owner, not about whoever is
   * looking at the app. Passing it in makes that impossible to get wrong.
   *
   * A null/empty tenant returns nothing: a system event, or an event published
   * before the tenant resolved, is delivered to no external endpoint at all.
   */
  enabledWebhooksForTenant(tenantId: string | null | undefined): Webhook[] {
    if (!tenantId) return [];
    return [...this.webhooks.values()]
      .filter((w) => w.enabled && ownershipOf(w) === 'assigned' && w.tenantId === tenantId)
      .map(stripWebhook);
  }
  setEnabled(id: string, enabled: boolean): Webhook | null {
    const w = this.visibleWebhook(id);
    if (!w) return null;
    const next = { ...w, enabled };
    this.webhooks.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return stripWebhook(next);
  }
  delete(id: string): boolean {
    // Resolved through the boundary first: a caller holding another tenant's
    // endpoint id deletes nothing and is told nothing.
    if (!this.visibleWebhook(id)) return false;
    const ok = this.webhooks.delete(id);
    if (ok) {
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  /* ── delivery outbox ── */

  enqueue(webhookId: string, event: PlatformEvent, nowMs: number): WebhookDelivery {
    const owner = this.webhooks.get(webhookId);
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
      /**
       * The delivery inherits the ENDPOINT's tenant, which the producer has
       * already proved equals the event's. Stored on the row so a retry six
       * hours later, or a manual replay next week, still knows whose it is
       * without asking who is signed in.
       */
      tenantId: owner?.tenantId ?? null,
      workspaceId: null,
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
    /**
     * `webhookId` is OPTIONAL in the IPC contract, so omitting it used to
     * enumerate every tenant's delivery history — event ids and types included.
     */
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    let out = [...this.deliveries.values()].filter((d) => recordInScope(d, scope));
    if (query.webhookId) out = out.filter((d) => d.webhookId === query.webhookId);
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return out.slice(0, query.limit ?? 200).map(stripDelivery);
  }

  deadLetters(): WebhookDelivery[] {
    const scope = this.scopeOrDeny();
    if (scope === null) return [];
    return [...this.deliveries.values()]
      .filter((d) => d.status === 'dead' && recordInScope(d, scope))
      .map(stripDelivery);
  }

  /** Re-enqueue a fresh delivery for an existing delivery's event + endpoint. */
  replay(deliveryId: string, nowMs: number): WebhookDelivery | null {
    /**
     * Replay re-POSTs a stored payload to a stored endpoint. Unscoped, it was
     * the sharpest tool in the surface: hand it another tenant's delivery id
     * and the app re-transmits that tenant's event body on demand.
     */
    const scope = this.scopeOrDeny();
    if (scope === null) return null;
    const prev = this.deliveries.get(deliveryId);
    if (!prev || !recordInScope(prev, scope)) return null;
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

  /**
   * Delivery counters for THIS CALLER only.
   *
   * Broadcast to every renderer on each change, so a global version was a live
   * readout of another tenant's integration volume and failure rate.
   */
  stats(): WebhookDeliveryStats {
    let delivered = 0;
    let failed = 0;
    let pending = 0;
    let dead = 0;
    const scope = this.scopeOrDeny();
    if (scope === null) return { total: 0, delivered: 0, failed: 0, pending: 0, dead: 0 };
    for (const d of this.deliveries.values()) {
      if (!recordInScope(d, scope)) continue;
      if (d.status === 'delivered') delivered += 1;
      else if (d.status === 'failed') failed += 1;
      else if (d.status === 'pending') pending += 1;
      else if (d.status === 'dead') dead += 1;
    }
    // `total` is the sum of what this caller can see, not `this.deliveries.size`
    // — a global size contradicts the histogram beside it and discloses another
    // tenant's integration volume.
    return { total: delivered + failed + pending + dead, delivered, failed, pending, dead };
  }

  /**
   * Hard-cap the outbox PER OWNER. P13C ROUND 10 — NEW-H2.
   *
   * Within one owner: terminal (delivered/dead) rows oldest-first, then — if a
   * stuck backlog of pending/failed rows is still over the cap — that owner's
   * oldest non-terminal rows too, so no single tenant's slice of the Map or of
   * the persisted file can grow without bound (a black-holed endpoint used to
   * pin every delivery non-terminal for ~6h).
   *
   * The cap argument used to be install-wide, and `selectEvictions` sorted every
   * tenant's rows into ONE order. Terminal-first then meant another tenant's
   * dead-lettered rows were evicted before the flooding tenant's own pending
   * ones — the DLQ is what `deadLetters()` and `replay()` read, so the loss was
   * of evidence and of the ability to re-send, not merely of history. Called
   * from `enqueue` and `replay`, and the result is persisted, so the deletion
   * reached disk.
   */
  private prune(): void {
    for (const id of selectEvictions([...this.deliveries.values()], DELIVERY_CAP_PER_OWNER)) {
      this.deliveries.delete(id);
    }
  }
}

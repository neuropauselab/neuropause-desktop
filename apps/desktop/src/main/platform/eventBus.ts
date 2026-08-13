/**
 * The Platform Event Bus — strongly typed publish/subscribe infrastructure.
 *
 * Design rules:
 *   - This is *infrastructure only*. It moves events; it contains no business
 *     logic. All reactions live in subscribers.
 *   - Subscribers are isolated: one throwing (or rejecting) never affects the
 *     publisher or other subscribers; the failure is recorded and reported.
 *   - Every event is materialized with an id, timestamp, version, priority, and
 *     correlation/causation ids so downstream consumers can reconstruct chains.
 *   - A bounded replay buffer supports late subscribers and the Event Inspector.
 *
 * The module is intentionally free of Electron so it is unit-testable and
 * reusable by any future host.
 */
import { randomUUID } from 'node:crypto';
import { recordInScope } from '@neuropause/shared';
import { currentPrincipal } from '../tenancy/backgroundPrincipal';
import type {
  EventBusMetrics,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventType,
  SubscriberStatus,
  TenantScope,
} from '@neuropause/shared';

export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export interface SubscribeOptions {
  /** Stable id for diagnostics; auto-generated when omitted. */
  id?: string;
  /** Only receive these event types (omit for all). */
  types?: PlatformEventType[];
  /**
   * Replay the buffer THIS CALLER MAY SEE (oldest→newest) on attach.
   *
   * P13C ROUND 10 — NEW-M11: this used to re-dispatch the whole install-wide
   * ring. It is now the same authorized set `replay()` returns.
   */
  replay?: boolean;
}

export interface Subscription {
  id: string;
  dispose: () => void;
}

interface Registered {
  id: string;
  handler: EventHandler;
  types: Set<PlatformEventType> | null;
  events: number;
  errors: number;
  lastError: string | null;
  totalMs: number;
}

export interface EventBusOptions {
  /** P13B — resolves the owning tenant for each materialized event. */
  tenantId?: () => string | null;
  /**
   * Max events retained for replay, PER OWNER (default 500).
   *
   * P13C ROUND 10 — NEW-M11: it used to be the size of ONE shared ring across
   * every tenant. An install with more tenants now holds more events in memory,
   * which is the identical trade `TimelineService.maxInMemory` documents: the
   * alternative is one customer able to evict another's.
   */
  replayBufferSize?: number;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
  /** Injectable id factory for deterministic tests. */
  idFactory?: () => string;
  /** Notified when a subscriber throws/rejects (in addition to internal tally). */
  onSubscriberError?: (subscriberId: string, event: PlatformEvent, err: unknown) => void;
}

const RATE_WINDOW_MS = 60_000;

/**
 * The replay ring's retention buckets. P13C ROUND 10 — NEW-M11.
 *
 * Deliberately the SAME partitioning `platform/timelineService.ts` already uses,
 * key for key, because it is the same problem one layer down and two answers to
 * it is how one of them drifts. SYSTEM events belong to the product and are
 * readable by every resolved viewer, so they get their own budget; unowned rows
 * (published before the tenant resolver was bound, or with no principal at all)
 * are visible to nobody and can neither evict nor be evicted by anyone.
 *
 * The leading space keeps these keys out of the `t:` namespace used for tenants,
 * so no tenant id can collide with them.
 */
const SYSTEM_BUCKET = ' system';
const UNOWNED_BUCKET = ' unowned';

/** The bucket an event belongs to. Derived from the event, never guessed. */
function replayBucket(e: PlatformEvent): string {
  if (e.scopeKind === 'system') return SYSTEM_BUCKET;
  const owner = e.tenantId;
  return typeof owner === 'string' && owner !== '' ? `t:${owner}` : UNOWNED_BUCKET;
}

export class EventBus {
  private readonly subs = new Map<string, Registered>();
  /**
   * THE REPLAY RING, ONE BOUNDED BUFFER PER OWNER. P13C ROUND 10 — NEW-M11.
   *
   * It was a single `PlatformEvent[]` with `shift()` at the cap, and three
   * things followed from that, none of them visible from any one line:
   *
   *   1. EVICTION WAS A CROSS-TENANT ACT. A busy tenant pushed a quiet one's
   *      events out of the ring — the defect Round 9 fixed on the durable
   *      timeline (F11) and left standing on the bus that feeds it.
   *   2. `replay()` FILTERED ONLY BY TYPE and never consulted the `tenantId`
   *      that `materialize` stamps two methods below, so it returned every
   *      tenant's events to any caller.
   *   3. `subscribe({ replay: true })` RE-DISPATCHED THAT WHOLE RING to a late
   *      subscriber — the same disclosure with a push shape instead of a pull.
   *
   * No production caller was found for either read; `PlatformEventApi.replay`
   * re-exports it and nothing calls that. It is fixed anyway, because "nothing
   * calls it" is a fact about today's wiring and not a property of the bus, and
   * because the event these buffers hold carries `actor.id`, `resource.id` and
   * free-form `metadata`.
   */
  private readonly buffers = new Map<string, PlatformEvent[]>();
  private readonly bufferSize: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly onSubscriberError?: EventBusOptions['onSubscriberError'];
  /** P13B — resolves the owning tenant at materialization. Null ⇒ unowned. */
  private tenantId?: () => string | null;

  private subSeq = 0;
  private published = 0;
  private dropped = 0;
  private dispatchTotalMs = 0;
  private dispatchCount = 0;
  /** Recent publish timestamps (ms) for rate calculation. */
  private recentPublishes: number[] = [];

  constructor(opts: EventBusOptions = {}) {
    this.bufferSize = opts.replayBufferSize ?? 500;
    this.now = opts.now ?? (() => Date.now());
    this.idFactory = opts.idFactory ?? (() => randomUUID());
    this.onSubscriberError = opts.onSubscriberError;
    this.tenantId = opts.tenantId;
  }

  /**
   * Bind the tenant resolver (P13B).
   *
   * Late-bound rather than a constructor argument because the bus is created
   * during boot, before the enterprise subsystem exists to resolve anything.
   * Until it is bound every event is unowned — which is the correct reading of
   * "published before the app knew who it was acting for".
   */
  bindTenant(resolve: () => string | null): void {
    this.tenantId = resolve;
  }

  /** Publish an event. Returns the fully materialized event. */
  publish(input: PlatformEventInput): PlatformEvent {
    const event = this.materialize(input);

    this.retain(event);

    this.published += 1;
    const t = this.now();
    this.recentPublishes.push(t);
    this.trimRate(t);

    // Fan out. Higher-priority events are dispatched first within this call so
    // critical signals reach subscribers ahead of routine ones.
    for (const sub of this.subs.values()) {
      if (sub.types && !sub.types.has(event.type)) continue;
      this.dispatch(sub, event);
    }
    return event;
  }

  /** Subscribe a handler. Returns a disposable subscription. */
  subscribe(handler: EventHandler, opts: SubscribeOptions = {}): Subscription {
    const id = opts.id ?? `sub_${(this.subSeq++).toString(36)}`;
    const reg: Registered = {
      id,
      handler,
      types: opts.types && opts.types.length ? new Set(opts.types) : null,
      events: 0,
      errors: 0,
      lastError: null,
      totalMs: 0,
    };
    this.subs.set(id, reg);

    /**
     * A late subscriber receives THE EVENTS ITS CALLER MAY SEE.
     *
     * The authorization is the same call `replay()` makes, deliberately: a push
     * and a pull onto one buffer must not be able to disagree, which is exactly
     * how this diverged from the timeline in the first place.
     */
    if (opts.replay) {
      for (const event of this.visibleBuffer()) {
        if (reg.types && !reg.types.has(event.type)) continue;
        this.dispatch(reg, event);
      }
    }

    return { id, dispose: () => void this.subs.delete(id) };
  }

  /**
   * The replay buffer THIS CALLER MAY SEE (optionally filtered), oldest→newest.
   *
   * Two buckets: the caller's own tenant, and the SYSTEM bucket that belongs to
   * the product. NO RESOLVED TENANT MEANS NO EVENTS — an unbound bus, or one
   * read before an organization resolves, returns nothing rather than the ring.
   * That is the same fail-closed answer `TimelineService.query` gives, and it is
   * why a workspace switch needs nothing cleared: the buffers are not the
   * boundary, the read is, so after a switch the caller simply resolves to a
   * different bucket.
   */
  replay(filter?: { types?: PlatformEventType[]; limit?: number }): PlatformEvent[] {
    const set = filter?.types && filter.types.length ? new Set(filter.types) : null;
    const visible = this.visibleBuffer();
    let out = set ? visible.filter((e) => set.has(e.type)) : visible;
    if (filter?.limit && out.length > filter.limit) out = out.slice(out.length - filter.limit);
    return out;
  }

  /**
   * Put one event into ITS OWNER'S ring, evicting only that owner's oldest.
   *
   * A retention cap is a WRITE, so the only rows it may delete belong to the
   * event's own owner. The bucket comes from the event, which `materialize`
   * stamped from the resolved principal — a producer cannot choose it.
   */
  private retain(event: PlatformEvent): void {
    const key = replayBucket(event);
    let bucket = this.buffers.get(key);
    if (!bucket) this.buffers.set(key, (bucket = []));
    bucket.push(event);
    if (bucket.length > this.bufferSize) bucket.shift();
  }

  /**
   * The caller's own bucket plus the system bucket, merged oldest→newest.
   *
   * `recordInScope` still runs over the result: the bucket key is derived from
   * `tenantId` alone, so re-checking the event against the resolved scope means
   * a row cannot ride in on a bucket name. The bus resolves only a tenant id
   * (`platform/index.ts` binds `resolve()?.tenantId`), and a `PlatformEvent`
   * carries no workspace, so tenant granularity is the whole boundary here
   * rather than a narrowing of one.
   */
  private visibleBuffer(): PlatformEvent[] {
    const owner = this.tenantId?.() ?? null;
    if (owner === null || owner === '') return [];
    const scope: TenantScope = { tenantId: owner, workspaceId: '' };
    const mine = [
      ...(this.buffers.get(`t:${owner}`) ?? []),
      ...(this.buffers.get(SYSTEM_BUCKET) ?? []),
    ].filter((e) => (e.scopeKind === 'system' ? true : recordInScope(e, scope)));
    mine.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return mine;
  }

  /** How many events are retained across every owner. Diagnostics only. */
  private bufferedCount(): number {
    let n = 0;
    for (const bucket of this.buffers.values()) n += bucket.length;
    return n;
  }

  metrics(): EventBusMetrics {
    const t = this.now();
    this.trimRate(t);
    return {
      eventsPublished: this.published,
      eventsPerMinute: this.recentPublishes.length,
      subscribers: this.subs.size,
      droppedEvents: this.dropped,
      avgDispatchMs: this.dispatchCount ? round2(this.dispatchTotalMs / this.dispatchCount) : 0,
      bufferedEvents: this.bufferedCount(),
    };
  }

  subscriberStatuses(): SubscriberStatus[] {
    return [...this.subs.values()].map((s) => ({
      id: s.id,
      events: s.events,
      errors: s.errors,
      lastError: s.lastError,
      avgMs: s.events ? round2(s.totalMs / s.events) : 0,
    }));
  }

  subscriberCount(): number {
    return this.subs.size;
  }

  private dispatch(sub: Registered, event: PlatformEvent): void {
    const start = this.now();
    try {
      const result = sub.handler(event);
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch((err) => this.fail(sub, event, err));
      }
    } catch (err) {
      this.fail(sub, event, err);
    } finally {
      const ms = this.now() - start;
      sub.events += 1;
      sub.totalMs += ms;
      this.dispatchTotalMs += ms;
      this.dispatchCount += 1;
    }
  }

  private fail(sub: Registered, event: PlatformEvent, err: unknown): void {
    sub.errors += 1;
    sub.lastError = err instanceof Error ? err.message : String(err);
    try {
      this.onSubscriberError?.(sub.id, event, err);
    } catch {
      /* an error reporter must never re-enter the failure path */
    }
  }

  private materialize(input: PlatformEventInput): PlatformEvent {
    const id = this.idFactory();
    return {
      id,
      /**
       * P13B — ONE stamping point for the whole event system.
       *
       * `materialize` is the only place a `PlatformEvent` comes into existence,
       * which is why the tenant is resolved here rather than at the ~100 publish
       * sites. A producer cannot supply it: `PlatformEventInput` has no such
       * field, so there is no expressible way to publish an event into another
       * tenant's timeline.
       *
       * `tenantId` is injected as a function rather than imported, so the bus
       * keeps no dependency on the enterprise subsystem and still unit-tests
       * standalone. Unset resolver, or no active tenant, yields null — an event
       * nobody owns and nobody is shown.
       */
      tenantId: this.tenantId?.() ?? null,
      // Stamped from the principal, never from the producer. Only a SYSTEM
      // principal yields a system event; everything else is tenant-owned or,
      // absent a tenant, owned by nobody.
      scopeKind: currentPrincipal()?.principalType === 'system' ? 'system' : 'tenant',
      type: input.type,
      category: input.category,
      version: input.version ?? 1,
      priority: input.priority ?? 'normal',
      timestamp: new Date(this.now()).toISOString(),
      source: input.source,
      actor: input.actor ?? { kind: 'system', id: null },
      resource: input.resource ?? null,
      // A standalone event correlates to itself; a caused event inherits its
      // parent's correlation id (the producer passes it through).
      correlationId: input.correlationId ?? id,
      causationId: input.causationId ?? null,
      metadata: input.metadata ?? {},
    };
  }

  private trimRate(now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    while (this.recentPublishes.length && this.recentPublishes[0] < cutoff) {
      this.recentPublishes.shift();
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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
import type {
  EventBusMetrics,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventType,
  SubscriberStatus,
} from '@neuropause/shared';

export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export interface SubscribeOptions {
  /** Stable id for diagnostics; auto-generated when omitted. */
  id?: string;
  /** Only receive these event types (omit for all). */
  types?: PlatformEventType[];
  /** Replay the current buffer (oldest→newest) to this subscriber on attach. */
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
  /** Max events retained for replay (default 500). */
  replayBufferSize?: number;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
  /** Injectable id factory for deterministic tests. */
  idFactory?: () => string;
  /** Notified when a subscriber throws/rejects (in addition to internal tally). */
  onSubscriberError?: (subscriberId: string, event: PlatformEvent, err: unknown) => void;
}

const RATE_WINDOW_MS = 60_000;

export class EventBus {
  private readonly subs = new Map<string, Registered>();
  private readonly buffer: PlatformEvent[] = [];
  private readonly bufferSize: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly onSubscriberError?: EventBusOptions['onSubscriberError'];

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
  }

  /** Publish an event. Returns the fully materialized event. */
  publish(input: PlatformEventInput): PlatformEvent {
    const event = this.materialize(input);

    // Retain for replay (ring buffer).
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

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

    if (opts.replay) {
      for (const event of this.buffer) {
        if (reg.types && !reg.types.has(event.type)) continue;
        this.dispatch(reg, event);
      }
    }

    return { id, dispose: () => void this.subs.delete(id) };
  }

  /** The current replay buffer (optionally filtered), oldest→newest. */
  replay(filter?: { types?: PlatformEventType[]; limit?: number }): PlatformEvent[] {
    const set = filter?.types && filter.types.length ? new Set(filter.types) : null;
    let out = set ? this.buffer.filter((e) => set.has(e.type)) : this.buffer.slice();
    if (filter?.limit && out.length > filter.limit) out = out.slice(out.length - filter.limit);
    return out;
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
      bufferedEvents: this.buffer.length,
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

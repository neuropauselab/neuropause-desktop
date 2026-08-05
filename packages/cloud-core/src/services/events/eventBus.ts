/**
 * Enterprise Event Bus (NCEA 10.2) — REAL, in-memory.
 *
 * Provides: typed events, type/topic routing, a durable append log (interface),
 * per-publish global ordering (monotonic `seq`), at-least-once delivery with
 * bounded retry, a dead-letter queue, replay from a sequence, and versioning
 * (see ./versioning). Delivery is awaited in publish order, so a single bus
 * gives deterministic ordering — production scale-out needs a partitioned log
 * (noted in STATUS.md); the interface here is designed for that swap.
 */
import type { EventId } from '@neuropause/shared-cloud';
import type { Clock } from '../../lib/clock';
import type { Logger } from '../../lib/logger';
import { contentId } from '../../lib/ids';

export interface CloudEvent<T = unknown> {
  id: EventId;
  type: string; // e.g. 'device.enrolled'
  topic: string; // e.g. 'devices'
  partitionKey: string; // ordering key, e.g. a userId
  version: number; // payload schema version
  seq: number; // global monotonic sequence assigned at publish
  occurredAt: number;
  payload: T;
}

export interface EventInput<T = unknown> {
  type: string;
  topic: string;
  partitionKey: string;
  version: number;
  payload: T;
  occurredAt?: number;
}

export interface EventStore {
  append(event: CloudEvent): void;
  read(fromSeq: number): CloudEvent[];
  size(): number;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: CloudEvent[] = [];
  append(event: CloudEvent): void {
    this.events.push(event);
  }
  read(fromSeq: number): CloudEvent[] {
    return this.events.filter((e) => e.seq >= fromSeq);
  }
  size(): number {
    return this.events.length;
  }
}

export interface DeadLetter {
  event: CloudEvent;
  attempts: number;
  lastError: string;
}

export type EventHandler = (event: CloudEvent) => void | Promise<void>;

interface Subscription {
  id: string;
  match: (event: CloudEvent) => boolean;
  handler: EventHandler;
}

export interface EventBusOptions {
  maxAttempts?: number;
}

/** Pattern semantics: '*' = all; 'device.*' = prefix; else exact type match. */
export function matchPattern(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export class EventBus {
  private seq = 0;
  private subCounter = 0;
  private readonly subs: Subscription[] = [];
  private readonly dlq: DeadLetter[] = [];
  private readonly maxAttempts: number;

  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
    private readonly logger?: Logger,
    options: EventBusOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  /** Subscribe by pattern or predicate. Returns an unsubscribe function. */
  subscribe(pattern: string | ((event: CloudEvent) => boolean), handler: EventHandler): () => void {
    const id = `sub_${++this.subCounter}`;
    const match =
      typeof pattern === 'function' ? pattern : (event: CloudEvent) => matchPattern(pattern, event.type);
    this.subs.push({ id, match, handler });
    return () => {
      const i = this.subs.findIndex((s) => s.id === id);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }

  async publish<T>(input: EventInput<T>): Promise<CloudEvent<T>> {
    const seq = ++this.seq;
    const occurredAt = input.occurredAt ?? this.clock.now();
    const event: CloudEvent<T> = {
      id: contentId('evt', input.type, input.partitionKey, seq) as EventId,
      type: input.type,
      topic: input.topic,
      partitionKey: input.partitionKey,
      version: input.version,
      seq,
      occurredAt,
      payload: input.payload,
    };
    this.store.append(event as CloudEvent);
    await this.deliver(event as CloudEvent);
    return event;
  }

  private async deliver(event: CloudEvent): Promise<void> {
    for (const sub of this.subs) {
      if (!sub.match(event)) continue;
      await this.deliverToSub(sub, event);
    }
  }

  private async deliverToSub(sub: Subscription, event: CloudEvent): Promise<void> {
    let lastError = '';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await sub.handler(event);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    this.dlq.push({ event, attempts: this.maxAttempts, lastError });
    this.logger?.warn('event.dead_lettered', {
      eventId: event.id,
      type: event.type,
      sub: sub.id,
      attempts: this.maxAttempts,
    });
  }

  /** Re-deliver persisted events (seq >= fromSeq) to a handler. */
  async replay(fromSeq: number, handler: EventHandler): Promise<number> {
    const events = this.store.read(fromSeq);
    for (const event of events) {
      await handler(event);
    }
    return events.length;
  }

  deadLetters(): DeadLetter[] {
    return [...this.dlq];
  }

  stats(): { published: number; subscriptions: number; deadLettered: number } {
    return { published: this.store.size(), subscriptions: this.subs.length, deadLettered: this.dlq.length };
  }
}

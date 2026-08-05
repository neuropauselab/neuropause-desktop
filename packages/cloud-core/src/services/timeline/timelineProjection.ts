/**
 * Timeline (NCEA 10.2) — REAL, event-sourced.
 * The timeline is a PROJECTION built by subscribing to the Event Bus; it holds
 * no authoritative state of its own, it derives from events (event sourcing).
 * A durable projection store is the follow-up (STATUS.md).
 */
import type { CloudEvent, EventBus } from '../events/eventBus';

export interface TimelineEntry {
  seq: number;
  at: number;
  type: string;
  partitionKey: string;
}

export class TimelineProjection {
  private readonly entries: TimelineEntry[] = [];

  apply(event: CloudEvent): void {
    this.entries.push({
      seq: event.seq,
      at: event.occurredAt,
      type: event.type,
      partitionKey: event.partitionKey,
    });
  }

  /** Subscribe to all events; returns an unsubscribe fn. */
  attach(bus: EventBus): () => void {
    return bus.subscribe('*', (event) => this.apply(event));
  }

  forPartition(partitionKey: string): TimelineEntry[] {
    return this.entries.filter((e) => e.partitionKey === partitionKey).sort((a, b) => a.seq - b.seq);
  }

  all(): TimelineEntry[] {
    return [...this.entries];
  }
}

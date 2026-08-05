/**
 * Platform event publishing adapter (NCEA 10.2B).
 *
 * Lets backend services publish DOMAIN events onto the shared cloud-core Event
 * Bus without owning any event infrastructure (one event bus, one model — the
 * backend has none of its own). The publisher is an INTERFACE, so services take
 * it optionally and default to a no-op: existing behavior is unchanged when no
 * bus is wired, which keeps this fully backward-compatible.
 */
import { EventBus, InMemoryEventStore, systemClock } from '@neuropause/cloud-core';

export interface DomainEvent {
  type: string;
  topic: string;
  partitionKey: string;
  version: number;
  payload: unknown;
}

export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

/** No-op publisher — the safe default when no bus is configured. */
export const noopPublisher: DomainEventPublisher = {
  async publish(): Promise<void> {
    /* intentionally empty */
  },
};

/** Wrap a cloud-core EventBus as a backend domain-event publisher. */
export function busPublisher(bus: EventBus): DomainEventPublisher {
  return {
    async publish(event: DomainEvent): Promise<void> {
      await bus.publish(event);
    },
  };
}

/** A ready in-memory platform bus for a single-process deployment. */
export function createPlatformBus(): EventBus {
  return new EventBus(new InMemoryEventStore(), systemClock);
}

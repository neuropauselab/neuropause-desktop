/**
 * Event runtime (NCEA 10.2C, Phase 3). Composes the SINGLE cloud-core Event Bus
 * and an event-category registry (domain / platform / timeline / notification /
 * audit / health / lifecycle). One bus, one model, one replay pipeline, one DLQ.
 */
import {
  EventBus,
  InMemoryEventStore,
  type Clock,
  type Logger,
  type EventInput,
  type CloudEvent,
  type DeadLetter,
  type EventHandler,
} from '@neuropause/cloud-core';

export const EVENT_CATEGORIES = [
  'domain',
  'platform',
  'timeline',
  'notification',
  'audit',
  'health',
  'lifecycle',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface EventRuntime {
  publish(input: EventInput): Promise<CloudEvent>;
  subscribe(pattern: string | ((e: CloudEvent) => boolean), handler: EventHandler): () => void;
  replay(fromSeq: number, handler: EventHandler): Promise<number>;
  deadLetters(): DeadLetter[];
  categories(): EventCategory[];
  registerCategory(category: EventCategory): void;
  bus(): EventBus;
}

export function createEventRuntime(clock: Clock, logger?: Logger): EventRuntime {
  const bus = new EventBus(new InMemoryEventStore(), clock, logger);
  const categories = new Set<EventCategory>(EVENT_CATEGORIES);
  return {
    publish: (input) => bus.publish(input),
    subscribe: (pattern, handler) => bus.subscribe(pattern, handler),
    replay: (fromSeq, handler) => bus.replay(fromSeq, handler),
    deadLetters: () => bus.deadLetters(),
    categories: () => [...categories],
    registerCategory: (category) => {
      categories.add(category);
    },
    bus: () => bus,
  };
}

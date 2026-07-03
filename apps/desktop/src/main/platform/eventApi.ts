/**
 * The Public Event API — the stable internal interface every other module
 * (and, in Phase 4, the Connector Framework) uses to participate in the
 * platform. Consumers depend on *this*, never on the bus/timeline internals,
 * so the implementation can evolve without breaking integrations.
 */
import type {
  PlatformEvent,
  PlatformEventInput,
  PlatformEventType,
  TimelineQuery,
  TimelinePage,
  TimelineStats,
} from '@neuropause/shared';
import type { EventBus, EventHandler, Subscription, SubscribeOptions } from './eventBus';
import type { TimelineService } from './timelineService';

export class PlatformEventApi {
  constructor(
    private readonly bus: EventBus,
    private readonly timeline: TimelineService,
  ) {
    // These methods are routinely passed by reference into other subsystems
    // (e.g. `publish: platform.api.publish`). Bind them so a torn-off reference
    // keeps its `this` and never reads `bus`/`timeline` off an undefined receiver.
    this.publish = this.publish.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.on = this.on.bind(this);
    this.replay = this.replay.bind(this);
    this.query = this.query.bind(this);
    this.stats = this.stats.bind(this);
  }

  /** Publish a typed event. Returns the materialized event (with id/timestamp). */
  publish(input: PlatformEventInput): PlatformEvent {
    return this.bus.publish(input);
  }

  /** Subscribe to events, optionally filtered by type. */
  subscribe(handler: EventHandler, opts?: SubscribeOptions): Subscription {
    return this.bus.subscribe(handler, opts);
  }

  /** Convenience: subscribe to a specific set of event types. */
  on(types: PlatformEventType[], handler: EventHandler): Subscription {
    return this.bus.subscribe(handler, { types });
  }

  /** The live in-memory replay buffer (for late subscribers / the Inspector). */
  replay(filter?: { types?: PlatformEventType[]; limit?: number }): PlatformEvent[] {
    return this.bus.replay(filter);
  }

  /** Query the durable Timeline. */
  query(q: TimelineQuery): TimelinePage {
    return this.timeline.query(q);
  }

  stats(): TimelineStats {
    return this.timeline.stats();
  }
}

export type PlatformApi = PlatformEventApi;

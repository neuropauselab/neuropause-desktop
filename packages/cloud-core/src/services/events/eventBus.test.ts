import { describe, it, expect } from 'vitest';
import { ManualClock } from '../../lib/clock';
import { MemorySink, Logger } from '../../lib/logger';
import {
  EventBus,
  InMemoryEventStore,
  matchPattern,
  type CloudEvent,
} from './eventBus';
import { EventUpcasterRegistry } from './versioning';

function bus(maxAttempts = 3): { bus: EventBus; store: InMemoryEventStore; sink: MemorySink } {
  const store = new InMemoryEventStore();
  const sink = new MemorySink();
  const logger = new Logger(sink, new ManualClock(0));
  return { bus: new EventBus(store, new ManualClock(1000), logger, { maxAttempts }), store, sink };
}

function evt(type: string, partitionKey = 'usr_1', payload: unknown = {}) {
  return { type, topic: type.split('.')[0], partitionKey, version: 1, payload };
}

describe('matchPattern', () => {
  it('supports wildcard, prefix, and exact', () => {
    expect(matchPattern('*', 'device.enrolled')).toBe(true);
    expect(matchPattern('device.*', 'device.enrolled')).toBe(true);
    expect(matchPattern('device.*', 'sync.pushed')).toBe(false);
    expect(matchPattern('sync.pushed', 'sync.pushed')).toBe(true);
    expect(matchPattern('sync.pushed', 'sync.pulled')).toBe(false);
  });
});

describe('EventBus routing + ordering', () => {
  it('routes to matching subscribers and assigns monotonic seq/occurredAt', async () => {
    const { bus } = bus0();
    const devices: string[] = [];
    const all: number[] = [];
    bus.subscribe('device.*', (e) => void devices.push(e.type));
    bus.subscribe('*', (e) => void all.push(e.seq));

    const a = await bus.publish(evt('device.enrolled'));
    await bus.publish(evt('sync.pushed'));
    const c = await bus.publish(evt('device.revoked'));

    expect(devices).toEqual(['device.enrolled', 'device.revoked']);
    expect(all).toEqual([1, 2, 3]);
    expect(a.seq).toBe(1);
    expect(c.seq).toBe(3);
    expect(a.occurredAt).toBe(1000);
    expect(a.id.startsWith('evt_')).toBe(true);
  });

  it('delivers same-partition events in publish order', async () => {
    const { bus } = bus0();
    const order: number[] = [];
    bus.subscribe('*', (e) => void order.push(e.seq));
    for (let i = 0; i < 5; i++) await bus.publish(evt('t.x', 'usr_same'));
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('EventBus retry + dead-letter', () => {
  it('retries then succeeds without dead-lettering', async () => {
    const { bus } = bus0(3);
    let attempts = 0;
    bus.subscribe('*', () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
    });
    await bus.publish(evt('t.retry'));
    expect(attempts).toBe(3);
    expect(bus.deadLetters()).toHaveLength(0);
  });

  it('dead-letters after maxAttempts and logs it', async () => {
    const { bus, sink } = bus0(3);
    bus.subscribe('*', () => {
      throw new Error('always fails');
    });
    await bus.publish(evt('t.fail', 'usr_9'));
    const dlq = bus.deadLetters();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].attempts).toBe(3);
    expect(dlq[0].lastError).toBe('always fails');
    expect(sink.records.some((r) => r.msg === 'event.dead_lettered')).toBe(true);
  });
});

describe('EventBus replay', () => {
  it('replays persisted events from a sequence', async () => {
    const { bus } = bus0();
    await bus.publish(evt('t.a'));
    await bus.publish(evt('t.b'));
    await bus.publish(evt('t.c'));
    const seen: number[] = [];
    const count = await bus.replay(2, (e: CloudEvent) => void seen.push(e.seq));
    expect(count).toBe(2);
    expect(seen).toEqual([2, 3]);
  });
});

describe('EventUpcasterRegistry', () => {
  it('chains upcasters from an old version to the target', () => {
    const reg = new EventUpcasterRegistry();
    reg
      .register('device.enrolled', 1, (p) => ({ ...(p as object), platform: 'unknown' }))
      .register('device.enrolled', 2, (p) => ({ ...(p as object), capabilities: [] }));
    const v1 = { deviceId: 'dev_1' };
    const v3 = reg.upcast('device.enrolled', v1, 1, 3) as Record<string, unknown>;
    expect(v3).toEqual({ deviceId: 'dev_1', platform: 'unknown', capabilities: [] });
  });
});

// local helper bound after hoist-safe declaration
function bus0(maxAttempts = 3) {
  return bus(maxAttempts);
}

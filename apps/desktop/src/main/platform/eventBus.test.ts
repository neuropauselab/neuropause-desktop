import { describe, it, expect } from 'vitest';
import { EventBus, type EventBusOptions } from './eventBus';
import type { PlatformEvent, PlatformEventInput } from '@neuropause/shared';

function makeBus(overrides: EventBusOptions = {}): EventBus {
  let id = 0;
  let t = 1_000;
  return new EventBus({ idFactory: () => `e${++id}`, now: () => (t += 1), replayBufferSize: 5, ...overrides });
}

const input = (over: Partial<PlatformEventInput> = {}): PlatformEventInput => ({
  type: 'system.ready',
  category: 'system',
  source: 'test',
  ...over,
});

describe('EventBus', () => {
  it('materializes events with sane defaults', () => {
    const bus = makeBus();
    const e = bus.publish(input());
    expect(e.id).toBe('e1');
    expect(e.version).toBe(1);
    expect(e.priority).toBe('normal');
    expect(e.correlationId).toBe('e1'); // a standalone event correlates to itself
    expect(e.causationId).toBeNull();
    expect(e.actor).toEqual({ kind: 'system', id: null });
    expect(typeof e.timestamp).toBe('string');
  });

  it('delivers to multiple subscribers', () => {
    const bus = makeBus();
    const a: PlatformEvent[] = [];
    const b: PlatformEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish(input());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('filters by event type', () => {
    const bus = makeBus();
    const got: PlatformEvent[] = [];
    bus.subscribe((e) => got.push(e), { types: ['runtime.crashed'] });
    bus.publish(input({ type: 'system.ready' }));
    bus.publish(input({ type: 'runtime.crashed', category: 'runtime' }));
    expect(got.map((e) => e.type)).toEqual(['runtime.crashed']);
  });

  it('isolates a throwing subscriber from the publisher and others', () => {
    const errors: string[] = [];
    const bus = makeBus({ onSubscriberError: (id) => errors.push(id) });
    const good: PlatformEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    }, { id: 'bad' });
    bus.subscribe((e) => good.push(e), { id: 'good' });
    expect(() => bus.publish(input())).not.toThrow();
    expect(good).toHaveLength(1);
    expect(errors).toContain('bad');
    expect(bus.subscriberStatuses().find((s) => s.id === 'bad')?.errors).toBe(1);
  });

  it('isolates an async subscriber rejection', async () => {
    const errors: string[] = [];
    const bus = makeBus({ onSubscriberError: (id) => errors.push(id) });
    bus.subscribe(() => Promise.reject(new Error('async boom')), { id: 'bad-async' });
    bus.publish(input());
    await Promise.resolve();
    expect(errors).toContain('bad-async');
  });

  it('replays the buffer to late subscribers', () => {
    const bus = makeBus();
    bus.publish(input({ type: 'system.ready' }));
    bus.publish(input({ type: 'runtime.started', category: 'runtime' }));
    const got: string[] = [];
    bus.subscribe((e) => got.push(e.type), { replay: true });
    expect(got).toEqual(['system.ready', 'runtime.started']);
  });

  it('caps the replay buffer', () => {
    const bus = makeBus({ replayBufferSize: 2 });
    for (let i = 0; i < 5; i++) bus.publish(input());
    expect(bus.replay()).toHaveLength(2);
  });

  it('reports metrics', () => {
    const bus = makeBus();
    bus.subscribe(() => undefined);
    bus.publish(input());
    bus.publish(input());
    const m = bus.metrics();
    expect(m.eventsPublished).toBe(2);
    expect(m.subscribers).toBe(1);
    expect(m.eventsPerMinute).toBe(2);
  });

  it('carries correlation and causation through a chain', () => {
    const bus = makeBus();
    const root = bus.publish(input());
    const child = bus.publish(input({ correlationId: root.correlationId, causationId: root.id }));
    expect(child.correlationId).toBe(root.correlationId);
    expect(child.causationId).toBe(root.id);
  });
});

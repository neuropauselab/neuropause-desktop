import { describe, it, expect } from 'vitest';
import { ManualClock } from '../../lib/clock';
import { EventBus, InMemoryEventStore } from '../events/eventBus';
import { TimelineProjection } from './timelineProjection';

describe('TimelineProjection (event-sourced)', () => {
  it('builds a per-partition timeline by subscribing to the bus', async () => {
    const bus = new EventBus(new InMemoryEventStore(), new ManualClock(1000));
    const timeline = new TimelineProjection();
    timeline.attach(bus);

    await bus.publish({ type: 'device.enrolled', topic: 'devices', partitionKey: 'usr_1', version: 1, payload: {} });
    await bus.publish({ type: 'sync.pushed', topic: 'sync', partitionKey: 'usr_2', version: 1, payload: {} });
    await bus.publish({ type: 'approval.granted', topic: 'approvals', partitionKey: 'usr_1', version: 1, payload: {} });

    const forUser1 = timeline.forPartition('usr_1');
    expect(forUser1.map((e) => e.type)).toEqual(['device.enrolled', 'approval.granted']);
    expect(forUser1.every((e) => e.at === 1000)).toBe(true);
    expect(timeline.all()).toHaveLength(3);
  });

  it('stops projecting after unsubscribe', async () => {
    const bus = new EventBus(new InMemoryEventStore(), new ManualClock(0));
    const timeline = new TimelineProjection();
    const off = timeline.attach(bus);
    await bus.publish({ type: 'a', topic: 'a', partitionKey: 'p', version: 1, payload: {} });
    off();
    await bus.publish({ type: 'b', topic: 'b', partitionKey: 'p', version: 1, payload: {} });
    expect(timeline.forPartition('p').map((e) => e.type)).toEqual(['a']);
  });
});

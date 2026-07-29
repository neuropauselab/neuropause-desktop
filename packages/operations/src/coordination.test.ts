import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import {
  ServiceDiscovery,
  orderByDependencies,
  DependencyCycleError,
  InMemoryLeaderElection,
  InMemoryLock,
  HeartbeatMonitor,
  CoordinationPlatform,
} from './coordination';

describe('Service coordination (Phase 3)', () => {
  it('discovers services and filters by tag', () => {
    const d = new ServiceDiscovery();
    d.register({ name: 'api', address: 'http://api', tags: ['web'] });
    d.register({ name: 'worker', tags: ['batch'] });
    expect(d.resolve('api')?.address).toBe('http://api');
    expect(d.byTag('web').map((s) => s.name)).toEqual(['api']);
    expect(d.list()).toHaveLength(2);
  });

  it('orders by dependencies (dependencies first) and detects cycles', () => {
    const order = orderByDependencies([{ name: 'a', dependsOn: ['b'] }, { name: 'b', dependsOn: ['c'] }, { name: 'c' }]);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
    expect(() => orderByDependencies([{ name: 'x', dependsOn: ['y'] }, { name: 'y', dependsOn: ['x'] }])).toThrow(DependencyCycleError);
  });

  it('single-node leader election: lease, renew, expiry, takeover, resign', async () => {
    const clock = new ManualClock(0);
    const le = new InMemoryLeaderElection(clock, 1000);
    expect(await le.campaign('a')).toBe(true);
    expect(le.isLeader('a')).toBe(true);
    expect(await le.campaign('b')).toBe(false); // a holds the lease
    clock.advance(500);
    expect(le.renew('a')).toBe(true); // lease now expires at 1500
    clock.advance(1200); // now 1700 > 1500
    expect(le.leader()).toBeUndefined(); // lapsed
    expect(await le.campaign('b')).toBe(true); // b takes over
    le.resign('b');
    expect(le.leader()).toBeUndefined();
  });

  it('single-process distributed lock: exclusive, release, re-acquire after expiry', async () => {
    const clock = new ManualClock(0);
    const lock = new InMemoryLock(clock);
    expect(await lock.acquire('k', 'o1', 1000)).toBe(true);
    expect(await lock.acquire('k', 'o2', 1000)).toBe(false); // held by o1
    expect(lock.held('k')?.owner).toBe('o1');
    expect(lock.release('k', 'o2')).toBe(false); // wrong owner
    expect(lock.release('k', 'o1')).toBe(true);
    expect(await lock.acquire('k', 'o2', 1000)).toBe(true);
  });

  it('heartbeat framework tracks liveness with a TTL', () => {
    const clock = new ManualClock(0);
    const hb = new HeartbeatMonitor(clock, 1000);
    hb.register('n1');
    expect(hb.alive('n1')).toBe(true);
    clock.advance(1001);
    expect(hb.alive('n1')).toBe(false);
    expect(hb.expired()).toContain('n1');
    hb.beat('n1');
    expect(hb.alive('n1')).toBe(true);
  });

  it('the coordination platform orders startup/shutdown and reports self membership', () => {
    const cp = new CoordinationPlatform(new ManualClock(0), { nodeId: 'node-1' });
    cp.discovery.register({ name: 'api', tags: ['web'] });
    const nodes = [{ name: 'db' }, { name: 'cache' }, { name: 'api', dependsOn: ['db', 'cache'] }];
    const up = cp.startupOrder(nodes);
    expect(up.indexOf('db')).toBeLessThan(up.indexOf('api'));
    expect(cp.shutdownOrder(nodes)).toEqual([...up].reverse());
    expect(cp.membership.self()).toEqual({ id: 'node-1', state: 'alive' });
  });
});

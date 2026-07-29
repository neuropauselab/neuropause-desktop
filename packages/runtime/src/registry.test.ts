import { describe, it, expect } from 'vitest';
import { ServiceRegistry, type ServiceDefinition } from './registry';

const svc = (name: string, dependsOn?: string[]): ServiceDefinition => ({
  name,
  ...(dependsOn ? { dependsOn } : {}),
  init: () => ({ name }),
});

describe('ServiceRegistry', () => {
  it('orders services in dependency (topological) order', () => {
    const r = new ServiceRegistry();
    r.register(svc('gateway', ['auth', 'events']));
    r.register(svc('auth', ['events']));
    r.register(svc('events'));
    const order = r.order();
    expect(order.indexOf('events')).toBeLessThan(order.indexOf('auth'));
    expect(order.indexOf('auth')).toBeLessThan(order.indexOf('gateway'));
  });

  it('is deterministic for independent services (sorted)', () => {
    const r = new ServiceRegistry();
    r.register(svc('c'));
    r.register(svc('a'));
    r.register(svc('b'));
    expect(r.order()).toEqual(['a', 'b', 'c']);
  });

  it('detects a circular dependency', () => {
    const r = new ServiceRegistry();
    r.register(svc('x', ['y']));
    r.register(svc('y', ['x']));
    expect(() => r.order()).toThrow(/circular/);
  });

  it('detects a missing dependency', () => {
    const r = new ServiceRegistry();
    r.register(svc('x', ['ghost']));
    expect(() => r.order()).toThrow(/unknown service 'ghost'/);
  });

  it('rejects duplicate registration', () => {
    const r = new ServiceRegistry();
    r.register(svc('x'));
    expect(() => r.register(svc('x'))).toThrow(/already registered/);
  });
});

import { describe, it, expect } from 'vitest';
import { EventBus } from './eventBus';
import {
  AnalyticsSubscriber,
  DiagnosticsCollector,
  DomainProjection,
  registerSubscribers,
} from './subscribers';
import type { PlatformEvent, PlatformEventInput, PlatformEventType, PlatformEventCategory } from '@neuropause/shared';

const input = (over: Partial<PlatformEventInput> = {}): PlatformEventInput => ({
  type: 'system.ready',
  category: 'system',
  source: 'test',
  ...over,
});

function event(type: PlatformEventType, category: PlatformEventCategory): PlatformEvent {
  return {
    id: 'x', type, category, version: 1, priority: 'normal',
    timestamp: '2026-01-01T00:00:00.000Z', source: 't',
    actor: { kind: 'system', id: null }, resource: null,
    correlationId: 'c', causationId: null, metadata: {},
  };
}

describe('AnalyticsSubscriber', () => {
  it('counts by type and category', () => {
    const a = new AnalyticsSubscriber();
    a.handle(event('runtime.started', 'runtime'));
    a.handle(event('runtime.stopped', 'runtime'));
    a.handle(event('system.ready', 'system'));
    const s = a.snapshot();
    expect(s.total).toBe(3);
    expect(s.byCategory.runtime).toBe(2);
    expect(s.byType['runtime.started']).toBe(1);
  });
});

describe('DomainProjection', () => {
  it('keeps only its category and caps recent size', () => {
    const p = new DomainProjection('download', 2);
    p.handle(event('download.started', 'download'));
    p.handle(event('runtime.started', 'runtime')); // ignored
    p.handle(event('download.completed', 'download'));
    p.handle(event('download.failed', 'download'));
    const v = p.view();
    expect(v.count).toBe(3);
    expect(v.recent).toHaveLength(2);
  });
});

describe('DiagnosticsCollector', () => {
  it('tracks liveness and crash/failure counters', () => {
    const d = new DiagnosticsCollector();
    d.handle(event('runtime.crashed', 'runtime'));
    d.handle(event('download.failed', 'download'));
    expect(d.counters()).toEqual({ crashes: 1, failures: 1 });
    expect(d.liveness('runtime').count).toBe(1);
    expect(d.liveness('runtime').lastType).toBe('runtime.crashed');
  });
});

describe('registerSubscribers', () => {
  function harness() {
    const bus = new EventBus();
    const persisted: PlatformEvent[] = [];
    const audited: PlatformEvent[] = [];
    const notified: PlatformEvent[] = [];
    const broadcast: PlatformEvent[] = [];
    const reg = registerSubscribers(bus, {
      persist: (e) => persisted.push(e),
      audit: (e) => audited.push(e),
      notify: (e) => notified.push(e),
      broadcast: (e) => broadcast.push(e),
    });
    return { bus, persisted, audited, notified, broadcast, reg };
  }

  it('persists non-ephemeral events but skips download.progress; forwards all', () => {
    const h = harness();
    h.bus.publish(input({ type: 'application.installed', category: 'application' }));
    h.bus.publish(input({ type: 'download.progress', category: 'download', priority: 'low' }));
    expect(h.persisted.map((e) => e.type)).toEqual(['application.installed']);
    expect(h.broadcast).toHaveLength(2);
  });

  it('audits security-relevant events only', () => {
    const h = harness();
    h.bus.publish(input({ type: 'permission.granted', category: 'permission', priority: 'high' }));
    h.bus.publish(input({ type: 'runtime.health_changed', category: 'runtime' }));
    expect(h.audited.map((e) => e.type)).toEqual(['permission.granted']);
  });

  it('notifies on high/critical priority only', () => {
    const h = harness();
    h.bus.publish(input({ type: 'runtime.crashed', category: 'runtime', priority: 'high' }));
    h.bus.publish(input({ type: 'system.ready', priority: 'normal' }));
    expect(h.notified.map((e) => e.type)).toEqual(['runtime.crashed']);
  });

  it('feeds analytics and per-domain projections', () => {
    const h = harness();
    h.bus.publish(input({ type: 'runtime.started', category: 'runtime' }));
    expect(h.reg.analytics.snapshot().total).toBe(1);
    expect(h.reg.projections.find((p) => p.view().category === 'runtime')?.view().count).toBe(1);
  });

  it('keeps a faulty subscriber from breaking the rest (failure recovery)', () => {
    const h = harness();
    h.bus.subscribe(() => {
      throw new Error('subscriber down');
    }, { id: 'faulty' });
    expect(() => h.bus.publish(input({ type: 'application.removed', category: 'application' }))).not.toThrow();
    expect(h.persisted).toHaveLength(1);
    expect(h.broadcast).toHaveLength(1);
  });
});

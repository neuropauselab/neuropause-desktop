import { describe, it, expect } from 'vitest';
import { HealthAggregator, MetricsRegistry, type HealthStatus } from './observability';

describe('MetricsRegistry', () => {
  it('accumulates counters and sets gauges', () => {
    const m = new MetricsRegistry();
    m.inc('http_requests_total');
    m.inc('http_requests_total', 4);
    m.set('pool_idle', 10);
    expect(m.snapshot()).toEqual({ counters: { http_requests_total: 5 }, gauges: { pool_idle: 10 } });
  });
});

describe('HealthAggregator', () => {
  it('folds components into the worst status (down > degraded > ok)', () => {
    const h = new HealthAggregator();
    let redis: HealthStatus = 'ok';
    h.register('database', () => 'ok');
    h.register('redis', () => redis);
    expect(h.report().status).toBe('ok');
    redis = 'degraded';
    expect(h.report().status).toBe('degraded');
    redis = 'down';
    expect(h.report().status).toBe('down');
    expect(h.report().components).toHaveLength(2);
  });
});

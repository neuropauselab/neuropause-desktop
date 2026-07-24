import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep alert logs out of test output.
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  reportComponentHealth,
  reportHealthSnapshot,
  registerAlertSink,
  resetHealthAlerts,
  type HealthAlert,
} from './healthAlerts';
import { renderMetrics, resetMetrics } from './metrics';

/**
 * TD-6 (alerting slice) regression: dependency health transitions must fire
 * edge-triggered alerts — once per up<->down change, not on every poll — with a
 * counter for Prometheus alerting and dispatch to registered sinks.
 */
describe('health alerts (TD-6 edge-triggered)', () => {
  let received: HealthAlert[];
  beforeEach(() => {
    resetHealthAlerts();
    resetMetrics();
    received = [];
    registerAlertSink((a) => received.push(a));
  });

  it('does not alert on the healthy baseline (first observation up)', () => {
    reportComponentHealth('redis', 'up');
    expect(received).toHaveLength(0);
  });

  it('alerts once when a component goes down, and NOT again while it stays down', () => {
    reportComponentHealth('redis', 'up'); // baseline
    reportComponentHealth('redis', 'down'); // transition -> alert
    reportComponentHealth('redis', 'down'); // sustained -> no new alert
    reportComponentHealth('redis', 'down'); // sustained -> no new alert
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ component: 'redis', state: 'down' });
    expect(typeof received[0].at).toBe('string');
  });

  it('alerts on recovery (down -> up)', () => {
    reportComponentHealth('database', 'up'); // baseline
    reportComponentHealth('database', 'down'); // alert 1
    reportComponentHealth('database', 'up'); // alert 2 (recovery)
    expect(received.map((a) => a.state)).toEqual(['down', 'up']);
  });

  it('treats a first observation of down as an alert (no silent baseline)', () => {
    reportComponentHealth('redis', 'down');
    expect(received).toHaveLength(1);
    expect(received[0].state).toBe('down');
  });

  it('increments the alertable neuropause_health_alerts_total metric by component+state', () => {
    reportComponentHealth('redis', 'up');
    reportComponentHealth('redis', 'down');
    reportComponentHealth('redis', 'up');
    const out = renderMetrics();
    expect(out).toContain('# TYPE neuropause_health_alerts_total counter');
    expect(out).toMatch(/neuropause_health_alerts_total\{component="redis",state="down"\} 1/);
    expect(out).toMatch(/neuropause_health_alerts_total\{component="redis",state="up"\} 1/);
  });

  it('reportHealthSnapshot fires per changed component', () => {
    reportHealthSnapshot({ database: 'up', redis: 'up' }); // baseline, silent
    reportHealthSnapshot({ database: 'up', redis: 'down' }); // only redis changed
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ component: 'redis', state: 'down' });
  });

  it('a throwing sink does not break alert handling', () => {
    registerAlertSink(() => {
      throw new Error('sink boom');
    });
    expect(() => reportComponentHealth('redis', 'down')).not.toThrow();
    // the good sink registered in beforeEach still received the alert
    expect(received).toHaveLength(1);
  });
});

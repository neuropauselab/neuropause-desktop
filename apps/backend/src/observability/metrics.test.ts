import { describe, it, expect, beforeEach } from 'vitest';
import { recordHttpRequest, renderMetrics, resetMetrics } from './metrics';

describe('backend metrics exposition', () => {
  beforeEach(() => resetMetrics());

  it('renders valid Prometheus text with core process gauges', () => {
    const text = renderMetrics();
    expect(text).toMatch(/# TYPE neuropause_backend_up gauge/);
    expect(text).toMatch(/neuropause_backend_up 1/);
    expect(text).toMatch(/neuropause_backend_uptime_seconds \d+/);
    expect(text).toMatch(/neuropause_backend_resident_memory_bytes \d+/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('includes pg pool gauges only when pool stats are provided', () => {
    expect(renderMetrics()).not.toContain('neuropause_pg_pool_connections{');
    const text = renderMetrics({ total: 10, idle: 7, waiting: 2 });
    expect(text).toContain('neuropause_pg_pool_connections{state="total"} 10');
    expect(text).toContain('neuropause_pg_pool_connections{state="idle"} 7');
    expect(text).toContain('neuropause_pg_pool_connections{state="waiting"} 2');
  });

  it('counts HTTP requests by method and status (method upper-cased)', () => {
    recordHttpRequest('get', 200);
    recordHttpRequest('GET', 200);
    recordHttpRequest('post', 500);
    const text = renderMetrics();
    expect(text).toContain('neuropause_http_requests_total{method="GET",status="200"} 2');
    expect(text).toContain('neuropause_http_requests_total{method="POST",status="500"} 1');
  });

  it('resetMetrics clears the request counters', () => {
    recordHttpRequest('get', 200);
    resetMetrics();
    expect(renderMetrics()).not.toContain('neuropause_http_requests_total{');
  });
});

/**
 * P3.0 Increment 1 — Enterprise API dispatcher tests.
 *
 * Verifies the composition: unknown routes 404 before the gateway runs; a denied
 * gateway decision (401/403/429) short-circuits; an allowed request dispatches to
 * the resolved handler with the right scope + payload; list routes return the
 * paginated envelope; the composed routes (health / metrics / bulk) fan out; and
 * handler/validation errors map onto HTTP statuses. All deps are injected fakes —
 * no runtime, no real gateway.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GatewayAuditEntry, GatewayDecision, GatewayMetrics, GatewayRequestInput, SystemHealthSnapshot } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { enterpriseApiRouteIndex, handleEnterpriseApiRequest, type ApiGatewayDeps } from './apiGateway';
import { ENTERPRISE_API_ROUTES } from './routeRegistry';

function healthStub(): SystemHealthSnapshot {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z', score: 98, level: 'healthy', uptimeMs: 3_600_000,
    subsystems: [{ id: 'runtime', label: 'Runtime', level: 'healthy' }, { id: 'backend', label: 'Backend', level: 'degraded' }],
    throughput: { eventsPerMinute: 12, bufferedEvents: 0, avgDispatchMs: 2 },
    automation: { completed: 5, failed: 1, paused: 0, running: 1 },
    voice: 'idle',
    telemetry: { cpuPercent: 10, memoryUsedMb: 200, memoryTotalMb: 1000, processUptimeMs: 3_600_000, backendLatencyMs: 20, backendState: 'connected' },
  };
}

function auditStub(): GatewayAuditEntry[] {
  return [
    { id: 'gw_1', at: '2026-01-01T00:00:00.000Z', keyId: 'k', developerId: 'dev', method: 'GET', path: '/modules', version: 'v1', status: 200, reason: 'OK', latencyMs: 12 },
    { id: 'gw_2', at: '2026-01-01T00:00:01.000Z', keyId: null, developerId: null, method: 'DELETE', path: '/modules/x/records/1', version: 'v1', status: 403, reason: 'forbidden', latencyMs: 4 },
  ];
}

function metricsStub(): GatewayMetrics {
  return { windowDays: 7, requests: 10, allowed: 8, denied: 2, rateLimited: 1, unauthorized: 1, byStatus: { '200': 8, '403': 2 }, byVersion: { v1: 10 }, p95LatencyMs: 42 };
}

function allow(over: Partial<GatewayDecision> = {}): GatewayDecision {
  return {
    allowed: true, status: 200, reason: 'OK', developerId: 'dev', keyId: 'k',
    rateRemaining: 99, rateLimit: 100, quotaRemaining: 999, quotaLimit: 1000,
    retryAfterMs: null, version: 'v1', ...over,
  };
}
function deny(status: number, reason: string): GatewayDecision {
  return { ...allow(), allowed: false, status, reason };
}

function makeDeps(over: Partial<ApiGatewayDeps> = {}): ApiGatewayDeps {
  return {
    decide: () => allow(),
    resolveHandler: (channel) => ({ channel } as SecureHandlerDef),
    runHandler: async (def) => ({ echoedChannel: def.channel }),
    metrics: (windowDays) => ({ windowDays, requests: 0 }),
    gatewayAudit: () => auditStub(),
    health: async () => healthStub(),
    now: () => 0,
    ...over,
  };
}

describe('handleEnterpriseApiRequest', () => {
  it('404s an unknown route without ever calling the gateway', async () => {
    const decide = vi.fn(() => allow());
    const res = await handleEnterpriseApiRequest({ method: 'GET', path: '/nope' }, makeDeps({ decide }));
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });

  it('passes the route scope to the gateway and short-circuits on denial', async () => {
    const seen: GatewayRequestInput[] = [];
    const res = await handleEnterpriseApiRequest(
      { method: 'POST', path: '/modules/crm/records', apiKey: 'bad', body: { title: 'X' } },
      makeDeps({ decide: (i) => { seen.push(i); return deny(403, 'API key missing required scope "records:write"'); } }),
    );
    expect(seen[0].scope).toBe('records:write');
    expect(res.status).toBe(403);
    expect(res.ok).toBe(false);
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('reflects 429 rate limiting with headers', async () => {
    const res = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/modules', apiKey: 'k' },
      makeDeps({ decide: () => deny(429, 'Rate limit exceeded') }),
    );
    expect(res.status).toBe(429);
    expect(res.headers['x-quota-remaining']).toBeDefined();
  });

  it('dispatches an allowed GET to the resolved handler and returns its data', async () => {
    const res = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/modules', apiKey: 'k' },
      makeDeps({ runHandler: async () => [{ id: 'finance-invoices' }] }),
    );
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual([{ id: 'finance-invoices' }]);
    expect(res.headers['x-api-version']).toBe('v1');
  });

  it('wraps list routes in the paginated envelope (sort + cursor)', async () => {
    const records = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, updatedAt: `2026-01-0${i}` }));
    const res = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/modules/crm/records', query: { limit: 3 }, apiKey: 'k' },
      makeDeps({ runHandler: async () => records }),
    );
    expect(res.status).toBe(200);
    const page = res.data as { data: unknown[]; total: number; nextCursor: string | null; limit: number };
    expect(page.data).toHaveLength(3);
    expect(page.total).toBe(7);
    expect(page.limit).toBe(3);
    expect(page.nextCursor).not.toBeNull();
  });

  it('builds the create payload from body + path param', async () => {
    let captured: unknown = null;
    await handleEnterpriseApiRequest(
      { method: 'POST', path: '/modules/crm/records', apiKey: 'k', body: { title: 'Acme', fields: { tier: 'A' } } },
      makeDeps({ runHandler: async (_def, payload) => { captured = payload; return { id: 'new' }; } }),
    );
    expect(captured).toEqual({ moduleId: 'crm', title: 'Acme', fields: { tier: 'A' } });
  });

  it('serves the composed /health route', async () => {
    const res = await handleEnterpriseApiRequest({ method: 'GET', path: '/health', apiKey: 'k' }, makeDeps());
    const data = res.data as { status: string; routes: number; version: string };
    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.routes).toBe(ENTERPRISE_API_ROUTES.length);
  });

  it('serves the composed /metrics route from the injected gateway metrics', async () => {
    const metrics = vi.fn((d: number) => ({ windowDays: d }));
    const res = await handleEnterpriseApiRequest({ method: 'GET', path: '/metrics', query: { windowDays: 14 }, apiKey: 'k' }, makeDeps({ metrics }));
    expect(metrics).toHaveBeenCalledWith(14);
    expect(res.data).toEqual({ windowDays: 14 });
  });

  it('fans a bulk request out over the module channels, isolating per-op failure', async () => {
    const dispatched: string[] = [];
    const res = await handleEnterpriseApiRequest(
      {
        method: 'POST', path: '/modules/crm/records/bulk', apiKey: 'k',
        body: { operations: [{ op: 'create', title: 'A' }, { op: 'delete', id: 'x' }, { op: 'bogus' }] },
      },
      makeDeps({
        runHandler: async (def) => { dispatched.push(def.channel); return { ok: 1 }; },
      }),
    );
    const data = res.data as { count: number; results: Array<{ ok: boolean; op: string }> };
    expect(res.status).toBe(200);
    expect(data.count).toBe(3);
    expect(data.results[0].ok).toBe(true);
    expect(data.results[2].ok).toBe(false); // unknown op isolated
    expect(dispatched).toHaveLength(2); // create + delete dispatched; bogus never did
  });

  it('serves Prometheus metrics as text from gateway metrics + health', async () => {
    const res = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/observability/metrics', apiKey: 'k' },
      makeDeps({ metrics: () => metricsStub() }),
    );
    expect(res.status).toBe(200);
    const text = res.data as string;
    expect(text).toContain('# TYPE neuropause_gateway_requests_total counter');
    expect(text).toContain('neuropause_gateway_requests_total 10');
    expect(text).toContain('neuropause_health_score 98');
    expect(text).toContain('neuropause_subsystem_up{subsystem="backend",level="degraded"} 1');
  });

  it('serves the health snapshot', async () => {
    const res = await handleEnterpriseApiRequest({ method: 'GET', path: '/observability/health', apiKey: 'k' }, makeDeps());
    expect((res.data as SystemHealthSnapshot).score).toBe(98);
  });

  it('projects gateway audit into OTLP spans and logs', async () => {
    const spanRes = await handleEnterpriseApiRequest({ method: 'GET', path: '/observability/traces', query: { limit: 5 }, apiKey: 'k' }, makeDeps());
    const spans = (spanRes.data as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; status: { code: number } }> }> }> }).resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe('GET /modules');
    expect(spans[1].status.code).toBe(2); // 403 → ERROR

    const logRes = await handleEnterpriseApiRequest({ method: 'GET', path: '/observability/logs', apiKey: 'k' }, makeDeps());
    const logs = (logRes.data as { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<{ severityText: string }> }> }> }).resourceLogs[0].scopeLogs[0].logRecords;
    expect(logs[1].severityText).toBe('WARN'); // 403 → WARN
  });

  it('maps validation + permission errors onto 400 / 403', async () => {
    const bad = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/modules/x/records/1', apiKey: 'k' },
      makeDeps({ runHandler: async () => { throw new Error('Invalid request for enterprise:module.get'); } }),
    );
    expect(bad.status).toBe(400);

    const forbidden = await handleEnterpriseApiRequest(
      { method: 'DELETE', path: '/modules/x/records/1', apiKey: 'k' },
      makeDeps({ runHandler: async () => { throw new Error('Missing permission operations:manage'); } }),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.error).toMatch(/permission/i); // 4xx detail is preserved (user-actionable)
  });

  it('does not leak internal error text on 5xx', async () => {
    const res = await handleEnterpriseApiRequest(
      { method: 'GET', path: '/modules', apiKey: 'k' },
      makeDeps({ runHandler: async () => { throw new Error('ECONNREFUSED sqlite:///Users/x/secret.db table gateway_secrets'); } }),
    );
    expect(res.status).toBe(500);
    expect(res.error).toBe('Internal server error');
    expect(res.error).not.toMatch(/sqlite|secret|ECONNREFUSED/);
  });
});

describe('enterpriseApiRouteIndex', () => {
  it('exposes every route as public info (method/path/scope/summary/list)', () => {
    const index = enterpriseApiRouteIndex();
    expect(index).toHaveLength(ENTERPRISE_API_ROUTES.length);
    for (const r of index) {
      expect(r.method).toMatch(/GET|POST|PUT|PATCH|DELETE/);
      expect(r.path.startsWith('/')).toBe(true);
      expect(typeof r.scope).toBe('string');
    }
  });
});

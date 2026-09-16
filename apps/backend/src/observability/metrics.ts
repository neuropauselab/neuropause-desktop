/**
 * Minimal Prometheus text-exposition metrics for the backend (Phase 4).
 *
 * No new dependency: a tiny in-process counter registry plus live process/pool
 * gauges, rendered in the Prometheus text format (v0.0.4). It exposes ONLY
 * non-sensitive aggregate operational signals — process uptime/memory, Postgres
 * pool connection counts, and HTTP request counts by method+status. No request
 * bodies, no paths with identifiers, no PII, no secrets.
 *
 * Scrape target: `GET /metrics` (see app.ts). Keep it network-restricted in
 * production (loopback bind in compose; a separate port / NetworkPolicy in k8s).
 */

/** HTTP request counter, keyed by `${METHOD}|${status}`. */
const httpRequests = new Map<string, number>();

/** Record one finished HTTP request. Health/metrics probes are excluded by the caller. */
export function recordHttpRequest(method: string, status: number): void {
  const key = `${method.toUpperCase()}|${status}`;
  httpRequests.set(key, (httpRequests.get(key) ?? 0) + 1);
}

/**
 * Rate-limit fallback counter, keyed by bucket. Increments each time a request
 * is served by the in-process fallback limiter because Redis was unavailable
 * (TD-3). This is an operational ALERT signal: a nonzero rate means the
 * distributed limiter is degraded (Redis down) and per-instance enforcement is
 * in effect. Alert on `rate(neuropause_ratelimit_fallback_total[5m]) > 0`.
 */
const rateLimitFallbacks = new Map<string, number>();

/** Record one request served by the rate-limit fallback path (Redis unavailable). */
export function recordRateLimitFallback(bucket: string): void {
  rateLimitFallbacks.set(bucket, (rateLimitFallbacks.get(bucket) ?? 0) + 1);
}

/**
 * Health-transition alert counter, keyed by component + new state. Increments
 * each time a monitored dependency transitions up<->down (TD-6, edge-triggered).
 * Operational signal: alert on `increase(neuropause_health_alerts_total{state="down"}[10m]) > 0`.
 */
const healthAlerts = new Map<string, number>();

/** Record one health-state transition alert for a component (state = new state). */
/**
 * NP-PUBLIC-LAUNCH-003 §14 — AI gateway signals as METRICS, not only log lines:
 * requests by provider/outcome, tokens by direction, latency sum/count (ms).
 * Never carries prompt or completion content.
 */
const aiRequests = new Map<string, number>();
const aiTokens = new Map<string, number>();
let aiLatencyMs = 0;
let aiLatencyCount = 0;
export function recordAiGateway(provider: string, outcome: 'ok' | 'refused' | 'error' | 'rate_limited', latencyMs: number, inputTokens = 0, outputTokens = 0): void {
  const key = `${provider}|${outcome}`;
  aiRequests.set(key, (aiRequests.get(key) ?? 0) + 1);
  aiTokens.set('input', (aiTokens.get('input') ?? 0) + Math.max(0, inputTokens | 0));
  aiTokens.set('output', (aiTokens.get('output') ?? 0) + Math.max(0, outputTokens | 0));
  aiLatencyMs += Math.max(0, latencyMs | 0);
  aiLatencyCount += 1;
}

/** Release/deployment identity as a gauge so dashboards can pin a version to a symptom. */
const BUILD_INFO = { version: process.env.npm_package_version ?? 'unknown', commit: process.env.NEUROPAUSE_BUILD_COMMIT ?? 'unknown', node: process.version };

export function recordHealthAlert(component: string, state: string): void {
  const key = `${component}|${state}`;
  healthAlerts.set(key, (healthAlerts.get(key) ?? 0) + 1);
}

/** Live Postgres pool counts (node-postgres exposes these as plain numbers). */
export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function metric(name: string, value: number, labels?: Record<string, string>): string {
  const entries = labels ? Object.entries(labels) : [];
  const lbl = entries.length
    ? '{' + entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',') + '}'
    : '';
  return `${name}${lbl} ${value}`;
}

/**
 * Render the current metrics as Prometheus text exposition. `poolStats` is
 * injected by the route (from the real pg pool) so this module stays free of
 * any database/env import and is unit-testable in isolation.
 */
export function renderMetrics(poolStats?: PoolStats): string {
  const mem = process.memoryUsage();
  const out: string[] = [];

  out.push('# HELP neuropause_backend_up Whether the backend process is serving (always 1 when scraped).');
  out.push('# TYPE neuropause_backend_up gauge');
  out.push(metric('neuropause_backend_up', 1));

  out.push('# HELP neuropause_backend_uptime_seconds Process uptime in seconds.');
  out.push('# TYPE neuropause_backend_uptime_seconds gauge');
  out.push(metric('neuropause_backend_uptime_seconds', Math.round(process.uptime())));

  out.push('# HELP neuropause_backend_resident_memory_bytes Resident set size in bytes.');
  out.push('# TYPE neuropause_backend_resident_memory_bytes gauge');
  out.push(metric('neuropause_backend_resident_memory_bytes', mem.rss));

  out.push('# HELP neuropause_backend_heap_used_bytes V8 heap used in bytes.');
  out.push('# TYPE neuropause_backend_heap_used_bytes gauge');
  out.push(metric('neuropause_backend_heap_used_bytes', mem.heapUsed));

  if (poolStats) {
    out.push('# HELP neuropause_pg_pool_connections Postgres pool connections by state.');
    out.push('# TYPE neuropause_pg_pool_connections gauge');
    out.push(metric('neuropause_pg_pool_connections', poolStats.total, { state: 'total' }));
    out.push(metric('neuropause_pg_pool_connections', poolStats.idle, { state: 'idle' }));
    out.push(metric('neuropause_pg_pool_connections', poolStats.waiting, { state: 'waiting' }));
  }

  out.push('# HELP neuropause_http_requests_total Total HTTP requests by method and status.');
  out.push('# TYPE neuropause_http_requests_total counter');
  for (const [key, count] of httpRequests) {
    const [method, status] = key.split('|');
    out.push(metric('neuropause_http_requests_total', count, { method, status }));
  }

  out.push(
    '# HELP neuropause_ratelimit_fallback_total Requests served by the in-process rate-limit fallback because Redis was unavailable, by bucket.',
  );
  out.push('# TYPE neuropause_ratelimit_fallback_total counter');
  for (const [bucket, count] of rateLimitFallbacks) {
    out.push(metric('neuropause_ratelimit_fallback_total', count, { bucket }));
  }

  out.push(
    '# HELP neuropause_health_alerts_total Health-state transition alerts by component and new state (up/down).',
  );
  out.push('# HELP neuropause_build_info Backend build identity (value is always 1).');
  out.push('# TYPE neuropause_build_info gauge');
  out.push(metric('neuropause_build_info', 1, { version: BUILD_INFO.version, commit: BUILD_INFO.commit, node: BUILD_INFO.node }));
  out.push('# HELP neuropause_ai_requests_total AI gateway requests by provider and outcome.');
  out.push('# TYPE neuropause_ai_requests_total counter');
  for (const [key, count] of aiRequests) { const [provider, outcome] = key.split('|'); out.push(metric('neuropause_ai_requests_total', count, { provider, outcome })); }
  out.push('# HELP neuropause_ai_tokens_total AI gateway tokens by direction.');
  out.push('# TYPE neuropause_ai_tokens_total counter');
  for (const [direction, count] of aiTokens) out.push(metric('neuropause_ai_tokens_total', count, { direction }));
  out.push('# HELP neuropause_ai_latency_ms_sum Sum of AI gateway provider latency in ms.');
  out.push('# TYPE neuropause_ai_latency_ms_sum counter');
  out.push(metric('neuropause_ai_latency_ms_sum', aiLatencyMs));
  out.push('# HELP neuropause_ai_latency_ms_count Count of AI gateway provider calls with a measured latency.');
  out.push('# TYPE neuropause_ai_latency_ms_count counter');
  out.push(metric('neuropause_ai_latency_ms_count', aiLatencyCount));
  out.push('# TYPE neuropause_health_alerts_total counter');
  for (const [key, count] of healthAlerts) {
    const [component, state] = key.split('|');
    out.push(metric('neuropause_health_alerts_total', count, { component, state }));
  }

  return out.join('\n') + '\n';
}

/** Test helper — clears the request counters. */
export function resetMetrics(): void {
  httpRequests.clear();
  rateLimitFallbacks.clear();
  healthAlerts.clear();
}

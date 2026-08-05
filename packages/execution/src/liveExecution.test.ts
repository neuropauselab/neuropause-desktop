import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { FetchHttpClient } from '@neuropause/integrations';
import { createExecutionPlatform, type ExecutionPlatform } from './platform';

/**
 * LIVE-VERIFIED: these tests execute the FULL pipeline over REAL HTTP against a local
 * Node server (a real socket + round-trip). A real execution genuinely occurs — this is
 * the honest basis for the "live-verified" classification. No external SaaS is called.
 */
describe('Module 17 — LIVE execution over real HTTP (a real execution occurs)', () => {
  let server: Server;
  let base: string;
  let runtime: EnterpriseRuntime;
  let exec: ExecutionPlatform;
  let flakyHits = 0;

  const generic = (id: string) => ({ id, name: id, category: 'generic', auth: 'none' as const, baseUrl: base, evidence: 'live-verified' as const, operations: [{ name: 'req', method: 'GET', path: '{path}' }] });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = req.url ?? '';
        if (url.startsWith('/echo')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, method: req.method, path: url, received: body }));
        } else if (url.startsWith('/flaky')) {
          flakyHits += 1;
          if (flakyHits < 3) {
            res.writeHead(500);
            res.end('transient');
          } else {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ recovered: true }));
          }
        } else if (url.startsWith('/always500')) {
          res.writeHead(500);
          res.end('down');
        } else if (url.startsWith('/slow')) {
          setTimeout(() => {
            res.writeHead(200);
            res.end('slow');
          }, 400);
        } else {
          res.writeHead(404);
          res.end('nf');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    runtime = createEnterpriseRuntime({ clock: new ManualClock(1_000_000) });
    exec = createExecutionPlatform(runtime, { clock: new ManualClock(1_000_000), http: new FetchHttpClient(), engine: { maxAttempts: 3, timeoutMs: 200 } });
  });
  afterAll(() => {
    server.close();
  });

  it('executes a real GET through the full pipeline (live-verified)', async () => {
    const r = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'rest', operation: 'request', params: { path: '/echo' }, baseUrl: base });
    expect(r.outcome).toBe('success');
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean; method: string }).ok).toBe(true);
    expect((r.body as { method: string }).method).toBe('GET');
    expect(r.evidence).toBe('live-verified'); // a real execution occurred
    expect(r.auditId).toBeTruthy();
  });

  it('executes a real POST through the gateway', async () => {
    const resp = await exec.gateway().call({ tenantId: 't', actor: 'u', connectorId: 'graphql', operation: 'query', params: { path: '/echo' }, body: { q: '{ me }' }, baseUrl: base });
    expect(resp.ok).toBe(true);
    expect((resp.data as { method: string }).method).toBe('POST');
  });

  it('retries a real 5xx with backoff, then succeeds', async () => {
    const r = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'rest', operation: 'request', params: { path: '/flaky' }, baseUrl: base });
    expect(r.outcome).toBe('success');
    expect(r.attempts).toBe(3); // two real 500s retried
    expect((r.body as { recovered: boolean }).recovered).toBe(true);
  });

  it('opens a real circuit breaker after repeated failures', async () => {
    exec.connectors().register(generic('breakertest'));
    for (let i = 0; i < 5; i += 1) await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'breakertest', operation: 'req', params: { path: '/always500' }, baseUrl: base });
    expect(exec.engine().breakerState('breakertest')).toBe('open');
    const blocked = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'breakertest', operation: 'req', params: { path: '/echo' }, baseUrl: base });
    expect(blocked.outcome).toBe('circuit-open'); // no HTTP — short-circuited
  });

  it('rate-limits real over-limit executions', async () => {
    exec.connectors().register(generic('ratetest'));
    exec.rateLimiter().configure('ratetest', { capacity: 2, refillPerSec: 0 });
    const call = () => exec.engine().execute({ tenantId: 'rl', actor: 'u', connectorId: 'ratetest', operation: 'req', params: { path: '/echo' }, baseUrl: base });
    expect((await call()).outcome).toBe('success');
    expect((await call()).outcome).toBe('success');
    expect((await call()).outcome).toBe('rate-limited');
  });

  it('times out a real slow response and dead-letters it', async () => {
    const r = await exec.engine().execute({ tenantId: 't3', actor: 'u', connectorId: 'rest', operation: 'request', params: { path: '/slow' }, baseUrl: base });
    expect(r.outcome).toBe('dead-lettered');
    expect(exec.recovery().deadLetters('t3').length).toBe(1);
  });

  it('health-probes a connector over real HTTP', async () => {
    exec.connectors().register({ id: 'local', name: 'Local', category: 'generic', auth: 'none', baseUrl: base, evidence: 'live-verified', operations: [{ name: 'ping', method: 'GET', path: '/echo' }] });
    const h = await exec.health().probe('t', 'local');
    expect(h.state).toBe('healthy');
  });

  it('replays a real execution and governs everything (audit chain verifies)', async () => {
    const orig = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'rest', operation: 'request', params: { path: '/echo' }, baseUrl: base });
    const replay = await exec.engine().replay(orig.id);
    expect(replay.outcome).toBe('success');
    expect(replay.id).not.toBe(orig.id);
    expect(exec.governance().count('success')).toBeGreaterThan(0);
    expect(exec.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('runs a real batch (performance) — 10 real round-trips all succeed', async () => {
    const reqs = Array.from({ length: 10 }, () => ({ tenantId: 'perf', actor: 'u', connectorId: 'rest', operation: 'request', params: { path: '/echo' }, baseUrl: base }));
    const responses = await exec.gateway().batch(reqs);
    expect(responses.length).toBe(10);
    expect(responses.every((r) => r.ok)).toBe(true);
    const report = exec.analytics().report('perf');
    expect(report.totalExecutions).toBe(10);
    expect(report.successRate).toBe(1);
  });
});

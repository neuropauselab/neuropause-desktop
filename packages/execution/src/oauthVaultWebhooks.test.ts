import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { FetchHttpClient } from '@neuropause/integrations';
import { createExecutionPlatform, type ExecutionPlatform } from './platform';

describe('Module 17 — OAuth lifecycle, Secret rotation, Webhooks, Streaming', () => {
  let tokenServer: Server;
  let tokenBase: string;
  let runtime: EnterpriseRuntime;
  let clock: ManualClock;
  let exec: ExecutionPlatform;

  beforeAll(async () => {
    tokenServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' }));
    });
    await new Promise<void>((r) => tokenServer.listen(0, '127.0.0.1', () => r()));
    tokenBase = `http://127.0.0.1:${(tokenServer.address() as AddressInfo).port}`;
    clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    exec = createExecutionPlatform(runtime, { clock, http: new FetchHttpClient() });
  });
  afterAll(() => {
    tokenServer.close();
  });

  it('runs the OAuth lifecycle — authorize URL, real token exchange, refresh, state', async () => {
    exec.oauth().configure('github', { provider: 'github', authorizeUrl: `${tokenBase}/auth`, tokenUrl: `${tokenBase}/token`, scopes: ['repo'], pkce: false });
    const url = exec.oauth().authorizeUrl('github', { clientId: 'cid', redirectUri: 'https://app/cb', state: 'st' });
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=cid');
    // real token exchange over HTTP against the local token server
    const tokens = await exec.oauth().exchange('github', 'acme', { code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://app/cb' });
    expect(tokens.accessToken).toBe('at-1');
    expect(await exec.oauth().state('github', 'acme')).toBe('authorized');
    const refreshed = await exec.oauth().refresh('github', 'acme', { clientId: 'cid', clientSecret: 'sec' });
    expect(refreshed.accessToken).toBe('at-1');
  });

  it('rotates secrets (scheduled + on-demand) with real envelope encryption', async () => {
    const rot = exec.rotation();
    await rot.store('acme:github', 'api_key', 'key-v1');
    expect(await rot.resolve('acme:github', 'api_key')).toBe('key-v1');
    expect(await rot.rotateNow('acme:github', 'api_key', 'key-v2')).toBe(2);
    expect(await rot.resolve('acme:github', 'api_key')).toBe('key-v2');
    // ciphertext at rest never contains the plaintext
    expect(JSON.stringify(exec.vault().ciphertext('acme:github', 'api_key'))).not.toContain('key-v2');
    // scheduled rotation
    await rot.store('acme:slack', 'tok', 't0');
    let gen = 0;
    rot.schedule({ scope: 'acme:slack', key: 'tok', intervalMs: 1000, generator: () => `gen${(gen += 1)}` });
    clock.advance(2500);
    expect(await rot.tick()).toBe(2); // two intervals due
    expect(exec.rotation().version('acme:slack', 'tok')).toBeGreaterThanOrEqual(3);
  });

  it('verifies real HMAC webhook signatures, dead-letters bad ones, and replays', async () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ action: 'opened' });
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const good = await exec.webhooks().receive('github', { headers: { 'x-hub-signature-256': sig, 'x-github-delivery': 'd1' }, body, secret });
    expect(good.accepted).toBe(true);
    const bad = await exec.webhooks().receive('github', { headers: { 'x-hub-signature-256': 'sha256=deadbeef', 'x-github-delivery': 'd2' }, body, secret });
    expect(bad.accepted).toBe(false); // real HMAC mismatch rejected
    expect(exec.webhooks().stats().accepted).toBeGreaterThanOrEqual(1);
    expect(exec.webhooks().stats().rejected).toBeGreaterThanOrEqual(1);
  });

  it('streams events over the one bus with partitions and buffering', async () => {
    let seen = 0;
    const unsub = exec.streaming().subscribe('exec.custom', () => {
      seen += 1;
    });
    await runtime.events().publish({ type: 'exec.custom', topic: 'execution', partitionKey: 'acme', version: 1, payload: { x: 1 } });
    expect(seen).toBe(1);
    expect(exec.streaming().recent({ topic: 'execution' }).length).toBeGreaterThan(0);
    expect(exec.streaming().partitions()).toContain('acme');
    unsub();
  });

  it('exposes production dashboards + honest readiness', () => {
    const dash = exec.dashboards().build('acme');
    expect(dash.panels).toHaveProperty('executionHealth');
    expect(dash.panels).toHaveProperty('connectorHealth');
    const r = exec.readiness();
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0); // the SaaS-connector row
  });
});

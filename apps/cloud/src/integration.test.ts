/**
 * Integration — the CONSOLIDATED cloud service composing cloud-core primitives.
 *
 * The cloud no longer owns identity/devices/orgs (backend does), so the gateway
 * receives an ALREADY-AUTHENTICATED context and merely enforces it. Flow:
 * authorize -> publish event -> timeline projects -> audit references + verifies.
 * Plus the constitution end-to-end (a secret cannot be synced), request signing,
 * and the cloud-sdk client wiring.
 */
import { describe, it, expect } from 'vitest';
import { createCloud } from './index';
import { ManualClock, isErr, isOk, sha256Hex } from '@neuropause/cloud-core';
import { CloudClient, inMemoryTransport } from '@neuropause/cloud-sdk';

const SECRET = 'test-only-secret-test-only-secret-0123456789';

describe('Consolidated cloud service integration', () => {
  it('authorizes -> event -> timeline -> verifiable audit', async () => {
    const clock = new ManualClock(1000);
    const cloud = createCloud({ secret: SECRET, clock, rateLimit: { capacity: 10, refillPerSec: 1 } });

    const ctx = { authenticated: true, roles: ['admin'] };
    cloud.gateway.register({
      version: 'v1',
      method: 'POST',
      path: '/v1/timeline/announce',
      policy: 'authenticated',
      roles: ['admin'],
      handler: () => 'accepted',
    });
    const res = cloud.gateway.handle({ version: 'v1', method: 'POST', path: '/v1/timeline/announce', ctx });
    expect(res.ok).toBe(true);
    expect(res.traceId.startsWith('trace_')).toBe(true);

    const evt = await cloud.events.publish({
      type: 'timeline.entry',
      topic: 'timeline',
      partitionKey: 'usr_1',
      version: 1,
      payload: { note: 'standup' },
    });
    expect(cloud.timeline.forPartition('usr_1').map((e) => e.type)).toContain('timeline.entry');

    cloud.audit.append({
      actor: 'usr_1',
      action: 'timeline.entry',
      target: 'tl_1',
      deviceId: 'dev_a',
      at: clock.now(),
      dataHash: sha256Hex(evt.id),
    });
    expect(cloud.audit.verify().valid).toBe(true);
  });

  it('denies an unauthenticated caller at the gateway', () => {
    const cloud = createCloud({ secret: SECRET, clock: new ManualClock(0) });
    cloud.gateway.register({
      version: 'v1',
      method: 'POST',
      path: '/v1/secure',
      policy: 'authenticated',
      handler: () => 'ok',
    });
    const res = cloud.gateway.handle({
      version: 'v1',
      method: 'POST',
      path: '/v1/secure',
      ctx: { authenticated: false, roles: [] },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('unauthorized');
  });

  it('honors the constitution end-to-end: a secret cannot be synced', () => {
    const cloud = createCloud({ secret: SECRET, clock: new ManualClock(0) });
    const res = cloud.sync.push({
      kind: 'preferences',
      entityId: 'pref_1',
      deviceId: 'dev_a',
      vv: { dev_a: 1 },
      updatedAt: 1,
      state: { theme: 'dark', apiKey: 'sk-must-not-sync' },
    });
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('secret_rejected');
  });

  it('signs and verifies an inter-service request', () => {
    const clock = new ManualClock(5000);
    const cloud = createCloud({ secret: SECRET, clock });
    const { signature, timestamp } = cloud.signer.sign('POST', '/v1/sync', '{"kind":"timeline"}');
    expect(isOk(cloud.signer.verify('POST', '/v1/sync', '{"kind":"timeline"}', signature, timestamp))).toBe(true);
  });

  it('cloud-sdk routes typed calls through a pluggable transport', async () => {
    const client = new CloudClient(
      inMemoryTransport((method, path) => ({ ok: true, data: { method, path }, traceId: 'trace_test' })),
    );
    const res = await client.notifications.history('usr_1');
    expect(res.ok).toBe(true);
    expect(res.traceId).toBe('trace_test');
  });
});

import { describe, it, expect } from 'vitest';
import { EventBus, InMemoryEventStore, ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { busPublisher, noopPublisher, createPlatformBus } from './events';
import { apiOk, apiFail, newTraceId } from './response';
import { findSecretKey, containsSecret } from './secretGuard';
import { createAuditRecorder } from './audit';
import { publishNotification } from './notifications';

describe('platform/events', () => {
  it('busPublisher forwards domain events to a cloud-core bus; noop is inert', async () => {
    const bus = new EventBus(new InMemoryEventStore(), new ManualClock(0));
    const seen: string[] = [];
    bus.subscribe('*', (e: CloudEvent) => void seen.push(e.type));
    await busPublisher(bus).publish({
      type: 'device.registered',
      topic: 'devices',
      partitionKey: 'org_1',
      version: 1,
      payload: {},
    });
    expect(seen).toEqual(['device.registered']);
    await noopPublisher.publish({ type: 'x', topic: 'x', partitionKey: 'p', version: 1, payload: {} });
    expect(createPlatformBus().stats().published).toBe(0);
  });
});

describe('platform/response', () => {
  it('produces the shared envelope with a trace id', () => {
    const okr = apiOk({ n: 1 });
    expect(okr).toMatchObject({ ok: true, data: { n: 1 } });
    expect(okr.traceId.startsWith('trace_')).toBe(true);
    expect(apiFail('bad', 'nope', 'trace_x')).toMatchObject({
      ok: false,
      error: { code: 'bad', message: 'nope' },
      traceId: 'trace_x',
    });
    expect(newTraceId().startsWith('trace_')).toBe(true);
  });
});

describe('platform/secretGuard', () => {
  it('detects secret-like keys using the shared rule', () => {
    expect(findSecretKey({ a: { apiKey: 'x' } })).toBe('a.apiKey');
    expect(containsSecret({ token: 1 })).toBe(true);
    expect(findSecretKey({ theme: 'dark' })).toBeNull();
  });
});

describe('platform/audit', () => {
  it('records verifiable provenance and stores only hashes', () => {
    const rec = createAuditRecorder();
    const a = rec.record({ actor: 'usr_1', action: 'org.created', target: 'org_1', at: 1000, data: { leak: 'sk-secret' } });
    const b = rec.record({ actor: 'usr_1', action: 'device.registered', target: 'dev_1', at: 1001 });
    expect(a.prevId).toBeNull();
    expect(b.prevId).toBe(a.auditId);
    expect(rec.verify().valid).toBe(true);
    expect(JSON.stringify(rec.refs())).not.toContain('sk-secret');
  });
});

describe('platform/notifications', () => {
  it('publishes a notification.requested event onto the bus', async () => {
    const bus = new EventBus(new InMemoryEventStore(), new ManualClock(0));
    const seen: string[] = [];
    bus.subscribe('notification.*', (e: CloudEvent) => void seen.push(e.type));
    await publishNotification(busPublisher(bus), { userId: 'usr_1', title: 'Approval needed', channels: ['push'] });
    expect(seen).toEqual(['notification.requested']);
  });
});

import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { createConnectorPlatform, mockConnector, catalogDescriptor } from './index';

describe('createConnectorPlatform (integration)', () => {
  it('governs a connector action end-to-end: audited + observable', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const platform = createConnectorPlatform(runtime, { clock });

    await platform.connectorSecrets().put('github', 'token', 'ghp_x');
    platform.connectorRegistry().install(mockConnector(catalogDescriptor('github') as never));

    const events: string[] = [];
    runtime.events().subscribe('connector.*', (e: CloudEvent) => void events.push(e.type));

    const r = await platform
      .connectors()
      .invoke('github', 'invoke', { op: 'listRepos' }, { actor: 'usr_1', grants: ['github:use', 'github:invoke'] });
    expect(r).toMatchObject({ connector: 'github', op: 'listRepos', mocked: true });

    expect(platform.connectorAudit().history().some((x) => x.connectorId === 'github' && x.ok)).toBe(true);
    expect(events).toContain('connector.execution');
    expect(runtime.audit().verify().valid).toBe(true);
    expect(runtime.timeline().all().some((e) => e.type === 'connector.execution')).toBe(true);
    expect(platform.connectorMetrics().metrics('github').calls).toBe(1); // observability from the event stream
    expect(platform.connectorHealth().find((h) => h.id === 'github')?.health.status).toBe('ok');
  });

  it('triggers a governed automation through the shared scheduler/bus', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const platform = createConnectorPlatform(runtime, { clock });
    const ran: string[] = [];
    platform.connectorAutomation().register({ id: 'sync', steps: [{ name: 'pull', run: async () => void ran.push('pull') }] });
    platform.connectorScheduler().register({ id: 'onPush', kind: 'event', eventPattern: 'github.push', automation: 'sync' });

    await runtime.events().publish({ type: 'github.push', topic: 'x', partitionKey: 'p', version: 1, payload: {} });

    expect(ran).toEqual(['pull']);
    expect(platform.connectorAudit().history().some((x) => x.connectorId === 'automation:sync' && x.ok)).toBe(true);
  });

  it('exposes the full connector platform API', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    const platform = createConnectorPlatform(runtime, { clock: new ManualClock(0) });
    expect(platform.version).toContain('preview');
    for (const fn of [
      platform.connectors,
      platform.connectorRegistry,
      platform.connectorHealth,
      platform.connectorMetrics,
      platform.connectorSecrets,
      platform.connectorAuth,
      platform.connectorScheduler,
      platform.connectorAutomation,
      platform.connectorAudit,
      platform.marketplace,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});

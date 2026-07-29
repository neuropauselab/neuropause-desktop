import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { defineConnector } from './sdk';
import { ConnectorRegistry } from './registry';
import { ConnectorGovernance } from './governance';
import { ConnectorExecutor } from './execution';
import { InMemorySecretVault } from './vault';

function harness() {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const registry = new ConnectorRegistry(clock);
  const governance = new ConnectorGovernance(runtime, clock);
  const vault = new InMemorySecretVault(clock);
  const exec = new ConnectorExecutor(runtime, registry, governance, vault, clock);
  return { clock, runtime, registry, governance, vault, exec };
}

const demo = defineConnector({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  category: 'test',
  auth: { type: 'api_key' },
  capabilities: ['read'],
  permissions: ['demo:use'],
  actions: [{ name: 'echo', permissions: ['demo:echo'], schema: z.object({ msg: z.string() }), execute: async (a: { msg: string }) => ({ echo: a.msg }) }],
  rateLimit: { capacity: 1, refillPerSec: 0 },
});

describe('ConnectorRegistry', () => {
  it('installs, discovers, versions, resolves dependencies', () => {
    const { registry } = harness();
    registry.install(demo);
    expect(registry.has('demo')).toBe(true);
    expect(registry.version('demo')).toBe('1.0.0');
    expect(registry.discover('read').map((d) => d.id)).toEqual(['demo']);
    registry.install(defineConnector({ ...demo, id: 'dep', dependencies: ['demo'], capabilities: [] }));
    expect(() => registry.uninstall('demo')).toThrow(/depended upon/);
    expect(() => registry.install(defineConnector({ ...demo, id: 'x', dependencies: ['ghost'] }))).toThrow(/missing dependency/);
  });
  it('reports health including disabled', () => {
    const { registry } = harness();
    registry.install(demo);
    registry.disable('demo');
    expect(registry.health()).toEqual([{ id: 'demo', health: { status: 'down', detail: 'disabled' } }]);
  });
});

describe('ConnectorExecutor (governed)', () => {
  it('invokes an action with permission + valid args, fully audited', async () => {
    const { registry, exec, governance, runtime } = harness();
    registry.install(demo);
    const r = await exec.invoke('demo', 'echo', { msg: 'hi' }, { actor: 'usr_1', grants: ['demo:use', 'demo:echo'] });
    expect(r).toEqual({ echo: 'hi' });
    const rec = governance.history().find((x) => x.connectorId === 'demo' && x.ok);
    expect(rec?.approval).toBe('approved');
    expect(rec?.requestId.startsWith('req_')).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    expect(runtime.timeline().all().some((e) => e.type === 'connector.execution')).toBe(true);
  });
  it('denies without permission (recorded rejected)', async () => {
    const { registry, exec, governance } = harness();
    registry.install(demo);
    await expect(exec.invoke('demo', 'echo', { msg: 'hi' }, { actor: 'usr_1', grants: ['demo:use'] })).rejects.toThrow(/requires permission/);
    expect(governance.history().some((x) => x.approval === 'rejected')).toBe(true);
  });
  it('enforces rate limits', async () => {
    const { registry, exec } = harness();
    registry.install(demo);
    const grants = ['demo:use', 'demo:echo'];
    await exec.invoke('demo', 'echo', { msg: 'a' }, { actor: 'usr_1', grants });
    await expect(exec.invoke('demo', 'echo', { msg: 'b' }, { actor: 'usr_1', grants })).rejects.toThrow(/rate limit/);
  });
  it('rejects a disabled connector and invalid args', async () => {
    const { registry, exec } = harness();
    registry.install(demo);
    await expect(exec.invoke('demo', 'echo', { msg: 123 }, { actor: 'usr_1', grants: ['demo:use', 'demo:echo'] })).rejects.toThrow(/invalid arguments/);
    registry.disable('demo');
    await expect(exec.invoke('demo', 'echo', { msg: 'x' }, { actor: 'usr_1', grants: ['demo:use', 'demo:echo'] })).rejects.toThrow(/disabled/);
  });
  it('reveals connector secrets from the vault at use time (never exposed elsewhere)', async () => {
    const { registry, exec, vault } = harness();
    await vault.put('secretive', 'token', 'sk-xyz');
    registry.install(
      defineConnector({
        id: 'secretive',
        name: 'S',
        version: '1.0.0',
        category: 'test',
        auth: { type: 'bearer' },
        capabilities: [],
        permissions: [],
        actions: [{ name: 'whoami', permissions: [], execute: async (_i, ctx) => ({ token: await ctx.secret('token') }) }],
      }),
    );
    const r = (await exec.invoke('secretive', 'whoami', {}, { actor: 'usr_1', grants: [] })) as { token: string };
    expect(r.token).toBe('sk-xyz');
  });
});

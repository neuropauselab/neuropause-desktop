import { describe, it, expect } from 'vitest';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from './runtime';
import type { ServiceDefinition } from './registry';

const rt = (services: ServiceDefinition[] = []) =>
  createEnterpriseRuntime({ clock: new ManualClock(0), services });

describe('createEnterpriseRuntime', () => {
  it('starts services in dependency order and reaches ready', async () => {
    const order: string[] = [];
    const mk = (name: string, dependsOn?: string[]): ServiceDefinition => ({
      name,
      ...(dependsOn ? { dependsOn } : {}),
      init: () => ({ name }),
      start: () => void order.push(name),
      health: () => ({ status: 'ok', ready: true }),
    });
    const runtime = rt([mk('gateway', ['events']), mk('events')]);
    expect(runtime.state()).toBe('idle');
    await runtime.start();
    expect(runtime.state()).toBe('ready');
    expect(order).toEqual(['events', 'gateway']);
    const health = runtime.health();
    expect(health.status).toBe('ok');
    expect(health.ready).toBe(true);
    await runtime.stop();
    expect(runtime.state()).toBe('stopped');
  });

  it('injects dependencies via ctx.get', async () => {
    let injected: unknown;
    const runtime = rt([
      { name: 'db', init: () => ({ kind: 'db' }) },
      {
        name: 'repo',
        dependsOn: ['db'],
        init: (ctx) => {
          injected = ctx.get('db');
          return { kind: 'repo' };
        },
      },
    ]);
    await runtime.start();
    expect(injected).toEqual({ kind: 'db' });
  });

  it('rolls back started services when one fails to start', async () => {
    const stopped: string[] = [];
    const runtime = rt([
      { name: 'a', init: () => ({}), start: () => undefined, stop: () => void stopped.push('a') },
      { name: 'b', dependsOn: ['a'], init: () => ({}), start: () => { throw new Error('boom'); } },
    ]);
    await expect(runtime.start()).rejects.toThrow('boom');
    expect(runtime.state()).toBe('error');
    expect(stopped).toEqual(['a']);
  });

  it('publishes lifecycle events on the single bus', async () => {
    const runtime = rt([]);
    const seen: string[] = [];
    runtime.events().subscribe('lifecycle.*', (e: CloudEvent) => void seen.push(e.type));
    await runtime.start();
    await runtime.stop();
    expect(seen).toContain('lifecycle.started');
    expect(seen).toContain('lifecycle.stopping');
  });

  it('exposes the unified runtime API', () => {
    const runtime = rt([]);
    expect(runtime.version).toContain('preview');
    expect(typeof runtime.events().publish).toBe('function');
    expect(typeof runtime.scheduler().tick).toBe('function');
    expect(typeof runtime.audit().append).toBe('function');
    expect(typeof runtime.notifications().send).toBe('function');
    expect(typeof runtime.timeline().forPartition).toBe('function');
    expect(typeof runtime.plugins().register).toBe('function');
    expect(runtime.services().size()).toBe(0);
    expect(runtime.context().mode).toBe('development');
  });

  it('enforces a per-service startup timeout', async () => {
    const runtime = rt([
      { name: 'slow', timeoutMs: 10, init: () => new Promise((res) => setTimeout(() => res({}), 200)) },
    ]);
    await expect(runtime.start()).rejects.toThrow(/timed out/);
  });
});

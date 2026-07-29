import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { loadConfig, isFlagEnabled, envSecretProvider } from './config';
import { HealthSystem } from './health';
import { Scheduler } from './scheduler';
import { PluginRuntime, satisfiesMinVersion } from './plugins';
import { createEventRuntime } from './events';
import { createObservabilityRuntime } from './observability';

describe('config + modes', () => {
  it('resolves mode from input, env, then default', () => {
    expect(loadConfig({ mode: 'production' }).mode).toBe('production');
    expect(loadConfig({ env: { NP_RUNTIME_MODE: 'air_gapped' } }).mode).toBe('air_gapped');
    expect(loadConfig({ env: { NP_RUNTIME_MODE: 'bogus' } }).mode).toBe('development');
    expect(loadConfig().mode).toBe('development');
  });
  it('exposes flags and injected secrets (never process.env)', () => {
    const c = loadConfig({ flags: { beta: true } });
    expect(isFlagEnabled(c, 'beta')).toBe(true);
    expect(isFlagEnabled(c, 'missing')).toBe(false);
    expect(envSecretProvider({ K: 'v' }).get('K')).toBe('v');
    expect(envSecretProvider({}).get('nope')).toBeUndefined();
  });
});

describe('HealthSystem', () => {
  it('aggregates worst status and readiness', () => {
    const h = new HealthSystem();
    h.register('a', () => ({ status: 'ok', ready: true }));
    h.register('b', () => ({ status: 'degraded', ready: true }));
    const r = h.report();
    expect(r.status).toBe('degraded');
    expect(r.ready).toBe(true);
    expect(r.services).toHaveLength(2);
    h.register('c', () => ({ status: 'down', ready: false, detail: 'db down' }));
    const r2 = h.report();
    expect(r2.status).toBe('down');
    expect(r2.ready).toBe(false);
  });
});

describe('Scheduler', () => {
  it('runs tasks when due and reschedules by interval', async () => {
    const clock = new ManualClock(0);
    const s = new Scheduler(clock);
    let runs = 0;
    s.register({ name: 'cleanup', intervalMs: 100, handler: () => void runs++ });
    expect(await s.tick()).toEqual([]); // nextRun is 100
    clock.advance(100);
    expect(await s.tick()).toEqual(['cleanup']);
    expect(runs).toBe(1);
    expect(await s.tick()).toEqual([]); // rescheduled to 200
  });

  it('retries a failing task up to maxRetries, then backs off', async () => {
    const clock = new ManualClock(0);
    const s = new Scheduler(clock);
    let attempts = 0;
    s.register({
      name: 'flaky',
      intervalMs: 100,
      maxRetries: 2,
      handler: () => {
        attempts++;
        throw new Error('boom');
      },
    });
    clock.advance(100);
    await s.tick(); // attempt 1 -> retry
    await s.tick(); // attempt 2 -> retry
    await s.tick(); // attempt 3 -> back off
    expect(attempts).toBe(3);
    expect(s.failures('flaky')).toBe(3);
    expect(await s.tick()).toEqual([]); // backed off to next interval
  });
});

describe('PluginRuntime', () => {
  it('registers plugins, discovers capabilities', () => {
    const p = new PluginRuntime('1.2.0');
    p.register({
      name: 'ai-anthropic',
      version: '1.0.0',
      capabilities: ['ai-provider'],
      register: (ctx) => ctx.register('ai-provider', { id: 'anthropic' }),
    });
    expect(p.discover('ai-provider')).toHaveLength(1);
    expect(p.discover('ai-provider')[0].plugin).toBe('ai-anthropic');
    expect(p.list()).toHaveLength(1);
  });

  it('rejects a plugin that requires a newer runtime', () => {
    const p = new PluginRuntime('1.0.0');
    expect(() =>
      p.register({ name: 'x', version: '1.0.0', capabilities: [], requires: { runtime: '2.0.0' }, register: () => undefined }),
    ).toThrow(/requires runtime/);
  });

  it('compares versions', () => {
    expect(satisfiesMinVersion('1.2.0', '1.0.0')).toBe(true);
    expect(satisfiesMinVersion('1.0.0', '1.2.0')).toBe(false);
    expect(satisfiesMinVersion('0.0.0-preview.1', '0.0.0')).toBe(true);
  });
});

describe('event + observability runtime', () => {
  it('publishes through the single bus and exposes categories', async () => {
    const er = createEventRuntime(new ManualClock(0));
    const seen: string[] = [];
    er.subscribe('*', (e) => void seen.push(e.type));
    await er.publish({ type: 'domain.thing', topic: 'x', partitionKey: 'p', version: 1, payload: {} });
    expect(seen).toEqual(['domain.thing']);
    expect(er.categories()).toContain('lifecycle');
    expect(er.deadLetters()).toEqual([]);
  });

  it('produces trace ids and performance timers', () => {
    const clock = new ManualClock(0);
    const o = createObservabilityRuntime(clock);
    expect(o.newTraceId().startsWith('trace_')).toBe(true);
    const timer = o.startTimer('op');
    clock.advance(5);
    expect(timer.end()).toBe(5);
    expect(o.metrics.snapshot().gauges['timer.op.ms']).toBe(5);
  });
});

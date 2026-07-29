import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ProviderRegistry } from '@neuropause/ai-runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createIntegrationPlatform } from './platform';
import { FakeHttpClient, type HttpResponse } from './http';

const OK = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, body: JSON.stringify(body) });

describe('createIntegrationPlatform (integration)', () => {
  it('registers provider adapters into the ai-runtime registry (stays governed)', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const http = new FakeHttpClient(() => OK({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const platform = createIntegrationPlatform({ runtime, http, clock });

    const registry = new ProviderRegistry();
    const built = platform.registerProviders(registry, { openai: { apiKey: 'sk' }, anthropic: { apiKey: 'ak' } });
    expect(built).toHaveLength(2);
    // the adapters are in the ONE registry the runtime routes through
    expect(registry.get('openai')).toBeDefined();
    expect(registry.route('gpt-4o').id).toBe('openai');

    const result = await registry.route('gpt-4o').generate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('hi');
  });

  it('exposes credentials, webhooks, observability, matrix, and readiness', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    const platform = createIntegrationPlatform({ runtime, http: new FakeHttpClient(() => OK({})) });
    expect(platform.version).toContain('preview');
    expect(platform.matrix().length).toBeGreaterThan(20);
    expect(platform.readiness().liveVerified).toBe(1);
    for (const fn of [platform.http, platform.provider, platform.credentials, platform.webhooks, platform.observability, platform.matrix, platform.readiness]) {
      expect(typeof fn).toBe('function');
    }
    // sync requires the persistence layer — it fails loudly rather than silently
    expect(() => platform.sync()).toThrow(/persistence/);
  });

  it('records provider + webhook + sync metrics into observability', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    const obs = createIntegrationPlatform({ runtime, http: new FakeHttpClient(() => OK({})) }).observability();
    obs.recordProvider('openai', { ok: true, promptTokens: 10, completionTokens: 5, model: 'gpt-4o' });
    obs.recordSync(3, 1);
    const snap = obs.snapshot();
    expect(snap.providers.openai?.totalTokens).toBe(15);
    expect(snap.sync).toEqual({ runs: 1, records: 3, conflicts: 1 });
    expect(snap.cost.priced).toBe(false); // no price table → cost not fabricated
  });
});

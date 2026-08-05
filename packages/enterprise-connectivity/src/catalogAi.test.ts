import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createEnterpriseConnectivity } from './platform';

describe('E3-E7 / E8 — connector catalogs + AI provider platform', () => {
  it('exposes represented systems across five categories, reusing integration frameworks where available', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ec = createEnterpriseConnectivity(rt, { clock });
    const all = ec.catalog().all();
    expect(all).toHaveLength(5);
    expect(ec.catalog().catalog('erp').systems).toContain('SAP');
    expect(ec.catalog().catalog('erp').reusedIntegrationFramework).toBe(true);
    expect(ec.catalog().catalog('communication').reusedIntegrationFramework).toBe(false); // metadata-only, local
    expect(ec.catalog().representedSystemCount()).toBeGreaterThanOrEqual(24);
  });

  it('routes AI requests with failover and NEVER fabricates external usage', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ai = createAiRuntime(rt);
    const ec = createEnterpriseConnectivity(rt, { clock, aiRuntime: ai, integrationPlatform: undefined });

    expect(ec.aiProviders().supportedProviders()).toHaveLength(6);
    const none = ec.aiProviders().route({ model: 'gpt-4o' });
    expect(none.selected).toBeNull(); // no configured provider — nothing invoked

    await ec.aiProviders().register({ provider: 'Anthropic', configured: true });
    const routed = ec.aiProviders().route({ model: 'claude-opus', preference: ['OpenAI', 'Anthropic'] });
    expect(routed.selected).toBe('Anthropic');
    expect(routed.failedOver).toBe(true); // OpenAI not configured → failed over
    expect(ec.aiProviders().usage().externalRequests).toBe(0); // usage never fabricated
    expect(ec.aiProviders().aiRuntimeProviderCount().reusedAiRuntime).toBe(true);
  });
});

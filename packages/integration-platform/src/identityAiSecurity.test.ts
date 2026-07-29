import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from '@neuropause/infrastructure';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createIntegrationPlatform } from './platform';

describe('E3, E14, E17 — identity integration, AI integration, integration security', () => {
  it('identity integration REUSES the Sprint-2 identity platform', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    const ip = createIntegrationPlatform(rt, { clock, infrastructure: infra });
    const conn = await ip.identity().connect({ system: 'Okta', tenant: 'acme' });
    expect(conn.reusedInfrastructure).toBe(true);
    expect(ip.identity().systems()).toContain('Microsoft Entra ID');
  });

  it('AI integration REUSES the existing AI runtime; providers represented', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ai = createAiRuntime(rt);
    const ip = createIntegrationPlatform(rt, { clock, aiRuntime: ai });
    const conn = await ip.ai().connect({ provider: 'Anthropic' });
    expect(conn.reusedAiRuntime).toBe(true);
    expect(ip.ai().providers()).toHaveLength(7);
    expect(typeof ip.ai().aiRuntimeProviders()).toBe('number');
  });

  it('integration security REUSES security tokens and exposes references only', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const ip = createIntegrationPlatform(rt, { clock, security: sec });
    const id = await sec.identity().register({ type: 'user', displayName: 'svc', tenant: 'acme' });
    const tok = await ip.security().issueToken(id.id, 'integration-token');
    expect(ip.security().verifyToken(tok!.token)).toBe(id.id);
    const ref = await ip.security().registerApiKeyRef({ name: 'sap-key', secretRef: 'vault:acme/sap' });
    expect(ref.ref).toBe('vault:acme/sap'); // a reference, never a value
    expect(ip.security().reusesSecurity()).toBe(true);
  });
});

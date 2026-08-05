import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from './platform';

describe('E1, E2, E4–E13 — integration runtime, API gateway, adapter frameworks', () => {
  it('an integration is active ONLY after configure AND verify', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const intg = await ip.runtime().register({ name: 'ACME SAP', category: 'erp', system: 'SAP S/4HANA' });
    expect(intg.status).toBe('registered');
    await ip.runtime().configure(intg.id, { endpoint: 'https://sap.acme.internal', credentialRef: 'vault:acme/sap' });
    await expect(ip.runtime().activate(intg.id)).rejects.toThrow(/must be verified/);
    await ip.runtime().verifyConnection(intg.id, { verified: true, evidenceRef: 'handshake-ok' });
    const active = await ip.runtime().activate(intg.id);
    expect(active.status).toBe('active');
    expect(ip.runtime().activeCount()).toBe(1);
  });

  it('the API gateway really validates and rate-limits', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ep = await ip.gateway().registerEndpoint({ protocol: 'rest', path: '/orders', requiredFields: ['id'], rateLimitPerWindow: 2 });
    expect(ip.gateway().validateRequest(ep.id, {}).valid).toBe(false);
    expect(ip.gateway().validateRequest(ep.id, { id: 1 }).valid).toBe(true);
    expect(ip.gateway().checkRate(ep.id, 'caller-1').allowed).toBe(true);
    expect(ip.gateway().checkRate(ep.id, 'caller-1').allowed).toBe(true);
    expect(ip.gateway().checkRate(ep.id, 'caller-1').allowed).toBe(false); // over the window limit
    expect(ip.gateway().analytics().rejected).toBe(1);
  });

  it('adapter frameworks represent systems and carry honesty guards', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    expect(ip.framework('erp').systems()).toHaveLength(6);
    const stripe = await ip.framework('finance').connect({ system: 'Stripe' });
    expect(stripe.status).toBe('represented');
    expect(stripe.note).toMatch(/NEVER processes a real payment/);
    const epic = await ip.framework('healthcare').connect({ system: 'Epic' });
    expect(epic.note).toMatch(/NEVER fabricates patient records/);
    await expect(ip.framework('crm').connect({ system: 'NotACrm' })).rejects.toThrow(/not a supported crm system/);
  });
});

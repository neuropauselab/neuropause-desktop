import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createIntegrationPlatform } from '@neuropause/integration-platform';
import { createEnterpriseConnectivity } from './platform';

describe('E1 — enterprise connector runtime', () => {
  it('reaches active ONLY after configure AND verify, reusing the integration adapter framework', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ip = createIntegrationPlatform(rt, { clock });
    const ec = createEnterpriseConnectivity(rt, { clock, integrationPlatform: ip });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'connectivity.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    const conn = await ec.connectors().register({ name: 'acme-sfdc', category: 'crm', system: 'Salesforce' });
    expect(conn.status).toBe('registered');
    expect(conn.reusedIntegration).toBe(true);
    expect(ec.connectors().health(conn.id).healthy).toBe(false);

    await ec.connectors().configure(conn.id, 'vault:acme/sfdc');
    expect(ec.connectors().get(conn.id)!.status).toBe('configured');
    expect(ec.connectors().get(conn.id)!.credentialRef).toBe('vault:acme/sfdc'); // a reference, never a value

    const verified = await ec.connectors().verify(conn.id, { verified: true, evidenceRef: 'oauth-proof-1' });
    expect(verified.status).toBe('active');
    expect(ec.connectors().activeCount()).toBe(1);
    expect(ec.connectors().permissions(conn.id).granted).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    expect(events[events.length - 1]!['replayId']).toBeTruthy();
  });

  it('fails verification when a connector is not configured — never silently active', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ec = createEnterpriseConnectivity(rt, { clock });
    const conn = await ec.connectors().register({ name: 'acme-sap', category: 'erp', system: 'SAP' });
    const result = await ec.connectors().verify(conn.id, { verified: true, evidenceRef: 'x' });
    expect(result.status).toBe('failed'); // cannot verify before configure
    expect(ec.connectors().activeCount()).toBe(0);
    expect(ec.connectors().discover('storage')).toContain('Google Drive');
  });
});

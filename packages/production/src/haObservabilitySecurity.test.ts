import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createOperationsPlatform } from '@neuropause/operations';
import { createSecurityPlatform } from '@neuropause/security';
import { createProductionPlatform } from './platform';
import { quorumModel } from './highAvailability';

describe('M7–M9 — high availability, observability, security hardening', () => {
  it('HA computes real quorum and marks real clusters infrastructure-pending', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const prod = createProductionPlatform(rt, { clock });
    expect(quorumModel(5)).toEqual({ nodes: 5, quorum: 3, tolerates: 2 });
    const cluster = await prod.highAvailability().registerCluster({ name: 'core', nodes: 5, replicas: 3 });
    expect(cluster.quorum).toBe(3);
    expect(cluster.note).toMatch(/infrastructure-pending/);
  });

  it('observability REUSES the operations dashboard and health registry', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createOperationsPlatform(rt);
    const prod = createProductionPlatform(rt, { clock, operations: ops });
    expect(prod.monitoring().dashboard().connected).toBe(true);
    expect(typeof prod.monitoring().serviceHealth().status).toBe('string');

    const solo = createProductionPlatform(rt, { clock });
    expect(solo.monitoring().serviceHealth().status).toBe('No production data available');
  });

  it('security hardening REUSES the security key & session managers for real operations', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const prod = createProductionPlatform(rt, { clock, security: sec });

    const rot = await prod.security().rotateKeys('tenant-1');
    expect(rot.reusedSecurity).toBe(true);
    expect(typeof rot.version).toBe('number');

    const session = await sec.sessions().create({ identityId: 'user-1', tenant: 'tenant-1' });
    expect(prod.security().validateSession(session.id).valid).toBe(true);

    prod.security().registerCertificate({ name: 'tls', expiresAt: clock.now() + 1000 });
    expect(prod.security().expiringCertificates(5000)).toHaveLength(1); // real expiry check
  });
});

import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createInfrastructurePlatform } from './platform';

describe('E8–E9 — authorization, zero trust', () => {
  it('authorization REUSES the security RBAC/ABAC engine for real decisions', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    await infra.authorization().defineRole({ id: 'ops', name: 'Operator', permissions: ['infrastructure:read', 'infrastructure:deploy'] });
    const permit = infra.authorization().authorize({ subjectId: 'u1', roles: ['ops'], action: 'read', resourceType: 'infrastructure' });
    expect(permit.allowed).toBe(true);
    const deny = infra.authorization().authorize({ subjectId: 'u2', roles: [], action: 'delete', resourceType: 'infrastructure' });
    expect(deny.allowed).toBe(false);
    expect(infra.authorization().roleTemplates().length).toBe(3);
  });

  it('zero trust denies on untrusted device/network/high risk and permits when clean', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const sec = createSecurityPlatform(rt);
    const infra = createInfrastructurePlatform(rt, { clock, security: sec });
    await infra.authorization().defineRole({ id: 'admin', name: 'Admin', permissions: ['*:*'] });

    const clean = await infra.zeroTrust().evaluate({ subjectId: 'u1', roles: ['admin'], action: 'deploy', resourceType: 'infrastructure', deviceTrusted: true, networkTrusted: true, riskScore: 10 });
    expect(clean.allowed).toBe(true);

    const untrustedDevice = await infra.zeroTrust().evaluate({ subjectId: 'u1', roles: ['admin'], action: 'deploy', resourceType: 'infrastructure', deviceTrusted: false, networkTrusted: true, riskScore: 10 });
    expect(untrustedDevice.allowed).toBe(false);
    expect(untrustedDevice.requiresStepUp).toBe(true);

    const highRisk = await infra.zeroTrust().evaluate({ subjectId: 'u1', roles: ['admin'], action: 'deploy', resourceType: 'infrastructure', deviceTrusted: true, networkTrusted: true, riskScore: 95 });
    expect(highRisk.allowed).toBe(false);

    const unauthorized = await infra.zeroTrust().evaluate({ subjectId: 'u2', roles: [], action: 'deploy', resourceType: 'infrastructure', deviceTrusted: true, networkTrusted: true, riskScore: 10 });
    expect(unauthorized.allowed).toBe(false);
  });
});

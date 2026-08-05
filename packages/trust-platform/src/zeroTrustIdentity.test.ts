import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createSecurityPlatform } from '@neuropause/security';
import { createTrustPlatform } from './platform';

describe('E1 / E2 — Zero Trust runtime + enterprise identity security', () => {
  it('evaluates access via the REUSED authorization engine, gated by trust level', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(rt, { clock });
    security.authorization().defineRole({ id: 'reader', name: 'reader', permissions: ['document:read'] });
    const tp = createTrustPlatform(rt, { clock, security });

    const policy = await tp.zeroTrust().definePolicy({ name: 'read-confidential', resourceClass: 'confidential', minTrust: 'high', permission: 'document:read' });
    await tp.zeroTrust().classify('doc-1', 'confidential');

    // permitted by RBAC AND trust level meets the policy minimum
    const ok = await tp.zeroTrust().evaluate({ policyId: policy.id, subject: { id: 'u1', roles: ['reader'] }, resourceType: 'document', action: 'read', subjectTrust: 'verified' });
    expect(ok.reusedAuthorization).toBe(true);
    expect(ok.allowed).toBe(true);

    // same permission but insufficient trust → denied by the Zero Trust gate
    const denied = await tp.zeroTrust().evaluate({ policyId: policy.id, subject: { id: 'u1', roles: ['reader'] }, resourceType: 'document', action: 'read', subjectTrust: 'low' });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('below policy minimum');
  });

  it('scores trust from supplied signals and reports missing ones honestly', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    const device = await tp.zeroTrust().registerDevice({ deviceId: 'dev-1', managed: true, compliant: true });
    expect(device.level).toBe('high');

    const score = tp.zeroTrust().score({ identity: 100, 'device-posture': 90 });
    expect(score.score).toBe(95);
    expect(score.level).toBe('verified');
    expect(score.missingSignals).toContain('network'); // never claims a signal it wasn't given
  });

  it('grants JIT + break-glass via the reused authorization engine and provisions real service accounts', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const security = createSecurityPlatform(rt, { clock });
    const tp = createTrustPlatform(rt, { clock, security });

    const req = await tp.identitySecurity().requestPrivilege({ subjectId: 'admin-1', permission: 'secrets:rotate', reason: 'quarterly rotation' });
    expect(req.state).toBe('requested');
    await tp.identitySecurity().approve(req.id, 'ciso');
    const active = await tp.identitySecurity().activate(req.id, clock.now() + 3_600_000);
    expect(active.state).toBe('active');
    expect(active.reusedAuthorization).toBe(true);

    const glass = await tp.identitySecurity().breakGlass({ subjectId: 'admin-2', permission: 'db:read', reason: 'sev1 outage', approver: 'cto', expiresAt: clock.now() + 900_000 });
    expect(glass.breakGlass).toBe(true);
    expect(glass.state).toBe('active');

    const svc = await tp.identitySecurity().registerServiceAccount({ name: 'ci-runner', tenant: 'acme' });
    expect(svc.reusedIdentity).toBe(true);
    expect(tp.identitySecurity().serviceAccountCount()).toBe(1);
  });

  it('refuses to activate a privilege that was never approved', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const tp = createTrustPlatform(rt, { clock });
    const req = await tp.identitySecurity().requestPrivilege({ subjectId: 'x', permission: 'p:do', reason: 'r' });
    const denied = await tp.identitySecurity().activate(req.id, clock.now() + 1000);
    expect(denied.state).toBe('denied'); // deny-by-default: approval is required
  });
});

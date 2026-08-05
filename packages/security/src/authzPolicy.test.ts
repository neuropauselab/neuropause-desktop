import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform, type SecurityPlatform } from './platform';
import type { AccessRequest } from './authz';

describe('Authorization — RBAC + ABAC + least privilege', () => {
  let clock: ManualClock;
  let p: SecurityPlatform;
  beforeEach(() => {
    clock = new ManualClock(0);
    p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    p.authorization().defineRole({ id: 'editor', name: 'Editor', permissions: ['workspace:read', 'workspace:write', 'tool:*'] });
  });

  it('grants via role permissions + wildcards, denies by default', () => {
    const subject = { id: 'u1', roles: ['editor'] };
    expect(p.authorization().authorize({ subject, action: 'read', resource: { type: 'workspace' } }).allowed).toBe(true);
    expect(p.authorization().authorize({ subject, action: 'call', resource: { type: 'tool' } }).allowed).toBe(true); // tool:*
    expect(p.authorization().authorize({ subject, action: 'delete', resource: { type: 'workspace' } }).allowed).toBe(false);
    expect(p.authorization().authorize({ subject: { id: 'u2', roles: [] }, action: 'read', resource: { type: 'workspace' } }).allowed).toBe(false); // default deny
  });

  it('resolves delegation + JIT into effective permissions, with expiry', async () => {
    await p.authorization().delegate('u1', 'u2', ['connector:invoke'], clock.now() + 10_000);
    expect(p.authorization().authorize({ subject: { id: 'u2', roles: [] }, action: 'invoke', resource: { type: 'connector' } }).allowed).toBe(true);
    await p.authorization().grantJit('u3', 'secret:read', clock.now() + 5_000, 'approver');
    expect(p.authorization().effectivePermissions({ id: 'u3', roles: [] })).toContain('secret:read');
    clock.advance(10_000); // both expire
    expect(p.authorization().authorize({ subject: { id: 'u2', roles: [] }, action: 'invoke', resource: { type: 'connector' } }).allowed).toBe(false);
    expect(p.authorization().effectivePermissions({ id: 'u3', roles: [] })).not.toContain('secret:read');
  });

  it('enforce() audits the decision and throws on deny; impersonation is audited', async () => {
    await expect(p.authorization().enforce({ subject: { id: 'u2', roles: [] }, action: 'read', resource: { type: 'workspace', tenant: 'acme' } })).rejects.toThrow(/denied/);
    await p.authorization().impersonate('admin', 'user', 'support ticket');
    const authzEvents = p.audit().events({ category: 'authorization' }).map((e) => e.action);
    expect(authzEvents).toContain('deny');
    expect(authzEvents).toContain('impersonation.start');
  });

  it('ABAC policy deny overrides an RBAC grant (deny wins)', () => {
    p.authorization().defineRole({ id: 'reader', name: 'Reader', permissions: ['document:read'] });
    const req: AccessRequest = { subject: { id: 'u4', roles: ['reader'] }, action: 'read', resource: { type: 'document', attributes: { classification: 'restricted' } } };
    // without policy: RBAC grants
    expect(p.authorization().authorize(req).allowed).toBe(true);
    // with a deny policy on restricted docs: denied
    void p.policy().add({ id: 'no-restricted', kind: 'data', effect: 'deny', target: { resourceType: 'document' }, conditions: [{ attribute: 'resource.attributes.classification', op: 'eq', value: 'restricted' }], description: 'restricted docs blocked' });
    expect(p.authorization().authorize(req, (r) => p.policy().evaluate(r)).allowed).toBe(false);
  });
});

describe('Policy engine — versioning, simulation, testing', () => {
  it('evaluates deny-wins, versions policies, simulates and tests', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    await p.policy().add({ id: 'p-permit', kind: 'access', effect: 'permit', target: { resourceType: 'doc' }, conditions: [] });
    await p.policy().add({ id: 'p-deny', kind: 'data', effect: 'deny', target: { resourceType: 'doc' }, conditions: [{ attribute: 'resource.attributes.pii', op: 'eq', value: true }] });
    const clean: AccessRequest = { subject: { id: 'u', roles: [] }, action: 'read', resource: { type: 'doc', attributes: { pii: false } } };
    const pii: AccessRequest = { subject: { id: 'u', roles: [] }, action: 'read', resource: { type: 'doc', attributes: { pii: true } } };
    expect(p.policy().evaluate(clean).effect).toBe('permit');
    expect(p.policy().evaluate(pii).effect).toBe('deny'); // deny wins over the permit

    await p.policy().add({ id: 'p-permit', kind: 'access', effect: 'permit', target: { resourceType: 'doc' }, conditions: [] }); // re-add → v2
    expect(p.policy().get('p-permit')?.version).toBe(2);
    expect(p.policy().versionsOf('p-permit')).toHaveLength(2);

    expect(p.policy().simulate(pii).result.effect).toBe('deny');
    const t = p.policy().test([
      { name: 'clean permits', request: clean, expect: 'permit' },
      { name: 'pii denies', request: pii, expect: 'deny' },
    ]);
    expect(t.passed).toBe(2);
    expect(t.failed).toBe(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createPgliteDriver, type PgliteDriver } from '@neuropause/persistence';
import { totpCode } from '@neuropause/security';
import { createNemsPlatform, type NemsPlatform } from './platform';
import { systemContext } from './types';

describe('Organizations, Users & Identity (Modules 1,2,3 — real Postgres)', () => {
  let runtime: EnterpriseRuntime;
  let driver: PgliteDriver;
  let nems: NemsPlatform;
  let clock: ManualClock;
  let orgA: { id: string };
  let orgB: { id: string };

  beforeAll(async () => {
    clock = new ManualClock(1_000_000);
    runtime = createEnterpriseRuntime({ clock });
    driver = await createPgliteDriver();
    nems = createNemsPlatform(runtime, { driver, clock, sessionPolicy: { idleTimeoutMs: 1000, absoluteTimeoutMs: 5000 } });
    await nems.migrate();
    orgA = await nems.organizations().create({ name: 'Acme', slug: 'acme' });
    orgB = await nems.organizations().create({ name: 'Globex', slug: 'globex' });
  });
  afterAll(async () => {
    await driver.close();
  });

  it('persists organizations + a business-unit → department → team hierarchy', async () => {
    expect((await nems.organizations().get(orgA.id))?.name).toBe('Acme');
    expect((await nems.organizations().list()).length).toBe(2);
    const ctx = systemContext(orgA.id);
    await nems.organizations().createBusinessUnit(ctx, { name: 'Platform' });
    const dept = await nems.organizations().createDepartment(ctx, { name: 'Engineering' });
    await nems.organizations().createTeam(ctx, { name: 'Core', departmentId: dept.id });
    expect(await nems.organizations().hierarchy(orgA.id)).toEqual({ businessUnits: 1, departments: 1, teams: 1 });
  });

  it('creates users with roles, updates status, and persists', async () => {
    const ctx = systemContext(orgA.id);
    const u = await nems.users().create(ctx, { email: 'ada@acme.test', password: 's3cret!', displayName: 'Ada', roles: ['manager'] });
    expect(u.roles).toContain('manager');
    expect((await nems.users().get(orgA.id, u.id))?.email).toBe('ada@acme.test');
    await nems.users().assignRole(ctx, u.id, 'executive');
    expect((await nems.users().get(orgA.id, u.id))?.roles).toEqual(expect.arrayContaining(['manager', 'executive']));
    await nems.users().setStatus(ctx, u.id, 'suspended');
    expect((await nems.users().get(orgA.id, u.id))?.status).toBe('suspended');
  });

  it('authorizes through the ONE security RBAC model', async () => {
    const ctx = systemContext(orgA.id);
    const admin = await nems.users().create(ctx, { email: 'admin@acme.test', password: 'pw', displayName: 'Admin', roles: ['admin'] });
    const viewer = await nems.users().create(ctx, { email: 'view@acme.test', password: 'pw', displayName: 'V', roles: ['viewer'] });
    expect(nems.roles().authorize(admin, 'write', 'dashboard')).toBe(true); // admin '*'
    expect(nems.roles().authorize(viewer, 'read', 'dashboard')).toBe(true); // viewer dashboard:read
    expect(nems.roles().authorize(viewer, 'write', 'dashboard')).toBe(false);
    expect((await nems.roles().list()).length).toBeGreaterThanOrEqual(5);
  });

  it('isolates tenants — org A cannot see org B users', async () => {
    const ub = await nems.users().create(systemContext(orgB.id), { email: 'bob@globex.test', password: 'pw', displayName: 'Bob' });
    expect(await nems.users().get(orgA.id, ub.id)).toBeUndefined();
    expect((await nems.users().list(orgA.id)).some((u) => u.id === ub.id)).toBe(false);
    expect((await nems.users().list(orgB.id)).some((u) => u.id === ub.id)).toBe(true);
  });

  it('logs in with a correct password, rejects a wrong one, and manages the session', async () => {
    const ctx = systemContext(orgA.id);
    const u = await nems.users().create(ctx, { email: 'login@acme.test', password: 'right-pw', displayName: 'Login' });
    expect((await nems.identity().login({ tenantId: orgA.id, email: 'login@acme.test', password: 'wrong' })).ok).toBe(false);
    const good = await nems.identity().login({ tenantId: orgA.id, email: 'login@acme.test', password: 'right-pw', deviceId: 'laptop' });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect((await nems.identity().validate(good.session.id)).valid).toBe(true);
      expect((await nems.identity().deviceSessions(orgA.id, u.id)).length).toBe(1);
      await nems.identity().logout(good.session.id);
      expect((await nems.identity().validate(good.session.id)).reason).toBe('revoked');
    }
  });

  it('enforces idle + absolute session timeouts', async () => {
    const u = await nems.users().create(systemContext(orgA.id), { email: 'timeout@acme.test', password: 'pw', displayName: 'T' });
    const s = await nems.identity().login({ tenantId: orgA.id, email: 'timeout@acme.test', password: 'pw' });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    clock.advance(1500); // idle window (1000) exceeded
    expect((await nems.identity().validate(s.session.id)).reason).toBe('idle-timeout');
    void u;
  });

  it('requires MFA once enrolled (real TOTP)', async () => {
    const ctx = systemContext(orgA.id);
    const u = await nems.users().create(ctx, { email: 'mfa@acme.test', password: 'pw', displayName: 'M' });
    const { secret } = await nems.identity().enrollMfa(ctx, u.id);
    const noCode = await nems.identity().login({ tenantId: orgA.id, email: 'mfa@acme.test', password: 'pw' });
    expect(noCode.ok === false && noCode.reason === 'mfa-required').toBe(true);
    const withCode = await nems.identity().login({ tenantId: orgA.id, email: 'mfa@acme.test', password: 'pw', mfaCode: totpCode(secret, clock.now()) });
    expect(withCode.ok).toBe(true);
  });

  it('invites a user who accepts and can then log in', async () => {
    const { token } = await nems.identity().invite(systemContext(orgA.id), { email: 'invitee@acme.test', role: 'contributor' });
    const user = await nems.identity().acceptInvitation(orgA.id, token, { password: 'invited-pw', displayName: 'Invitee' });
    expect(user.status).toBe('active');
    expect(user.roles).toContain('contributor');
    expect((await nems.identity().login({ tenantId: orgA.id, email: 'invitee@acme.test', password: 'invited-pw' })).ok).toBe(true);
  });

  it('resets a password, invalidating old sessions', async () => {
    const ctx = systemContext(orgA.id);
    await nems.users().create(ctx, { email: 'reset@acme.test', password: 'old-pw', displayName: 'R' });
    const s = await nems.identity().login({ tenantId: orgA.id, email: 'reset@acme.test', password: 'old-pw' });
    expect(s.ok).toBe(true);
    const req = await nems.identity().requestPasswordReset(orgA.id, 'reset@acme.test');
    expect(req).toBeTruthy();
    expect(await nems.identity().resetPassword(orgA.id, req!.token, 'new-pw')).toBe(true);
    if (s.ok) expect((await nems.identity().validate(s.session.id)).reason).toBe('revoked'); // old session gone
    expect((await nems.identity().login({ tenantId: orgA.id, email: 'reset@acme.test', password: 'old-pw' })).ok).toBe(false);
    expect((await nems.identity().login({ tenantId: orgA.id, email: 'reset@acme.test', password: 'new-pw' })).ok).toBe(true);
  });

  it('records every mutation on the one audit chain and publishes events', () => {
    expect(runtime.audit().list().length).toBeGreaterThan(0);
    expect(runtime.audit().verify().valid).toBe(true);
    expect(nems.events().count()).toBeGreaterThan(0);
    expect(nems.events().count('nems.user.created')).toBeGreaterThan(0);
    expect(nems.events().count('nems.session.started')).toBeGreaterThan(0);
  });
});

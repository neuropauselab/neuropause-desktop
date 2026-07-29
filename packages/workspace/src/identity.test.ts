import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { WorkspaceGovernance } from './governance';
import { IdentityDirectory } from './identity';

function setup(): { identity: IdentityDirectory; governance: WorkspaceGovernance } {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new WorkspaceGovernance(runtime, clock);
  return { identity: new IdentityDirectory(clock, governance), governance };
}

describe('IdentityDirectory — one principal + one permission model', () => {
  let identity: IdentityDirectory;
  let governance: WorkspaceGovernance;
  beforeEach(() => {
    ({ identity, governance } = setup());
  });

  it('treats humans and AI employees as the same principal type family', async () => {
    const human = await identity.registerPrincipal({ type: 'human', displayName: 'Sam' });
    const ai = await identity.registerPrincipal({ type: 'ai-employee', displayName: 'Ada' });
    expect(human.type).toBe('human');
    expect(ai.type).toBe('ai-employee');
    expect(identity.listPrincipals('ai-employee')).toHaveLength(1);
    expect(identity.listPrincipals()).toHaveLength(2);
  });

  it('resolves effective permissions from grants + roles + permission sets + delegation', async () => {
    identity.definePermissionSet({ id: 'ps-read', name: 'Reader', permissions: ['docs:read'] });
    identity.defineRole({ id: 'role-reader', name: 'Reader', permissionSetIds: ['ps-read'] });
    const p = await identity.registerPrincipal({ type: 'human', displayName: 'Sam', permissions: ['tasks:create'] });
    await identity.assignRole(p.id, 'role-reader');
    expect(identity.can(p.id, 'tasks:create')).toBe(true);
    expect(identity.can(p.id, 'docs:read')).toBe(true);
    expect(identity.can(p.id, 'billing:admin')).toBe(false);

    const svc = await identity.registerPrincipal({ type: 'service-account', displayName: 'CI' });
    await identity.delegate(p.id, svc.id, ['docs:read'], {});
    expect(identity.can(svc.id, 'docs:read')).toBe(true);
    const dlg = (await identity.delegate(p.id, svc.id, ['secrets:*'], {}));
    expect(identity.can(svc.id, 'secrets:rotate')).toBe(true); // wildcard grant
    await identity.revokeDelegation(dlg.id);
    expect(identity.can(svc.id, 'secrets:rotate')).toBe(false);
  });

  it('scopes membership and lists members per team/workspace', async () => {
    const a = await identity.registerPrincipal({ type: 'human', displayName: 'A' });
    const b = await identity.registerPrincipal({ type: 'human', displayName: 'B' });
    await identity.addMembership(a.id, 'team', 'team_1');
    await identity.addMembership(b.id, 'team', 'team_1');
    await identity.addMembership(a.id, 'workspace', 'ws_1');
    expect(identity.members('team', 'team_1').map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(identity.members('workspace', 'ws_1')).toHaveLength(1);
    expect(identity.membershipsOf(a.id)).toHaveLength(2);
  });

  it('audits impersonation start and end and requires a reason', async () => {
    const admin = await identity.registerPrincipal({ type: 'human', displayName: 'Admin' });
    const user = await identity.registerPrincipal({ type: 'human', displayName: 'User' });
    await expect(identity.impersonate(admin.id, user.id, '  ')).rejects.toThrow(/reason/);
    const session = await identity.impersonate(admin.id, user.id, 'support ticket #42');
    await identity.endImpersonation(session.id);
    const actions = governance.byDomain('identity').map((r) => r.action);
    expect(actions).toContain('impersonation.start');
    expect(actions).toContain('impersonation.end');
  });

  it('drops all permissions when a principal is deactivated', async () => {
    const p = await identity.registerPrincipal({ type: 'human', displayName: 'Sam', permissions: ['*'] });
    expect(identity.can(p.id, 'anything')).toBe(true);
    await identity.setActive(p.id, false);
    expect(identity.effectivePermissions(p.id)).toEqual([]);
    expect(identity.can(p.id, 'anything')).toBe(false);
  });
});

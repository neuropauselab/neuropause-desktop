import { describe, expect, it } from 'vitest';
import type { EnterprisePermission, OrgRole, OrgUser, OrgUserStatus } from '@neuropause/shared';
import {
  AuthorizationError,
  can,
  canAll,
  canAny,
  effectivePermissions,
  requirePermission,
} from './authz';

const NOW = '2026-07-01T00:00:00.000Z';

function role(id: string, permissions: EnterprisePermission[]): OrgRole {
  return {
    id,
    orgId: 'org',
    name: id,
    description: '',
    permissions,
    builtIn: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function member(
  roleIds: string[],
  status: OrgUserStatus = 'active',
  kind: OrgUser['kind'] = 'human',
): OrgUser {
  return {
    id: 'u1',
    orgId: 'org',
    name: 'U',
    email: null,
    title: '',
    kind,
    workerId: null,
    unitId: null,
    roleIds,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const admin = role('admin', ['org:read', 'org:manage', 'people:read', 'people:manage']);
const viewer = role('viewer', ['org:read', 'people:read', 'dashboard:read']);
const roles = [admin, viewer];

describe('effectivePermissions', () => {
  it('unions permissions across the member’s roles', () => {
    const eff = effectivePermissions(member(['admin', 'viewer']), roles);
    expect(eff.has('org:manage')).toBe(true);
    expect(eff.has('dashboard:read')).toBe(true);
    expect(eff.size).toBe(5); // org:read, org:manage, people:read, people:manage, dashboard:read
  });

  it('is empty for a non-active member, whatever their roles', () => {
    expect(effectivePermissions(member(['admin'], 'invited'), roles).size).toBe(0);
    expect(effectivePermissions(member(['admin'], 'suspended'), roles).size).toBe(0);
  });

  it('ignores unknown role ids', () => {
    expect(effectivePermissions(member(['ghost', 'viewer']), roles).has('dashboard:read')).toBe(
      true,
    );
    expect(effectivePermissions(member(['ghost']), roles).size).toBe(0);
  });

  it('resolves regardless of member kind (status/roles decide, not kind)', () => {
    expect(
      effectivePermissions(member(['viewer'], 'active', 'ai_worker'), roles).has('org:read'),
    ).toBe(true);
  });
});

describe('can / canAny / canAll', () => {
  it('can reflects a single permission', () => {
    expect(can(member(['viewer']), roles, 'org:read')).toBe(true);
    expect(can(member(['viewer']), roles, 'org:manage')).toBe(false);
  });

  it('canAny is true if the member holds at least one', () => {
    expect(canAny(member(['viewer']), roles, ['org:manage', 'dashboard:read'])).toBe(true);
    expect(canAny(member(['viewer']), roles, ['org:manage', 'people:manage'])).toBe(false);
  });

  it('canAll requires every permission', () => {
    expect(canAll(member(['admin']), roles, ['org:manage', 'people:manage'])).toBe(true);
    expect(canAll(member(['viewer']), roles, ['org:read', 'org:manage'])).toBe(false);
  });
});

describe('requirePermission', () => {
  it('passes silently when the member holds the permission', () => {
    expect(() => requirePermission(member(['admin']), roles, 'people:manage')).not.toThrow();
  });

  it('throws AuthorizationError naming the missing permission', () => {
    try {
      requirePermission(member(['viewer']), roles, 'people:manage');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).permission).toBe('people:manage');
    }
  });

  it('throws for a suspended member even with the right role', () => {
    expect(() => requirePermission(member(['admin'], 'suspended'), roles, 'org:manage')).toThrow(
      AuthorizationError,
    );
  });
});

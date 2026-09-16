/**
 * P13C ROUND 25 — W-1. AN AUDIT SIDE EFFECT MAY NOT VETO AN AUTHORIZATION OUTCOME.
 *
 * `createAuthorize` records a durable HOLD on the way out of every refusal. A
 * hold needs an owner, so on an install with no resolvable tenant scope that
 * write throws — and it was called BEFORE the authorization error was raised,
 * so the recorder's exception escaped in place of the real one.
 *
 * The user was told:
 *
 *   "Cannot record a hold: no organization and workspace are active, so it
 *    would have no owner."
 *
 * when the fact they needed was:
 *
 *   "No organization member is bound to this account."
 *
 * Both sentences are true. Only the second names the condition. The first is
 * the app failing to file paperwork ABOUT the second, and because it replaced
 * it, a Windows investigation spent its time in the data layer — the visible
 * error pointed at `dp:history` and at hold recording, neither of which was
 * broken.
 *
 * These tests pin the ordering property rather than the message text: whatever
 * the gate decides, the recorder cannot change it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EnterprisePermission, OrgRole, OrgUser } from '@neuropause/shared';
import { AuthorizationError, createAuthorize, UNRESOLVED_TENANT } from './authzGate';
import type { ActorResolverDeps } from './authzGate';

const ORG = 'org-alpha';

function member(over: Partial<OrgUser> = {}): OrgUser {
  return {
    id: 'user-1',
    orgId: ORG,
    name: 'Member One',
    email: 'one@example.com',
    kind: 'human',
    status: 'active',
    roleIds: ['role-viewer'],
    unitId: null,
    title: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as OrgUser;
}

function role(permissions: EnterprisePermission[]): OrgRole {
  return {
    id: 'role-viewer',
    orgId: ORG,
    name: 'Viewer',
    description: '',
    permissions,
    builtIn: true,
  } as OrgRole;
}

/** The exact failure the hold store raises when no tenant scope is resolvable. */
const HOLD_FAILURE = new Error(
  'Cannot record a hold: no organization and workspace are active, so it would have no owner.',
);

function deps(over: Partial<ActorResolverDeps> = {}): ActorResolverDeps {
  return {
    sessionEmail: () => 'one@example.com',
    activeOrgId: () => ORG,
    usersFor: () => [member()],
    rolesFor: () => [role([])],
    ownerMember: () => null,
    ...over,
  };
}

describe('W-1 — a failing refusal recorder never replaces the refusal', () => {
  it('a workspace-less install reports the MEMBERSHIP failure, not the hold failure', () => {
    // `activeOrgId` returning the sentinel is exactly what a null tenant scope
    // produces, which is exactly the state of an organization with no enterable
    // workspace. The recorder then throws, because a hold needs an owner.
    const authorize = createAuthorize(
      deps({
        activeOrgId: () => UNRESOLVED_TENANT,
        onPermissionRefused: () => {
          throw HOLD_FAILURE;
        },
      }),
    );

    expect(() => authorize('data:read')).toThrowError(
      'No organization member is bound to this account.',
    );
  });

  it('an RBAC refusal still throws AuthorizationError when recording fails', () => {
    const authorize = createAuthorize(
      deps({
        rolesFor: () => [role([])], // holds nothing
        onPermissionRefused: () => {
          throw HOLD_FAILURE;
        },
      }),
    );

    expect(() => authorize('people:manage')).toThrowError(AuthorizationError);
  });

  it('a platform-only refusal still throws AuthorizationError when recording fails', () => {
    const authorize = createAuthorize(
      deps({
        isPlatformOperator: () => false,
        onPermissionRefused: () => {
          throw HOLD_FAILURE;
        },
      }),
    );

    // `platform:operate` is platform-only, so it refuses before resolveActor.
    expect(() => authorize('platform:operate' as EnterprisePermission)).toThrowError(
      AuthorizationError,
    );
  });

  it('the swallowed recorder failure is reported, not silently discarded', () => {
    const onRefusalRecordFailed = vi.fn();
    const authorize = createAuthorize(
      deps({
        activeOrgId: () => UNRESOLVED_TENANT,
        onPermissionRefused: () => {
          throw HOLD_FAILURE;
        },
        onRefusalRecordFailed,
      }),
    );

    expect(() => authorize('data:read')).toThrow();
    expect(onRefusalRecordFailed).toHaveBeenCalledTimes(1);
    const call = onRefusalRecordFailed.mock.calls[0]![0] as {
      permission: string;
      error: unknown;
    };
    expect(call.permission).toBe('data:read');
    expect(call.error).toBe(HOLD_FAILURE);
  });

  it('a recorder that succeeds is still called, with the same input as before', () => {
    const onPermissionRefused = vi.fn();
    const onRefusalRecordFailed = vi.fn();
    const authorize = createAuthorize(
      deps({ rolesFor: () => [role([])], onPermissionRefused, onRefusalRecordFailed }),
    );

    expect(() => authorize('people:manage')).toThrowError(AuthorizationError);
    expect(onPermissionRefused).toHaveBeenCalledTimes(1);
    const input = onPermissionRefused.mock.calls[0]![0] as { permission: string; held: unknown[] };
    expect(input.permission).toBe('people:manage');
    expect(Array.isArray(input.held)).toBe(true);
    // No failure means the failure hook stays untouched — this is the guard
    // against "wrapped in try/catch" quietly becoming "always reports a problem".
    expect(onRefusalRecordFailed).not.toHaveBeenCalled();
  });

  it('an absent recorder is still not an error path', () => {
    const authorize = createAuthorize(deps({ rolesFor: () => [role([])] }));
    expect(() => authorize('people:manage')).toThrowError(AuthorizationError);
  });

  it('a permitted action is unaffected — the recorder is never consulted', () => {
    const onPermissionRefused = vi.fn(() => {
      throw HOLD_FAILURE;
    });
    const authorize = createAuthorize(
      deps({ rolesFor: () => [role(['data:read'])], onPermissionRefused }),
    );

    expect(() => authorize('data:read')).not.toThrow();
    expect(onPermissionRefused).not.toHaveBeenCalled();
  });
});

/**
 * P13C ROUND 26 — W-5. EIGHT REASONS, ONE SENTENCE.
 *
 * `tenantContext.resolveFull()` distinguishes eight reasons a tenant cannot be
 * resolved, each with plain-words text already written for a person to read.
 * `createAuthorize` discarded every one of them and threw:
 *
 *   "No organization member is bound to this account."
 *
 * True of all eight. Useful for one. An install that never signed in, an
 * install with no workspace, and an install whose workspace points at a deleted
 * organization are three different faults with three different remedies — and
 * from outside the process they were indistinguishable.
 *
 * That is not a cosmetic complaint. Diagnosing the Windows build required
 * reading JSON files off the machine, twice, across several days, because the
 * application would not say which of the eight it was. The information existed
 * the whole time and was thrown away one function call before it was needed.
 *
 * These tests pin that each refusal arrives intact and carries a stable code.
 */
import { describe, expect, it } from 'vitest';
import type { EnterprisePermission, OrgRole, OrgUser, TenantRefusal } from '@neuropause/shared';
import { TENANT_REFUSAL_MESSAGE } from '@neuropause/shared';
import { createAuthorize, TenantContextError, UNRESOLVED_TENANT } from './authzGate';
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
  return { id: 'role-viewer', orgId: ORG, name: 'Viewer', description: '', permissions, builtIn: true } as OrgRole;
}

function deps(over: Partial<ActorResolverDeps> = {}): ActorResolverDeps {
  return {
    sessionEmail: () => 'one@example.com',
    activeOrgId: () => ORG,
    usersFor: () => [member()],
    rolesFor: () => [role(['data:read'])],
    ownerMember: () => null,
    ...over,
  };
}

/** Every reason the resolver can produce. If the union grows, this must too. */
const REASONS: TenantRefusal['reason'][] = [
  'not_signed_in',
  'not_loaded',
  'no_workspace',
  'workspace_orphaned',
  'not_a_member',
  'not_in_workspace',
  'member_inactive',
  'tenant_not_operable',
];

describe('W-5 — the gate reports which tenant refusal occurred', () => {
  it.each(REASONS)('%s reaches the caller with its own message and code', (reason) => {
    const refusal: TenantRefusal = { reason, message: TENANT_REFUSAL_MESSAGE[reason] };
    const authorize = createAuthorize(
      deps({ activeOrgId: () => UNRESOLVED_TENANT, tenantRefusal: () => refusal }),
    );

    let thrown: unknown;
    try {
      authorize('data:read');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(TenantContextError);
    expect((thrown as TenantContextError).reason).toBe(reason);
    expect((thrown as Error).message).toBe(TENANT_REFUSAL_MESSAGE[reason]);
    // The generic sentence must NOT be what the caller sees any more.
    expect((thrown as Error).message).not.toBe('No organization member is bound to this account.');
  });

  it('every reason has distinct text — otherwise the codes are the only signal', () => {
    const messages = REASONS.map((r) => TENANT_REFUSAL_MESSAGE[r]);
    expect(new Set(messages).size).toBe(REASONS.length);
  });

  it('a resolvable tenant with no matching member still gets the membership sentence', () => {
    // This is the ONE case the old message was right about, and it must survive:
    // the tenant resolves, so `tenantRefusal` returns null, and the fault really
    // is that this account is not a member of it.
    const authorize = createAuthorize(
      deps({
        usersFor: () => [],
        ownerMember: () => member({ id: 'user-owner', email: 'someone.else@example.com' }),
        tenantRefusal: () => null,
      }),
    );

    expect(() => authorize('data:read')).toThrowError(
      'No organization member is bound to this account.',
    );
  });

  it('a resolver with no tenantRefusal dep behaves exactly as before', () => {
    const authorize = createAuthorize(deps({ activeOrgId: () => UNRESOLVED_TENANT }));
    expect(() => authorize('data:read')).toThrowError(
      'No organization member is bound to this account.',
    );
  });

  it('a permitted action is unaffected — the refusal path is never consulted', () => {
    let consulted = 0;
    const authorize = createAuthorize(
      deps({
        tenantRefusal: () => {
          consulted += 1;
          return null;
        },
      }),
    );
    expect(() => authorize('data:read')).not.toThrow();
    expect(consulted).toBe(0);
  });

  it('a failing refusal recorder still cannot replace the tenant reason (W-1 holds)', () => {
    const refusal: TenantRefusal = { reason: 'no_workspace', message: TENANT_REFUSAL_MESSAGE.no_workspace };
    const authorize = createAuthorize(
      deps({
        activeOrgId: () => UNRESOLVED_TENANT,
        tenantRefusal: () => refusal,
        onPermissionRefused: () => {
          throw new Error(
            'Cannot record a hold: no organization and workspace are active, so it would have no owner.',
          );
        },
      }),
    );

    // The exact Windows symptom: W-1 stops the hold write from winning, W-5
    // makes what remains name the actual condition.
    expect(() => authorize('data:read')).toThrowError(TENANT_REFUSAL_MESSAGE.no_workspace);
  });
});

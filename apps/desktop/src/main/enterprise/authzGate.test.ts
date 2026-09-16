import { describe, expect, it } from 'vitest';
import type {
  EnterprisePermission,
  IpcChannelName,
  OrgRole,
  OrgUser,
  OrgUserStatus,
} from '@neuropause/shared';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  IpcChannel,
  PLATFORM_ONLY_PERMISSIONS,
  RUNTIME_INVOKABLE_CHANNELS,
  isPlatformOnlyPermission,
} from '@neuropause/shared';
import { AuthorizationError } from './authz';
import {
  DYNAMICALLY_AUTHORIZED_ENTERPRISE_CHANNELS,
  ENTERPRISE_CHANNEL_PERMISSIONS,
  canDeleteMember,
  createAuthorize,
  decideOwnerClaim,
  guardBuiltInRolePatch,
  guardOwnerUserPatch,
  resolveActor,
  withEnterpriseAuthz,
  type ActorResolverDeps,
} from './authzGate';

const NOW = '2026-07-08T00:00:00.000Z';
const ORG = 'org-default';

function role(id: string, permissions: EnterprisePermission[]): OrgRole {
  return {
    id,
    orgId: ORG,
    name: id,
    description: '',
    permissions,
    builtIn: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function member(
  id: string,
  email: string | null,
  roleIds: string[],
  status: OrgUserStatus = 'active',
  kind: OrgUser['kind'] = 'human',
): OrgUser {
  return {
    id,
    orgId: ORG,
    name: id,
    email,
    title: '',
    kind,
    workerId: kind === 'ai_worker' ? `worker-${id}` : null,
    unitId: null,
    roleIds,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * P13C ROUND 7 — the widest role an ORGANIZATION can grant.
 *
 * This used to be `[...ALL_ENTERPRISE_PERMISSIONS]` and the tests below asserted
 * the owner could do every single thing in that array. That was the trap the
 * round removed: a permission meant to be install-level would have been granted
 * here, silently, and these tests would have CONFIRMED the escalation as correct
 * behaviour. `PLATFORM_ONLY_PERMISSIONS` is excluded, and the exclusion is
 * asserted directly further down rather than left implicit.
 */
const ORG_GRANTABLE = ALL_ENTERPRISE_PERMISSIONS.filter((p) => !isPlatformOnlyPermission(p));
const ownerRole = role('role-owner', [...ORG_GRANTABLE]);
const viewerRole = role('role-viewer', ['org:read', 'dashboard:read', 'governance:read']);

interface World {
  session: string | null;
  users: OrgUser[];
  roles: OrgRole[];
  owner: OrgUser | null;
}

function depsOf(world: World): ActorResolverDeps {
  return {
    sessionEmail: () => world.session,
    activeOrgId: () => ORG,
    usersFor: (orgId) => world.users.filter((u) => u.orgId === orgId),
    rolesFor: (orgId) => world.roles.filter((r) => r.orgId === orgId),
    ownerMember: () => world.owner,
  };
}

const owner = member('user-owner', 'owner@np.dev', ['role-owner']); // a CLAIMED owner
const unclaimedOwner = member('user-owner', null, ['role-owner']); // fresh install, not yet claimed

describe('resolveActor', () => {
  it('returns null when there is no session', () => {
    const actor = resolveActor(
      depsOf({ session: null, users: [owner], roles: [ownerRole], owner }),
    );
    expect(actor).toBeNull();
  });

  it('resolves the member whose email matches the session (case/space-insensitive)', () => {
    const viewer = member('u-viewer', 'Viewer@Np.Dev', ['role-viewer']);
    const world = {
      session: '  viewer@np.dev ',
      users: [owner, viewer],
      roles: [ownerRole, viewerRole],
      owner,
    };
    const actor = resolveActor(depsOf(world));
    expect(actor?.member.id).toBe('u-viewer');
    expect(actor?.roles.map((r) => r.id)).toContain('role-viewer');
  });

  it('resolves a suspended matched member to that member — never the owner', () => {
    const suspended = member('u-suspended', 'sus@np.dev', ['role-viewer'], 'suspended');
    const world = {
      session: 'sus@np.dev',
      users: [owner, suspended],
      roles: [ownerRole, viewerRole],
      owner,
    };
    expect(resolveActor(depsOf(world))?.member.id).toBe('u-suspended');
  });

  it('never matches AI-worker members by email (falls through to the owner)', () => {
    const ai = member('u-ai', 'ai@np.dev', ['role-viewer'], 'active', 'ai_worker');
    const world = {
      session: 'ai@np.dev',
      users: [unclaimedOwner, ai],
      roles: [ownerRole, viewerRole],
      owner: unclaimedOwner,
    };
    // The AI worker is never matched by email; on a fresh (unclaimed) install the
    // owner fallback resolves instead — proving the AI member was skipped.
    expect(resolveActor(depsOf(world))?.member.id).toBe('user-owner');
  });

  it('falls back to the owner on a fresh unclaimed install (first-claim bootstrap)', () => {
    const world = {
      session: 'first@np.dev',
      users: [unclaimedOwner],
      roles: [ownerRole],
      owner: unclaimedOwner,
    };
    expect(resolveActor(depsOf(world))?.member.id).toBe('user-owner');
  });

  it('denies an unrecognized account once the owner is claimed (first-claim-wins)', () => {
    // The owner has a non-null email → the workspace is already claimed. A
    // different account matches no member and must NOT inherit ownership.
    const world = { session: 'intruder@evil.dev', users: [owner], roles: [ownerRole], owner };
    expect(resolveActor(depsOf(world))).toBeNull();
  });

  it('returns null when nothing matches and the owner record is gone', () => {
    const world = { session: 'someone@else.dev', users: [], roles: [ownerRole], owner: null };
    expect(resolveActor(depsOf(world))).toBeNull();
  });

  /**
   * GATE 24 — a corrupt member row must fail closed at the resolver, never crash
   * and never grant. The email can reload as a non-string when a store row was
   * hand-edited or truncated; the `typeof m.email === 'string'` guard skips it.
   * This pins that behavior at the authz resolver itself (previously only tested
   * one layer away, through the tenant resolver).
   */
  it('a corrupt row (non-string email) is skipped — no crash, no grant', () => {
    const corrupt = { ...member('u-corrupt', null, ['role-owner']), email: undefined as unknown as string };
    // The owner is CLAIMED, so first-claim-wins denies any unmatched session.
    const world = { session: 'anything@np.dev', users: [owner, corrupt], roles: [ownerRole], owner };
    expect(() => resolveActor(depsOf(world))).not.toThrow();
    expect(resolveActor(depsOf(world))).toBeNull();
  });

  it('a corrupt row cannot be matched by coercion (numeric email)', () => {
    const corrupt = { ...member('u-corrupt', null, ['role-owner']), email: 12 as unknown as string };
    // A claimed owner exists; the numeric "12" must never coerce into a match.
    const world = { session: '12', users: [owner, corrupt], roles: [ownerRole], owner };
    expect(resolveActor(depsOf(world))).toBeNull();
  });
});

describe('decideOwnerClaim (first-claim-wins)', () => {
  it('claims an unclaimed owner for the first account to sign in', () => {
    expect(
      decideOwnerClaim(
        { name: 'Workspace Owner', email: null },
        { name: 'Ada', email: 'ada@np.dev' },
      ),
    ).toEqual({ name: 'Ada', email: 'ada@np.dev' });
  });

  it('refreshes only the display name when the same account signs in (email preserved)', () => {
    expect(
      decideOwnerClaim(
        { name: 'Ada', email: 'ada@np.dev' },
        { name: 'Ada Lovelace', email: 'ADA@np.dev' },
      ),
    ).toEqual({ name: 'Ada Lovelace', email: 'ada@np.dev' });
  });

  it('does nothing when the same account signs in unchanged', () => {
    expect(
      decideOwnerClaim({ name: 'Ada', email: 'ada@np.dev' }, { name: 'Ada', email: 'ada@np.dev' }),
    ).toBeNull();
  });

  it('never rebinds a claimed owner to a different account', () => {
    expect(
      decideOwnerClaim({ name: 'Ada', email: 'ada@np.dev' }, { name: 'Eve', email: 'eve@evil.dev' }),
    ).toBeNull();
  });

  it('returns null when there is no owner record', () => {
    expect(decideOwnerClaim(null, { name: 'Ada', email: 'ada@np.dev' })).toBeNull();
  });
});

describe('createAuthorize', () => {
  it('rejects when unauthenticated, matching the bridge auth-gate message', () => {
    const authorize = createAuthorize(
      depsOf({ session: null, users: [owner], roles: [ownerRole], owner }),
    );
    expect(() => authorize('org:read')).toThrowError('Sign in to continue.');
  });

  it('allows the owner everything on a fresh unclaimed install (single-user bootstrap)', () => {
    const authorize = createAuthorize(
      depsOf({
        session: 'fresh-login@np.dev',
        users: [unclaimedOwner],
        roles: [ownerRole],
        owner: unclaimedOwner,
      }),
    );
    for (const p of ORG_GRANTABLE) expect(() => authorize(p)).not.toThrow();
    // …and NOT the install-level ones, on the very install where bootstrap is
    // most permissive. A fresh unclaimed install is exactly where an escalation
    // would be least noticed.
    for (const p of PLATFORM_ONLY_PERMISSIONS) expect(() => authorize(p)).toThrow();
  });

  it('allows the claimed owner everything when signed in with the owning account', () => {
    const authorize = createAuthorize(
      depsOf({ session: 'owner@np.dev', users: [owner], roles: [ownerRole], owner }),
    );
    for (const p of ORG_GRANTABLE) expect(() => authorize(p)).not.toThrow();
    // The claimed owner is no more install-level than the unclaimed one.
    for (const p of PLATFORM_ONLY_PERMISSIONS) expect(() => authorize(p)).toThrow();
  });

  it('denies a different account once ownership is claimed (no silent seizure)', () => {
    const authorize = createAuthorize(
      depsOf({ session: 'intruder@evil.dev', users: [owner], roles: [ownerRole], owner }),
    );
    expect(() => authorize('org:read')).toThrowError(
      'No organization member is bound to this account.',
    );
  });

  it('enforces the matched member’s own roles: reads pass, manage is denied', () => {
    const viewer = member('u-viewer', 'viewer@np.dev', ['role-viewer']);
    const authorize = createAuthorize(
      depsOf({
        session: 'viewer@np.dev',
        users: [owner, viewer],
        roles: [ownerRole, viewerRole],
        owner,
      }),
    );
    expect(() => authorize('org:read')).not.toThrow();
    try {
      authorize('org:manage');
      expect.unreachable('org:manage must be denied for a viewer');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).permission).toBe('org:manage');
    }
  });

  it('denies a suspended matched member even reads (suspension locks out)', () => {
    const suspended = member('u-suspended', 'sus@np.dev', ['role-viewer'], 'suspended');
    const authorize = createAuthorize(
      depsOf({
        session: 'sus@np.dev',
        users: [owner, suspended],
        roles: [ownerRole, viewerRole],
        owner,
      }),
    );
    expect(() => authorize('org:read')).toThrowError(AuthorizationError);
  });

  it('fails closed when authenticated but no actor can be resolved at all', () => {
    const authorize = createAuthorize(
      depsOf({ session: 'x@np.dev', users: [], roles: [], owner: null }),
    );
    expect(() => authorize('org:read')).toThrowError(
      'No organization member is bound to this account.',
    );
  });
});

describe('ENTERPRISE_CHANNEL_PERMISSIONS', () => {
  const enterpriseInvokable = RUNTIME_INVOKABLE_CHANNELS.filter((c) => c.startsWith('enterprise:'));

  it('guards every invokable enterprise channel — statically or dynamically, none unguarded', () => {
    const statik = new Set(Object.keys(ENTERPRISE_CHANNEL_PERMISSIONS));
    const dynamic = new Set<string>(DYNAMICALLY_AUTHORIZED_ENTERPRISE_CHANNELS);
    // Every enterprise channel is classified exactly once (static XOR dynamic).
    for (const channel of enterpriseInvokable) {
      const inStatic = statik.has(channel);
      const inDynamic = dynamic.has(channel);
      expect(inStatic || inDynamic, `unguarded enterprise channel: ${channel}`).toBe(true);
      expect(inStatic && inDynamic, `double-classified channel: ${channel}`).toBe(false);
    }
    // And neither set references a non-enterprise or non-existent channel.
    const known = new Set<string>(enterpriseInvokable);
    for (const c of [...statik, ...dynamic]) expect(known.has(c)).toBe(true);
  });

  it('uses only real permission scopes', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const p of Object.values(ENTERPRISE_CHANNEL_PERMISSIONS)) {
      expect(valid.has(p as string)).toBe(true);
    }
  });

  it('maps mutations to manage scopes and reads to read scopes', () => {
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseOrgCreateUnit]).toBe('org:manage');
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseOrgDeleteUser]).toBe(
      'people:manage',
    );
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseOrgCreateRole]).toBe(
      'governance:manage',
    );
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseGovernanceSetChain]).toBe(
      'governance:manage',
    );
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseWorkspaceSwitch]).toBe(
      'workspace:manage',
    );
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseOrgGet]).toBe('org:read');
    expect(ENTERPRISE_CHANNEL_PERMISSIONS[IpcChannel.EnterpriseDashboard]).toBe('dashboard:read');
  });
});

describe('withEnterpriseAuthz', () => {
  it('annotates handlers with their permission and forces requireAuth', () => {
    const defs = [
      { channel: IpcChannel.EnterpriseOrgGet as IpcChannelName, audit: false },
      { channel: IpcChannel.EnterpriseOrgCreateUnit as IpcChannelName, audit: true },
    ];
    const out = withEnterpriseAuthz(defs);
    expect(out[0]).toMatchObject({ permission: 'org:read', requireAuth: true, audit: false });
    expect(out[1]).toMatchObject({ permission: 'org:manage', requireAuth: true, audit: true });
  });

  it('throws at composition time for an unclassified channel', () => {
    expect(() =>
      withEnterpriseAuthz([{ channel: IpcChannel.MemoryRecall as IpcChannelName }]),
    ).toThrowError(/no permission classification/);
  });
});

describe('root-of-trust guards (lockout prevention)', () => {
  const OWNER_ID = 'user-owner';

  it('never allows deleting the seeded owner', () => {
    expect(canDeleteMember(OWNER_ID, OWNER_ID)).toBe(false);
    expect(canDeleteMember('someone-else', OWNER_ID)).toBe(true);
  });

  it('strips roles/status/email from an owner patch but keeps profile fields', () => {
    // O-13: email joins the immutable set — membership is decided by it, so an
    // in-tenant rewrite was an ownership transfer wearing a profile edit.
    const patch = guardOwnerUserPatch(OWNER_ID, OWNER_ID, {
      name: 'New Name',
      email: 'usurper@evil.test',
      roleIds: [],
      status: 'suspended',
    });
    expect(patch).toEqual({ name: 'New Name' });
    expect('roleIds' in patch).toBe(false);
    expect('status' in patch).toBe(false);
    expect('email' in patch).toBe(false);
  });

  it('passes non-owner patches through untouched', () => {
    const patch = {
      name: 'X',
      email: 'x@example.test',
      roleIds: ['role-viewer'],
      status: 'suspended' as const,
    };
    expect(guardOwnerUserPatch('u-2', OWNER_ID, patch)).toEqual(patch);
  });

  it('strips permissions from built-in role patches, allows rename', () => {
    const patch = guardBuiltInRolePatch(
      { builtIn: true },
      { name: 'Owner (renamed)', permissions: [] },
    );
    expect(patch).toEqual({ name: 'Owner (renamed)' });
  });

  it('leaves custom-role patches and missing roles untouched', () => {
    const patch = { name: 'Custom', permissions: ['org:read'] };
    expect(guardBuiltInRolePatch({ builtIn: false }, patch)).toEqual(patch);
    expect(guardBuiltInRolePatch(null, patch)).toEqual(patch);
  });
});

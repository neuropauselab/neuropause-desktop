/**
 * P13C ROUND 31 — W-10. THE INSTRUMENTATION HAS TO BE WHERE THE DECISION IS.
 *
 * Round 28 added a diagnostic that logged why a `not_a_member` refusal had
 * happened, wired into `createAuthorize` in `enterprise/index.ts`. On the
 * Windows machine that motivated it, it printed nothing — not once, across a
 * run in which the renderer showed the refusal on five separate screens.
 *
 * The reason is worth stating plainly, because it is a class of mistake and not
 * a typo. `livesync:status` obtains the refusal from `resolveFull()` and throws
 * it directly; it never calls `createAuthorize`. So does every other caller that
 * reads `scope()` and finds null. Hooking the gate measures the gate. There are
 * many callers and exactly one resolver, and the resolver is the thing that
 * decides, so the resolver is where the measurement belongs.
 *
 * WHAT THESE TESTS PIN
 *
 *   1. Every one of the eight refusals reports itself. Not seven.
 *   2. No address survives into the payload, for any of them.
 *   3. The transition — first refusal after a success, and the recovery — is
 *      observable, because "how long did it work before it stopped" was the
 *      question nobody in the process could answer.
 *   4. A hook that throws changes nothing. Instrumentation is not load-bearing.
 *   5. Structurally: no refusal path can bypass the hook, checked against the
 *      source, because a ninth reason added in six months will not remember.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Organization, OrgRole, OrgUser, TenantRefusal, Workspace } from '@neuropause/shared';
import {
  createTenantContextResolver,
  redactedEmailShape,
  type TenantContextDeps,
  type TenantRecovery,
  type TenantRefusalDiagnostic,
} from './tenantContext';

const NOW = '2026-01-01T00:00:00.000Z';
const SESSION_EMAIL = 'dishant.dobariya@neuropause033.com';

const ORG: Organization = {
  id: 'org-a',
  name: 'Tenant A',
  slug: 'a',
  description: '',
  type: 'business',
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
  metadata: {},
};

const WS: Workspace = {
  id: 'ws-a',
  name: 'A',
  organizationId: 'org-a',
  isolation: 'isolated',
  createdAt: NOW,
  updatedAt: NOW,
};

const ROLE: OrgRole = {
  id: 'role-a',
  orgId: 'org-a',
  name: 'Manager',
  description: '',
  permissions: ['crm:read'],
  builtIn: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const MEMBER: OrgUser = {
  id: 'user-a',
  orgId: 'org-a',
  name: 'Ada',
  email: SESSION_EMAIL,
  title: 'Ops',
  kind: 'human',
  workerId: null,
  unitId: null,
  roleIds: ['role-a'],
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
};

/** The eight. If the union grows, this array is the thing that must fail first. */
const ALL_REASONS: TenantRefusal['reason'][] = [
  'not_loaded',
  'not_signed_in',
  'no_workspace',
  'workspace_orphaned',
  'tenant_not_operable',
  'not_a_member',
  'member_inactive',
  'not_in_workspace',
];

describe('W-10 — every tenant refusal reports itself from inside the resolver', () => {
  let email: string | null;
  let loaded: boolean;
  let activeWs: string | null;
  let orgs: Map<string, Organization>;
  let workspaces: Map<string, Workspace>;
  let members: OrgUser[];
  let owner: OrgUser | null;
  let clockMs: number;
  let seen: TenantRefusalDiagnostic[];
  let recoveries: TenantRecovery[];

  const make = (over: Partial<TenantContextDeps> = {}) =>
    createTenantContextResolver({
      sessionEmail: () => email,
      isLoaded: () => loaded,
      activeWorkspaceId: () => activeWs,
      workspace: (id) => workspaces.get(id) ?? null,
      organization: (id) => orgs.get(id) ?? null,
      usersFor: (orgId) => members.filter((m) => m.orgId === orgId),
      rolesFor: (orgId) => (orgId === 'org-a' ? [ROLE] : []),
      ownerMember: () => owner,
      now: () => clockMs,
      onRefusal: (d) => {
        seen.push(d);
      },
      onRecovered: (r) => {
        recoveries.push(r);
      },
      ...over,
    });

  /** Put the fixture into the state that produces exactly one named refusal. */
  const arrange = (reason: TenantRefusal['reason']): void => {
    switch (reason) {
      case 'not_loaded':
        loaded = false;
        break;
      case 'not_signed_in':
        email = null;
        break;
      case 'no_workspace':
        activeWs = null;
        break;
      case 'workspace_orphaned':
        orgs.delete('org-a');
        break;
      case 'tenant_not_operable':
        orgs.set('org-a', { ...ORG, status: 'suspended' });
        break;
      case 'not_a_member':
        // A claimed owner at a different address: the fallback does not apply,
        // which is precisely the branch the Windows install lands in.
        members = [];
        owner = { ...MEMBER, id: 'user-owner', email: 'someone.else@example.com' };
        break;
      case 'member_inactive':
        members = [{ ...MEMBER, status: 'suspended' }];
        break;
      case 'not_in_workspace':
        members = [{ ...MEMBER, workspaceIds: ['ws-other'] }];
        break;
    }
  };

  beforeEach(() => {
    email = SESSION_EMAIL;
    loaded = true;
    activeWs = 'ws-a';
    orgs = new Map([[ORG.id, ORG]]);
    workspaces = new Map([[WS.id, WS]]);
    members = [MEMBER];
    owner = { ...MEMBER, id: 'user-owner', email: null };
    clockMs = 1_000_000;
    seen = [];
    recoveries = [];
  });

  /* ── 1. Completeness ──────────────────────────────────────────────────── */

  it.each(ALL_REASONS)('%s fires the hook exactly once, with its own reason', (reason) => {
    arrange(reason);
    const res = make().resolveFull();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusal.reason).toBe(reason);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe(reason);
  });

  it('a resolution that succeeds fires no refusal hook at all', () => {
    const res = make().resolveFull();
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it('scope() and resolve() report too — the hook is not exclusive to resolveFull', () => {
    // Every scoped store in the app reaches the resolver through `scope()`.
    // A diagnostic only wired into `resolveFull` would miss all of them.
    arrange('not_a_member');
    const r = make();
    expect(r.scope()).toBeNull();
    expect(r.resolve().ok).toBe(false);
    expect(seen.map((d) => d.reason)).toEqual(['not_a_member', 'not_a_member']);
  });

  /* ── 2. No address survives ───────────────────────────────────────────── */

  it.each(ALL_REASONS)('%s carries no email address anywhere in its payload', (reason) => {
    arrange(reason);
    make().resolveFull();

    const serialized = JSON.stringify(seen[0]);
    expect(serialized).not.toContain('dishant.dobariya');
    expect(serialized).not.toContain('someone.else');
    expect(serialized).not.toContain(SESSION_EMAIL);
  });

  it('redactedEmailShape keeps the domain and reduces the local part to a length', () => {
    expect(redactedEmailShape('Ada.Lovelace@Example.COM ')).toBe('12@example.com');
    expect(redactedEmailShape(null)).toBeNull();
    // Two different people at one domain look different; neither is readable.
    expect(redactedEmailShape('a@x.io')).toBe('1@x.io');
    expect(redactedEmailShape('abcd@x.io')).toBe('4@x.io');
    // Malformed input must not throw and must not leak.
    expect(redactedEmailShape('not-an-email')).toBe('12@');
  });

  /* ── 3. The facts are the ones the refusal used ───────────────────────── */

  it('not_a_member carries the predicates the Windows fault turns on', () => {
    arrange('not_a_member');
    make().resolveFull();

    const d = seen[0];
    expect(d?.reason).toBe('not_a_member');
    // The whole question: the renderer showed the owner's own address while the
    // resolver said not_a_member. If this is false, the two sessions disagree.
    expect(d?.sessionMatchesOwner).toBe(false);
    expect(d?.ownerExists).toBe(true);
    expect(d?.ownerClaimed).toBe(true);
    expect(d?.ownerOrgMatches).toBe(true);
    expect(d?.sessionMatchedAMember).toBe(false);
    expect(d?.memberCount).toBe(0);
    expect(d?.humanMembersWithEmail).toBe(0);
    expect(d?.workspaceOrgId).toBe('org-a');
  });

  it('an unclaimed owner reports sessionMatchesOwner false, not a match against empty', () => {
    // The owner row has a null email on a fresh install. Comparing a session
    // address to `''` would call that a match and invert the diagnosis.
    members = [];
    owner = { ...MEMBER, id: 'user-owner', email: null, orgId: 'org-other' };
    make().resolveFull();

    expect(seen[0]?.reason).toBe('not_a_member');
    expect(seen[0]?.ownerClaimed).toBe(false);
    expect(seen[0]?.sessionMatchesOwner).toBe(false);
    expect(seen[0]?.ownerEmailShape).toBeNull();
  });

  it('a refusal reports null for facts not yet established, never false', () => {
    // `not_signed_in` fires before any workspace is read. Reporting
    // `workspaceFound: false` there would be an invention that sends the next
    // engineer to look at the workspace store.
    arrange('not_signed_in');
    make().resolveFull();

    const d = seen[0];
    expect(d?.loaded).toBe(true);
    expect(d?.sessionEmailShape).toBeNull();
    expect(d?.workspaceFound).toBeNull();
    expect(d?.organizationFound).toBeNull();
    expect(d?.memberCount).toBeNull();
    expect(d?.ownerExists).toBeNull();
    expect(d?.memberStatus).toBeNull();
    expect(d?.memberInWorkspace).toBeNull();
  });

  it('member_inactive reports the status it rejected', () => {
    arrange('member_inactive');
    make().resolveFull();
    expect(seen[0]?.memberStatus).toBe('suspended');
    expect(seen[0]?.sessionMatchedAMember).toBe(true);
    // Read the member without ever reaching the owner fallback.
    expect(seen[0]?.ownerExists).toBeNull();
  });

  it('not_in_workspace reports a member who matched but is scoped elsewhere', () => {
    arrange('not_in_workspace');
    make().resolveFull();
    expect(seen[0]?.sessionMatchedAMember).toBe(true);
    expect(seen[0]?.memberStatus).toBe('active');
    expect(seen[0]?.memberInWorkspace).toBe(false);
    expect(seen[0]?.activeWorkspaceId).toBe('ws-a');
  });

  /* ── 4. The transition, which is the measurement ──────────────────────── */

  it('the first refusal after a success is flagged, and only that one', () => {
    const r = make();
    expect(r.resolveFull().ok).toBe(true);

    arrange('not_a_member');
    clockMs += 2_400_000; // 40 minutes, the interval observed on Windows
    r.resolveFull();
    r.resolveFull();
    r.resolveFull();

    expect(seen.map((d) => d.firstRefusalAfterSuccess)).toEqual([true, false, false]);
    expect(seen.map((d) => d.refusalIndex)).toEqual([1, 2, 3]);
  });

  it('msSinceLastSuccess is the interval that had to be measured by hand', () => {
    const r = make();
    r.resolveFull(); // success at t0
    arrange('not_a_member');
    clockMs += 2_400_000;
    r.resolveFull();

    expect(seen[0]?.msSinceLastSuccess).toBe(2_400_000);
  });

  it('a cold start that never resolved reports null, not zero', () => {
    // Zero would read as "it broke instantly", which is a different defect.
    arrange('not_loaded');
    make().resolveFull();
    expect(seen[0]?.msSinceLastSuccess).toBeNull();
    expect(seen[0]?.firstRefusalAfterSuccess).toBe(false);
  });

  it('recovery fires once, closing the bracket with the outage duration', () => {
    const r = make();
    r.resolveFull();

    arrange('not_a_member');
    clockMs += 600_000;
    r.resolveFull();
    clockMs += 60_000;
    r.resolveFull();

    // Whatever the fix turns out to be, this is what a restart does today.
    members = [MEMBER];
    owner = { ...MEMBER, id: 'user-owner', email: null };
    clockMs += 30_000;
    expect(r.resolveFull().ok).toBe(true);

    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]?.msSinceFirstRefusal).toBe(90_000);
    expect(recoveries[0]?.msSinceLastSuccess).toBe(690_000);
    expect(recoveries[0]?.refusalsWhileDown).toBe(2);
    expect(recoveries[0]?.lastRefusalReason).toBe('not_a_member');

    // A second success is not a second recovery.
    r.resolveFull();
    expect(recoveries).toHaveLength(1);
  });

  it('a first-call success is not reported as a recovery', () => {
    make().resolveFull();
    expect(recoveries).toHaveLength(0);
  });

  /* ── 5. Instrumentation is never load-bearing ─────────────────────────── */

  it('a hook that throws leaves the refusal exactly as it was', () => {
    arrange('not_a_member');
    const r = make({
      onRefusal: () => {
        throw new Error('logger exploded');
      },
    });

    const res = r.resolveFull();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.refusal.reason).toBe('not_a_member');
    expect(() => r.scope()).not.toThrow();
    expect(r.scope()).toBeNull();
  });

  it('a recovery hook that throws does not lose the successful resolution', () => {
    const r = make({
      onRecovered: () => {
        throw new Error('logger exploded');
      },
    });
    arrange('not_a_member');
    r.resolveFull();
    members = [MEMBER];
    expect(r.resolveFull().ok).toBe(true);
  });

  it('with no hooks wired the resolver behaves exactly as before', () => {
    for (const reason of ALL_REASONS) {
      // Fresh fixture per reason, or a suspended org leaks into the next case.
      email = SESSION_EMAIL;
      loaded = true;
      activeWs = 'ws-a';
      orgs = new Map([[ORG.id, ORG]]);
      workspaces = new Map([[WS.id, WS]]);
      members = [MEMBER];
      owner = { ...MEMBER, id: 'user-owner', email: null };
      arrange(reason);

      const bare = createTenantContextResolver({
        sessionEmail: () => email,
        isLoaded: () => loaded,
        activeWorkspaceId: () => activeWs,
        workspace: (id) => workspaces.get(id) ?? null,
        organization: (id) => orgs.get(id) ?? null,
        usersFor: (orgId) => members.filter((m) => m.orgId === orgId),
        rolesFor: () => [ROLE],
        ownerMember: () => owner,
      });
      const res = bare.resolveFull();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.refusal.reason).toBe(reason);
    }
  });

  /* ── 6. Structural: no refusal path may bypass the hook ───────────────── */

  it('resolveFull contains no refusal return that skips refuse()', () => {
    /**
     * A source invariant, deliberately. The behavioural tests above cover the
     * eight reasons that exist TODAY; this one covers the ninth. Round 28's
     * diagnostic was complete for the branch it was written against and blind
     * to every other, and nothing failed to say so.
     */
    const src = readFileSync(join(__dirname, 'tenantContext.ts'), 'utf8');
    const start = src.indexOf('const resolveFull = ():');
    const end = src.indexOf('  return {\n    resolveFull,', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const body = src.slice(start, end);
    // Exactly one construction of a refusal, and exactly one `ok: false` return
    // — the same statement, inside `refuse`. Any new branch that builds its own
    // fails here rather than going unreported for a fortnight.
    expect(body.split('refusalOf(').length - 1).toBe(1);
    const bareReturns = body.match(/return\s*\{\s*ok:\s*false[^}]*\}/g) ?? [];
    expect(bareReturns).toHaveLength(1);
    expect(bareReturns[0]).toContain('refusalOf(reason)');
    /**
     * And the set of reasons routed through the helper is the whole union —
     * asserted as a SET, not a count, because `no_workspace` is refused at two
     * sites (no id, and an id that resolves to nothing) and a count would have
     * to encode that coincidence to stay green.
     */
    const routed = [...body.matchAll(/return refuse\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(routed)].sort()).toEqual([...ALL_REASONS].sort());
  });
});

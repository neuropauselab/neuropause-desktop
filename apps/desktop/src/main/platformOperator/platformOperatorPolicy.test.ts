/**
 * PROGRAM 13C ROUND 7 — THE ONE AUTHORITY THAT IS NOT PER-ORGANIZATION.
 *
 * WHAT IS ACTUALLY BEING PROVED
 *
 * Round 6 left `setPolicyEnabled` behind `cloud:manage` and wrote down the cost:
 * a rate-limit policy governs the shared runtime, and `cloud:manage` is held by
 * every organization's Admin. So the exposure was never "an admin can do an admin
 * thing" — it was that ANYONE CAN CREATE AN ORGANIZATION AND BECOME ITS OWNER,
 * and an Owner held every permission in `ALL_ENTERPRISE_PERMISSIONS`. A control
 * over every tenant on the machine was two clicks from any signed-in user.
 *
 * The fix is not a stricter role. Every role in this product is per organization,
 * so no role can express it: whatever you grant tenant A's Admin, tenant B's Admin
 * holds the identical thing in their own org. The fix is a permission NO ROLE CAN
 * HOLD, satisfied by an install-level identity that switching organizations cannot
 * change because it was never keyed on one.
 *
 * These tests assert both halves. Refusal alone would pass against a permission
 * nobody can ever satisfy — which is an outage, not a control — so every refusal
 * here is paired with the operator succeeding at the same operation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  PLATFORM_ONLY_PERMISSIONS,
  isPlatformOnlyPermission,
  type EnterprisePermission,
  type OrgRole,
  type OrgUser,
} from '@neuropause/shared';
import { BUILT_IN_ROLE_SPECS } from '../enterprise/org/seed';
import { createAuthorize } from '../enterprise/authzGate';
import { PlatformOperatorRegistry } from './platformOperatorRegistry';
import { createPlatformAuthorizer } from './platformAuthority';
import { ApiPlatformStore, type PolicyChangeAudit } from '../cloud/apiplatform/apiPlatformStore';

const OPERATOR = 'operator@themachine.example';
const A_ADMIN = 'admin@alpha.example';
const B_ADMIN = 'admin@bravo.example';
const A_OWNER = 'owner@alpha.example';

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `nps-r7-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/* ── The permission itself ───────────────────────────────────────────────── */

describe('cloud:operate as a permission', () => {
  it('is declared platform-only', () => {
    expect(PLATFORM_ONLY_PERMISSIONS).toContain('cloud:operate');
    expect(isPlatformOnlyPermission('cloud:operate')).toBe(true);
    // …and the ordinary cloud permissions are NOT, so this is a real distinction
    // rather than a label applied to everything.
    expect(isPlatformOnlyPermission('cloud:manage')).toBe(false);
    expect(isPlatformOnlyPermission('cloud:read')).toBe(false);
  });

  /**
   * THE TRAP, AS A TEST.
   *
   * Owner was `[...ALL_ENTERPRISE_PERMISSIONS]`. Any permission added to that
   * array was granted to every organization's Owner on the next reconcile — so
   * an install-level capability would have silently become the most widely held
   * one in the product. This asserts the wildcard now means "everything an
   * ORGANIZATION can do", which is how everyone already read it.
   */
  it('NO built-in role holds it — not Owner, not Admin, not any other', () => {
    for (const spec of BUILT_IN_ROLE_SPECS) {
      expect(spec.permissions).not.toContain('cloud:operate');
    }
    // And the Owner role is otherwise still a wildcard — the filter removed one
    // permission, not the concept.
    const owner = BUILT_IN_ROLE_SPECS.find((r) => r.key === 'owner');
    expect(owner).toBeDefined();
    expect(owner!.permissions).toContain('cloud:manage');
    expect(owner!.permissions.length).toBe(
      ALL_ENTERPRISE_PERMISSIONS.length - PLATFORM_ONLY_PERMISSIONS.length,
    );
  });
});

/* ── The IPC gate ────────────────────────────────────────────────────────── */

describe('the authorizer', () => {
  /** A member holding exactly the permissions given. */
  function actorWith(
    email: string,
    orgId: string,
    permissions: readonly EnterprisePermission[],
  ): { users: OrgUser[]; roles: OrgRole[] } {
    const roleId = `role-${orgId}`;
    const user = {
      id: `user-${email}`,
      orgId,
      kind: 'human',
      name: email,
      email,
      status: 'active',
      roleIds: [roleId],
    } as unknown as OrgUser;
    const role = { id: roleId, orgId, name: 'Test', permissions: [...permissions] } as unknown as OrgRole;
    return { users: [user], roles: [role] };
  }

  function gate(input: {
    email: string;
    orgId: string;
    permissions: readonly EnterprisePermission[];
    operators?: string[];
  }): (p: EnterprisePermission) => void {
    const { users, roles } = actorWith(input.email, input.orgId, input.permissions);
    const operators = new Set((input.operators ?? []).map((e) => e.toLowerCase()));
    return createAuthorize({
      sessionEmail: () => input.email,
      activeOrgId: () => input.orgId,
      usersFor: () => users,
      rolesFor: () => roles,
      ownerMember: () => null,
      isPlatformOperator: (e) => operators.has(e.toLowerCase()),
    });
  }

  it('tenant A’s admin is DENIED', () => {
    const authorize = gate({ email: A_ADMIN, orgId: 'org-alpha', permissions: ['cloud:read', 'cloud:manage'] });
    expect(() => authorize('cloud:operate')).toThrow(/not authorized/i);
    // …and the SAME actor can still do everything cloud:manage covers, so the
    // change narrowed one operation rather than breaking the console.
    expect(() => authorize('cloud:manage')).not.toThrow();
  });

  it('tenant B’s admin is DENIED — identically, because nothing here is org-keyed', () => {
    const authorize = gate({ email: B_ADMIN, orgId: 'org-bravo', permissions: ['cloud:read', 'cloud:manage'] });
    expect(() => authorize('cloud:operate')).toThrow(/not authorized/i);
    expect(() => authorize('cloud:manage')).not.toThrow();
  });

  /**
   * The one that mattered most: creating an organization makes you its Owner, and
   * Owner held every permission that existed.
   */
  it('an ORGANIZATION OWNER holding every org permission is still DENIED', () => {
    const ownerSpec = BUILT_IN_ROLE_SPECS.find((r) => r.key === 'owner')!;
    const authorize = gate({ email: A_OWNER, orgId: 'org-alpha', permissions: ownerSpec.permissions });
    expect(() => authorize('cloud:operate')).toThrow(/not authorized/i);
  });

  it('cloud:manage ALONE is not enough — the two are not ordered by name', () => {
    const authorize = gate({ email: A_ADMIN, orgId: 'org-alpha', permissions: ['cloud:manage'] });
    expect(() => authorize('cloud:operate')).toThrow(/not authorized/i);
  });

  it('a platform operator is ALLOWED', () => {
    const authorize = gate({
      email: OPERATOR,
      orgId: 'org-alpha',
      permissions: [], // no org permissions AT ALL
      operators: [OPERATOR],
    });
    expect(() => authorize('cloud:operate')).not.toThrow();
    // The authority is genuinely separate: this operator holds no org scope, so
    // an ordinary cloud read is still refused.
    expect(() => authorize('cloud:read')).toThrow();
  });

  /**
   * SWITCHING ORGANIZATIONS CONFERS NOTHING.
   *
   * The failure this guards against is subtle and has happened elsewhere in this
   * program: an authority resolved through "the active organization" changes
   * meaning when the active organization changes. Here the same account is
   * checked under org A and then under org B, and the answer must be identical
   * both times — because the decision never consulted the organization.
   */
  it('A → B switching does not grant, and does not revoke, platform authority', () => {
    const asOrg = (orgId: string, operators: string[]): (p: EnterprisePermission) => void =>
      gate({ email: A_ADMIN, orgId, permissions: ['cloud:manage'], operators });

    // A non-operator: refused in A, still refused after switching to B.
    expect(() => asOrg('org-alpha', [])('cloud:operate')).toThrow();
    expect(() => asOrg('org-bravo', [])('cloud:operate')).toThrow();

    // An operator: allowed in A, and still allowed in B — the authority does not
    // evaporate on a switch either. Both directions, because a control that is
    // merely unreliable is also a control nobody trusts.
    expect(() => asOrg('org-alpha', [A_ADMIN])('cloud:operate')).not.toThrow();
    expect(() => asOrg('org-bravo', [A_ADMIN])('cloud:operate')).not.toThrow();
  });

  it('an unwired install refuses everyone — absent resolver means NOBODY', () => {
    const { users, roles } = actorWith(A_OWNER, 'org-alpha', ALL_ENTERPRISE_PERMISSIONS);
    const authorize = createAuthorize({
      sessionEmail: () => A_OWNER,
      activeOrgId: () => 'org-alpha',
      usersFor: () => users,
      rolesFor: () => roles,
      ownerMember: () => null,
      // isPlatformOperator deliberately omitted
    });
    expect(() => authorize('cloud:operate')).toThrow(/not authorized/i);
  });

  it('signed out is refused before anything else is consulted', () => {
    const authorize = createAuthorize({
      sessionEmail: () => null,
      activeOrgId: () => 'org-alpha',
      usersFor: () => [],
      rolesFor: () => [],
      ownerMember: () => null,
      isPlatformOperator: () => true, // even so
    });
    expect(() => authorize('cloud:operate')).toThrow(/sign in/i);
  });
});

/* ── The registry ────────────────────────────────────────────────────────── */

describe('the operator registry', () => {
  async function reg(input: { file?: unknown; env?: string }): Promise<PlatformOperatorRegistry> {
    if (input.file !== undefined) {
      await fs.writeFile(join(dir, 'platform-operators.json'), JSON.stringify(input.file));
    }
    const r = new PlatformOperatorRegistry(
      dir,
      input.env === undefined ? {} : { NEUROPAUSE_PLATFORM_OPERATORS: input.env },
    );
    await r.load();
    return r;
  }

  it('is EMPTY when no file exists — a missing file is not a bootstrap', async () => {
    const r = await reg({});
    expect(r.count()).toBe(0);
    expect(r.isOperator(OPERATOR)).toBe(false);
    expect(r.isOperator(A_OWNER)).toBe(false);
  });

  it('reads the file, and matches case-insensitively', async () => {
    const r = await reg({ file: { operators: ['Operator@TheMachine.Example'] } });
    expect(r.isOperator(OPERATOR)).toBe(true);
    expect(r.isOperator('OPERATOR@THEMACHINE.EXAMPLE')).toBe(true);
    expect(r.isOperator(A_ADMIN)).toBe(false);
  });

  /**
   * A corrupt list must not be read generously. The generous reading of "who may
   * reconfigure the shared runtime" is wrong every time.
   */
  it('a malformed file yields NOBODY, not everybody', async () => {
    for (const bad of [{ operators: 'not-an-array' }, { operators: [42, null, {}] }, { nope: true }]) {
      await fs.writeFile(join(dir, 'platform-operators.json'), JSON.stringify(bad));
      const r = new PlatformOperatorRegistry(dir, {});
      await r.load();
      expect(r.count()).toBe(0);
      expect(r.isOperator(OPERATOR)).toBe(false);
    }
  });

  it('null, empty and whitespace identities are never operators', async () => {
    const r = await reg({ file: { operators: [OPERATOR, '', '   '] } });
    expect(r.count()).toBe(1); // the blanks were dropped, not stored
    expect(r.isOperator(null)).toBe(false);
    expect(r.isOperator('')).toBe(false);
    expect(r.isOperator('   ')).toBe(false);
  });

  it('exposes a count and never the addresses', async () => {
    const r = await reg({ file: { operators: [OPERATOR] } });
    expect(r.count()).toBe(1);
    expect(JSON.stringify(r.count())).not.toContain('themachine');
    // There is no listing method to leak them through.
    expect((r as unknown as Record<string, unknown>).list).toBeUndefined();
  });
});

/* ── The authority token ─────────────────────────────────────────────────── */

describe('the platform authority', () => {
  const mint = (email: string | null, operators: string[]): ReturnType<ReturnType<typeof createPlatformAuthorizer>> =>
    createPlatformAuthorizer({
      sessionEmail: () => email,
      isOperator: (e) => operators.includes(e),
    })();

  it('an operator gets an authority naming who and when', () => {
    const a = mint(OPERATOR, [OPERATOR]);
    expect(a).not.toBeNull();
    expect(a!.operator).toBe(OPERATOR);
    expect(a!.permission).toBe('cloud:operate');
    expect(Date.parse(a!.at)).not.toBeNaN();
  });

  it('a tenant admin gets null, and so does a signed-out caller', () => {
    expect(mint(A_ADMIN, [OPERATOR])).toBeNull();
    expect(mint(null, [OPERATOR])).toBeNull();
    expect(mint('   ', [OPERATOR])).toBeNull();
  });

  /**
   * BACKGROUND WORK CANNOT CONJURE ONE.
   *
   * `BackgroundPrincipal` carries a `permissions` array that NO authorization
   * code in this repo reads — it is a tenancy mechanism, not an authority one. So
   * a background job "holding" cloud:operate would mean nothing, and the store
   * must not accept anything a background job can construct. A background caller
   * has no session, so the authorizer returns null and the operation is
   * unreachable — which is the point of demanding a value rather than trusting a
   * gate on one door.
   */
  it('a caller with no session — every background job — cannot obtain one', () => {
    expect(mint(null, [OPERATOR])).toBeNull();
  });
});

/* ── The operation, end to end ───────────────────────────────────────────── */

describe('setPolicyEnabled', () => {
  async function open(): Promise<ApiPlatformStore> {
    const s = new ApiPlatformStore(join(dir, `api-${randomUUID()}.json`))
      .bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }))
      .bindCloudTenantResolver(() => 'tnt_alpha');
    await s.load('tnt_alpha');
    return s;
  }

  const authorityFor = (email: string): NonNullable<ReturnType<ReturnType<typeof createPlatformAuthorizer>>> =>
    createPlatformAuthorizer({ sessionEmail: () => email, isOperator: () => true })()!;

  /**
   * PRESENCE FIRST. A test that only proves the refusal would also pass against a
   * policy list that is empty, or an operation that does nothing at all.
   */
  it('an operator changes a policy, and the change is real', async () => {
    const s = await open();
    const before = s.listPolicies();
    expect(before.length).toBeGreaterThan(0); // the feature exists

    const target = before[0]!;
    const result = s.setPolicyEnabled(target.id, !target.enabled, authorityFor(OPERATOR));
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(!target.enabled);
    expect(s.listPolicies().find((p) => p.id === target.id)!.enabled).toBe(!target.enabled);
  });

  /**
   * THE AUDIT, WITH EVERY FIELD THE ROUND DEMANDED.
   *
   * `authorizedBy`/`authorizedAt` come from the AUTHORITY, not the call site, so
   * the record cannot name an actor the authorizer never approved.
   */
  it('records actor, operation, policy, before, after, timestamp and authorization', async () => {
    const s = await open();
    const target = s.listPolicies()[0]!;
    const seen: PolicyChangeAudit[] = [];

    s.setPolicyEnabled(target.id, false, authorityFor(OPERATOR), (r) => seen.push(r));

    expect(seen).toHaveLength(1);
    const rec = seen[0]!;
    expect(rec.actor).toBe(OPERATOR);
    expect(rec.authorizedBy).toBe('cloud:operate');
    expect(Date.parse(rec.authorizedAt)).not.toBeNaN();
    expect(rec.operation).toBe('cloud.rate_policy.set_enabled');
    expect(rec.policyId).toBe(target.id);
    expect(rec.policyName).toBe(target.name);
    expect(rec.before).toBe(target.enabled);
    expect(rec.after).toBe(false);
    expect(Date.parse(rec.at)).not.toBeNaN();
  });

  it('an unknown policy id changes nothing and audits nothing', async () => {
    const s = await open();
    const seen: PolicyChangeAudit[] = [];
    expect(s.setPolicyEnabled('pol_does_not_exist', false, authorityFor(OPERATOR), (r) => seen.push(r))).toBeNull();
    expect(seen).toEqual([]);
  });
});

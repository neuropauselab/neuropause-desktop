/**
 * PIN A — CHARACTERIZATION. `tenantContext.scope()` flattens ALL EIGHT members of
 * `TenantRefusalReason` to a bare `null`.
 *
 * LABEL: **structural information-loss property.**
 *
 * EVIDENCE RUNG: SOURCE-PROVEN + TESTED (driven through the real
 * `createTenantContextResolver`, never a hand-built `scope` stub — CLAUDE §2 #17,
 * "pin against the real path, not a convenient shape").
 *
 * DOCSTRING REQUIREMENT (operator ruling, 20 Aug 2026), stated so no future reader
 * can mistake this pin for a cause:
 *
 *   **THIS PIN IS *NOT* DEMONSTRATED AS THE CAUSE OF THE 20 AUG CEREMONY FAILURE.**
 *
 * The preserved r3 log contains exactly two tenant lines, both at cold start
 * (12:08:37Z, `not_loaded`, RECOVERED 5ms later). There is no tenant refusal in the
 * 12:44–12:49Z ceremony window, and suppression cannot hide one because a refusal
 * following the 12:44:16Z success carries `firstRefusalAfterSuccess: true`, which
 * bypasses the interval gate. Completeness checked before relying on that negative:
 * exactly ONE `createTenantContextResolver` instance exists (`enterprise/index.ts:392`)
 * and its `onRefusal` is wired (`:416`) — there is no second, uninstrumented resolver.
 *
 * CHARACTERIZATION ≠ LOCALIZATION ≠ CAUSAL EXPLANATION.
 *
 * WHAT THIS PIN IS FOR: the resolver computes a typed, eight-valued reason and
 * `scope()` discards it. The refusal EVENT is separately instrumented at the resolver
 * (which is what produced the negative above); the refusal REASON is what `scope()`
 * loses. Both facts matter and they are not the same fact.
 *
 * WHEN THE P1 REPAIR LANDS this pin is UPDATED IN-BRACKET and the flip is part of the
 * acceptance test — the executionGate precedent. A failure here means the flattening
 * changed; re-derive every negative that rests on it.
 */
import { describe, it, expect } from 'vitest';
import type { Organization, OrgUser, Workspace } from '@neuropause/shared';
import { createTenantContextResolver, type TenantContextDeps } from './tenantContext';

/** The authoritative union, enumerated BY NAME as the operator ruled. */
const ALL_EIGHT = [
  'not_signed_in',
  'not_loaded',
  'no_workspace',
  'workspace_orphaned',
  'not_a_member',
  'not_in_workspace',
  'member_inactive',
  'tenant_not_operable',
] as const;

const ORG_ID = 'org_pin_a';
const WS_ID = 'ws_pin_a';
const EMAIL = 'operator@example.com';

const org = (over: Partial<Organization> = {}): Organization =>
  ({ id: ORG_ID, name: 'Pin A', slug: 'pin-a', description: '', ...over }) as Organization;

const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  id: WS_ID,
  name: 'Pin A',
  organizationId: ORG_ID,
  isolation: 'isolated',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
  ...over,
});

const member = (over: Partial<OrgUser> = {}): OrgUser =>
  ({
    id: 'usr_pin_a',
    orgId: ORG_ID,
    name: 'Operator',
    email: EMAIL,
    title: 'Operator',
    kind: 'human',
    workerId: null,
    unitId: null,
    roleIds: [],
    status: 'active',
    ...over,
  }) as OrgUser;

/** Deps that RESOLVE. Each case below perturbs exactly one of them. */
const baseDeps = (): TenantContextDeps =>
  ({
    sessionEmail: () => EMAIL,
    isLoaded: () => true,
    activeWorkspaceId: () => WS_ID,
    workspace: (id: string) => (id === WS_ID ? workspace() : null),
    organization: (id: string) => (id === ORG_ID ? org() : null),
    usersFor: () => [member()],
    rolesFor: () => [],
    ownerMember: () => null,
  }) as unknown as TenantContextDeps;

const withDeps = (over: Partial<TenantContextDeps>): TenantContextDeps =>
  ({ ...baseDeps(), ...over }) as TenantContextDeps;

/** One perturbation per refusal reason, each driving the REAL resolver. */
const CASES: ReadonlyArray<{ reason: (typeof ALL_EIGHT)[number]; deps: () => TenantContextDeps }> = [
  { reason: 'not_loaded', deps: () => withDeps({ isLoaded: () => false }) },
  { reason: 'not_signed_in', deps: () => withDeps({ sessionEmail: () => null }) },
  { reason: 'no_workspace', deps: () => withDeps({ activeWorkspaceId: () => null }) },
  { reason: 'workspace_orphaned', deps: () => withDeps({ organization: () => null }) },
  {
    reason: 'tenant_not_operable',
    deps: () => withDeps({ organization: () => org({ status: 'suspended' as Organization['status'] }) }),
  },
  { reason: 'not_a_member', deps: () => withDeps({ usersFor: () => [], ownerMember: () => null }) },
  {
    reason: 'member_inactive',
    deps: () => withDeps({ usersFor: () => [member({ status: 'invited' as OrgUser['status'] })] }),
  },
  {
    reason: 'not_in_workspace',
    deps: () => withDeps({ usersFor: () => [member({ workspaceIds: ['ws_other'] } as Partial<OrgUser>)] }),
  },
];

describe('PIN A · scope() flattens every TenantRefusal reason to null (information loss)', () => {
  it('the base deps RESOLVE — otherwise every case below would pass for the wrong reason', () => {
    const r = createTenantContextResolver(baseDeps());
    expect(r.resolveFull().ok, 'base fixture must resolve, or the perturbations prove nothing').toBe(true);
    expect(r.scope()).not.toBeNull();
  });

  for (const c of CASES) {
    it(`${c.reason}: resolveFull NAMES it, scope() returns a bare null`, () => {
      const resolver = createTenantContextResolver(c.deps());
      const full = resolver.resolveFull();
      expect(full.ok).toBe(false);
      if (full.ok) return;
      expect(full.refusal.reason).toBe(c.reason);
      // THE INFORMATION LOSS: the same call, one layer out, answers only `null`.
      expect(resolver.scope()).toBeNull();
    });
  }

  it('all EIGHT reasons are covered by name — a ninth member fails this pin rather than passing quietly', () => {
    expect(new Set(CASES.map((c) => c.reason))).toEqual(new Set(ALL_EIGHT));
    expect(ALL_EIGHT).toHaveLength(8);
  });
});

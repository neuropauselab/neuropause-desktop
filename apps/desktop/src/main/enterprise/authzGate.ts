/**
 * Enterprise authorization gate — the wiring layer that turns the pure `authz`
 * resolver into live enforcement on the secure IPC bridge.
 *
 * Three pieces, all Electron-free so they unit-test without the app runtime:
 *
 *  1. `resolveActor` — maps the signed-in session to an `OrgUser` + their org's
 *     roles. A session whose email matches a human member resolves to *that*
 *     member (their assigned roles decide what they may do). When no member
 *     matches, the seeded workspace owner is the fallback ONLY while it is still
 *     unclaimed (`owner.email === null`): the first account to sign in bootstraps
 *     a fresh single-user install as owner (first-claim-wins). Once the owner is
 *     claimed, an unrecognized account resolves to no actor (fails closed) rather
 *     than silently seizing ownership. No session → no actor.
 *  2. `createAuthorize` — builds the `authorize(permission)` dependency the
 *     secure bridge calls before dispatching a permission-annotated channel.
 *     Throws (never returns a verdict object) so the bridge's existing error
 *     shaping surfaces a clean, user-safe message.
 *  3. `ENTERPRISE_CHANNEL_PERMISSIONS` + `withEnterpriseAuthz` — the single
 *     source of truth mapping every enterprise channel to the permission it
 *     requires, and the annotator `initEnterprise` runs its handlers through.
 *     An enterprise channel missing from the map fails at startup, not open.
 *
 * Suspension is deliberate: a session email that matches a suspended or
 * invited member resolves to that member (who holds no permissions) — it never
 * falls back to the owner, so suspending someone actually locks them out.
 *
 * Ownership is first-claim-wins: the seeded owner is claimed once, by the first
 * account to sign in (see `decideOwnerClaim`), and handoff thereafter is an
 * explicit admin action (an owner-email `updateUser` under `people:manage`),
 * never an implicit consequence of a different account signing in.
 */
import type {
  EnterprisePermission,
  IpcChannelName,
  OrgRole,
  OrgUser,
  TenantRefusal,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { isPlatformOnlyPermission } from '@neuropause/shared';
import { AuthorizationError, can, effectivePermissions, requirePermission } from './authz';

/**
 * P13C ROUND 26 — W-5. THE SYSTEM KNEW WHY AND SAID SOMETHING ELSE.
 *
 * `resolveFull()` distinguishes EIGHT reasons a tenant cannot be resolved —
 * `not_signed_in`, `not_loaded`, `no_workspace`, `workspace_orphaned`,
 * `not_a_member`, `not_in_workspace`, `member_inactive`, `tenant_not_operable`
 * — each with a plain-words message already written for a person to read.
 *
 * `createAuthorize` discarded all eight and threw one sentence: "No
 * organization member is bound to this account." That sentence is TRUE of every
 * one of them and USEFUL for exactly one. An install that never signed in, an
 * install with no workspace, and an install whose workspace points at a deleted
 * organization are three different faults with three different remedies, and
 * they were indistinguishable from the outside — which is why diagnosing the
 * Windows build required reading files off the machine instead of reading the
 * error it printed.
 *
 * Carries `reason` as a stable code. Not a new error framework: the codes are
 * the existing `TenantRefusalReason` union, and the messages are the existing
 * `TENANT_REFUSAL_MESSAGE` table. Inventing a second vocabulary here would give
 * one condition two names.
 */
export class TenantContextError extends Error {
  readonly reason: TenantRefusal['reason'];
  constructor(refusal: TenantRefusal) {
    super(refusal.message);
    this.name = 'TenantContextError';
    this.reason = refusal.reason;
  }
}

/** The resolved identity a permission check runs against. */
export interface EnterpriseActor {
  member: OrgUser;
  roles: OrgRole[];
}

/** Live lookups injected by the enterprise composition root (or a test). */
export interface ActorResolverDeps {
  /** Email of the signed-in account, or null when unauthenticated. */
  sessionEmail: () => string | null;
  /**
   * A permission check failed. Optional so every existing test constructs the
   * resolver unchanged; supplied by the composition root, where it raises a
   * durable `insufficient_permission` HOLD.
   */
  onPermissionRefused?: (input: {
    permission: EnterprisePermission;
    /** Scopes the actor DOES hold — empty means no org membership at all. */
    held: readonly EnterprisePermission[];
    actorLabel: string;
  }) => void;
  /**
   * P13C ROUND 25 — W-1. THE RECORDER FAILED; THE DECISION STILL STANDS.
   *
   * `onPermissionRefused` writes a durable HOLD, and a hold needs an owner, so
   * on an install with no resolvable tenant scope that write THROWS. It was
   * called BEFORE the authorization error was raised, so its exception escaped
   * in place of the real one and the user was told
   *
   *   "Cannot record a hold: no organization and workspace are active"
   *
   * instead of "No organization member is bound to this account." The second
   * sentence names the actual condition; the first is an artefact of trying to
   * file the paperwork about it. A diagnostic that replaces its own subject is
   * worse than no diagnostic — this one pointed a Windows investigation at the
   * data layer when the fault was in tenancy.
   *
   * Optional, and the default swallows rather than rethrows, because rethrowing
   * IS the bug: an audit side effect must never veto an authorization outcome.
   * Supplied by the composition root so the swallow is LOGGED rather than
   * silent — a recorder that is failing has to stay visible to whoever reads
   * the log.
   */
  onRefusalRecordFailed?: (input: { permission: EnterprisePermission; error: unknown }) => void;
  /**
   * P13C ROUND 26 — W-5. WHY the tenant could not be resolved, when it could not.
   *
   * Returns the refusal `resolveFull()` produced, or null when a tenant IS
   * resolvable and the missing actor is genuinely a membership problem. Optional
   * so every existing test constructs the resolver unchanged; when absent the
   * gate falls back to the original sentence, which is the pre-W-5 behaviour.
   */
  tenantRefusal?: () => TenantRefusal | null;
  /** The org the active workspace is bound to — the scope of every handler. */
  activeOrgId: () => string;
  usersFor: (orgId: string) => OrgUser[];
  rolesFor: (orgId: string) => OrgRole[];
  /** The seeded workspace-owner member, if it still exists. */
  ownerMember: () => OrgUser | null;
  /**
   * Whether the signed-in account is an INSTALL-LEVEL platform operator.
   *
   * P13C ROUND 7. Optional so every existing test constructs the resolver
   * unchanged — and an ABSENT resolver means NOBODY, which is why the default
   * below is `() => false` rather than a throw. A platform-only permission
   * checked on an install that never wired the registry is refused, which is the
   * safe direction: the failure is "the control plane cannot be reconfigured",
   * not "anyone may reconfigure it".
   */
  isPlatformOperator?: (email: string) => boolean;
}

/**
 * Resolve the current session to an enterprise actor. Email matching is
 * case-insensitive and considers human members only (AI workers never invoke
 * renderer IPC; their actions are governed by the workforce policy engine).
 *
 * The owner fallback is load-bearing ONLY for a fresh, unclaimed install: once
 * the owner has an email (it has been claimed — see `decideOwnerClaim`), a
 * session matching no member fails closed instead of inheriting ownership.
 */
/**
 * The value `activeOrgId` returns when no tenant could be resolved.
 *
 * Exported so the gate and the resolver compare the SAME string. A sentinel
 * written out at two sites is a sentinel that eventually differs at one of them.
 * The NUL prefix makes it unconstructable as a real organization id.
 */
export const UNRESOLVED_TENANT = '\u0000no-tenant';

export function resolveActor(deps: ActorResolverDeps): EnterpriseActor | null {
  const email = deps.sessionEmail();
  if (!email) return null;
  const wanted = email.trim().toLowerCase();
  const orgId = deps.activeOrgId();
  /**
   * P11 — NO TENANT MEANS NO ACTOR, before anything else is consulted.
   *
   * `activeOrgId` returns `UNRESOLVED_TENANT` whenever the tenant context
   * refuses — cold start, suspended tenant, orphaned workspace, non-member.
   * Without this line the sentinel simply matched no org, `usersFor` returned
   * empty, and execution fell through to the owner branch below — so a tenant
   * REFUSAL routed into the unclaimed-owner fallback, which holds every
   * permission there is. Two implementations of first-claim-wins that disagreed
   * on the one field that makes it a tenant decision.
   */
  if (orgId === UNRESOLVED_TENANT) return null;
  const matched = deps
    .usersFor(orgId)
    .find((m) => m.kind === 'human' && m.email !== null && m.email.trim().toLowerCase() === wanted);
  if (matched) return { member: matched, roles: deps.rolesFor(matched.orgId) };
  const owner = deps.ownerMember();
  if (!owner) return null;
  // First-claim-wins: fall back to the owner only while the workspace is
  // unclaimed. A claimed owner (non-null email) that didn't match above means a
  // *different* account is signing in — deny rather than hand it the workspace.
  //
  // P11 adds `owner.orgId === orgId`: the owner of a DIFFERENT tenant is not a
  // fallback for this one. The tenant resolver already required this; the two
  // copies of the rule now agree.
  if (owner.email === null && owner.orgId === orgId) {
    return { member: owner, roles: deps.rolesFor(owner.orgId) };
  }
  return null;
}

/** The identity the seeded owner is bound to when first claimed. */
export interface OwnerClaim {
  name: string;
  email: string;
}

/**
 * First-claim-wins ownership. The seeded owner ships unclaimed (`email === null`);
 * the FIRST account to sign in claims it and becomes the permanent local root of
 * trust. Thereafter the SAME account only refreshes a changed display name, and a
 * DIFFERENT account never rebinds the owner — so no one can silently seize a
 * workspace by signing in. Ownership handoff is a deliberate admin action (an
 * owner-email `updateUser` by someone holding `people:manage`), not a side effect
 * of authentication.
 *
 * Pure and total: returns the identity to bind the owner to, or `null` to leave
 * the owner untouched.
 */
export function decideOwnerClaim(
  current: { name: string; email: string | null } | null,
  session: { name: string; email: string },
): OwnerClaim | null {
  if (!current) return null;
  if (current.email === null) return { name: session.name, email: session.email }; // unclaimed → first claim wins
  const same = current.email.trim().toLowerCase() === session.email.trim().toLowerCase();
  if (same && current.name !== session.name) return { name: session.name, email: current.email }; // same account → refresh name only
  return null; // different account, or nothing changed → never rebind
}

/**
 * Build the `authorize` dependency for `registerSecureHandlers`. Throws
 * `AuthorizationError` when the actor lacks the permission, or a plain error
 * matching the bridge's own auth-gate message when there is no session.
 */
export function createAuthorize(
  deps: ActorResolverDeps,
): (permission: EnterprisePermission) => void {
  /**
   * P13C ROUND 25 — W-1. RECORDING A REFUSAL CANNOT CHANGE THE REFUSAL.
   *
   * Every `onPermissionRefused` call in this function is a side effect of a
   * decision that has ALREADY been made. Letting it throw does not undo the
   * decision — it only substitutes a different exception for the one the caller
   * was about to receive, which is how the true message got lost.
   *
   * One helper rather than three try/catch blocks, so a fourth refusal site
   * added later cannot reintroduce the defect by forgetting to wrap itself.
   */
  const recordRefusal = (
    permission: EnterprisePermission,
    input: { held: readonly EnterprisePermission[]; actorLabel: string },
  ): void => {
    if (deps.onPermissionRefused === undefined) return;
    try {
      deps.onPermissionRefused({ permission, held: input.held, actorLabel: input.actorLabel });
    } catch (error) {
      deps.onRefusalRecordFailed?.({ permission, error });
    }
  };

  return (permission) => {
    const email = deps.sessionEmail();
    if (email === null) throw new Error('Sign in to continue.');

    /**
     * P13C ROUND 7 — PLATFORM-ONLY PERMISSIONS NEVER CONSULT ORG ROLES.
     *
     * Handled here, before `resolveActor`, and returning early rather than
     * falling through — because falling through would mean an operator ALSO
     * needs an org membership, and a platform operator is not a member of
     * anything. More importantly, an org role must never be able to satisfy this:
     * the whole point is that tenant A's Admin and tenant B's Admin are equally
     * refused, and that switching from A to B confers nothing, because nothing
     * about this decision is keyed on an organization.
     *
     * The refusal is recorded through the same hold channel as any other, so an
     * administrator who hits it gets a route forward rather than a dead toast.
     */
    if (isPlatformOnlyPermission(permission)) {
      if (deps.isPlatformOperator?.(email) === true) return;
      recordRefusal(permission, { held: [], actorLabel: email });
      throw new AuthorizationError(permission);
    }

    const actor = resolveActor(deps);
    if (!actor) {
      recordRefusal(permission, {
        held: [],
        actorLabel: deps.sessionEmail() ?? 'This account',
      });
      /**
       * P13C ROUND 26 — W-5. Say which of the eight it was.
       *
       * The membership sentence is kept as the fallback rather than deleted: it
       * is the correct answer when a tenant DOES resolve and the account simply
       * is not a member of it, and it is what a resolver with no `tenantRefusal`
       * dep still produces.
       */
      const refusal = deps.tenantRefusal?.() ?? null;
      if (refusal !== null) throw new TenantContextError(refusal);
      throw new Error('No organization member is bound to this account.');
    }
    if (!can(actor.member, actor.roles, permission)) {
      /**
       * An RBAC refusal is a HOLD, not an error.
       *
       * The request was understood and legitimate; the person simply is not
       * permitted. Thrown and caught, that fact dies with the toast and the
       * user is left with "something failed" and no route forward. Recording
       * it durably means the resolution — ask someone who holds the scope —
       * lands somewhere a person can actually act on it.
       *
       * The throw is UNCHANGED. Every existing caller, and the secure bridge's
       * own error path, behave exactly as before; this only adds a record.
       */
      recordRefusal(permission, {
        held: [...effectivePermissions(actor.member, actor.roles)],
        actorLabel: actor.member.name || actor.member.email || 'This account',
      });
    }
    requirePermission(actor.member, actor.roles, permission);
  };
}

/** A non-throwing read of what the current actor may do. */
export interface PermissionProbe {
  allows: (permission: EnterprisePermission) => boolean;
  held: () => readonly EnterprisePermission[];
  label: () => string;
}

/**
 * Ask what the actor may do, without acting.
 *
 * `createAuthorize` is the enforcement path: it throws, and it raises a durable
 * permission HOLD on the way out. Both behaviours are right for a refused
 * operation and wrong for a question — a UI that greys out a button it knows
 * will fail would otherwise fill the governance queue with holds nobody
 * requested, and an audit trail that records refusals nobody attempted is an
 * audit trail people stop reading.
 *
 * Shares `resolveActor` and `can` with the enforcement path on purpose. Two
 * implementations of "may they?" is how a button ends up enabled for an action
 * the server will refuse.
 */
export function createPermissionProbe(deps: ActorResolverDeps): PermissionProbe {
  return {
    allows: (permission) => {
      if (deps.sessionEmail() === null) return false;
      const actor = resolveActor(deps);
      return actor ? can(actor.member, actor.roles, permission) : false;
    },
    held: () => {
      const actor = deps.sessionEmail() === null ? null : resolveActor(deps);
      return actor ? [...effectivePermissions(actor.member, actor.roles)] : [];
    },
    label: () => {
      const actor = deps.sessionEmail() === null ? null : resolveActor(deps);
      return actor?.member.name || actor?.member.email || deps.sessionEmail() || 'This account';
    },
  };
}

/**
 * Permission required by each enterprise channel. Reads require the matching
 * `:read` scope (held by every seeded human role); mutations require the
 * owning domain's `:manage` scope. Role CRUD is access control, so it sits
 * under `governance:manage` rather than `org:manage`.
 */
export const ENTERPRISE_CHANNEL_PERMISSIONS: Partial<Record<IpcChannelName, EnterprisePermission>> =
  {
    [IpcChannel.EnterpriseOrgGet]: 'org:read',
    [IpcChannel.EnterpriseGraph]: 'org:read',
    [IpcChannel.EnterpriseGraphNeighbors]: 'org:read',
    [IpcChannel.EnterpriseOrgCreateUnit]: 'org:manage',
    [IpcChannel.EnterpriseOrgUpdateUnit]: 'org:manage',
    [IpcChannel.EnterpriseOrgDeleteUnit]: 'org:manage',
    [IpcChannel.EnterpriseOrgCreateUser]: 'people:manage',
    [IpcChannel.EnterpriseOrgUpdateUser]: 'people:manage',
    [IpcChannel.EnterpriseOrgDeleteUser]: 'people:manage',
    [IpcChannel.EnterpriseOrgCreateRole]: 'governance:manage',
    [IpcChannel.EnterpriseOrgUpdateRole]: 'governance:manage',
    [IpcChannel.EnterpriseOrgDeleteRole]: 'governance:manage',
    [IpcChannel.EnterpriseWorkspaceList]: 'workspace:read',
    [IpcChannel.EnterpriseWorkspaceActive]: 'workspace:read',
    [IpcChannel.EnterpriseWorkspaceCreate]: 'workspace:manage',
    [IpcChannel.EnterpriseWorkspaceSwitch]: 'workspace:manage',
    /**
     * P13C Part 3 — multi-organization.
     *
     * LIST and SWITCH are gated on a READ scope, not `workspace:manage`, and the
     * asymmetry with `EnterpriseWorkspaceSwitch` above is deliberate.
     *
     * Every permission in this map is evaluated against the member's CURRENT
     * organization, because that is what the active workspace resolves to. For
     * an action ON that organization — creating a workspace in it — that is
     * exactly right. For LEAVING it, it is backwards: gating the exit on a
     * manage scope inside the tenant you are trying to leave traps a viewer in
     * whichever organization they last opened, with no way out but to sign out.
     *
     * Loosening the map is safe here because the map is not the gate that
     * matters for these two. The real authorization is target-side and
     * server-side: `organizationSummaries` returns only organizations this
     * account is an active member of, and the switch commits through the same
     * `canSwitchTo` membership chain a workspace switch uses. Holding
     * `workspace:read` grants no organization the membership chain would not
     * already have admitted.
     */
    [IpcChannel.EnterpriseOrganizationList]: 'workspace:read',
    [IpcChannel.EnterpriseOrganizationSwitch]: 'workspace:read',
    /**
     * CREATE is `org:manage`, the strictest reading available.
     *
     * The tradeoff is stated rather than hidden: because permissions resolve
     * against the current organization, a member who is only a viewer in their
     * one organization cannot create a second one. That is a real limitation
     * for a desktop product where the user often owns their own install — and
     * it is the conservative direction, since the alternative lets any
     * signed-in account mint tenants that then appear in every background
     * fan-out. The seeded install's first account claims the owner role, so the
     * common single-user path is unaffected.
     */
    [IpcChannel.EnterpriseOrganizationCreate]: 'org:manage',
    [IpcChannel.EnterpriseGovernanceConfig]: 'governance:read',
    [IpcChannel.EnterpriseGovernanceCompliance]: 'governance:read',
    [IpcChannel.EnterpriseGovernanceAudit]: 'governance:read',
    [IpcChannel.EnterpriseGovernanceSetChain]: 'governance:manage',
    [IpcChannel.EnterpriseGovernanceSetRule]: 'governance:manage',
    [IpcChannel.EnterpriseDashboard]: 'dashboard:read',
    // Process Explorer: read-only projections of the mined processes (operations analytics).
    [IpcChannel.EnterpriseProcessExplore]: 'operations:read',
    [IpcChannel.EnterpriseProcessCase]: 'operations:read',
    // Production Schedule Explorer: read-only projection of the routing schedule (manufacturing analytics).
    [IpcChannel.EnterpriseScheduleExplore]: 'operations:read',
    // Operator Console (MES): read-only projection of shop-floor execution (manufacturing analytics).
    [IpcChannel.EnterpriseExecutionExplore]: 'operations:read',
    // Relationship Intelligence: read-only ERP entity relationship graph (cross-domain analytics).
    [IpcChannel.EnterpriseRelationshipExplore]: 'operations:read',
    // Trust Engine: read-only per-entity deterministic trust model (cross-domain analytics).
    [IpcChannel.EnterpriseTrustExplore]: 'operations:read',
    // Context Engine (P2.5): read-only entity-360 across graph + relationships + timeline + memory.
    [IpcChannel.EnterpriseContext]: 'operations:read',
    // Personalization: per-user favorites / recents / saved views. Every signed-in user may manage their
    // OWN personalization (the actor is resolved server-side), so these are gated on the universal read scope.
    [IpcChannel.EnterprisePersonalizationGet]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationFavorite]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationRecent]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationClearRecents]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationSaveView]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationDeleteView]: 'dashboard:read',
    [IpcChannel.EnterprisePersonalizationRenameView]: 'dashboard:read',
    // Enterprise Module Framework: listing which modules exist is metadata-only.
    [IpcChannel.EnterpriseModulesList]: 'operations:read',
  };

/**
 * Enterprise channels whose required permission depends on the *module* named
 * in the payload (resolved at call time), so it cannot be a fixed per-channel
 * value. The generic module handlers register these with `requireAuth: true`
 * and call `ctx.authorize(module.permissions.read|write)` inside the handler —
 * they are guarded, just dynamically. Kept here so the "no unguarded enterprise
 * channel" invariant (see the tests) accounts for them explicitly.
 */
export const DYNAMICALLY_AUTHORIZED_ENTERPRISE_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.EnterpriseModuleList,
  IpcChannel.EnterpriseModuleGet,
  IpcChannel.EnterpriseModuleSearch,
  IpcChannel.EnterpriseModuleSummarize,
  IpcChannel.EnterpriseModuleCreate,
  IpcChannel.EnterpriseModuleUpdate,
  IpcChannel.EnterpriseModuleSetStatus,
  IpcChannel.EnterpriseModuleDelete,
  IpcChannel.EnterpriseModuleAction,
  // ERP document layer. Same dynamic model as the CRUD channels: the handler
  // resolves the module from the payload and authorizes its own read/write
  // scope. Approval decisions take the module's WRITE scope — recording one
  // changes what the document is allowed to do — and role eligibility plus
  // segregation of duties are enforced separately inside the engine.
  IpcChannel.EnterpriseModuleLines,
  IpcChannel.EnterpriseModuleSetLines,
  IpcChannel.EnterpriseModuleApproval,
  IpcChannel.EnterpriseModuleApprove,
  // Cross-domain related records. The one answer that legitimately spans
  // several read scopes, so it cannot carry a single static one: the handler
  // authorizes the root record's module and then filters every hop by the far
  // module's own scope. A static scope here would be the permission bypass the
  // traversal exists to prevent.
  IpcChannel.CrossDomainRelated,
];

/**
 * Annotate enterprise handler defs with their required permission (and the
 * auth gate mutations were missing). Fails loudly at startup if a channel has
 * no classification — a new enterprise channel must be classified, never
 * silently unguarded.
 */
export function withEnterpriseAuthz<T extends { channel: IpcChannelName }>(
  defs: readonly T[],
): T[] {
  /**
   * Returns `T[]`, not `(T & { permission; requireAuth: true })[]`.
   *
   * `SecureHandlerDef` is a mapped type distributed over every IPC channel —
   * seven hundred-odd members — so intersecting it forces TypeScript to
   * distribute across all of them, and the compiler eventually answers
   * "expression produces a union type that is too complex to represent". It
   * did, the first time a batch of new channels pushed it over.
   *
   * Nothing is lost: `permission` and `requireAuth` are already declared on
   * `SecureHandlerDefFor`, the throw below is what actually guarantees the
   * classification exists, and it is a runtime guarantee rather than a type
   * one either way — a channel missing from the table fails at startup.
   */
  return defs.map((def) => {
    const permission = ENTERPRISE_CHANNEL_PERMISSIONS[def.channel];
    if (!permission) {
      throw new Error(`Enterprise channel "${def.channel}" has no permission classification.`);
    }
    return { ...def, permission, requireAuth: true };
  });
}

/* ── Root-of-trust protection ─────────────────────────────────────────────
 * Enforcement makes lockout possible: if the seeded owner could be suspended,
 * de-roled, or deleted — or the built-in Owner role stripped of permissions —
 * a sole user could permanently lose access to every enterprise channel.
 * These pure guards keep the local root of trust intact; handlers apply them
 * before touching the org store.
 */

/** Whether a member may be deleted — the seeded owner never may. */
export function canDeleteMember(userId: string, ownerUserId: string): boolean {
  return userId !== ownerUserId;
}

/**
 * Strip the fields of a member update that would disarm the seeded owner
 * (roles and status are immutable on the root of trust). Non-owner patches
 * pass through untouched.
 */
export function guardOwnerUserPatch<T extends { roleIds?: unknown; status?: unknown }>(
  userId: string,
  ownerUserId: string,
  patch: T,
): T {
  if (userId !== ownerUserId) return patch;
  const out = { ...patch };
  delete (out as Record<string, unknown>).roleIds;
  delete (out as Record<string, unknown>).status;
  return out;
}

/**
 * Strip the permission list from an update to a built-in role. Built-in roles
 * are the calibrated RBAC baseline (and `Owner` is the root of trust) — their
 * names/descriptions may be edited, their permissions may not.
 */
export function guardBuiltInRolePatch<T extends { permissions?: unknown }>(
  role: { builtIn: boolean } | null,
  patch: T,
): T {
  if (!role || !role.builtIn) return patch;
  const out = { ...patch };
  delete (out as Record<string, unknown>).permissions;
  return out;
}

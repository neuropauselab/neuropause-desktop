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
import type { EnterprisePermission, IpcChannelName, OrgRole, OrgUser } from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { can, effectivePermissions, requirePermission } from './authz';

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
  /** The org the active workspace is bound to — the scope of every handler. */
  activeOrgId: () => string;
  usersFor: (orgId: string) => OrgUser[];
  rolesFor: (orgId: string) => OrgRole[];
  /** The seeded workspace-owner member, if it still exists. */
  ownerMember: () => OrgUser | null;
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
export function resolveActor(deps: ActorResolverDeps): EnterpriseActor | null {
  const email = deps.sessionEmail();
  if (!email) return null;
  const wanted = email.trim().toLowerCase();
  const orgId = deps.activeOrgId();
  const matched = deps
    .usersFor(orgId)
    .find((m) => m.kind === 'human' && m.email !== null && m.email.trim().toLowerCase() === wanted);
  if (matched) return { member: matched, roles: deps.rolesFor(matched.orgId) };
  const owner = deps.ownerMember();
  if (!owner) return null;
  // First-claim-wins: fall back to the owner only while the workspace is
  // unclaimed. A claimed owner (non-null email) that didn't match above means a
  // *different* account is signing in — deny rather than hand it the workspace.
  if (owner.email === null) return { member: owner, roles: deps.rolesFor(owner.orgId) };
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
  return (permission) => {
    if (deps.sessionEmail() === null) throw new Error('Sign in to continue.');
    const actor = resolveActor(deps);
    if (!actor) {
      deps.onPermissionRefused?.({
        permission,
        held: [],
        actorLabel: deps.sessionEmail() ?? 'This account',
      });
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
      deps.onPermissionRefused?.({
        permission,
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

/**
 * Enterprise authorization — the RBAC enforcement layer.
 *
 * The org model already defines roles (`OrgRole`, each carrying
 * `EnterprisePermission[]`) and members (`OrgUser`, each carrying `roleIds` and a
 * status). What was missing was the *enforcement*: a way to answer "may this
 * member perform this action?". This module is that resolver — pure functions
 * over the existing model, no new state, so it composes with the OrgStore rather
 * than duplicating it.
 *
 * Rules:
 *  - A member's effective permissions are the union of the permissions on the
 *    roles they hold (`roleIds` → `OrgRole.permissions`).
 *  - Only `active` members hold permissions. `invited` (pending acceptance) and
 *    `suspended` members hold none, regardless of their roles.
 *  - Resolution is member-kind-agnostic: it resolves whatever roles a member has.
 *    Gating an action to humans vs. AI workers is a separate, caller-side concern.
 *
 * Authorization (may they?) is deliberately separate from authentication (who are
 * they?). Callers resolve the current actor to an `OrgUser` first, then ask here.
 */
import type { EnterprisePermission, OrgRole, OrgUser } from '@neuropause/shared';

/** Thrown by `requirePermission` when a member lacks the required permission. */
export class AuthorizationError extends Error {
  constructor(public readonly permission: EnterprisePermission) {
    super(`Not authorized: missing permission "${permission}".`);
    this.name = 'AuthorizationError';
  }
}

/**
 * The set of permissions a member effectively holds — the union across their
 * active roles. Empty when the member is not `active`, or holds no known roles.
 */
export function effectivePermissions(
  member: OrgUser,
  roles: readonly OrgRole[],
): Set<EnterprisePermission> {
  const out = new Set<EnterprisePermission>();
  if (member.status !== 'active') return out;
  const byId = new Map(roles.map((r) => [r.id, r]));
  for (const roleId of member.roleIds) {
    const role = byId.get(roleId);
    if (role) for (const p of role.permissions) out.add(p);
  }
  return out;
}

/** Whether a member holds a specific permission. */
export function can(
  member: OrgUser,
  roles: readonly OrgRole[],
  permission: EnterprisePermission,
): boolean {
  return effectivePermissions(member, roles).has(permission);
}

/** Whether a member holds at least one of the given permissions. */
export function canAny(
  member: OrgUser,
  roles: readonly OrgRole[],
  permissions: readonly EnterprisePermission[],
): boolean {
  const eff = effectivePermissions(member, roles);
  return permissions.some((p) => eff.has(p));
}

/** Whether a member holds every one of the given permissions. */
export function canAll(
  member: OrgUser,
  roles: readonly OrgRole[],
  permissions: readonly EnterprisePermission[],
): boolean {
  const eff = effectivePermissions(member, roles);
  return permissions.every((p) => eff.has(p));
}

/** Assert a member holds a permission; throws `AuthorizationError` if not. */
export function requirePermission(
  member: OrgUser,
  roles: readonly OrgRole[],
  permission: EnterprisePermission,
): void {
  if (!can(member, roles, permission)) throw new AuthorizationError(permission);
}

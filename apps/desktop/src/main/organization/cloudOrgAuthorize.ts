/**
 * Pure authorization decisions for CLOUD organizations. P13C GATE 10.
 *
 * Extracted from `runtimeCore.ts` so the decision — "may this caller, holding
 * this role in this org, perform this class of action?" — is testable WITHOUT
 * Electron or the network. `runtimeCore` fetches the caller's memberships from
 * `orgClient.list()` (the backend already scopes that to the authenticated
 * user, and each row carries the role the BACKEND assigned) and hands them here.
 *
 * MEMBERSHIP IS NOT AUTHORIZATION. Before this, every mutating cloud-org channel
 * authorized on membership alone, so a `viewer`/`member` could invite or remove
 * other members, rename workspaces, or start a paid checkout. This enforces the
 * backend-reported role on the client too — defense in depth, fail-closed. It
 * invents no authority: it only refuses what the backend's own role says it
 * should.
 */
import type { CloudOrgRole } from '@neuropause/shared';

/** A membership row as returned by `orgClient.list()` — the fields we authorize on. */
export interface CloudMembershipRow {
  orgId: string;
  role: CloudOrgRole;
}

/** Roles permitted to MUTATE a cloud org (invite/remove/update/workspaces/billing). */
export const CLOUD_ORG_MANAGERS: readonly CloudOrgRole[] = ['owner', 'admin'];

/** One opaque message for every refusal — never distinguishes "not yours",
 *  "no such org", or "insufficient role", so nothing about the org or the
 *  caller's standing leaks. */
export const CLOUD_ORG_DENIED = 'That organization is not available to you.';

export class CloudOrgAuthorizationError extends Error {
  constructor() {
    super(CLOUD_ORG_DENIED);
    this.name = 'CloudOrgAuthorizationError';
  }
}

/**
 * Return `orgId` iff the caller is a member of it whose role is in `allowed`;
 * otherwise throw the opaque refusal. Pass every role (or omit) for a
 * membership-only check; pass `CLOUD_ORG_MANAGERS` for a mutation.
 *
 * A blank id, an org the caller does not belong to, or a role outside `allowed`
 * all refuse identically. The caller is responsible for the fail-closed handling
 * of an UNREACHABLE backend (an empty/failed list reaching here refuses, because
 * no membership will match).
 */
export function authorizeCloudOrgRole(
  memberships: readonly CloudMembershipRow[],
  orgId: string,
  allowed: readonly CloudOrgRole[] = ['owner', 'admin', 'member', 'viewer'],
): string {
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new CloudOrgAuthorizationError();
  }
  const membership = memberships.find((m) => m.orgId === orgId);
  if (!membership || !allowed.includes(membership.role)) {
    throw new CloudOrgAuthorizationError();
  }
  return orgId;
}

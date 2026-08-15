/**
 * Creating a SECOND organization.
 *
 * WHY THIS IS ONE FUNCTION AND NOT SIX CALLS AT THE HANDLER
 *
 * A tenant is only usable when six things exist together: the organization, its
 * roles, an owner member, that member's role assignment, a workspace, and an
 * audit record saying who did it. Any subset is a tenant nobody can enter and
 * nobody can clean up — an organization with no workspace cannot be switched
 * into, because `tenantContext` resolves the tenant FROM the workspace; a
 * workspace with no member denies every read; an owner with no role has no
 * permissions and cannot even invite anyone.
 *
 * Writing that sequence at the IPC handler would mean the next caller — an
 * onboarding flow, a test fixture, a migration — writes it again, slightly
 * differently, and the version that forgets the role assignment produces a
 * tenant that looks created and is inert. So the composition is the unit.
 *
 * WHAT IS NOT A PARAMETER
 *
 * The owner. The creator becomes the owner because they are the session, and a
 * request that could name someone else would be a caller-supplied answer to
 * "whose tenant is this" — the same class of input P11 removed from workspace
 * creation. Nor the organization id, nor the role ids: all generated here.
 *
 * ORDERING IS DELIBERATE. Roles before the member (the member references them),
 * member before the workspace (so the workspace is never briefly memberless),
 * and every write happens before the audit entry, so an audit record implies a
 * completed provision rather than an attempted one.
 */
import type { EnterprisePermission, Organization, OrgRole, OrgUser, Workspace } from '@neuropause/shared';
import { BUILT_IN_ROLE_SPECS } from './seed';

/** The stores this touches, injected so the composition is testable in node. */
export interface ProvisionDeps {
  createOrganization: (name: string, description: string) => Organization;
  createRole: (input: {
    orgId: string;
    name: string;
    description: string;
    permissions: EnterprisePermission[];
    builtIn?: boolean;
  }) => OrgRole;
  createUser: (input: {
    orgId: string;
    name: string;
    email: string | null;
    title: string;
    roleIds: string[];
  }) => OrgUser;
  createWorkspace: (name: string, organizationId: string) => Workspace;
  /**
   * Round 40 — Gate 27: record the creator as the tenant's PROTECTED owner
   * (`Organization.ownerUserId`), in the same act that creates the row. This
   * is what the root-of-trust guards key on; without it a provisioned org had
   * no owner anybody could protect — the Round 9 takeover, one tenant over.
   */
  recordOwner: (orgId: string, userId: string) => void;
}

export interface ProvisionInput {
  name: string;
  description?: string | undefined;
  workspaceName?: string | undefined;
  /** The signed-in account. Becomes the owner. Never taken from a payload. */
  ownerEmail: string;
  /** Display name for the owner member. Falls back to the email's local part. */
  ownerName?: string | undefined;
}

export interface ProvisionResult {
  organization: Organization;
  workspace: Workspace;
  owner: OrgUser;
  roles: OrgRole[];
}

/** The default first-workspace name, when the caller does not choose one. */
export const DEFAULT_FIRST_WORKSPACE_NAME = 'General';

/**
 * A readable owner name from an email, when the session has no display name.
 *
 * Cosmetic only — nothing authorizes on it. Kept here rather than at the
 * handler so the fallback is the same wherever provisioning is called from.
 */
export function ownerNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.trim() === '' ? email : local.trim();
}

export function provisionOrganization(
  deps: ProvisionDeps,
  input: ProvisionInput,
): ProvisionResult {
  const email = input.ownerEmail.trim();
  /**
   * FAIL CLOSED ON AN ANONYMOUS CREATOR.
   *
   * An organization created with no owner email has an owner row that matches
   * nobody, so the tenant resolver's membership lookup fails for every account
   * — and the seeded first-claim-wins path does NOT apply, because that is
   * scoped to the seeded organization. The result is a tenant that exists,
   * consumes a slot in every fan-out, and can never be entered or deleted.
   */
  if (email === '') throw new Error('An organization can only be created by a signed-in account.');

  const name = input.name.trim();
  if (name === '') throw new Error('An organization needs a name.');

  const organization = deps.createOrganization(name, input.description?.trim() ?? '');

  /**
   * The same role set the seeded organization has, with this tenant's own ids.
   *
   * `BUILT_IN_ROLE_SPECS` is the single definition; see the note there for why
   * the ids are generated rather than shared.
   */
  const roles = BUILT_IN_ROLE_SPECS.map((spec) =>
    deps.createRole({
      orgId: organization.id,
      name: spec.name,
      description: spec.description,
      permissions: [...spec.permissions],
      // Round 40: these ARE the built-in set for this tenant — same specs the
      // seeded org ships with. Leaving them custom made the Owner role
      // deletable, which silently de-permissioned the provisioned owner.
      builtIn: true,
    }),
  );
  const ownerRole = roles[0];
  /**
   * Defensive, and it has to be: if the owner role were missing, the creator
   * would end up a member with no permissions inside a tenant only they can
   * see. Failing loudly here beats producing that tenant.
   */
  if (!ownerRole) throw new Error('The organization was created without an owner role.');

  const owner = deps.createUser({
    orgId: organization.id,
    name: input.ownerName?.trim() || ownerNameFromEmail(email),
    email,
    title: 'Owner',
    roleIds: [ownerRole.id],
  });
  // The anchor the owner guards key on — written here, before the workspace,
  // so no moment exists where the tenant is enterable but ownerless.
  deps.recordOwner(organization.id, owner.id);

  /**
   * `workspaceIds` is deliberately left ABSENT on the owner.
   *
   * Absent means "every workspace in this tenant", which is what the owner
   * should have and what `memberMayUseWorkspace` already means. Writing an
   * explicit list here would pin the owner to the first workspace and lock them
   * out of every workspace they later create — an empty or stale list denies,
   * by design, and the owner is the one member who must never be denied.
   */
  const workspace = deps.createWorkspace(
    input.workspaceName?.trim() || DEFAULT_FIRST_WORKSPACE_NAME,
    organization.id,
  );

  return { organization, workspace, owner, roles };
}

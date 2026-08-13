/**
 * WHAT A SIGNED-IN ACCOUNT IS ALLOWED TO KNOW EXISTS.
 *
 * THE DEFECT THIS FILE REPLACES
 *
 * `workspaceSummaries()` returned `workspaceStore.list()` — every workspace on
 * the install, across every organization, each row carrying that organization's
 * NAME, USER COUNT and UNIT COUNT. It backs the workspace switcher, so a member
 * of one tenant was shown another tenant's roster size and headcount.
 *
 * The switch itself was never open; `canSwitchTo` has denied since P11. But a
 * denied switch is not the whole boundary, for two reasons. Existence and names
 * are disclosure on their own — "Northwind Health has 340 people here" is a
 * fact about a customer. And this list is where the IDS come from: every other
 * direct-object-reference attempt in the program's matrix needs a workspace or
 * organization id to try, and the switcher was handing them out.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 *
 * These three functions decide who can see whom. That decision belongs
 * somewhere it can be read end-to-end and tested directly, rather than inlined
 * among two hundred IPC handlers where it is reviewed once and then trusted.
 * Every input is injected, so the tests below construct two real organizations
 * and ask the questions an attacker would.
 *
 * THE RULE, ONCE, APPLIED THREE TIMES
 *
 *   signed in → an ACTIVE member row in that organization → the organization is
 *   OPERABLE → `memberMayUseWorkspace` for each workspace
 *
 * Identical to the chain `tenantContext` enforces on a request, on purpose. Two
 * implementations of "may they be here" is how a switcher offers a destination
 * that every subsequent read refuses.
 */
import type {
  Organization,
  OrganizationSummary,
  OrgRole,
  OrgUser,
  Workspace,
  WorkspaceSummary,
} from '@neuropause/shared';
import { memberMayUseWorkspace, organizationIsOperable } from '@neuropause/shared';

export interface TenantDirectoryDeps {
  /** The signed-in address, or null. Server-side only; never a payload. */
  sessionEmail: () => string | null;
  organizations: () => Organization[];
  workspaces: () => Workspace[];
  usersFor: (orgId: string) => OrgUser[];
  rolesFor: (orgId: string) => OrgRole[];
  /**
   * The seeded, possibly-unclaimed owner row.
   *
   * Load-bearing for first run: before the owner is claimed there is no member
   * row matching anybody's address, so without this a brand-new install would
   * show the signed-in user no organizations and no workspaces — an empty app.
   * Honoured under exactly the condition `tenantContext` honours it (unclaimed,
   * and in this organization), so the two cannot disagree.
   */
  ownerMember: () => OrgUser | null;
  /** The organization the session currently resolves to, or null. */
  activeOrganizationId: () => string | null;
  /** The active workspace id for display, or null. */
  activeWorkspaceId: () => string | null;
  /** Org-chart unit count, for the switcher row. Caller's own org only. */
  unitCountFor: (orgId: string) => number;
}

/**
 * The caller's member row in `orgId`, or null.
 *
 * The single membership lookup for this surface. Case-insensitive on a trimmed
 * address, matching `tenantContext` exactly.
 */
export function memberIn(deps: TenantDirectoryDeps, orgId: string): OrgUser | null {
  const email = deps.sessionEmail();
  if (email === null || email.trim() === '') return null;
  const wanted = email.trim().toLowerCase();

  const direct =
    deps
      .usersFor(orgId)
      .find(
        (m) => m.kind === 'human' && m.email !== null && m.email.trim().toLowerCase() === wanted,
      ) ?? null;
  if (direct !== null) return direct.status === 'active' ? direct : null;

  // First-claim-wins, ONLY while the seeded owner is unclaimed and belongs to
  // this organization. A CLAIMED owner that did not match above means a
  // different account is signed in, which denies.
  const owner = deps.ownerMember();
  if (owner === null || owner.email !== null || owner.orgId !== orgId) return null;
  return owner.status === 'active' ? owner : null;
}

/** The workspaces of `orgId` this member may operate in, ordered by id. */
function enterableWorkspaces(
  deps: TenantDirectoryDeps,
  orgId: string,
  member: OrgUser,
): Workspace[] {
  return deps
    .workspaces()
    .filter((ws) => ws.organizationId === orgId)
    .filter((ws) => memberMayUseWorkspace(member, ws.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every workspace the caller may enter, IN THEIR ACTIVE ORGANIZATION.
 *
 * Confined to the active organization rather than spanning every organization
 * they belong to, because this list feeds a switcher whose rows carry the
 * tenant's user and unit counts. Cross-organization movement is the
 * organization switcher's job, and it discloses less.
 *
 * Empty when nothing resolves — not "everything", and not the default
 * workspace. A caller who is signed out, or whose tenant is suspended, has no
 * workspaces, and handing them the install's contents is the disclosure being
 * closed.
 */
export function visibleWorkspaces(deps: TenantDirectoryDeps): WorkspaceSummary[] {
  const orgId = deps.activeOrganizationId();
  if (orgId === null) return [];
  const organization = deps.organizations().find((o) => o.id === orgId) ?? null;
  if (organization === null || !organizationIsOperable(organization)) return [];
  const member = memberIn(deps, orgId);
  if (member === null) return [];

  /**
   * Counted ONCE, from the caller's own organization.
   *
   * Previously derived per row from that row's `organizationId` — the foreign
   * organization's id for a foreign row — which is literally how another
   * tenant's headcount left the process. There is now only one organization
   * these two numbers can describe.
   */
  const userCount = deps.usersFor(organization.id).length;
  const unitCount = deps.unitCountFor(organization.id);
  const active = deps.activeWorkspaceId();

  return enterableWorkspaces(deps, organization.id, member).map((ws) => ({
    id: ws.id,
    name: ws.name,
    organizationId: ws.organizationId,
    orgName: organization.name,
    userCount,
    unitCount,
    active: ws.id === active,
  }));
}

/**
 * Every organization the caller is an active member of.
 *
 * NOT the install's tenant roster. A SUSPENDED organization is omitted rather
 * than shown as unavailable: listing it would confirm both that it exists and
 * that this account belongs to it, which is more than someone who cannot enter
 * it needs to know. `organizationIsOperable` is the same predicate the resolver
 * and the background fan-out apply, so a tenant that stops working stops
 * appearing everywhere, for one reason.
 */
export function visibleOrganizations(deps: TenantDirectoryDeps): OrganizationSummary[] {
  if (deps.sessionEmail() === null) return [];
  const activeOrgId = deps.activeOrganizationId();
  const out: OrganizationSummary[] = [];

  for (const org of [...deps.organizations()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!organizationIsOperable(org)) continue;
    const member = memberIn(deps, org.id);
    if (member === null) continue;
    out.push({
      id: org.id,
      name: org.name,
      active: org.id === activeOrgId,
      // The CALLER's roles here. Never the organization's role catalogue, which
      // would describe how the tenant is administered to someone who is not.
      roles: deps
        .rolesFor(org.id)
        .filter((role) => member.roleIds.includes(role.id))
        .map((role) => role.name),
      workspaceCount: enterableWorkspaces(deps, org.id, member).length,
    });
  }
  return out;
}

/**
 * A workspace in `orgId` the caller may enter, or null.
 *
 * The entry point for an organization switch. Returns null for every refusal —
 * no such organization, not a member, suspended, no permitted workspace —
 * WITHOUT distinguishing them, because a distinct "no such organization" is an
 * existence oracle over the install's tenant list, and the caller's remedy is
 * the same in all four cases.
 *
 * Deterministic (lowest workspace id), so switching to an organization twice
 * lands in the same place instead of wherever the file happened to list first.
 */
export function firstEnterableWorkspace(
  deps: TenantDirectoryDeps,
  orgId: string,
): Workspace | null {
  const organization = deps.organizations().find((o) => o.id === orgId) ?? null;
  if (organization === null || !organizationIsOperable(organization)) return null;
  const member = memberIn(deps, organization.id);
  if (member === null) return null;
  return enterableWorkspaces(deps, organization.id, member)[0] ?? null;
}

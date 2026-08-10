/**
 * The ONE place that decides which tenant a request belongs to.
 *
 * WHY THIS EXISTS
 *
 * Before P11 there was no request context at all. Every subsystem re-derived
 * what it needed, at call time, from process-global singletons — the pattern
 * `actor: () => authService.getStatus()…` appears verbatim at eight sites in
 * `runtimeCore.ts` alone, each producing a slightly different string for the
 * same person, and `workspaceId: () => workspaceStore.activeWorkspaceId()` at
 * fifteen more. Fifteen derivations of the same fact is fifteen chances for one
 * of them to be wrong, and eleven of those fifteen fed audit stamps, so being
 * wrong was invisible.
 *
 * THE CHAIN, ENFORCED IN ORDER
 *
 *   session → active workspace → its organization → membership → role →
 *   permissions → scope
 *
 * Every step can refuse, and a refusal carries its reason to the surface. The
 * order matters: the workspace names the tenant, so the workspace is resolved
 * BEFORE membership is checked. Checking membership first would require knowing
 * which tenant to check against, which is the question.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No parameter comes from a caller. Not the tenant, not the workspace, not the
 * user. A renderer-supplied tenant id is the whole class of bug this file
 * exists to make unrepresentable — and the audit found exactly that shape in
 * `enterprise:workspace.create`, where `organizationId` arrived from the
 * renderer and then selected the organization the caller's own RBAC was
 * evaluated against.
 *
 * There is no fallback. `activeOrg()` used to end in `?? orgStore.defaultOrg()`,
 * which is why `Workspace.organizationId` could never deny anything: any value
 * at all resolved to a real org. That line is the reason this file returns a
 * refusal instead of an organization.
 */
import { randomUUID } from 'node:crypto';
import type {
  EnterprisePermission,
  Organization,
  OrgRole,
  OrgUser,
  TenantContext,
  TenantRefusal,
  TenantResolution,
  TenantScope,
  Workspace,
} from '@neuropause/shared';
import { memberMayUseWorkspace, organizationIsOperable, tenantRefusal } from '@neuropause/shared';

/** The refusal payload only. `tenantRefusal` returns the resolution wrapper. */
function refusalOf(reason: Parameters<typeof tenantRefusal>[0]): TenantRefusal {
  const res = tenantRefusal(reason);
  // Narrowing for the type checker; `tenantRefusal` never returns ok:true.
  return res.ok ? { reason, message: '' } : res.refusal;
}
import { effectivePermissions } from '../enterprise/authz';

export interface TenantContextDeps {
  /** The signed-in account's email, or null. The ONLY session input. */
  sessionEmail: () => string | null;
  /** False until the org and workspace files have been read. */
  isLoaded: () => boolean;
  /** The active workspace id, or null when it is not yet knowable. */
  activeWorkspaceId: () => string | null;
  workspace: (id: string) => Workspace | null;
  organization: (id: string) => Organization | null;
  usersFor: (orgId: string) => OrgUser[];
  rolesFor: (orgId: string) => OrgRole[];
  /**
   * The seeded owner, for first-claim-wins on a fresh install.
   *
   * Program 4 built this and it is load-bearing: a brand-new install has an
   * unclaimed owner row with a null email, and the first account to sign in
   * becomes it. Preserved exactly — narrowing it would lock every existing
   * user out of their own data on upgrade, which is a worse failure than the
   * one being fixed.
   */
  ownerMember: () => OrgUser | null;
}

/** What resolution found, when it found something. */
export interface ResolvedTenant {
  context: TenantContext;
  organization: Organization;
  workspace: Workspace;
  member: OrgUser;
  roles: OrgRole[];
}

export interface TenantContextResolver {
  /** Resolve, with the reason on failure. Never throws. */
  resolve: () => TenantResolution;
  /** Resolve including the entities, for callers that need them. */
  resolveFull: () => { ok: true; value: ResolvedTenant } | { ok: false; refusal: TenantRefusal };
  /** The scope only, or null. The shape a store accepts. */
  scope: () => TenantScope | null;
  /**
   * May the signed-in account switch INTO this workspace?
   *
   * Separate from `resolve` because it asks about a workspace that is NOT
   * active yet, so the chain has to run against a supplied workspace rather
   * than the current one. Same predicates, same refusal vocabulary — two
   * implementations of "may they be here" is how a switch succeeds into a
   * workspace every subsequent read then denies.
   */
  canSwitchTo: (workspace: Workspace) => { ok: true } | { ok: false; refusal: TenantRefusal };
  /**
   * A service principal's context.
   *
   * A background job has no session, so it cannot go through the chain above.
   * It gets a context built from its DECLARED tenant and permissions instead —
   * which is the point: a service's authority is its own, not whichever human
   * happened to be signed in. Refuses if the tenant is not operable, so
   * suspending a tenant also stops its background work.
   */
  forService: (input: {
    serviceId: string;
    purpose: string;
    tenantId: string;
    workspaceId: string;
    permissions: readonly EnterprisePermission[];
  }) => TenantResolution;
}

export function createTenantContextResolver(deps: TenantContextDeps): TenantContextResolver {
  const resolveFull = ():
    | { ok: true; value: ResolvedTenant }
    | { ok: false; refusal: TenantRefusal } => {
    /**
     * COLD START FIRST.
     *
     * Checked before the session, because an unread store cannot answer any of
     * the questions below and answering them from empty maps would produce a
     * confident wrong answer. Program 10's adversarial review found exactly
     * this: a permission check that read an unloaded list, saw nothing, and
     * treated the absence as an all-clear.
     */
    if (!deps.isLoaded()) return { ok: false, refusal: refusalOf('not_loaded') };

    const email = deps.sessionEmail();
    if (email === null || email.trim() === '') {
      return { ok: false, refusal: refusalOf('not_signed_in') };
    }

    const workspaceId = deps.activeWorkspaceId();
    if (workspaceId === null || workspaceId === '') {
      return { ok: false, refusal: refusalOf('no_workspace') };
    }
    const workspace = deps.workspace(workspaceId);
    if (workspace === null) return { ok: false, refusal: refusalOf('no_workspace') };

    /**
     * The workspace names its tenant, and that name must resolve.
     *
     * This is the line that replaces `?? orgStore.defaultOrg()`. With the
     * fallback, a workspace pointed at a nonexistent organization silently
     * became the default organization's workspace — so the field could not
     * deny, and a renderer that could set it chose the authorization domain.
     */
    const organization = deps.organization(workspace.organizationId);
    if (organization === null) {
      return { ok: false, refusal: refusalOf('workspace_orphaned') };
    }
    if (!organizationIsOperable(organization)) {
      return { ok: false, refusal: refusalOf('tenant_not_operable') };
    }

    const wanted = email.trim().toLowerCase();
    const members = deps.usersFor(organization.id);
    let member =
      members.find(
        (m) => m.kind === 'human' && m.email !== null && m.email.trim().toLowerCase() === wanted,
      ) ?? null;

    if (member === null) {
      /**
       * First-claim-wins, preserved verbatim from the existing gate.
       *
       * Only while the owner is UNCLAIMED (null email). A claimed owner that
       * did not match above means a different account is signing in, and that
       * denies — which is the behaviour Program 4 shipped and Program 11 must
       * not loosen.
       */
      const owner = deps.ownerMember();
      if (owner === null || owner.email !== null || owner.orgId !== organization.id) {
        return { ok: false, refusal: refusalOf('not_a_member') };
      }
      member = owner;
    }

    if (member.status !== 'active') {
      return { ok: false, refusal: refusalOf('member_inactive') };
    }
    if (!memberMayUseWorkspace(member, workspace.id)) {
      return { ok: false, refusal: refusalOf('not_in_workspace') };
    }

    const roles = deps.rolesFor(member.orgId);
    /**
     * Roles are read from the MEMBER's org, and the member came from the
     * workspace's org, so the two agree by construction. The pre-P11 gate
     * looked the member up in one org and fetched roles from another — harmless
     * while only one org could exist, and a cross-tenant role bleed the moment
     * a second one did.
     */
    const permissions = [...effectivePermissions(member, roles)];

    const context: TenantContext = {
      requestId: `req_${randomUUID()}`,
      userId: member.email ?? member.id,
      memberId: member.id,
      tenantId: organization.id,
      workspaceId: workspace.id,
      roles: roles.filter((r) => member!.roleIds.includes(r.id)).map((r) => r.name),
      permissions,
      actorType: 'human',
      label: member.name || member.email || 'This account',
    };
    return { ok: true, value: { context, organization, workspace, member, roles } };
  };

  return {
    resolveFull,
    resolve: () => {
      const res = resolveFull();
      return res.ok
        ? { ok: true, context: res.value.context }
        : { ok: false, refusal: res.refusal };
    },
    scope: () => {
      const res = resolveFull();
      return res.ok
        ? { tenantId: res.value.context.tenantId, workspaceId: res.value.context.workspaceId }
        : null;
    },
    canSwitchTo: (workspace) => {
      if (!deps.isLoaded()) return { ok: false, refusal: refusalOf('not_loaded') };
      const email = deps.sessionEmail();
      if (email === null || email.trim() === '') {
        return { ok: false, refusal: refusalOf('not_signed_in') };
      }
      const organization = deps.organization(workspace.organizationId);
      if (organization === null) {
        return { ok: false, refusal: refusalOf('workspace_orphaned') };
      }
      if (!organizationIsOperable(organization)) {
        return { ok: false, refusal: refusalOf('tenant_not_operable') };
      }
      const wanted = email.trim().toLowerCase();
      const member =
        deps
          .usersFor(organization.id)
          .find(
            (m) =>
              m.kind === 'human' && m.email !== null && m.email.trim().toLowerCase() === wanted,
          ) ?? null;
      if (member === null) {
        /**
         * First-claim-wins applies to a switch too, and only while unclaimed.
         *
         * Without this, a fresh install could not switch into its own second
         * workspace before the owner row had been claimed — which is a real
         * first-run path, not a theoretical one.
         */
        const owner = deps.ownerMember();
        if (owner === null || owner.email !== null || owner.orgId !== organization.id) {
          return { ok: false, refusal: refusalOf('not_a_member') };
        }
        if (!memberMayUseWorkspace(owner, workspace.id)) {
          return { ok: false, refusal: refusalOf('not_in_workspace') };
        }
        return { ok: true };
      }
      if (member.status !== 'active') {
        return { ok: false, refusal: refusalOf('member_inactive') };
      }
      if (!memberMayUseWorkspace(member, workspace.id)) {
        return { ok: false, refusal: refusalOf('not_in_workspace') };
      }
      return { ok: true };
    },
    forService: (input) => {
      if (!deps.isLoaded()) return tenantRefusal('not_loaded');
      const organization = deps.organization(input.tenantId);
      if (organization === null) return tenantRefusal('not_a_member');
      if (!organizationIsOperable(organization)) return tenantRefusal('tenant_not_operable');
      const workspace = deps.workspace(input.workspaceId);
      if (workspace === null || workspace.organizationId !== input.tenantId) {
        // A workspace in a different tenant is not this service's to act in,
        // and saying so as `no_workspace` avoids confirming it exists.
        return tenantRefusal('no_workspace');
      }
      return {
        ok: true,
        context: {
          requestId: `req_${randomUUID()}`,
          userId: null,
          memberId: null,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          roles: [],
          permissions: [...input.permissions],
          actorType: 'service',
          label: `${input.purpose} (service)`,
        },
      };
    },
  };
}

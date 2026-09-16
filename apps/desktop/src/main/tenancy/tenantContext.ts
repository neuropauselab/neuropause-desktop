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
  /**
   * P13C ROUND 31 — W-10. FIRES IMMEDIATELY BEFORE EVERY REFUSAL.
   *
   * Round 28 put this diagnostic at the authorization gate, and it never once
   * printed on the machine it was written for. `livesync:status` throws the
   * refusal itself and never calls `createAuthorize`, so a hook on the gate
   * observes a subset of refusals that happened not to include the failing one.
   * Instrumenting a caller measures that caller. There are many callers and one
   * resolver, so the resolver is where the measurement belongs.
   *
   * Optional, and consulted only on the refusal path: a request that resolves
   * pays one `undefined` check.
   */
  onRefusal?: (diagnostic: TenantRefusalDiagnostic) => void;
  /**
   * Fires ONCE when resolution recovers, not on every success.
   *
   * The pair of events brackets the outage, so its duration is a subtraction in
   * the log rather than an interview with whoever was using the machine.
   */
  onRecovered?: (recovery: TenantRecovery) => void;
  /** Injectable clock, so the interval arithmetic is testable. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * An email reduced to what a diagnostic may keep.
 *
 * The local part becomes its LENGTH and the domain survives whole. Two accounts
 * at the same domain and two accounts at different domains are different bugs,
 * so the domain earns its place; the local part answers no question that the
 * comparison predicates do not already answer, so it does not. Nothing here is
 * reversible into an address, which is the property that lets a support bundle
 * be sent over WhatsApp.
 */
export function redactedEmailShape(email: string | null): string | null {
  if (email === null) return null;
  const norm = email.trim().toLowerCase();
  const at = norm.lastIndexOf('@');
  if (at < 0) return `${norm.length}@`;
  return `${at}@${norm.slice(at + 1)}`;
}

/**
 * What was true at the moment a refusal was decided.
 *
 * Every field is read from the values `resolveFull` ITSELF used. Round 28's
 * version re-read `authService.getStatus()` and the org store after the fact,
 * which is a second sample of mutable singletons: if the session changed in
 * between, the log described a state that never produced the refusal it claimed
 * to explain. These come from the same pass.
 *
 * `null` means NOT YET KNOWN at that point in the chain, and is never a stand-in
 * for false. A `not_signed_in` refusal happens before any workspace is read, so
 * reporting `workspaceFound: false` there would be an invention.
 */
export interface TenantRefusalDiagnostic {
  reason: TenantRefusal['reason'];
  /** 1 for the first refusal of an outage, incrementing until it recovers. */
  refusalIndex: number;
  /** True exactly once per outage: the transition from resolving to refusing. */
  firstRefusalAfterSuccess: boolean;
  /** ms since the last successful resolution; null if there has never been one. */
  msSinceLastSuccess: number | null;
  loaded: boolean;
  sessionEmailShape: string | null;
  activeWorkspaceId: string | null;
  workspaceFound: boolean | null;
  workspaceOrgId: string | null;
  organizationFound: boolean | null;
  organizationOperable: boolean | null;
  memberCount: number | null;
  humanMembersWithEmail: number | null;
  sessionMatchedAMember: boolean | null;
  ownerExists: boolean | null;
  /** An owner row whose email is set. Unclaimed owners are the first-run path. */
  ownerClaimed: boolean | null;
  ownerOrgMatches: boolean | null;
  ownerEmailShape: string | null;
  sessionMatchesOwner: boolean | null;
  memberStatus: string | null;
  memberInWorkspace: boolean | null;
}

/** The closing bracket of an outage. */
export interface TenantRecovery {
  /** How long resolution was refusing, end to end. */
  msSinceFirstRefusal: number | null;
  /** How long since the last success BEFORE the outage. Null on a cold start. */
  msSinceLastSuccess: number | null;
  refusalsWhileDown: number;
  lastRefusalReason: TenantRefusal['reason'] | null;
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
  const now = deps.now ?? ((): number => Date.now());

  /**
   * OUTAGE BOOKKEEPING — the only mutable state in this file.
   *
   * It exists because the question that mattered for six days was "how long did
   * it work before it stopped", and nothing in the process knew. Every caller
   * saw one refusal and had no way to tell whether it was the first or the
   * thousandth. This is three numbers and a string, updated on the transitions.
   */
  let lastSuccessAtMs: number | null = null;
  let lastOutcome: 'ok' | 'refused' | null = null;
  let firstRefusalAtMs: number | null = null;
  let refusalsWhileDown = 0;
  let lastRefusalReason: TenantRefusal['reason'] | null = null;

  const resolveFull = ():
    | { ok: true; value: ResolvedTenant }
    | { ok: false; refusal: TenantRefusal } => {
    /**
     * Facts accumulated as the chain runs, for the diagnostic. Left `null` until
     * the step that establishes them, so a refusal can only report what had
     * actually been read when it fired.
     */
    const loaded = deps.isLoaded();
    let sessionEmailRaw: string | null = null;
    let activeWorkspaceId: string | null = null;
    let workspaceFound: boolean | null = null;
    let workspaceOrgId: string | null = null;
    let organizationFound: boolean | null = null;
    let organizationOperable: boolean | null = null;
    let memberList: OrgUser[] | null = null;
    let sessionMatchedAMember: boolean | null = null;
    let ownerRow: OrgUser | null = null;
    let ownerWasRead = false;
    let memberStatus: string | null = null;
    let memberInWorkspace: boolean | null = null;

    /**
     * THE ONLY WAY OUT OF THIS FUNCTION WITHOUT A TENANT.
     *
     * Every refusal goes through here, which is what makes the instrumentation
     * complete rather than approximately complete. A ninth refusal reason added
     * later cannot forget to report itself, because the compiler will not let it
     * return the wrong shape and there is no other shape to return.
     * `refusalDiagnostic.test.ts` pins that structurally against the source.
     */
    const refuse = (
      reason: TenantRefusal['reason'],
    ): { ok: false; refusal: TenantRefusal } => {
      const at = now();
      const firstRefusalAfterSuccess = lastOutcome === 'ok';
      if (lastOutcome !== 'refused') {
        firstRefusalAtMs = at;
        refusalsWhileDown = 0;
      }
      refusalsWhileDown += 1;
      const msSinceLastSuccess = lastSuccessAtMs === null ? null : at - lastSuccessAtMs;
      lastOutcome = 'refused';
      lastRefusalReason = reason;

      if (deps.onRefusal !== undefined) {
        /**
         * Owner comparisons, spelled out rather than inlined.
         *
         * `sessionMatchesOwner` is the single predicate the Windows fault turns
         * on: the renderer showed the owner's own address while the resolver
         * said `not_a_member`, and those two statements cannot both be true.
         * An UNCLAIMED owner (null email) matches nobody — writing that as a
         * string comparison against `''` would make an empty session email
         * match an unclaimed owner and report the opposite of the truth.
         */
        const ownerEmail = ownerWasRead ? (ownerRow?.email ?? null) : null;
        const normSession = sessionEmailRaw === null ? null : sessionEmailRaw.trim().toLowerCase();
        const normOwner = ownerEmail === null ? null : ownerEmail.trim().toLowerCase();

        /**
         * A diagnostic that throws must not become the error the user sees.
         * That is the exact failure W-1 fixed one layer up: a recording step
         * threw, and its message replaced the real reason all the way to the
         * renderer. Instrumentation is never allowed to be load-bearing.
         */
        try {
          deps.onRefusal({
            reason,
            refusalIndex: refusalsWhileDown,
            firstRefusalAfterSuccess,
            msSinceLastSuccess,
            loaded,
            sessionEmailShape: redactedEmailShape(sessionEmailRaw),
            activeWorkspaceId,
            workspaceFound,
            workspaceOrgId,
            organizationFound,
            organizationOperable,
            memberCount: memberList === null ? null : memberList.length,
            humanMembersWithEmail:
              memberList === null
                ? null
                : memberList.filter((m) => m.kind === 'human' && m.email !== null).length,
            sessionMatchedAMember,
            ownerExists: ownerWasRead ? ownerRow !== null : null,
            ownerClaimed: ownerWasRead ? ownerEmail !== null : null,
            ownerOrgMatches:
              ownerWasRead && ownerRow !== null && workspaceOrgId !== null
                ? ownerRow.orgId === workspaceOrgId
                : null,
            ownerEmailShape: redactedEmailShape(ownerEmail),
            sessionMatchesOwner: ownerWasRead
              ? normOwner !== null && normSession !== null && normOwner === normSession
              : null,
            memberStatus,
            memberInWorkspace,
          });
        } catch {
          // Deliberately silent: there is no logger here and a failed log line
          // is not worth converting a refusal into a crash.
        }
      }
      return { ok: false, refusal: refusalOf(reason) };
    };

    const succeed = (value: ResolvedTenant): { ok: true; value: ResolvedTenant } => {
      const at = now();
      if (lastOutcome === 'refused' && deps.onRecovered !== undefined) {
        try {
          deps.onRecovered({
            msSinceFirstRefusal: firstRefusalAtMs === null ? null : at - firstRefusalAtMs,
            msSinceLastSuccess: lastSuccessAtMs === null ? null : at - lastSuccessAtMs,
            refusalsWhileDown,
            lastRefusalReason,
          });
        } catch {
          // Same rule as above.
        }
      }
      lastOutcome = 'ok';
      lastSuccessAtMs = at;
      firstRefusalAtMs = null;
      refusalsWhileDown = 0;
      return { ok: true, value };
    };

    /**
     * COLD START FIRST.
     *
     * Checked before the session, because an unread store cannot answer any of
     * the questions below and answering them from empty maps would produce a
     * confident wrong answer. Program 10's adversarial review found exactly
     * this: a permission check that read an unloaded list, saw nothing, and
     * treated the absence as an all-clear.
     */
    if (!loaded) return refuse('not_loaded');

    const email = deps.sessionEmail();
    sessionEmailRaw = email;
    if (email === null || email.trim() === '') {
      return refuse('not_signed_in');
    }

    const workspaceId = deps.activeWorkspaceId();
    activeWorkspaceId = workspaceId;
    if (workspaceId === null || workspaceId === '') {
      return refuse('no_workspace');
    }
    const workspace = deps.workspace(workspaceId);
    workspaceFound = workspace !== null;
    if (workspace === null) return refuse('no_workspace');
    workspaceOrgId = workspace.organizationId;

    /**
     * The workspace names its tenant, and that name must resolve.
     *
     * This is the line that replaces `?? orgStore.defaultOrg()`. With the
     * fallback, a workspace pointed at a nonexistent organization silently
     * became the default organization's workspace — so the field could not
     * deny, and a renderer that could set it chose the authorization domain.
     */
    const organization = deps.organization(workspace.organizationId);
    organizationFound = organization !== null;
    if (organization === null) {
      return refuse('workspace_orphaned');
    }
    organizationOperable = organizationIsOperable(organization);
    if (!organizationOperable) {
      return refuse('tenant_not_operable');
    }

    const wanted = email.trim().toLowerCase();
    const members = deps.usersFor(organization.id);
    memberList = members;
    /**
     * P13C ROUND 31 — O-11. `!== null` IS NOT THE SAME QUESTION AS "IS A STRING".
     *
     * `OrgUser.email` is typed `string | null`, and this predicate trusted the
     * type. It does not hold at runtime: `orgStore.updateUser` spreads a patch
     * object over the row, the IPC handler builds that patch as an object
     * LITERAL with every key present, and a request that omits `email`
     * therefore writes `email: undefined`. `undefined !== null` is true, so the
     * next call was `undefined.trim()` — a TypeError thrown out of a function
     * whose contract, stated on `resolve()` a few lines above, is that it never
     * throws. Everything downstream treats a refusal as the worst case.
     *
     * `typeof === 'string'` fails closed on every non-string: the same answer
     * for null, and the correct one for undefined. The owner fallback below is
     * deliberately NOT relaxed the same way — a corrupt owner row must keep
     * refusing rather than become claimable by whoever signs in next.
     */
    let member =
      members.find(
        (m) =>
          m.kind === 'human' &&
          typeof m.email === 'string' &&
          m.email.trim().toLowerCase() === wanted,
      ) ?? null;
    sessionMatchedAMember = member !== null;

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
      ownerRow = owner;
      ownerWasRead = true;
      if (owner === null || owner.email !== null || owner.orgId !== organization.id) {
        return refuse('not_a_member');
      }
      member = owner;
    }

    memberStatus = member.status;
    if (member.status !== 'active') {
      return refuse('member_inactive');
    }
    memberInWorkspace = memberMayUseWorkspace(member, workspace.id);
    if (!memberInWorkspace) {
      return refuse('not_in_workspace');
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
    return succeed({ context, organization, workspace, member, roles });
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
      // O-11 (round 32): `typeof === 'string'` fails closed on the corrupt
      // disk shape (email key erased, loads as undefined) — same predicate as
      // resolveFull above. `!== null` alone called `.trim()` on undefined.
      const member =
        deps
          .usersFor(organization.id)
          .find(
            (m) =>
              m.kind === 'human' &&
              typeof m.email === 'string' &&
              m.email.trim().toLowerCase() === wanted,
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

/**
 * What the membership panel shows, decided without React.
 *
 * P13C Part 3, Phase 23. Kept pure and separate from the component for the
 * usual reason in this codebase — a decision inside JSX is a decision that gets
 * tested by rendering, or not at all — and for one specific to this surface:
 * the panel's job is to state a BOUNDARY, and a boundary described wrongly is
 * worse than one not described. "You are an Owner here" must be true.
 *
 * Nothing here filters for security. The server already returned only the
 * organizations and workspaces this account may see; re-filtering in the
 * renderer would imply the payload might contain more, and invite someone to
 * rely on that filter later.
 */
import type { OrganizationSummary, WorkspaceSummary } from '@neuropause/shared';

export interface TenantMembershipView {
  organizationName: string;
  organizationId: string | null;
  /** The caller's role names in the active organization, joined for display. */
  roleLabel: string;
  workspaceName: string;
  workspaceId: string | null;
  /** Workspaces in the active organization this account may enter. */
  workspaces: WorkspaceSummary[];
  /** Other organizations this account belongs to, active one excluded. */
  otherOrganizations: OrganizationSummary[];
  /** True when there is genuinely nothing to show — signed out, or refused. */
  empty: boolean;
}

/** No role is a real state (a member of a tenant with no role holds nothing). */
export const NO_ROLE_LABEL = 'No role assigned';

export function buildMembershipView(
  organizations: readonly OrganizationSummary[],
  workspaces: readonly WorkspaceSummary[],
): TenantMembershipView {
  const active = organizations.find((o) => o.active) ?? null;
  const activeWorkspace = workspaces.find((w) => w.active) ?? null;

  return {
    organizationName: active?.name ?? '—',
    organizationId: active?.id ?? null,
    /**
     * Every role, not the first.
     *
     * Showing one of several would understate what the account can do, and this
     * panel is where somebody checks exactly that before granting more.
     */
    roleLabel:
      active === null || active.roles.length === 0 ? NO_ROLE_LABEL : active.roles.join(', '),
    workspaceName: activeWorkspace?.name ?? '—',
    workspaceId: activeWorkspace?.id ?? null,
    workspaces: [...workspaces],
    otherOrganizations: organizations.filter((o) => !o.active),
    /**
     * Empty means "no organization resolved", which is a real and reachable
     * state: signed out, a suspended tenant, a member removed while the window
     * was open. The panel says so rather than rendering blanks, because a blank
     * row reads as a loading state that never finishes.
     */
    empty: active === null,
  };
}

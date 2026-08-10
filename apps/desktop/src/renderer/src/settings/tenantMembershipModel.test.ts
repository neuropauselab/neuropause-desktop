/**
 * P13C Part 3, Phase 23 — what the membership panel states.
 *
 * The panel's job is to describe a security boundary in words a person acts on,
 * so a wrong description is worse than none: "you are a Viewer here" when they
 * are an Owner, or an organization name that is not the one their records
 * belong to. These tests are about that claim being true.
 */
import { describe, expect, it } from 'vitest';
import type { OrganizationSummary, WorkspaceSummary } from '@neuropause/shared';
import { buildMembershipView, NO_ROLE_LABEL } from './tenantMembershipModel';

const org = (over: Partial<OrganizationSummary> = {}): OrganizationSummary => ({
  id: 'org-a',
  name: 'Alpha',
  active: true,
  roles: ['Owner'],
  workspaceCount: 1,
  ...over,
});

const ws = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id: 'ws-a',
  name: 'General',
  organizationId: 'org-a',
  orgName: 'Alpha',
  userCount: 3,
  unitCount: 2,
  active: true,
  ...over,
});

describe('buildMembershipView', () => {
  it('names the active organization, workspace and role', () => {
    const v = buildMembershipView([org()], [ws()]);
    expect(v.organizationName).toBe('Alpha');
    expect(v.workspaceName).toBe('General');
    expect(v.roleLabel).toBe('Owner');
    expect(v.empty).toBe(false);
  });

  it('lists EVERY role, never just the first', () => {
    const v = buildMembershipView([org({ roles: ['Admin', 'Manager'] })], [ws()]);
    expect(v.roleLabel).toBe('Admin, Manager');
  });

  it('says so when a member holds no role, rather than showing nothing', () => {
    const v = buildMembershipView([org({ roles: [] })], [ws()]);
    expect(v.roleLabel).toBe(NO_ROLE_LABEL);
  });

  it('separates the OTHER organizations from the active one', () => {
    const v = buildMembershipView(
      [org(), org({ id: 'org-b', name: 'Northwind', active: false, roles: ['Viewer'] })],
      [ws()],
    );
    expect(v.otherOrganizations.map((o) => o.name)).toEqual(['Northwind']);
    expect(v.organizationName).toBe('Alpha');
  });

  /**
   * Reachable, and it must not render as a half-loaded panel: signed out, a
   * suspended tenant, or a membership revoked while the window was open all
   * arrive here as an empty list.
   */
  it('reports EMPTY when no organization resolves', () => {
    const v = buildMembershipView([], []);
    expect(v.empty).toBe(true);
    expect(v.organizationName).toBe('—');
    expect(v.organizationId).toBeNull();
  });

  it('is empty when organizations exist but none is active', () => {
    const v = buildMembershipView([org({ active: false })], []);
    expect(v.empty).toBe(true);
  });

  it('handles an organization with no active workspace without inventing one', () => {
    const v = buildMembershipView([org()], [ws({ active: false })]);
    expect(v.workspaceName).toBe('—');
    expect(v.workspaceId).toBeNull();
    expect(v.workspaces).toHaveLength(1); // still offered as a destination
  });

  /**
   * The renderer does not re-filter. The server already scoped both lists, and
   * a second filter here would imply the payload might contain another tenant's
   * rows — an assumption someone would later rely on.
   */
  it('passes the server’s workspace list through unchanged', () => {
    const rows = [ws(), ws({ id: 'ws-2', name: 'Clinical', active: false })];
    expect(buildMembershipView([org()], rows).workspaces).toHaveLength(2);
  });
});

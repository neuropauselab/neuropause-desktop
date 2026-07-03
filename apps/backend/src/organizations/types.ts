/**
 * Organizations — SaaS tenancy domain.
 *
 * Types + the repository interface the service depends on. Two implementations
 * satisfy it: an in-memory one (`memoryRepository.ts`, for tests) and a Postgres
 * one (`repository.ts`, for production). The service (`service.ts`) is pure logic
 * over this interface, so it is fully testable without a database.
 *
 * Note: this is the cloud tenancy model (org ⇄ user membership with a flat role),
 * distinct from the desktop Enterprise OS org model (`@neuropause/shared`'s
 * OrgUser/OrgRole, which carries units and permission sets). They describe the
 * same concept at different layers and are intentionally not coupled.
 */

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MembershipStatus = 'active' | 'invited' | 'suspended';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  orgId: string;
  /** Null while the membership is a pending invitation. */
  userId: string | null;
  role: OrgRole;
  status: MembershipStatus;
  /** Set while status = 'invited'. */
  invitedEmail: string | null;
  inviteExpiresAt: string | null;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember extends Membership {
  /** The member's account email, resolved from the users table. Null for a
   *  pending invite that has no linked user yet. */
  userEmail: string | null;
  userDisplayName: string | null;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** A summary of an organization a user belongs to (for the "my orgs" list). */
export interface UserOrganization {
  membershipId: string;
  orgId: string;
  slug: string;
  name: string;
  role: OrgRole;
}

/** A membership as created; the raw invite token is returned separately, once. */
export interface NewMembership {
  orgId: string;
  userId: string | null;
  role: OrgRole;
  status: MembershipStatus;
  invitedEmail: string | null;
  inviteTokenHash: string | null;
  inviteExpiresAt: string | null;
  invitedBy: string | null;
}

export interface MembershipPatch {
  userId?: string | null;
  role?: OrgRole;
  status?: MembershipStatus;
  invitedEmail?: string | null;
  inviteTokenHash?: string | null;
  inviteExpiresAt?: string | null;
}

/**
 * The persistence operations the Organizations service needs. Implementations
 * must treat all writes as immediately visible to subsequent reads.
 */
export interface OrgRepository {
  createOrganization(input: { name: string; slug: string }): Promise<Organization>;
  getOrganizationById(orgId: string): Promise<Organization | null>;
  updateOrganization(orgId: string, patch: { name: string }): Promise<Organization | null>;
  slugExists(slug: string): Promise<boolean>;

  createMembership(input: NewMembership): Promise<Membership>;
  getMembershipById(id: string): Promise<Membership | null>;
  getMembershipByOrgUser(orgId: string, userId: string): Promise<Membership | null>;
  getMembershipByInviteTokenHash(hash: string): Promise<Membership | null>;
  getPendingInvite(orgId: string, email: string): Promise<Membership | null>;
  listMemberships(orgId: string): Promise<Membership[]>;
  /** Memberships enriched with each member's user identity (email, name). */
  listOrgMembers(orgId: string): Promise<OrgMember[]>;
  updateMembership(id: string, patch: MembershipPatch): Promise<Membership | null>;
  deleteMembership(id: string): Promise<boolean>;
  countActiveOwners(orgId: string): Promise<number>;

  createWorkspace(orgId: string, name: string): Promise<Workspace>;
  updateWorkspace(
    orgId: string,
    workspaceId: string,
    patch: { name: string },
  ): Promise<Workspace | null>;
  deleteWorkspace(orgId: string, workspaceId: string): Promise<boolean>;
  listWorkspaces(orgId: string): Promise<Workspace[]>;

  /** The active organizations a user belongs to. */
  listUserMemberships(userId: string): Promise<UserOrganization[]>;
}

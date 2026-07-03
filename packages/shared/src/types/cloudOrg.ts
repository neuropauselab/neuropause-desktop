/**
 * Cloud (multi-tenant) organization DTOs — the shapes returned by the backend
 * `/organizations` API and carried over IPC to the renderer.
 *
 * These are DELIBERATELY distinct from the local Enterprise OS org model
 * (`OrgUser`/`OrgRole` with units and permission sets). That model is a
 * single-machine local structure; these describe the shared cloud tenancy a user
 * signs into. Same concept, different layer.
 */
export type CloudOrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export type CloudMembershipStatus = 'active' | 'invited' | 'suspended';

/** An organization the current user belongs to (from `GET /organizations`). */
export interface CloudOrganizationSummary {
  membershipId: string;
  orgId: string;
  slug: string;
  name: string;
  role: CloudOrgRole;
}

export interface CloudOrganization {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudMembership {
  id: string;
  orgId: string;
  /** Null while the membership is a pending invitation. */
  userId: string | null;
  role: CloudOrgRole;
  status: CloudMembershipStatus;
  invitedEmail: string | null;
  /** The member's account email, resolved server-side (null for pending invites). */
  userEmail: string | null;
  userDisplayName: string | null;
  inviteExpiresAt: string | null;
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudWorkspace {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudOrgCreateResult {
  organization: CloudOrganization;
  membership: CloudMembership;
}

export interface CloudInviteResult {
  membership: CloudMembership;
  /** One-time invite token (surfaced once, to be shared with the invitee). */
  token: string;
}

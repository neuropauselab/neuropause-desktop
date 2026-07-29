/**
 * Module 3 — Multi-Tenant Federation. A thin coordinator over the federation runtime, the
 * organization manager, and the trust engine: tenant isolation (a tenant only appears in
 * federations it belongs to), tenant federation + discovery (who is in a federation), and
 * shared policies (federation-level policies visible to members). No cross-tenant data leaks:
 * discovery is scoped to federation membership, and access is trust-gated.
 */
import type { FederationRuntime } from './federation';
import type { OrganizationManager } from './organizations';
import type { TrustEngine, FederationPolicy } from './trust';
import type { Organization } from './types';

export class MultiTenantFederation {
  constructor(
    private readonly federation: FederationRuntime,
    private readonly organizations: OrganizationManager,
    private readonly trust: TrustEngine,
  ) {}

  /** Discover the member organizations of a federation (tenant discovery). */
  discover(federationId: string): Organization[] {
    return this.federation
      .members(federationId)
      .map((id) => this.organizations.get(id))
      .filter((o): o is Organization => o !== undefined);
  }

  /** Tenant isolation: an org is "in" a federation only if it is a member (and active). */
  isolated(federationId: string, orgId: string): boolean {
    const org = this.organizations.get(orgId);
    return org?.status === 'active' && this.federation.members(federationId).includes(orgId);
  }

  /** Federation-level shared policies visible to members. */
  sharedPolicies(federationId: string): FederationPolicy[] {
    return this.trust.policiesFor(federationId);
  }

  /** Can `fromOrg` read `toOrg` within the federation (trust-gated cross-tenant access)? */
  canAccess(federationId: string, fromOrg: string, toOrg: string): boolean {
    if (!this.isolated(federationId, fromOrg) || !this.isolated(federationId, toOrg)) return false;
    return this.trust.validate(federationId, fromOrg, toOrg, 'read');
  }
}

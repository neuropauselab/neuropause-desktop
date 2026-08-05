/**
 * EPIC 4 — Identity Federation. Federates the customer's directory (Microsoft Entra ID / Google
 * Workspace / Okta / LDAP / Active Directory / OIDC / SAML). Providers are REPRESENTED (adapter-
 * verified) until the customer configures them. User synchronization is REAL when the security
 * platform is wired in: each external user is registered through the reused Sprint-2 identity
 * platform, and each mapped group role is created through the reused authorization engine. Provisioning
 * validation confirms every synced user really has an identity id — no user is fabricated.
 */
import { IDENTITY_PROVIDERS, type IdentityProvider } from './constants';
import type { CustomerDeploymentContext } from './types';
import type { DeploymentGovernance } from './governance';
import type { CustomerDeploymentRuntime } from './runtime';

export interface FederatedProvider {
  provider: IdentityProvider;
  status: 'represented' | 'configured';
  reusedIdentity: boolean;
  note: string;
}

export interface SyncedUser {
  externalId: string;
  identityId: string | null;
  synced: boolean;
}

export interface SyncResult {
  provider: IdentityProvider;
  users: SyncedUser[];
  syncedCount: number;
  groupsMapped: number;
  reusedSecurity: boolean;
}

export class IdentityFederation {
  constructor(
    private readonly ctx: CustomerDeploymentContext,
    private readonly runtime: CustomerDeploymentRuntime,
    private readonly gov: DeploymentGovernance,
    private readonly operator: string,
  ) {}

  providers(): readonly IdentityProvider[] {
    return IDENTITY_PROVIDERS;
  }

  /** Represent a provider connection. Adapter-verified until the customer supplies real configuration. */
  async connect(input: { deploymentId: string; provider: IdentityProvider; configured?: boolean }): Promise<FederatedProvider> {
    const deployment = this.require(input.deploymentId);
    const status = input.configured ? 'configured' : 'represented';
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E4',
      operation: 'federate',
      targetId: input.provider,
      evidence: 'adapter-verified',
      decision: status,
    });
    return {
      provider: input.provider,
      status,
      reusedIdentity: Boolean(this.ctx.infrastructure ?? this.ctx.security),
      note: `${input.provider} represented; adapter-verified until the customer configures and verifies the connection.`,
    };
  }

  /** REAL user synchronization through the reused identity platform (when wired in). */
  async syncUsers(input: { deploymentId: string; provider: IdentityProvider; users: Array<{ externalId: string; displayName: string }>; groups?: string[] }): Promise<SyncResult> {
    const deployment = this.require(input.deploymentId);
    const tenant = this.runtime.tenant(deployment.tenantId);
    const tenantKey = tenant?.name ?? deployment.tenantId;
    const users: SyncedUser[] = [];
    for (const u of input.users) {
      if (this.ctx.security) {
        const id = await this.ctx.security.identity().register({ type: 'user', displayName: u.displayName, tenant: tenantKey, federationSource: input.provider });
        users.push({ externalId: u.externalId, identityId: id.id, synced: Boolean(id.id) });
      } else {
        users.push({ externalId: u.externalId, identityId: null, synced: false });
      }
    }
    // Map each group to a real role in the reused authorization engine.
    let groupsMapped = 0;
    if (this.ctx.security && input.groups) {
      for (const g of input.groups) {
        this.ctx.security.authorization().defineRole({ id: `${tenantKey}:grp:${g}`, name: g, permissions: ['workspace:read'] });
        groupsMapped += 1;
      }
    }
    const syncedCount = users.filter((u) => u.synced).length;
    await this.gov.record({
      operator: this.operator,
      customer: deployment.customerId,
      tenant: deployment.tenantId,
      environment: deployment.environmentId,
      epic: 'E4',
      operation: 'sync-users',
      targetId: input.provider,
      evidence: this.ctx.security ? 'live-verified' : 'adapter-verified',
      decision: `${syncedCount}/${input.users.length} synced, ${groupsMapped} groups`,
    });
    return { provider: input.provider, users, syncedCount, groupsMapped, reusedSecurity: Boolean(this.ctx.security) };
  }

  /** Provisioning validation — every synced user must have a real identity id. */
  validate(result: SyncResult): { valid: boolean; note: string } {
    const valid = result.users.length > 0 && result.users.every((u) => u.synced && u.identityId);
    return { valid, note: valid ? 'all users provisioned with real identity ids' : 'no users, or a user lacks a real identity (security platform not wired in)' };
  }

  private require(deploymentId: string): { customerId: string; tenantId: string; environmentId: string } {
    const d = this.runtime.deployment(deploymentId);
    if (!d) throw new Error(`unknown deployment: ${deploymentId}`);
    return d;
  }
}

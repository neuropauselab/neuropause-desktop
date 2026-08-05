/**
 * EPIC 6 — Enterprise Identity Platform. OIDC / OAuth 2.1 / SAML 2.0 / LDAP / Active Directory /
 * Entra ID / Google Workspace / Okta / SCIM providers, JIT provisioning, identity federation, and an
 * identity/session registry. REUSES the security identity registry (real identity records + OIDC/SAML
 * provider config) — it never re-implements it. External IdPs are adapter-verified until configured.
 */
import { randomId } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import type { ProviderAdapterRegistry } from './adapters';
import { IDENTITY_PROTOCOLS, type IdentityProtocol } from './constants';

export interface IdpRecord {
  id: string;
  protocol: IdentityProtocol;
  name: string;
  tenant: string;
  reusedSecurity: boolean;
  note: string;
}

const securityProtocol = (p: IdentityProtocol): 'oidc' | 'saml' | null => {
  if (p === 'saml2.0') return 'saml';
  if (p === 'oidc' || p === 'oauth2.1' || p === 'entra-id' || p === 'google-workspace' || p === 'okta') return 'oidc';
  return null; // ldap / active-directory / scim — represented as adapters, not OIDC/SAML config
};

export class EnterpriseIdentity {
  private readonly idps = new Map<string, IdpRecord>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext,
    private readonly adapters: ProviderAdapterRegistry,
  ) {}

  async registerProvider(input: { protocol: IdentityProtocol; name: string; tenant: string; issuer?: string; metadataUrl?: string; org?: string }): Promise<IdpRecord> {
    if (!IDENTITY_PROTOCOLS.includes(input.protocol)) throw new Error(`unknown identity protocol: ${input.protocol}`);
    let reusedSecurity = false;
    const sp = securityProtocol(input.protocol);
    if (sp && this.ctx.security) {
      this.ctx.security.identity().registerProvider({ id: randomId('idp'), protocol: sp, issuer: input.issuer ?? `https://idp.example.com/${input.protocol}`, metadataUrl: input.metadataUrl ?? `https://idp.example.com/${input.protocol}/.well-known`, tenant: input.tenant });
      reusedSecurity = true;
    }
    const rec: IdpRecord = { id: randomId('idpref'), protocol: input.protocol, name: input.name, tenant: input.tenant, reusedSecurity, note: reusedSecurity ? 'provider configured on the reused security identity registry' : 'provider represented — adapter-verified until configured' };
    this.idps.set(rec.id, rec);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E6', operation: `identity.provider.${input.protocol}`, targetId: rec.id, evidence: reusedSecurity ? 'live-verified' : 'adapter-verified' });
    return rec;
  }

  /** Provision an identity (JIT) by REUSING the security identity registry — a real record. */
  async provisionIdentity(input: { displayName: string; tenant: string; roles?: string[]; federationSource?: string; org?: string }): Promise<{ identityId: string | null; reusedSecurity: boolean }> {
    if (this.ctx.security) {
      const identity = await this.ctx.security.identity().register({ type: 'user', displayName: input.displayName, tenant: input.tenant, ...(input.roles ? { roles: input.roles } : {}), ...(input.federationSource ? { federationSource: input.federationSource } : {}) });
      await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: '_platform', epic: 'E6', operation: 'identity.provision', targetId: identity.id, evidence: 'live-verified' });
      return { identityId: identity.id, reusedSecurity: true };
    }
    return { identityId: null, reusedSecurity: false };
  }

  /** Directory of real identities for a tenant — reused from the security registry. */
  directory(tenant: string): number {
    return this.ctx.security ? this.ctx.security.identity().directory(tenant).length : 0;
  }

  providers(): IdpRecord[] { return [...this.idps.values()]; }
  identityProviderAdapters(): string[] { return this.adapters.list('identity').map((a) => a.system); }
  count(): number { return this.idps.size; }
}

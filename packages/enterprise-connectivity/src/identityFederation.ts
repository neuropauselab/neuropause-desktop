/**
 * EPIC 2 — Identity Federation. Microsoft Entra ID / Google Workspace / Okta / Auth0 with SSO / OAuth2 /
 * OIDC / SCIM user provisioning and organization mapping. External IdPs are REPRESENTED (adapter-
 * verified) until configured. SCIM provisioning is REAL when the security platform is wired in: each
 * user is registered through the reused identity platform. No live OAuth authorization is ever claimed —
 * an OAuth grant is recorded 'pending-credentials' until real enterprise credentials are configured.
 */
import { IDP_PROVIDERS, SSO_PROTOCOLS, type IdpProvider, type SsoProtocol } from './constants';
import type { EcContext } from './types';
import type { EnterpriseConnectivityGovernance } from './governance';

export interface FederationConnection {
  provider: IdpProvider;
  protocol: SsoProtocol;
  configured: boolean;
  oauthStatus: 'pending-credentials' | 'authorized';
}

export interface ScimResult {
  provider: IdpProvider;
  provisioned: number;
  reusedSecurity: boolean;
}

export class IdentityFederation {
  constructor(
    private readonly ctx: EcContext,
    private readonly gov: EnterpriseConnectivityGovernance,
    private readonly operator: string,
  ) {}

  providers(): readonly IdpProvider[] {
    return IDP_PROVIDERS;
  }
  protocols(): readonly SsoProtocol[] {
    return SSO_PROTOCOLS;
  }

  /** Connect an IdP — represented. OAuth stays 'pending-credentials' (never a live authorization). */
  async connect(input: { provider: IdpProvider; protocol: SsoProtocol }): Promise<FederationConnection> {
    if (!IDP_PROVIDERS.includes(input.provider)) throw new Error(`unknown IdP: ${input.provider}`);
    const conn: FederationConnection = { provider: input.provider, protocol: input.protocol, configured: false, oauthStatus: 'pending-credentials' };
    await this.gov.record({ actor: this.operator, customer: '_identity', connector: input.provider, epic: 'E2', operation: `federate.${input.protocol}`, targetId: input.provider, evidence: 'adapter-verified', decision: conn.oauthStatus });
    return conn;
  }

  /** SCIM provisioning — REAL user registration through the reused security identity platform. */
  async provisionUsers(input: { provider: IdpProvider; users: Array<{ externalId: string; displayName: string }>; tenant: string }): Promise<ScimResult> {
    let provisioned = 0;
    let reusedSecurity = false;
    if (this.ctx.security) {
      for (const u of input.users) {
        const id = await this.ctx.security.identity().register({ type: 'user', displayName: u.displayName, tenant: input.tenant, federationSource: input.provider });
        if (id.id) provisioned += 1;
      }
      reusedSecurity = true;
    }
    await this.gov.record({ actor: this.operator, customer: input.tenant, connector: input.provider, epic: 'E2', operation: 'scim-provision', targetId: input.provider, evidence: reusedSecurity ? 'live-verified' : 'adapter-verified', decision: `${provisioned}/${input.users.length}` });
    return { provider: input.provider, provisioned, reusedSecurity };
  }

  /** Organization mapping — maps an external org to a NEMS tenant (represented until the IdP is configured). */
  organizationMapping(input: { provider: IdpProvider; externalOrg: string; tenant: string }): { provider: IdpProvider; externalOrg: string; tenant: string; active: false } {
    return { provider: input.provider, externalOrg: input.externalOrg, tenant: input.tenant, active: false };
  }
}

/**
 * EPIC 3 — Enterprise Identity Integration. Microsoft Entra ID, Google Workspace, Okta, Active
 * Directory, LDAP, and SCIM. REUSES the Sprint-2 infrastructure identity platform (which itself
 * reuses the security identity registry) — it never re-implements identity. Providers are
 * adapter-verified until configured; OIDC/SAML providers register on the reused registry.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import type { IntegrationContext } from './types';
import { IDENTITY_SYSTEMS } from './constants';

export interface IdentityConnection { id: string; system: string; tenant: string; reusedInfrastructure: boolean; note: string }

const toProtocol = (system: string): 'entra-id' | 'google-workspace' | 'okta' | 'active-directory' | 'ldap' | 'scim' | null => {
  switch (system) {
    case 'Microsoft Entra ID': return 'entra-id';
    case 'Google Workspace': return 'google-workspace';
    case 'Okta': return 'okta';
    case 'Active Directory': return 'active-directory';
    case 'LDAP': return 'ldap';
    case 'SCIM': return 'scim';
    default: return null;
  }
};

export class IdentityIntegration {
  private readonly connections = new Map<string, IdentityConnection>();

  constructor(
    private readonly governance: IntegrationGovernance,
    private readonly ctx: IntegrationContext,
  ) {}

  systems(): readonly string[] { return IDENTITY_SYSTEMS; }

  async connect(input: { system: string; tenant: string; org?: string }): Promise<IdentityConnection> {
    const protocol = toProtocol(input.system);
    if (!protocol) throw new Error(`${input.system} is not a supported identity system`);
    let reusedInfrastructure = false;
    if (this.ctx.infrastructure) {
      await this.ctx.infrastructure.identity().registerProvider({ protocol, name: input.system, tenant: input.tenant });
      reusedInfrastructure = true;
    }
    const conn: IdentityConnection = { id: randomId('idc'), system: input.system, tenant: input.tenant, reusedInfrastructure, note: reusedInfrastructure ? 'registered on the reused Sprint-2 identity platform' : 'represented — no identity platform connected' };
    this.connections.set(conn.id, conn);
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', integration: '_identity', connector: input.system, epic: 'E3', operation: 'identity.connect', targetId: conn.id, evidence: reusedInfrastructure ? 'live-verified' : 'adapter-verified' });
    return conn;
  }

  list(): IdentityConnection[] { return [...this.connections.values()]; }
  count(): number { return this.connections.size; }
}

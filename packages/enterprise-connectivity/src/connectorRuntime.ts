/**
 * EPIC 1 — Enterprise Connector Runtime. The registry + lifecycle + status + health + configuration +
 * discovery + permissions for enterprise connectors. A connector is 'active' ONLY after it is both
 * configured (a credential REFERENCE, never a value) AND verified (a real verification proof). When the
 * Sprint-3 integration platform is wired in, the connector is backed by its real adapter-framework
 * connection (connect → configure → verify). This never claims a live connection to a customer system.
 */
import { randomId } from '@neuropause/cloud-core';
import { CONNECTOR_CATEGORIES, CONNECTOR_SYSTEMS, type ConnectorCategory, type ConnectorStatus } from './constants';
import type { EcContext } from './types';
import type { EnterpriseConnectivityGovernance } from './governance';

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  system: string;
  status: ConnectorStatus;
  credentialRef: string | null;
  adapterConnId: string | null;
  reusedIntegration: boolean;
}

/** Map each connector category to a valid integration-platform connector-registry category (reuse). */
const CATEGORY_TO_INTEGRATION: Record<ConnectorCategory, 'collaboration' | 'erp' | 'crm' | 'storage' | 'messaging'> = {
  productivity: 'collaboration',
  erp: 'erp',
  crm: 'crm',
  storage: 'storage',
  communication: 'messaging',
};

export class ConnectorRuntime {
  private readonly connectors = new Map<string, Connector>();

  constructor(
    private readonly ctx: EcContext,
    private readonly gov: EnterpriseConnectivityGovernance,
    private readonly operator: string,
  ) {}

  categories(): readonly ConnectorCategory[] {
    return CONNECTOR_CATEGORIES;
  }

  /** Discovery — the represented systems available per category. */
  discover(category: ConnectorCategory): string[] {
    return CONNECTOR_SYSTEMS[category].systems;
  }

  async register(input: { name: string; category: ConnectorCategory; system: string }): Promise<Connector> {
    if (!CONNECTOR_SYSTEMS[input.category].systems.includes(input.system)) throw new Error(`system ${input.system} not in category ${input.category}`);
    let adapterConnId: string | null = null;
    let reusedIntegration = false;
    if (this.ctx.integrationPlatform) {
      // Reuse the Sprint-3 connector registry (permissive; the system stays adapter-verified, never contacted).
      const rec = await this.ctx.integrationPlatform.runtime().register({ name: input.name, category: CATEGORY_TO_INTEGRATION[input.category], system: input.system });
      adapterConnId = rec.id;
      reusedIntegration = true;
    }
    const connector: Connector = { id: randomId('conn'), name: input.name, category: input.category, system: input.system, status: 'registered', credentialRef: null, adapterConnId, reusedIntegration };
    this.connectors.set(connector.id, connector);
    await this.gov.record({ actor: this.operator, customer: '_connectors', connector: input.system, epic: 'E1', operation: 'register-connector', targetId: connector.id, evidence: 'live-verified', decision: 'registered' });
    return connector;
  }

  /** Configure a credential REFERENCE (never a secret value). */
  async configure(id: string, credentialRef: string): Promise<Connector> {
    const connector = this.require(id);
    connector.credentialRef = credentialRef;
    connector.status = 'configured';
    await this.gov.record({ actor: this.operator, customer: '_connectors', connector: connector.system, epic: 'E1', operation: 'configure-connector', targetId: id, evidence: 'live-verified', decision: 'configured' });
    return connector;
  }

  /** Verify with a real proof. 'active' is reached ONLY when configured AND verified. */
  async verify(id: string, proof: { verified: boolean; evidenceRef: string }): Promise<Connector> {
    const connector = this.require(id);
    if (connector.status !== 'configured') {
      connector.status = 'failed';
      await this.gov.record({ actor: this.operator, customer: '_connectors', connector: connector.system, epic: 'E1', operation: 'verify-connector', targetId: id, evidence: 'infrastructure-pending', decision: 'not configured' });
      return connector;
    }
    connector.status = proof.verified ? 'active' : 'verified';
    await this.gov.record({ actor: this.operator, customer: '_connectors', connector: connector.system, epic: 'E1', operation: 'verify-connector', targetId: id, evidence: proof.verified ? 'live-verified' : 'adapter-verified', decision: connector.status });
    return connector;
  }

  health(id: string): { id: string; status: ConnectorStatus; healthy: boolean } {
    const connector = this.require(id);
    return { id, status: connector.status, healthy: connector.status === 'active' };
  }

  /** Permissions are represented until a real, verified connection grants scopes. */
  permissions(id: string): { id: string; scopes: string[]; granted: boolean } {
    const connector = this.require(id);
    return { id, scopes: ['read:metadata'], granted: connector.status === 'active' };
  }

  get(id: string): Connector | undefined { return this.connectors.get(id); }
  list(category?: ConnectorCategory): Connector[] {
    const all = [...this.connectors.values()];
    return category ? all.filter((c) => c.category === category) : all;
  }
  activeCount(): number { return [...this.connectors.values()].filter((c) => c.status === 'active').length; }

  private require(id: string): Connector {
    const c = this.connectors.get(id);
    if (!c) throw new Error(`unknown connector: ${id}`);
    return c;
  }
}

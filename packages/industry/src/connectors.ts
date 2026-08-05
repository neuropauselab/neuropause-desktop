/**
 * Connector Marketplace. Industry connectors for SAP / Oracle / Dynamics / Salesforce / Epic /
 * Cerner / Shopify / WooCommerce / Stripe / Razorpay / QuickBooks / Xero / Workday / ADP. Each is
 * a DESCRIPTOR that stays ADAPTER-VERIFIED until a tenant configures it with real credentials —
 * it is never executed here.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IndustryGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { CONNECTOR_CATALOG } from './constants';

export interface MarketplaceConnector {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: EvidenceLevel;
  note: string;
}

export class ConnectorMarketplace {
  private readonly connectors = new Map<string, MarketplaceConnector>();

  constructor(private readonly governance: IndustryGovernance) {}

  async register(system: string, category: string): Promise<MarketplaceConnector> {
    const c: MarketplaceConnector = { id: randomId('conn'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} connector — adapter-verified until configured with real credentials (never executed here)` };
    this.connectors.set(c.id, c);
    await this.governance.record({ actor: 'system', operation: `connector.register.${category}`, targetId: c.id, evidence: 'adapter-verified', detail: system });
    return c;
  }

  /** Load the standard connector catalog. */
  async seed(): Promise<void> {
    for (const entry of CONNECTOR_CATALOG) await this.register(entry.system, entry.category);
  }

  get(id: string): MarketplaceConnector | undefined {
    return this.connectors.get(id);
  }
  list(category?: string): MarketplaceConnector[] {
    const all = [...this.connectors.values()];
    return category ? all.filter((c) => c.category === category) : all;
  }
  systems(): string[] {
    return [...this.connectors.values()].map((c) => c.system);
  }
  count(): number {
    return this.connectors.size;
  }
}

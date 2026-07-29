/**
 * External payment / marketplace-billing adapters — Stripe, Razorpay, PayPal, and the Azure / AWS /
 * Google Cloud marketplaces. Each is a DESCRIPTOR that stays ADAPTER-VERIFIED until configured; no
 * charge, settlement, payout, or remittance is performed here. Live payment operations are
 * regulated-external and represented only.
 */
import { randomId } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import type { EvidenceLevel } from './types';
import { PAYMENT_ADAPTER_CATALOG } from './constants';

export interface PaymentAdapterDescriptor {
  id: string;
  system: string;
  category: string;
  configured: boolean;
  evidence: EvidenceLevel;
  note: string;
}

export class PaymentAdapterRegistry {
  private readonly adapters = new Map<string, PaymentAdapterDescriptor>();

  constructor(private readonly governance: CommercialGovernance) {}

  async register(system: string, category: string): Promise<PaymentAdapterDescriptor> {
    const a: PaymentAdapterDescriptor = { id: randomId('payad'), system, category, configured: false, evidence: 'adapter-verified', note: `${system} (${category}) represented — adapter-verified until configured; no charge/settlement performed here` };
    this.adapters.set(a.id, a);
    await this.governance.record({ actor: 'system', org: '_platform', tenant: '_platform', operation: `adapter.register.${category}`, targetId: a.id, evidence: 'adapter-verified' });
    return a;
  }

  async seed(): Promise<void> {
    for (const entry of PAYMENT_ADAPTER_CATALOG) await this.register(entry.system, entry.category);
  }

  list(category?: string): PaymentAdapterDescriptor[] {
    const all = [...this.adapters.values()];
    return category ? all.filter((a) => a.category === category) : all;
  }
  systems(): string[] {
    return [...this.adapters.values()].map((a) => a.system);
  }
  count(): number {
    return this.adapters.size;
  }
}

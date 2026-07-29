/**
 * Module 11 — Marketplace Commerce. Purchase industry packs, AI workers, templates, and extensions.
 * REUSES the Wave 6 federation marketplace (publish + install) for the actual catalog and
 * distribution — no second marketplace is built. A purchase is a real in-process record and the
 * install is real; the PAYMENT is not processed here (settlement is regulated-external) and revenue
 * is business-data-pending. Starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import type { CommercialContext } from './types';
import { COMMERCE_KINDS, type CommerceKind } from './constants';

export interface Purchase {
  id: string;
  tenantId: string;
  orgId: string;
  kind: CommerceKind;
  name: string;
  reusedFederation: boolean;
  listingId: string | null;
  note: string;
  at: number;
}

// map a commercial commerce kind onto the reused federation marketplace kind (no duplicate taxonomy)
const federationKind = (k: CommerceKind): 'package' | 'ai-agent' | 'template' | 'plugin' => {
  switch (k) {
    case 'industry-pack': return 'package';
    case 'ai-worker': return 'ai-agent';
    case 'template': return 'template';
    case 'extension': return 'plugin';
  }
};

export class MarketplaceCommerce {
  private readonly purchases = new Map<string, Purchase>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
    private readonly ctx: CommercialContext = {},
  ) {}

  async purchase(input: { tenantId: string; orgId: string; kind: CommerceKind; name: string }): Promise<Purchase> {
    if (!COMMERCE_KINDS.includes(input.kind)) throw new Error(`unknown commerce kind: ${input.kind}`);
    let listingId: string | null = null;
    let reusedFederation = false;
    if (this.ctx.federation) {
      // reuse the Wave 6 federation marketplace — publish (idempotent catalog entry) then install
      const listing = await this.ctx.federation.marketplace().publish({ kind: federationKind(input.kind), name: input.name, publisherOrg: input.orgId });
      await this.ctx.federation.marketplace().install(listing.id, input.orgId);
      listingId = listing.id;
      reusedFederation = true;
    }
    const p: Purchase = {
      id: randomId('purch'),
      tenantId: input.tenantId,
      orgId: input.orgId,
      kind: input.kind,
      name: input.name,
      reusedFederation,
      listingId,
      note: 'entitlement recorded and installed; payment represented only — no charge settled here',
      at: this.clock.now(),
    };
    this.purchases.set(p.id, p);
    await this.governance.record({ actor: 'system', org: input.orgId, tenant: input.tenantId, operation: `purchase.${input.kind}`, targetId: p.id, evidence: 'live-verified', decision: reusedFederation ? 'installed via federation marketplace' : 'recorded (no marketplace connected)' });
    return p;
  }

  list(tenantId?: string): Purchase[] {
    const all = [...this.purchases.values()];
    return tenantId ? all.filter((p) => p.tenantId === tenantId) : all;
  }
  count(): number { return this.purchases.size; }
}

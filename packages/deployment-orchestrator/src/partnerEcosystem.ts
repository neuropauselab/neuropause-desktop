/**
 * EPIC 8 — Partner Ecosystem. System-integrator, consulting, technology, marketplace, and training
 * partner registries. Partners are REPRESENTED until agreements exist — <code>agreementSigned</code>
 * stays false. No partnership, reseller relationship, or marketplace listing is claimed.
 */
import { randomId } from '@neuropause/cloud-core';
import { PARTNER_TYPES, type PartnerType } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  agreementSigned: false;
}

export class PartnerEcosystem {
  private readonly partners = new Map<string, Partner>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  types(): readonly PartnerType[] {
    return PARTNER_TYPES;
  }

  async registerPartner(input: { name: string; type: PartnerType }): Promise<Partner> {
    const partner: Partner = { id: randomId('partner'), name: input.name, type: input.type, agreementSigned: false };
    this.partners.set(partner.id, partner);
    await this.gov.record({ operator: this.operator, organization: input.name, environment: 'partner', version: '1.0.0', epic: 'E8', operation: 'register-partner', targetId: partner.id, evidence: 'business-data-pending', decision: `${input.type} (represented)` });
    return partner;
  }

  listByType(type: PartnerType): Partner[] {
    return [...this.partners.values()].filter((p) => p.type === type);
  }
  partnerCount(): number {
    return this.partners.size;
  }
}

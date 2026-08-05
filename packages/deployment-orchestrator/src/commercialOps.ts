/**
 * EPIC 7 — Commercial Operations. Opportunity, proposal, quote, contract, license-activation, and renewal
 * registries. The commercial pipeline is a real in-process registry, but every entity is REPRESENTED: a
 * contract is never signed (<code>signed:false</code>), a license is issued in-registry but not backed by
 * a real paid contract, pipeline value is the sum of represented estimates and is explicitly NOT revenue,
 * and no production revenue is ever claimed or fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { type CommercialStage } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface Opportunity {
  id: string;
  organization: string;
  estimatedValue: number;
  stage: CommercialStage;
}
export interface Quote {
  id: string;
  opportunityId: string;
  amount: number;
}
export interface Contract {
  id: string;
  opportunityId: string;
  signed: false;
}
export interface LicenseActivation {
  id: string;
  organization: string;
  plan: string;
  issued: boolean;
  backedByContract: false;
}

export class CommercialOps {
  private readonly opportunities = new Map<string, Opportunity>();
  private readonly quotes = new Map<string, Quote>();
  private readonly contracts = new Map<string, Contract>();
  private readonly licenses = new Map<string, LicenseActivation>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  async createOpportunity(input: { organization: string; estimatedValue: number }): Promise<Opportunity> {
    const opp: Opportunity = { id: randomId('opp'), organization: input.organization, estimatedValue: input.estimatedValue, stage: 'opportunity' };
    this.opportunities.set(opp.id, opp);
    await this.gov.record({ operator: this.operator, organization: input.organization, environment: 'commercial', version: '1.0.0', epic: 'E7', operation: 'create-opportunity', targetId: opp.id, evidence: 'business-data-pending', decision: 'represented' });
    return opp;
  }

  async advanceStage(opportunityId: string, stage: CommercialStage): Promise<Opportunity> {
    const opp = this.requireOpp(opportunityId);
    opp.stage = stage;
    await this.gov.record({ operator: this.operator, organization: opp.organization, environment: 'commercial', version: '1.0.0', epic: 'E7', operation: 'advance-stage', targetId: opportunityId, evidence: 'business-data-pending', decision: stage });
    return opp;
  }

  async createQuote(input: { opportunityId: string; amount: number }): Promise<Quote> {
    const quote: Quote = { id: randomId('quote'), opportunityId: input.opportunityId, amount: input.amount };
    this.quotes.set(quote.id, quote);
    await this.advanceStage(input.opportunityId, 'quote');
    return quote;
  }

  /** Record a contract — REPRESENTED; <code>signed</code> stays false. No signed contract is ever claimed. */
  async recordContract(opportunityId: string): Promise<Contract> {
    const contract: Contract = { id: randomId('contract'), opportunityId, signed: false };
    this.contracts.set(contract.id, contract);
    await this.advanceStage(opportunityId, 'contract');
    await this.gov.record({ operator: this.operator, organization: '_commercial', environment: 'commercial', version: '1.0.0', epic: 'E7', operation: 'record-contract', targetId: contract.id, evidence: 'business-data-pending', decision: 'unsigned (represented)' });
    return contract;
  }

  /** Activate a license — issued in-registry but not backed by a real paid contract. */
  async activateLicense(input: { organization: string; plan: string }): Promise<LicenseActivation> {
    const license: LicenseActivation = { id: randomId('lic'), organization: input.organization, plan: input.plan, issued: true, backedByContract: false };
    this.licenses.set(license.id, license);
    await this.gov.record({ operator: this.operator, organization: input.organization, environment: 'commercial', version: '1.0.0', epic: 'E7', operation: 'activate-license', targetId: license.id, evidence: 'business-data-pending', decision: input.plan });
    return license;
  }

  async recordRenewal(contractId: string): Promise<{ contractId: string; renewed: false }> {
    await this.gov.record({ operator: this.operator, organization: '_commercial', environment: 'commercial', version: '1.0.0', epic: 'E7', operation: 'record-renewal', targetId: contractId, evidence: 'business-data-pending', decision: 'represented' });
    return { contractId, renewed: false };
  }

  /** Pipeline value — the sum of REPRESENTED estimates. This is NOT revenue. */
  pipelineValue(): { representedValue: number; isRevenue: false; note: string } {
    const total = [...this.opportunities.values()].reduce((sum, o) => sum + o.estimatedValue, 0);
    return { representedValue: total, isRevenue: false, note: 'sum of represented opportunity estimates; no production revenue exists' };
  }

  opportunityCount(): number {
    return this.opportunities.size;
  }
  contractCount(): number {
    return this.contracts.size;
  }
  licenseCount(): number {
    return this.licenses.size;
  }

  private requireOpp(id: string): Opportunity {
    const o = this.opportunities.get(id);
    if (!o) throw new Error(`unknown opportunity: ${id}`);
    return o;
  }
}

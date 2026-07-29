/**
 * EPIC 6 — Customer Success Operations. Customer health, adoption readiness, success playbooks, executive
 * business reviews, renewal planning, and expansion opportunities. Only MEASURED data is reported: a
 * health score is a real computation over the signals actually supplied, and success playbooks + EBR
 * structure are real. But there is no production usage here — real adoption metrics are business-data-
 * pending, and accounts are represented until a real customer relationship exists. No adoption number,
 * renewal, or expansion is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { NO_CUSTOMER_DATA } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface SuccessAccount {
  id: string;
  organization: string;
  healthScore: number | null;
}
export interface SuccessPlaybook {
  id: string;
  name: string;
  steps: string[];
}
export interface RenewalPlan {
  id: string;
  accountId: string;
  termMonths: number;
  committed: false;
}

export class CustomerSuccessOps {
  private readonly accounts = new Map<string, SuccessAccount>();
  private readonly playbooks = new Map<string, SuccessPlaybook>();
  private readonly renewals = new Map<string, RenewalPlan>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  async registerAccount(input: { organization: string }): Promise<SuccessAccount> {
    const account: SuccessAccount = { id: randomId('acct'), organization: input.organization, healthScore: null };
    this.accounts.set(account.id, account);
    await this.gov.record({ operator: this.operator, organization: input.organization, environment: 'success', version: '1.0.0', epic: 'E6', operation: 'register-account', targetId: account.id, evidence: 'business-data-pending', decision: 'represented' });
    return account;
  }

  /** Customer health — a REAL average over the signals supplied (0–100). No production telemetry exists. */
  async recordHealth(input: { accountId: string; signals: Array<{ label: string; value: number }> }): Promise<SuccessAccount> {
    const account = this.require(input.accountId);
    const vals = input.signals.map((s) => Math.max(0, Math.min(100, s.value)));
    account.healthScore = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    await this.gov.record({ operator: this.operator, organization: account.organization, environment: 'success', version: '1.0.0', epic: 'E6', operation: 'record-health', targetId: input.accountId, evidence: 'business-data-pending', decision: `health:${account.healthScore ?? 'n/a'}` });
    return account;
  }

  async addPlaybook(input: { name: string; steps: string[] }): Promise<SuccessPlaybook> {
    const pb: SuccessPlaybook = { id: randomId('csp'), name: input.name, steps: input.steps };
    this.playbooks.set(pb.id, pb);
    await this.gov.record({ operator: this.operator, organization: '_success', environment: 'success', version: '1.0.0', epic: 'E6', operation: 'add-playbook', targetId: pb.id, evidence: 'live-verified', decision: `${input.steps.length} steps` });
    return pb;
  }

  async scheduleEbr(input: { accountId: string; quarter: string }): Promise<{ accountId: string; quarter: string }> {
    const account = this.require(input.accountId);
    await this.gov.record({ operator: this.operator, organization: account.organization, environment: 'success', version: '1.0.0', epic: 'E6', operation: 'schedule-ebr', targetId: input.accountId, evidence: 'live-verified', decision: input.quarter });
    return { accountId: input.accountId, quarter: input.quarter };
  }

  /** Plan a renewal — represented; <code>committed</code> stays false until a real contract renewal exists. */
  async planRenewal(input: { accountId: string; termMonths: number }): Promise<RenewalPlan> {
    const account = this.require(input.accountId);
    const plan: RenewalPlan = { id: randomId('renew'), accountId: input.accountId, termMonths: input.termMonths, committed: false };
    this.renewals.set(plan.id, plan);
    await this.gov.record({ operator: this.operator, organization: account.organization, environment: 'success', version: '1.0.0', epic: 'E6', operation: 'plan-renewal', targetId: plan.id, evidence: 'business-data-pending', decision: `${input.termMonths}mo (represented)` });
    return plan;
  }

  async identifyExpansion(input: { accountId: string; note: string }): Promise<{ accountId: string; note: string; realized: false }> {
    const account = this.require(input.accountId);
    await this.gov.record({ operator: this.operator, organization: account.organization, environment: 'success', version: '1.0.0', epic: 'E6', operation: 'identify-expansion', targetId: input.accountId, evidence: 'business-data-pending', decision: 'opportunity (represented)' });
    return { accountId: input.accountId, note: input.note, realized: false };
  }

  /** Production adoption — no production usage data exists. */
  productionAdoption(): { measured: false; note: string } {
    return { measured: false, note: NO_CUSTOMER_DATA };
  }

  accountCount(): number {
    return this.accounts.size;
  }
  playbookCount(): number {
    return this.playbooks.size;
  }

  private require(id: string): SuccessAccount {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`unknown account: ${id}`);
    return a;
  }
}

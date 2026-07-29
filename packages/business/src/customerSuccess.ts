/**
 * Module 3 — Enterprise Customer Success. Onboarding, health scores (reused from CRM), renewals,
 * expansion, churn risk, success plans, and journey. Churn risk is derived from the real CRM
 * health signal — 'unknown' when there is no data, never fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import type { CrmRuntime } from './crm';

export interface OnboardingPlan {
  id: string;
  accountId: string;
  stages: Array<{ name: string; done: boolean }>;
  createdAt: number;
}
export interface Renewal {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  dueDate: number;
  state: 'upcoming' | 'renewed' | 'churned';
}
export interface SuccessPlan {
  id: string;
  accountId: string;
  goals: string[];
}

export type ChurnRisk = 'low' | 'medium' | 'high' | 'unknown';

export class CustomerSuccessRuntime {
  private readonly onboardingMap = new Map<string, OnboardingPlan>();
  private readonly renewalsMap = new Map<string, Renewal>();
  private readonly plansMap = new Map<string, SuccessPlan>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
    private readonly crm: CrmRuntime,
  ) {}

  async startOnboarding(accountId: string): Promise<OnboardingPlan> {
    const plan: OnboardingPlan = { id: randomId('onb'), accountId, stages: [{ name: 'kickoff', done: false }, { name: 'configure', done: false }, { name: 'train', done: false }, { name: 'go-live', done: false }], createdAt: this.clock.now() };
    this.onboardingMap.set(plan.id, plan);
    await this.governance.record({ actor: 'system', domain: 'customer-success', operation: 'onboarding.start', targetId: plan.id, evidence: 'live-verified' });
    return plan;
  }
  async createRenewal(input: { accountId: string; amount: number; dueDate: number; currency?: string }): Promise<Renewal> {
    const r: Renewal = { id: randomId('renew'), accountId: input.accountId, amount: input.amount, currency: input.currency ?? 'USD', dueDate: input.dueDate, state: 'upcoming' };
    this.renewalsMap.set(r.id, r);
    await this.governance.record({ actor: 'system', domain: 'customer-success', operation: 'renewal.create', targetId: r.id, evidence: 'live-verified' });
    return r;
  }
  async createSuccessPlan(input: { accountId: string; goals: string[] }): Promise<SuccessPlan> {
    const p: SuccessPlan = { id: randomId('sp'), accountId: input.accountId, goals: input.goals };
    this.plansMap.set(p.id, p);
    return p;
  }

  /** Churn risk derived from real CRM health — 'unknown' when there are no signals. */
  churnRisk(accountId: string): ChurnRisk {
    const h = this.crm.health(accountId);
    if (h.score === null) return 'unknown';
    if (h.score >= 60) return 'low';
    if (h.score >= 30) return 'medium';
    return 'high';
  }

  journey(accountId: string): Array<{ kind: string; note: string; at: number }> {
    return this.crm.activities().filter((a) => a.subjectId === accountId).map((a) => ({ kind: a.kind, note: a.note, at: a.at }));
  }

  onboarding(): OnboardingPlan[] { return [...this.onboardingMap.values()]; }
  renewals(): Renewal[] { return [...this.renewalsMap.values()]; }
  successPlans(): SuccessPlan[] { return [...this.plansMap.values()]; }
  count(): number { return this.onboardingMap.size + this.renewalsMap.size; }
}

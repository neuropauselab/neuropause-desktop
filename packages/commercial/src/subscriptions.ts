/**
 * Module 5 — Subscription Platform. Monthly / annual / enterprise-contract plans, renewals,
 * upgrades, downgrades, and suspension. Subscriptions are REPRESENTED — no card is charged and no
 * payment is processed here (settlement is regulated-external). MRR/ARR are computed from the REAL
 * represented subscription records only, so they are 0 until real subscriptions exist — never a
 * fabricated revenue figure.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { SUBSCRIPTION_PLANS, type SubscriptionPlan, type SubscriptionState } from './constants';

export interface Subscription {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  state: SubscriptionState;
  seats: number;
  unitPriceCents: number;
  mrrCents: number;
  startedAt: number;
}

const monthlyMrr = (plan: SubscriptionPlan, seats: number, unit: number): number => {
  if (plan === 'annual') return Math.round((seats * unit) / 12);
  return seats * unit; // monthly and enterprise-contract billed monthly-equivalent
};

export class SubscriptionPlatform {
  private readonly subs = new Map<string, Subscription>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async subscribe(input: { tenantId: string; plan: SubscriptionPlan; seats: number; unitPriceCents: number; trial?: boolean; org?: string }): Promise<Subscription> {
    if (!SUBSCRIPTION_PLANS.includes(input.plan)) throw new Error(`unknown plan: ${input.plan}`);
    if (input.seats <= 0) throw new Error('seats must be positive');
    const sub: Subscription = {
      id: randomId('sub'),
      tenantId: input.tenantId,
      plan: input.plan,
      state: input.trial ? 'trialing' : 'active',
      seats: input.seats,
      unitPriceCents: input.unitPriceCents,
      mrrCents: monthlyMrr(input.plan, input.seats, input.unitPriceCents),
      startedAt: this.clock.now(),
    };
    this.subs.set(sub.id, sub);
    // the subscription record is live-verified; the revenue it implies is business-data-pending and no charge is made
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: `subscription.${sub.state}.${input.plan}`, targetId: sub.id, evidence: 'live-verified', decision: 'represented — no payment processed' });
    return sub;
  }

  async renew(id: string): Promise<Subscription> { return this.transition(id, 'active', 'renew'); }
  async suspend(id: string): Promise<Subscription> { return this.transition(id, 'suspended', 'suspend'); }
  async cancel(id: string): Promise<Subscription> { return this.transition(id, 'cancelled', 'cancel'); }

  async changeSeats(id: string, seats: number): Promise<Subscription> {
    if (seats <= 0) throw new Error('seats must be positive');
    const sub = this.require(id);
    const direction = seats > sub.seats ? 'upgrade' : seats < sub.seats ? 'downgrade' : 'no-change';
    sub.seats = seats;
    sub.mrrCents = monthlyMrr(sub.plan, sub.seats, sub.unitPriceCents);
    await this.governance.record({ actor: 'system', org: '_ops', tenant: sub.tenantId, operation: `subscription.${direction}`, targetId: sub.id, evidence: 'live-verified', decision: `${seats} seats` });
    return sub;
  }

  private async transition(id: string, state: SubscriptionState, op: string): Promise<Subscription> {
    const sub = this.require(id);
    sub.state = state;
    await this.governance.record({ actor: 'system', org: '_ops', tenant: sub.tenantId, operation: `subscription.${op}`, targetId: sub.id, evidence: 'live-verified' });
    return sub;
  }
  private require(id: string): Subscription {
    const s = this.subs.get(id);
    if (!s) throw new Error(`no subscription ${id}`);
    return s;
  }

  /** MRR in cents from REAL active/trialing subscriptions only — 0 when there are none. */
  mrrCents(): number {
    return [...this.subs.values()].filter((s) => s.state === 'active' || s.state === 'trialing').reduce((sum, s) => sum + s.mrrCents, 0);
  }
  arrCents(): number { return this.mrrCents() * 12; }

  get(id: string): Subscription | undefined { return this.subs.get(id); }
  list(tenantId?: string): Subscription[] {
    const all = [...this.subs.values()];
    return tenantId ? all.filter((s) => s.tenantId === tenantId) : all;
  }
  count(): number { return this.subs.size; }
}

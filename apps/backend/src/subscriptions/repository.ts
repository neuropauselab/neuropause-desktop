/** Postgres SubscriptionRepository. Exercised by the integration suite. */
import { query } from '../db/pool';
import type { BillingPlanId } from '@neuropause/shared';
import type {
  PlanTier,
  Subscription,
  SubscriptionPatch,
  SubscriptionRepository,
  SubscriptionStatus,
} from './types';

interface SubscriptionRow {
  id: string;
  org_id: string;
  plan_tier: PlanTier;
  plan: BillingPlanId | null;
  status: SubscriptionStatus;
  seats: number;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
const COLS =
  'id, org_id, plan_tier, plan, status, seats, provider_customer_id, provider_subscription_id, current_period_end, trial_ends_at, created_at, updated_at';

const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id,
  orgId: r.org_id,
  planTier: r.plan_tier,
  plan: r.plan,
  status: r.status,
  seats: r.seats,
  providerCustomerId: r.provider_customer_id,
  providerSubscriptionId: r.provider_subscription_id,
  currentPeriodEnd: r.current_period_end ? r.current_period_end.toISOString() : null,
  trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

async function getByOrg(orgId: string): Promise<Subscription | null> {
  const { rows } = await query<SubscriptionRow>(
    `SELECT ${COLS} FROM subscriptions WHERE org_id = $1`,
    [orgId],
  );
  return rows[0] ? toSubscription(rows[0]) : null;
}

export function createPgSubscriptionRepository(): SubscriptionRepository {
  return {
    getByOrg,
    async create(orgId) {
      const { rows } = await query<SubscriptionRow>(
        `INSERT INTO subscriptions (org_id) VALUES ($1) RETURNING ${COLS}`,
        [orgId],
      );
      return toSubscription(rows[0]!);
    },
    async update(orgId, patch: SubscriptionPatch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const push = (col: string, val: unknown): void => {
        sets.push(`${col} = $${i++}`);
        vals.push(val);
      };
      if (patch.planTier !== undefined) push('plan_tier', patch.planTier);
      if (patch.plan !== undefined) push('plan', patch.plan);
      if (patch.status !== undefined) push('status', patch.status);
      if (patch.seats !== undefined) push('seats', patch.seats);
      if (patch.providerCustomerId !== undefined)
        push('provider_customer_id', patch.providerCustomerId);
      if (patch.providerSubscriptionId !== undefined)
        push('provider_subscription_id', patch.providerSubscriptionId);
      if (patch.currentPeriodEnd !== undefined) push('current_period_end', patch.currentPeriodEnd);
      if (patch.trialEndsAt !== undefined) push('trial_ends_at', patch.trialEndsAt);
      if (sets.length === 0) return getByOrg(orgId);
      vals.push(orgId);
      const { rows } = await query<SubscriptionRow>(
        `UPDATE subscriptions SET ${sets.join(', ')} WHERE org_id = $${i} RETURNING ${COLS}`,
        vals,
      );
      return rows[0] ? toSubscription(rows[0]) : null;
    },
  };
}

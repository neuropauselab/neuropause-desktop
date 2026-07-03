/**
 * The payment gateway abstraction the billing routes depend on. The production
 * implementation wraps the Razorpay SDK; tests inject a stub. This is what keeps
 * the routes unit-testable without live payment calls.
 */
import type { BillingPlanId } from '@neuropause/shared';

export interface CreateSubscriptionInput {
  orgId: string;
  plan: BillingPlanId;
  seats: number;
  /** Days of trial before the first charge (0 = charge immediately). */
  trialDays: number;
}

export interface CreatedSubscription {
  subscriptionId: string;
  customerId: string | null;
  /** Hosted checkout / authorization URL the customer is sent to. */
  shortUrl: string;
  status: string;
}

export interface BillingGateway {
  createSubscription(input: CreateSubscriptionInput): Promise<CreatedSubscription>;
  cancelSubscription(subscriptionId: string, atCycleEnd: boolean): Promise<void>;
}

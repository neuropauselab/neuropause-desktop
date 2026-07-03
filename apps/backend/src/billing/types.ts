/**
 * Billing types. The Razorpay *subscription shape* below is a deliberately minimal
 * local projection of the fields the lifecycle logic reads — kept here so the pure
 * logic (and its tests) need no Razorpay SDK. The real webhook handler (wired with
 * the Razorpay SDK) maps Razorpay's objects onto this shape.
 */
export interface RazorpaySubscriptionShape {
  /** Razorpay subscription id (e.g. sub_XXXXXXXX). */
  id: string;
  /** Razorpay customer id (e.g. cust_XXXXXXXX). */
  customerId: string;
  /** Razorpay plan id (e.g. plan_XXXXXXXX) — drives plan resolution. */
  planId: string;
  /** Raw Razorpay status (created/authenticated/active/pending/halted/cancelled/completed/expired). */
  status: string;
  /** Seat quantity on the subscription. */
  quantity: number;
  /** Unix seconds — end of the current billing cycle. */
  currentEnd: number | null;
  /** Unix seconds — when charging starts (a future value = trial). */
  startAt: number | null;
  /** Unix seconds — next scheduled charge. */
  chargeAt: number | null;
  /** Unix seconds — when the subscription ended, or null. */
  endedAt: number | null;
}

export type BillingErrorCode = 'unknown_plan' | 'billing_disabled' | 'no_subscription';

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

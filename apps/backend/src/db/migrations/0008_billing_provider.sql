-- 0008_billing_provider: make the payment-provider linkage columns gateway-neutral.
--
-- The subscription's customer/subscription ids belong to whichever payment gateway
-- is in use (currently Razorpay). The columns are renamed off their original
-- Stripe-specific names so the schema isn't tied to a single provider.

ALTER TABLE subscriptions RENAME COLUMN stripe_customer_id TO provider_customer_id;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id TO provider_subscription_id;

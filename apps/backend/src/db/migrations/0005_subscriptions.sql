-- 0005_subscriptions: per-organization subscription (billing foundation only).
-- Stripe linkage columns are present but nullable — real billing is deferred
-- until explicitly approved. plan_tier mirrors @neuropause/shared PLAN_TIERS
-- ('free' | 'pro' | 'enterprise').

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  plan_tier              TEXT NOT NULL DEFAULT 'free'
                           CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  seats                  INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 0),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

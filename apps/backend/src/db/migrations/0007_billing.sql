-- 0007_billing: add the commercial billing plan + trial expiry to subscriptions.
--
-- Reuses the existing subscriptions table (no parallel billing schema). `plan` is
-- the SaaS plan the organization bought (trial / starter / professional /
-- enterprise); the existing `plan_tier` remains the coarse feature-gating bucket,
-- derived from the plan. `plan` is nullable — the default free subscription that
-- every org starts with has no commercial plan until one is purchased.

ALTER TABLE subscriptions
  ADD COLUMN plan TEXT CHECK (plan IN ('trial', 'starter', 'professional', 'enterprise')),
  ADD COLUMN trial_ends_at TIMESTAMPTZ;

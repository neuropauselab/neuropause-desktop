-- 0015_account_deletion: soft-delete tracking for account deletion lifecycle.
-- Records the request, confirmation, and execution of account deletion,
-- plus a retention window for legal/compliance obligations.

CREATE TABLE account_deletion_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'executed', 'cancelled')),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,
  reason          TEXT
);

CREATE INDEX account_deletion_user_idx ON account_deletion_requests (user_id, status);

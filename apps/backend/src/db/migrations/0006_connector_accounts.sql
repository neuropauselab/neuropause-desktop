-- 0006_connector_accounts: cloud-side records of connected SaaS accounts.
--
-- Metadata ONLY. OAuth tokens are NEVER stored here — they remain in the desktop
-- keychain. This row records THAT an account is connected and its health, so an
-- admin surface can show "user connected GitHub" without the cloud holding
-- credentials. `provider` is open text (e.g. 'github', 'notion', 'slack',
-- 'google-calendar'), matching the desktop connector ids. One account per
-- (org, user, provider).

CREATE TABLE connector_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  external_account_id TEXT,
  display_name        TEXT,
  status              TEXT NOT NULL DEFAULT 'connected'
                        CHECK (status IN ('connected', 'revoked', 'error')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, provider)
);

CREATE INDEX connector_accounts_org_idx ON connector_accounts (org_id);
CREATE INDEX connector_accounts_user_idx ON connector_accounts (user_id);

CREATE TRIGGER connector_accounts_set_updated_at
  BEFORE UPDATE ON connector_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
